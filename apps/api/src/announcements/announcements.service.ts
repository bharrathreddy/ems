import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import { currentYear } from '../common/academic-year';
import { readJson } from '../common/json';
import type { RequestUser } from '../common/request-user';
import { studentFilter } from '../students/student-scope';

export type Audience =
  | { type: 'all' } | { type: 'staff' } | { type: 'families' }
  | { type: 'classes'; ids: number[] } | { type: 'sections'; ids: number[] };

export interface AnnouncementInput { title: string; body: string; audience: Audience; expireAt?: string | null; publish?: boolean; isPublic?: boolean }
type Meta = { ip: string | null; userAgent: string | null };

@Injectable()
export class AnnouncementsService {
  constructor(@Inject(KYSELY) private readonly db: Database, private readonly audit: AuditService) {}

  private canManage(u: RequestUser) {
    return u.workspace === 'staff' && (u.permissions.has('announcements.create') || u.permissions.has('announcements.publish'));
  }

  /** What this user may read: staff see staff-facing and school-wide notices; families see notices for their children. */
  async list(user: RequestUser, q: { includeDrafts: boolean }) {
    const year = await currentYear(this.db);
    const rows = await this.db.selectFrom('announcements as a').innerJoin('users as u', 'u.id', 'a.created_by')
      .select(['a.id', 'a.title', 'a.body_html as body', 'a.audience', 'a.status', 'a.is_public', 'a.publish_at', 'a.expire_at', 'a.created_at', 'u.name as author', 'a.created_by'])
      .orderBy(sql`COALESCE(a.publish_at, a.created_at)`, 'desc').limit(200).execute();
    const now = new Date();
    let familySections: Set<number> | null = null, familyClasses: Set<number> | null = null;
    if (user.workspace !== 'staff') {
      const kids = await this.db.selectFrom('students as s').innerJoin('families as f', 'f.id', 's.family_id')
        .innerJoin('enrollments as e', (j) => j.onRef('e.student_id', '=', 's.id').on('e.academic_year_id', '=', year.id))
        .select(['e.section_id', 'e.class_id']).where('s.status', '=', 'active')
        .where(user.workspace === 'parent' ? 'f.user_id' : 's.user_id', '=', user.id).execute();
      familySections = new Set(kids.map((k) => k.section_id));
      familyClasses = new Set(kids.map((k) => k.class_id));
    }
    const manage = this.canManage(user);
    return rows
      .map((r) => ({ ...r, audience: readJson<Audience>(r.audience)! }))
      .filter((r) => {
        const live = r.status === 'published' && (!r.publish_at || r.publish_at <= now) && (!r.expire_at || r.expire_at > now);
        if (user.workspace === 'staff') {
          if (manage && (q.includeDrafts || live)) return q.includeDrafts ? true : live;
          return live && ['all', 'staff', 'classes', 'sections'].includes(r.audience.type);
        }
        if (!live) return false;
        const a = r.audience;
        return a.type === 'all' || a.type === 'families'
          || (a.type === 'sections' && a.ids.some((id) => familySections!.has(id)))
          || (a.type === 'classes' && a.ids.some((id) => familyClasses!.has(id)));
      })
      .map(({ created_by, ...r }) => ({ ...r, mine: created_by === user.id }));
  }

  /** Class teachers (section scope) may only address their own sections. */
  private async assertAudienceAllowed(user: RequestUser, a: Audience) {
    const scope = user.permissions.get('announcements.create');
    if (scope === 'all' || user.permissions.get('announcements.publish') === 'all') return;
    const year = await currentYear(this.db);
    const f = await studentFilter(this.db, { ...user, permissions: new Map([['x', scope!]]) } as RequestUser, 'x', year.id);
    if (a.type !== 'sections' || f.kind !== 'sections' || !a.ids.every((id) => f.sectionIds.includes(id))) {
      throw Errors.badRequest('AUDIENCE_NOT_ALLOWED', 'You can only send notices to your own sections.');
    }
  }

  async create(user: RequestUser, input: AnnouncementInput, meta: Meta) {
    await this.assertAudienceAllowed(user, input.audience);
    const res = await this.db.insertInto('announcements').values({
      title: input.title, body_html: input.body, audience: JSON.stringify(input.audience), status: 'draft', is_public: input.isPublic ? 1 : 0,
      expire_at: input.expireAt ? new Date(input.expireAt) : null, created_by: user.id,
    }).executeTakeFirstOrThrow();
    const id = Number(res.insertId);
    await this.audit.log(user, { module: 'announcements', action: 'create', entityType: 'announcement', entityId: id, after: input, ...meta });
    if (input.publish && user.permissions.has('announcements.publish')) return this.publish(user, id, meta);
    return { id, status: 'draft' };
  }

  async publish(user: RequestUser, id: number, meta: Meta) {
    const a = await this.db.selectFrom('announcements').selectAll().where('id', '=', id).executeTakeFirst();
    if (!a) throw Errors.notFound('Announcement');
    if (a.status === 'published') return { id, status: 'published', notified: 0 };
    const audience = readJson<Audience>(a.audience)!;
    const notified = await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('announcements').set({ status: 'published', publish_at: new Date() }).where('id', '=', id).execute();
      const n = await this.notify(trx, audience, a.title, a.body_html, id);
      await this.audit.log(user, { module: 'announcements', action: 'publish', entityType: 'announcement', entityId: id, after: { notified: n }, ...meta }, trx);
      return n;
    });
    return { id, status: 'published', notified };
  }

  async archive(user: RequestUser, id: number, meta: Meta) {
    const a = await this.db.selectFrom('announcements').select(['id', 'created_by', 'status']).where('id', '=', id).executeTakeFirst();
    if (!a) throw Errors.notFound('Announcement');
    if (a.created_by !== user.id && !user.permissions.has('announcements.publish')) throw Errors.forbidden();
    await this.db.updateTable('announcements').set({ status: 'archived' }).where('id', '=', id).execute();
    await this.audit.log(user, { module: 'announcements', action: 'archive', entityType: 'announcement', entityId: id, ...meta });
    return { id, status: 'archived' };
  }

  /** One in-app notification per recipient, written in bulk (INSERT ... SELECT). */
  private async notify(trx: Database, a: Audience, title: string, body: string, id: number) {
    const year = await currentYear(trx);
    const preview = body.replace(/\s+/g, ' ').slice(0, 200);
    const link = `/announcements#${id}`;
    let total = 0;
    if (a.type === 'all' || a.type === 'staff') {
      const r = await sql`INSERT INTO notifications (user_id, workspace, category, push_group, title, body, link_path)
        SELECT u.id, 'staff', 'communication', 'notices', ${title}, ${preview}, ${link}
        FROM users u JOIN staff s ON s.user_id = u.id WHERE u.status = 'active' AND s.status = 'active'`.execute(trx);
      total += Number(r.numAffectedRows ?? 0);
    }
    if (a.type !== 'staff') {
      const where = a.type === 'sections' ? sql`AND e.section_id IN (${sql.join(a.ids)})`
        : a.type === 'classes' ? sql`AND e.class_id IN (${sql.join(a.ids)})` : sql``;
      const r = await sql`INSERT INTO notifications (user_id, workspace, category, push_group, title, body, link_path)
        SELECT DISTINCT f.user_id, 'parent', 'communication', 'notices', ${title}, ${preview}, ${link}
        FROM families f JOIN students s ON s.family_id = f.id AND s.status = 'active'
        JOIN enrollments e ON e.student_id = s.id AND e.academic_year_id = ${year.id}
        JOIN users u ON u.id = f.user_id AND u.status = 'active'
        WHERE 1 = 1 ${where}`.execute(trx);
      total += Number(r.numAffectedRows ?? 0);
    }
    return total;
  }
}

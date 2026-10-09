import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { sql } from 'kysely';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { readJson } from '../common/json';

export type ActivityType = 'signin' | 'change' | 'download';
export interface ActivityQuery { from?: string; to?: string; type?: ActivityType; userId?: string; proxyOnly?: boolean; module?: string; before?: string; limit?: number }
export interface ActivityRow {
  id: string; at: string; type: ActivityType; userId: string | null; who: string; workspace: string | null; actingName: string | null;
  module: string | null; action: string; success: boolean; reason: string | null; entityType: string | null; entityId: number | null; entity: string | null;
  before: unknown; after: unknown; ip: string | null; device: string | null;
}

/** Days kept (agreed: 2 years, then deleted). */
export const RETENTION_DAYS = 730;
const IST = '+05:30';
const istStart = (d: string) => new Date(`${d}T00:00:00${IST}`);
const istEnd = (d: string) => new Date(new Date(`${d}T00:00:00${IST}`).getTime() + 86_400_000);

/** "Chrome on Android" from a user agent, enough to recognise a device. */
export function deviceOf(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iOS/i.test(ua) ? 'iPhone' : /Windows/i.test(ua) ? 'Windows' : /Mac OS X|Macintosh/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : null;
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /node|curl|axios|supertest|okhttp/i.test(ua) ? 'App or script' : null;
  return br && os ? `${br} on ${os}` : br ?? os ?? ua.slice(0, 40);
}

@Injectable()
export class ActivityService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Activity');
  private timer: NodeJS.Timeout | null = null;
  constructor(@Inject(KYSELY) private readonly db: Database) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.RETENTION_WORKER === 'off') return;
    const run = () => void this.purge().catch((e) => this.logger.error(e?.message ?? e));
    setTimeout(run, 60_000).unref?.();
    this.timer = setInterval(run, 12 * 3600_000);
    this.timer.unref?.();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  /** Deletes log entries older than the retention period. */
  async purge(now = new Date()) {
    const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86_400_000);
    const a = await this.db.deleteFrom('audit_logs').where('created_at', '<', cutoff).executeTakeFirst();
    const l = await this.db.deleteFrom('login_logs').where('created_at', '<', cutoff).executeTakeFirst();
    const n = { changes: Number(a.numDeletedRows), signIns: Number(l.numDeletedRows) };
    if (n.changes || n.signIns) this.logger.log(`Removed log entries older than 2 years: ${n.changes} changes, ${n.signIns} sign-ins`);
    return n;
  }

  /** People the developer can open the app as. */
  async proxyUsers(q: { type?: 'staff' | 'driver' | 'parent' | 'student'; search?: string }) {
    const term = q.search?.trim();
    const like = term ? `%${term}%` : null;
    const out: Array<{ id: string; name: string; kind: string; detail: string; mobile: string | null; email: string | null; active: boolean }> = [];
    if (!q.type || q.type === 'staff' || q.type === 'driver') {
      let s = this.db.selectFrom('staff as s').innerJoin('users as u', 'u.id', 's.user_id')
        .select(['u.public_id', 'u.name', 'u.mobile', 'u.email', 'u.status', 'u.id as uid', 's.employee_code', 's.designation']).where('s.deleted_at', 'is', null).where('u.is_super_admin', '=', 0);
      if (like) s = s.where((eb) => eb.or([eb('u.name', 'like', like), eb('u.mobile', 'like', like), eb('u.email', 'like', like), eb('s.employee_code', 'like', like)]));
      const rows = await s.orderBy('u.name').limit(60).execute();
      const roles = rows.length ? await this.db.selectFrom('user_roles as ur').innerJoin('roles as r', 'r.id', 'ur.role_id').select(['ur.user_id', 'r.name', 'r.role_key'])
        .where('ur.user_id', 'in', rows.map((r) => r.uid)).where('r.workspace', '=', 'staff').execute() : [];
      for (const r of rows) {
        const mine = roles.filter((x) => x.user_id === r.uid);
        const driver = mine.some((x) => x.role_key === 'driver');
        if (q.type === 'driver' && !driver) continue;
        out.push({ id: r.public_id, name: r.name, kind: driver ? 'Driver' : 'Staff', detail: [r.employee_code, mine.map((x) => x.name).join(', ') || r.designation].filter(Boolean).join(' · '), mobile: r.mobile, email: r.email, active: r.status === 'active' });
      }
    }
    if (!q.type || q.type === 'parent') {
      let f = this.db.selectFrom('families as f').innerJoin('users as u', 'u.id', 'f.user_id')
        .select(['u.public_id', 'u.name', 'u.mobile', 'u.email', 'u.status', 'f.id as fid', 'f.family_name']).where('u.is_super_admin', '=', 0);
      if (like) f = f.where((eb) => eb.or([eb('u.name', 'like', like), eb('u.mobile', 'like', like), eb('f.family_name', 'like', like), eb('f.father_name', 'like', like), eb('f.mother_name', 'like', like),
        eb.exists(eb.selectFrom('students as st').select('st.id').whereRef('st.family_id', '=', 'f.id').where((e2) => e2.or([e2('st.first_name', 'like', like), e2('st.admission_no', 'like', like)])))]));
      const rows = await f.orderBy('u.name').limit(60).execute();
      const kids = rows.length ? await this.db.selectFrom('students').select(['family_id', 'first_name', 'status']).where('family_id', 'in', rows.map((r) => r.fid)).execute() : [];
      for (const r of rows) {
        const ks = kids.filter((k) => k.family_id === r.fid);
        out.push({ id: r.public_id, name: r.name, kind: 'Parent', detail: ks.length ? `Parent of ${ks.map((k) => k.first_name + (k.status === 'active' ? '' : ' (left)')).join(', ')}` : r.family_name, mobile: r.mobile, email: r.email, active: r.status === 'active' });
      }
    }
    if (!q.type || q.type === 'student') {
      let st = this.db.selectFrom('students as st').innerJoin('users as u', 'u.id', 'st.user_id').select(['u.public_id', 'u.name', 'u.mobile', 'u.email', 'u.status', 'st.admission_no']).where('u.is_super_admin', '=', 0);
      if (like) st = st.where((eb) => eb.or([eb('u.name', 'like', like), eb('st.admission_no', 'like', like), eb('u.mobile', 'like', like)]));
      for (const r of await st.orderBy('u.name').limit(60).execute()) out.push({ id: r.public_id, name: r.name, kind: 'Student', detail: `Adm ${r.admission_no}`, mobile: r.mobile, email: r.email, active: r.status === 'active' });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 80);
  }

  async list(q: ActivityQuery): Promise<{ rows: ActivityRow[]; next: string | null }> {
    const limit = Math.min(q.limit ?? 100, 500);
    const from = q.from ? istStart(q.from) : null, to = q.to ? istEnd(q.to) : null;
    const before = q.before ? new Date(q.before) : null;
    if (before && Number.isNaN(before.getTime())) throw Errors.validation([{ field: 'before', message: 'Bad position.' }]);
    let uid: number | null = null;
    if (q.userId) {
      const u = await this.db.selectFrom('users').select('id').where('public_id', '=', q.userId).executeTakeFirst();
      if (!u) return { rows: [], next: null };
      uid = u.id;
    }
    const wantSignins = (!q.type || q.type === 'signin') && !q.proxyOnly && !q.module;
    const wantAudit = q.type !== 'signin';
    const rows: ActivityRow[] = [];

    if (wantSignins) {
      let s = this.db.selectFrom('login_logs as l').leftJoin('users as u', 'u.id', 'l.user_id')
        .select(['l.id', 'l.created_at', 'l.identifier', 'l.success', 'l.reason', 'l.ip_address', 'l.user_agent', 'u.public_id', 'u.name']);
      if (from) s = s.where('l.created_at', '>=', from);
      if (to) s = s.where('l.created_at', '<', to);
      if (before) s = s.where('l.created_at', '<', before);
      if (uid) s = s.where('l.user_id', '=', uid);
      for (const r of await s.orderBy('l.created_at', 'desc').orderBy('l.id', 'desc').limit(limit).execute()) {
        rows.push({
          id: `l${r.id}`, at: new Date(r.created_at).toISOString(), type: 'signin', userId: r.public_id, who: r.name ?? r.identifier, workspace: null, actingName: null,
          module: 'auth', action: r.reason === 'logout' ? 'logout' : r.success ? 'login' : 'login_failed', success: !!r.success, reason: r.reason === 'logout' ? null : r.reason,
          entityType: null, entityId: null, entity: r.name ? null : r.identifier, before: null, after: null, ip: r.ip_address, device: deviceOf(r.user_agent),
        });
      }
    }
    if (wantAudit) {
      let a = this.db.selectFrom('audit_logs as a').leftJoin('users as u', 'u.id', 'a.user_id').leftJoin('users as d', 'd.id', 'a.acting_user_id')
        .select(['a.id', 'a.created_at', 'a.workspace', 'a.module_key', 'a.action', 'a.entity_type', 'a.entity_id', 'a.before_data', 'a.after_data', 'a.ip_address', 'a.user_agent',
          'u.public_id', 'u.name', 'd.name as acting_name']);
      if (from) a = a.where('a.created_at', '>=', from);
      if (to) a = a.where('a.created_at', '<', to);
      if (before) a = a.where('a.created_at', '<', before);
      if (uid) a = a.where((eb) => eb.or([eb('a.user_id', '=', uid!), eb('a.acting_user_id', '=', uid!)]));
      if (q.proxyOnly) a = a.where((eb) => eb.or([eb('a.acting_user_id', 'is not', null), eb.and([eb('a.module_key', '=', 'auth'), eb('a.action', 'in', ['proxy_start', 'proxy_end'])])]));
      if (q.module) a = a.where('a.module_key', '=', q.module);
      if (q.type === 'download') a = a.where('a.action', 'in', ['export', 'download']);
      if (q.type === 'change') a = a.where('a.action', 'not in', ['export', 'download']);
      for (const r of await a.orderBy('a.created_at', 'desc').orderBy('a.id', 'desc').limit(limit).execute()) {
        rows.push({
          id: `a${r.id}`, at: new Date(r.created_at).toISOString(), type: r.action === 'export' || r.action === 'download' ? 'download' : 'change',
          userId: r.public_id, who: r.name ?? (r.workspace === 'system' ? 'System' : 'Unknown'), workspace: r.workspace, actingName: r.acting_name,
          module: r.module_key, action: r.action, success: true, reason: null, entityType: r.entity_type, entityId: r.entity_id, entity: null,
          before: readJson(r.before_data), after: readJson(r.after_data), ip: r.ip_address, device: deviceOf(r.user_agent),
        });
      }
    }
    rows.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : y.id.localeCompare(x.id)));
    const page = rows.slice(0, limit);
    await this.nameEntities(page);
    // Next page: everything strictly older than the last row shown (rows sharing that millisecond are rare; they come on the next page).
    return { rows: page, next: rows.length > limit || page.length === limit ? page[page.length - 1].at : null };
  }

  /** Readable names for the records an entry is about ("Divya Sri", "RCPT/2026-27/00012"). */
  private async nameEntities(rows: ActivityRow[]) {
    const ids = (t: string) => [...new Set(rows.filter((r) => r.entityType === t && r.entityId).map((r) => r.entityId!))];
    const map = new Map<string, string>();
    const put = (t: string, list: Array<{ id: number; label: string | null }>) => list.forEach((x) => x.label && map.set(`${t}:${x.id}`, x.label));
    const tasks: Array<Promise<void>> = [];
    const q = (t: string, fn: (list: number[]) => Promise<Array<{ id: number; label: string | null }>>) => { const l = ids(t); if (l.length) tasks.push(fn(l).then((r) => put(t, r))); };
    q('user', (l) => this.db.selectFrom('users').select(['id', 'name as label']).where('id', 'in', l).execute());
    q('staff', (l) => this.db.selectFrom('staff as s').innerJoin('users as u', 'u.id', 's.user_id').select(['s.id', 'u.name as label']).where('s.id', 'in', l).execute());
    q('student', (l) => this.db.selectFrom('students').select(['id', sql<string>`CONCAT_WS(' ', first_name, last_name, CONCAT('(Adm ', admission_no, ')'))`.as('label')]).where('id', 'in', l).execute());
    q('family', (l) => this.db.selectFrom('families').select(['id', 'family_name as label']).where('id', 'in', l).execute());
    q('class', (l) => this.db.selectFrom('classes').select(['id', 'name as label']).where('id', 'in', l).execute());
    q('section', (l) => this.db.selectFrom('sections as s').innerJoin('classes as c', 'c.id', 's.class_id').select(['s.id', sql<string>`CONCAT(c.name, ' ', s.name)`.as('label')]).where('s.id', 'in', l).execute());
    q('payment', (l) => this.db.selectFrom('payments').select(['id', 'receipt_no as label']).where('id', 'in', l).execute());
    q('sale', (l) => this.db.selectFrom('sales').select(['id', 'receipt_no as label']).where('id', 'in', l).execute());
    q('expense', (l) => this.db.selectFrom('expenses').select(['id', 'voucher_no as label']).where('id', 'in', l).execute());
    q('announcement', (l) => this.db.selectFrom('announcements').select(['id', 'title as label']).where('id', 'in', l).execute());
    q('inventory_item', (l) => this.db.selectFrom('inventory_items').select(['id', 'name as label']).where('id', 'in', l).execute());
    q('vehicle', (l) => this.db.selectFrom('vehicles').select(['id', 'reg_no as label']).where('id', 'in', l).execute());
    q('bus_route', (l) => this.db.selectFrom('bus_routes').select(['id', 'name as label']).where('id', 'in', l).execute());
    q('academic_year', (l) => this.db.selectFrom('academic_years').select(['id', 'name as label']).where('id', 'in', l).execute());
    q('exam', (l) => this.db.selectFrom('exams').select(['id', 'name as label']).where('id', 'in', l).execute());
    await Promise.all(tasks);
    for (const r of rows) if (r.entityType && r.entityId) r.entity = map.get(`${r.entityType}:${r.entityId}`) ?? r.entity;
  }

  /** Module keys present in the log, for the filter. */
  async modules() {
    return (await this.db.selectFrom('audit_logs').select('module_key').distinct().orderBy('module_key').execute()).map((r) => r.module_key);
  }
}

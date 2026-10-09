import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import { FilesService } from '../common/files.service';
import { currentYear } from '../common/academic-year';
import type { RequestUser } from '../common/request-user';
import { iso, schoolToday } from '../attendance/calendar';
import { teacherSectionIds, visibleStudentId } from '../students/student-scope';

type Meta = { ip: string | null; userAgent: string | null };
export interface HomeworkInput { sectionId: number; subjectId?: number | null; type: 'homework' | 'diary'; title: string; details?: string | null; forDate?: string | null; dueDate?: string | null }
export interface Upload { buffer: Buffer; originalname: string; mimetype: string; size: number }

const MAX_FILE = 5 * 1024 * 1024;
/** Accept photos of the board/notebook and PDFs only, checked by their first bytes. */
export function assertAttachment(f: Upload) {
  const b = f.buffer;
  const ok = (b[0] === 0xff && b[1] === 0xd8) || b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) || b.subarray(0, 4).toString() === '%PDF'
    || (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP');
  if (!ok || !/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(f.mimetype)) throw Errors.badRequest('BAD_FILE', 'Attach a photo (JPG or PNG) or a PDF.');
  if (f.size > MAX_FILE) throw Errors.badRequest('FILE_TOO_LARGE', 'Attachments must be under 5 MB.');
}

/**
 * Homework and the class diary (requirement: any teacher of the section posts; parents see their child's).
 * "Teacher of the section" = class teacher or teaches any subject there this year.
 */
@Injectable()
export class HomeworkService {
  constructor(@Inject(KYSELY) private readonly db: Database, private readonly audit: AuditService, private readonly files: FilesService) {}

  /** Sections this staff member may see (view) or post to (post). null = every section. */
  private async sectionsFor(u: RequestUser, perm: 'homework.view' | 'homework.post', yearId: number): Promise<number[] | null> {
    if (u.workspace !== 'staff') return [];
    const scope = u.permissions.get(perm);
    if (!scope) return [];
    if (scope === 'all') return null;
    return teacherSectionIds(this.db, u.id, yearId);
  }

  private async sectionInfo(sectionId: number, yearId: number) {
    const s = await this.db.selectFrom('sections as s').innerJoin('classes as c', 'c.id', 's.class_id').select(['s.id', 's.name', 's.class_id', 'c.name as class_name'])
      .where('s.id', '=', sectionId).executeTakeFirst();
    if (!s) throw Errors.validation([{ field: 'sectionId', message: 'Choose a class and section.' }]);
    const subjects = await this.db.selectFrom('class_subjects as cs').innerJoin('subjects as sb', 'sb.id', 'cs.subject_id').select(['sb.id', 'sb.name'])
      .where('cs.academic_year_id', '=', yearId).where('cs.class_id', '=', s.class_id).orderBy('cs.display_order').orderBy('sb.name').execute();
    return { ...s, subjects };
  }

  /** What the "Post homework" form offers: the sections and their subjects (subjects you teach first). */
  async options(u: RequestUser) {
    const year = await currentYear(this.db);
    const ids = await this.sectionsFor(u, 'homework.post', year.id);
    let q = this.db.selectFrom('sections as s').innerJoin('classes as c', 'c.id', 's.class_id').select(['s.id', 's.name', 's.class_id', 'c.name as class_name'])
      .where('s.is_active', '=', 1).where('c.is_active', '=', 1).orderBy('c.level_order').orderBy('s.name');
    if (ids) q = ids.length ? q.where('s.id', 'in', ids) : q.where('s.id', '=', -1);
    const sections = await q.execute();
    const subj = sections.length ? await this.db.selectFrom('class_subjects as cs').innerJoin('subjects as sb', 'sb.id', 'cs.subject_id').select(['cs.class_id', 'sb.id', 'sb.name'])
      .where('cs.academic_year_id', '=', year.id).where('cs.class_id', 'in', [...new Set(sections.map((s) => s.class_id))]).orderBy('cs.display_order').orderBy('sb.name').execute() : [];
    const staff = await this.db.selectFrom('staff').select('id').where('user_id', '=', u.id).executeTakeFirst();
    const mine = staff ? await this.db.selectFrom('teacher_assignments').select(['section_id', 'subject_id']).where('staff_id', '=', staff.id).where('academic_year_id', '=', year.id).execute() : [];
    const ct = staff ? (await this.db.selectFrom('class_teachers').select('section_id').where('staff_id', '=', staff.id).where('academic_year_id', '=', year.id).execute()).map((r) => r.section_id) : [];
    return {
      today: await schoolToday(this.db),
      sections: sections.map((s) => {
        const taught = new Set(mine.filter((m) => m.section_id === s.id).map((m) => m.subject_id));
        const subjects = subj.filter((x) => x.class_id === s.class_id).map((x) => ({ id: x.id, name: x.name, mine: taught.has(x.id) }));
        return { id: s.id, label: `${s.class_name} ${s.name}`, classTeacher: ct.includes(s.id), subjects: [...subjects.filter((x) => x.mine), ...subjects.filter((x) => !x.mine)] };
      }).sort((a, b) => Number(b.classTeacher || mine.some((m) => m.section_id === b.id)) - Number(a.classTeacher || mine.some((m) => m.section_id === a.id))),
    };
  }

  private baseQuery() {
    return this.db.selectFrom('homework as h').innerJoin('sections as s', 's.id', 'h.section_id').innerJoin('classes as c', 'c.id', 's.class_id')
      .leftJoin('subjects as sb', 'sb.id', 'h.subject_id').innerJoin('users as u', 'u.id', 'h.posted_by').leftJoin('files as f', 'f.id', 'h.file_id')
      .select(['h.id', 'h.section_id', 'h.subject_id', 'h.entry_type', 'h.title', 'h.details', 'h.for_date', 'h.due_date', 'h.posted_by', 'h.created_at', 'h.updated_at',
        's.name as section', 'c.name as class_name', 'sb.name as subject', 'u.name as posted_by_name', 'f.original_name as file_name', 'f.mime_type as file_mime', 'f.size_bytes as file_size']);
  }
  private shape(r: Awaited<ReturnType<ReturnType<HomeworkService['baseQuery']>['execute']>>[number], canChange: boolean) {
    return {
      id: r.id, sectionId: r.section_id, className: `${r.class_name} ${r.section}`, subjectId: r.subject_id, subject: r.subject, type: r.entry_type, title: r.title, details: r.details,
      forDate: iso(r.for_date), dueDate: iso(r.due_date), postedBy: r.posted_by_name, createdAt: r.created_at, updatedAt: r.updated_at,
      file: r.file_name ? { name: r.file_name, mime: r.file_mime, size: Number(r.file_size) } : null, canChange,
    };
  }

  private async canChange(u: RequestUser, h: { posted_by: number; section_id: number }, yearId: number) {
    if (u.workspace !== 'staff' || !u.permissions.has('homework.post')) return false;
    if (h.posted_by === u.id || u.permissions.get('homework.post') === 'all') return true;
    const ct = await this.db.selectFrom('class_teachers as ct').innerJoin('staff as st', 'st.id', 'ct.staff_id').select('ct.section_id')
      .where('st.user_id', '=', u.id).where('ct.academic_year_id', '=', yearId).where('ct.section_id', '=', h.section_id).executeTakeFirst();
    return !!ct;
  }

  /** Staff list: by section and date range (defaults to the last 14 days and anything still due). */
  async list(u: RequestUser, f: { sectionId?: number; from?: string; to?: string; mine?: boolean }) {
    const year = await currentYear(this.db);
    const ids = await this.sectionsFor(u, 'homework.view', year.id);
    const today = await schoolToday(this.db);
    const from = f.from ?? new Date(Date.parse(`${today}T00:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10);
    let q = this.baseQuery().where('h.academic_year_id', '=', year.id).where('h.for_date', '>=', new Date(`${from}T00:00:00Z`));
    if (f.to) q = q.where('h.for_date', '<=', new Date(`${f.to}T00:00:00Z`));
    if (ids) q = ids.length ? q.where('h.section_id', 'in', ids) : q.where('h.id', '=', -1);
    if (f.sectionId) q = q.where('h.section_id', '=', f.sectionId);
    if (f.mine) q = q.where('h.posted_by', '=', u.id);
    const rows = await q.orderBy('h.for_date', 'desc').orderBy('h.id', 'desc').limit(300).execute();
    const ctOf = u.permissions.get('homework.post') === 'all' ? null : (await this.db.selectFrom('class_teachers as ct').innerJoin('staff as st', 'st.id', 'ct.staff_id').select('ct.section_id')
      .where('st.user_id', '=', u.id).where('ct.academic_year_id', '=', year.id).execute()).map((r) => r.section_id);
    const can = (r: { posted_by: number; section_id: number }) => u.permissions.has('homework.post') && (r.posted_by === u.id || ctOf === null || ctOf.includes(r.section_id));
    return { today, from, rows: rows.map((r) => this.shape(r, can(r))) };
  }

  /** For one student (parents, the student, or staff who can see the student). */
  async forStudent(u: RequestUser, studentPublicId: string) {
    const year = await currentYear(this.db);
    const sid = await visibleStudentId(this.db, u, studentPublicId, u.workspace === 'staff' ? 'students.view' : 'homework.view', year.id);
    const en = await this.db.selectFrom('enrollments').select('section_id').where('student_id', '=', sid).where('academic_year_id', '=', year.id).executeTakeFirst();
    if (!en) return { today: await schoolToday(this.db), rows: [] };
    if (u.workspace === 'staff') {
      const ids = await this.sectionsFor(u, 'homework.view', year.id);
      if (ids && !ids.includes(en.section_id)) throw Errors.forbidden();
    }
    const today = await schoolToday(this.db);
    const from = new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86_400_000);
    const rows = await this.baseQuery().where('h.section_id', '=', en.section_id).where('h.academic_year_id', '=', year.id)
      .where((eb) => eb.or([eb('h.for_date', '>=', from), eb('h.due_date', '>=', new Date(`${today}T00:00:00Z`))]))
      .orderBy('h.for_date', 'desc').orderBy('h.id', 'desc').limit(200).execute();
    return { today, rows: rows.map((r) => this.shape(r, false)) };
  }

  private async checkInput(u: RequestUser, b: HomeworkInput, yearId: number) {
    const ids = await this.sectionsFor(u, 'homework.post', yearId);
    if (ids && !ids.includes(b.sectionId)) throw Errors.badRequest('NOT_YOUR_SECTION', 'You can post only for sections where you are the class teacher or teach a subject.');
    const sec = await this.sectionInfo(b.sectionId, yearId);
    if (b.subjectId && !sec.subjects.some((s) => s.id === b.subjectId)) throw Errors.validation([{ field: 'subjectId', message: `This subject is not taught in ${sec.class_name}.` }]);
    const today = await schoolToday(this.db);
    const forDate = b.forDate || today;
    if (b.dueDate && b.dueDate < forDate) throw Errors.validation([{ field: 'dueDate', message: 'The due date is before the date it was given.' }]);
    return { sec, forDate };
  }

  async create(u: RequestUser, b: HomeworkInput, file: Upload | undefined, meta: Meta) {
    const year = await currentYear(this.db);
    const { sec, forDate } = await this.checkInput(u, b, year.id);
    if (file) assertAttachment(file);
    const fileId = file ? await this.files.save(file.buffer, file.originalname, file.mimetype, 'homework', u.id) : null;
    const subject = b.subjectId ? sec.subjects.find((s) => s.id === b.subjectId)!.name : null;
    const id = await this.db.transaction().execute(async (trx) => {
      const id = Number((await trx.insertInto('homework').values({
        academic_year_id: year.id, section_id: b.sectionId, subject_id: b.subjectId ?? null, entry_type: b.type, title: b.title, details: b.details || null,
        for_date: new Date(`${forDate}T00:00:00Z`), due_date: b.dueDate ? new Date(`${b.dueDate}T00:00:00Z`) : null, file_id: fileId, posted_by: u.id,
      }).executeTakeFirstOrThrow()).insertId);
      const head = `${b.type === 'diary' ? 'Class diary' : 'Homework'}${subject ? ` · ${subject}` : ''}`;
      const body = [b.title, b.dueDate ? `Due ${new Date(`${b.dueDate}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })}` : null].filter(Boolean).join(' · ').slice(0, 300);
      // One alert per child, to the parent login and to the student's own login if they have one.
      await sql`INSERT INTO notifications (user_id, workspace, category, push_group, title, body, link_path)
        SELECT f.user_id, 'parent', 'academic', 'notices', CONCAT(${head}, ': ', s.first_name), ${body}, CONCAT('/students/', s.public_id, '?tab=homework')
        FROM enrollments e JOIN students s ON s.id = e.student_id AND s.status = 'active'
        JOIN families f ON f.id = s.family_id JOIN users u ON u.id = f.user_id AND u.status = 'active'
        WHERE e.section_id = ${b.sectionId} AND e.academic_year_id = ${year.id}`.execute(trx);
      await sql`INSERT INTO notifications (user_id, workspace, category, push_group, title, body, link_path)
        SELECT s.user_id, 'student', 'academic', 'notices', ${head}, ${body}, CONCAT('/students/', s.public_id, '?tab=homework')
        FROM enrollments e JOIN students s ON s.id = e.student_id AND s.status = 'active' JOIN users u ON u.id = s.user_id AND u.status = 'active'
        WHERE e.section_id = ${b.sectionId} AND e.academic_year_id = ${year.id}`.execute(trx);
      await this.audit.log(u, { module: 'homework', action: 'post', entityType: 'homework', entityId: id, after: { ...b, forDate, file: file?.originalname ?? null }, ...meta }, trx);
      return id;
    });
    return this.one(u, id);
  }

  private async row(id: number) {
    const r = await this.baseQuery().select(['h.academic_year_id', 'h.file_id']).where('h.id', '=', id).executeTakeFirst();
    if (!r) throw Errors.notFound('Homework');
    return r;
  }

  async one(u: RequestUser, id: number) {
    const r = await this.row(id);
    return this.shape(r, await this.canChange(u, r, r.academic_year_id));
  }

  async update(u: RequestUser, id: number, b: Partial<Omit<HomeworkInput, 'sectionId'>>, meta: Meta) {
    const r = await this.row(id);
    if (!(await this.canChange(u, r, r.academic_year_id))) throw Errors.badRequest('NOT_YOURS', 'Only the teacher who posted this, or the class teacher, can change it.');
    const merged = { sectionId: r.section_id, subjectId: b.subjectId !== undefined ? b.subjectId : r.subject_id, type: b.type ?? r.entry_type, title: b.title ?? r.title,
      details: b.details !== undefined ? b.details : r.details, forDate: b.forDate ?? iso(r.for_date), dueDate: b.dueDate !== undefined ? b.dueDate : iso(r.due_date) };
    const { forDate } = await this.checkInput({ ...u, permissions: new Map([...u.permissions, ['homework.post', 'all']]) } as RequestUser, merged, r.academic_year_id);
    await this.db.updateTable('homework').set({ subject_id: merged.subjectId ?? null, entry_type: merged.type, title: merged.title, details: merged.details || null,
      for_date: new Date(`${forDate}T00:00:00Z`), due_date: merged.dueDate ? new Date(`${merged.dueDate}T00:00:00Z`) : null }).where('id', '=', id).execute();
    await this.audit.log(u, { module: 'homework', action: 'edit', entityType: 'homework', entityId: id, before: { title: r.title, dueDate: iso(r.due_date) }, after: b, ...meta });
    return this.one(u, id);
  }

  async remove(u: RequestUser, id: number, meta: Meta) {
    const r = await this.row(id);
    if (!(await this.canChange(u, r, r.academic_year_id))) throw Errors.badRequest('NOT_YOURS', 'Only the teacher who posted this, or the class teacher, can delete it.');
    await this.db.deleteFrom('homework').where('id', '=', id).execute();
    await this.audit.log(u, { module: 'homework', action: 'delete', entityType: 'homework', entityId: id, before: { title: r.title, className: `${r.class_name} ${r.section}`, forDate: iso(r.for_date) }, ...meta });
    return { id };
  }

  /** The attachment, for anyone who can see this entry. */
  async file(u: RequestUser, id: number) {
    const r = await this.row(id);
    if (!r.file_id) throw Errors.notFound('Attachment');
    if (u.workspace === 'staff') {
      const ids = await this.sectionsFor(u, 'homework.view', r.academic_year_id);
      if (ids && !ids.includes(r.section_id)) throw Errors.notFound('Attachment');
    } else {
      const scope = u.permissions.get('homework.view');
      let q = this.db.selectFrom('enrollments as e').innerJoin('students as s', 's.id', 'e.student_id').innerJoin('families as f', 'f.id', 's.family_id').select('s.id')
        .where('e.section_id', '=', r.section_id).where('e.academic_year_id', '=', r.academic_year_id);
      q = scope === 'own_children' ? q.where('f.user_id', '=', u.id) : scope === 'own_records' ? q.where('s.user_id', '=', u.id) : q.where('s.id', '=', -1);
      if (!(await q.executeTakeFirst())) throw Errors.notFound('Attachment');
    }
    const f = await this.db.selectFrom('files').select(['storage_path', 'mime_type', 'original_name']).where('id', '=', r.file_id).executeTakeFirstOrThrow();
    return f;
  }
}

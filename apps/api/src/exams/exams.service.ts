import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import { resolveYear } from '../common/academic-year';
import type { RequestUser } from '../common/request-user';
import { iso } from '../attendance/calendar';
import { rank, studentResult, type Band, type ClassRule, type ExamDef, type MarkCell } from './results';

type Meta = { ip: string | null; userAgent: string | null };
const PRE = /nursery|lkg|ukg|pre[- ]?primary|play/i;
const classNo = (name: string) => Number(/(\d+)/.exec(name)?.[1] ?? 0);
const DEFAULT_EXAMS: Array<[string, string, 'fa' | 'sa', number, number]> = [
  ['FA1', 'Formative Assessment 1', 'fa', 1, 20], ['FA2', 'Formative Assessment 2', 'fa', 1, 20], ['SA1', 'Summative Assessment 1', 'sa', 1, 80],
  ['FA3', 'Formative Assessment 3', 'fa', 2, 20], ['FA4', 'Formative Assessment 4', 'fa', 2, 20], ['SA2', 'Summative Assessment 2', 'sa', 2, 80],
];
export const CO_AREAS = ['Value education & life skills', 'Art & cultural education', 'Work & computer education', 'Physical & health education'];
const SKILLS: Array<[string, string[]]> = [
  ['Language', ['Recognises letters and sounds', 'Speaks in full sentences', 'Listens to and retells a story']],
  ['Numbers', ['Counts objects correctly', 'Recognises numbers', 'Understands bigger and smaller']],
  ['General awareness', ['Knows colours and shapes', 'Talks about family, home and nature']],
  ['Motor skills', ['Holds a pencil correctly', 'Colours within lines', 'Runs, jumps and balances']],
  ['Social & emotional', ['Shares and takes turns', 'Follows class routines', 'Expresses feelings']],
  ['Creative arts', ['Enjoys drawing and craft', 'Joins in songs, rhymes and dance']],
];

@Injectable()
export class ExamsService {
  constructor(@Inject(KYSELY) private readonly db: Database, private readonly audit: AuditService) {}

  // ---------------- Defaults for a year (idempotent) ----------------
  async ensureYear(yearId: number) {
    const has = await this.db.selectFrom('exams').select('id').where('academic_year_id', '=', yearId).executeTakeFirst();
    const scales = new Map((await this.db.selectFrom('grade_scales').select(['id', 'name']).execute()).map((s) => [s.name, s.id]));
    const classes = await this.db.selectFrom('classes').select(['id', 'name']).where('is_active', '=', 1).orderBy('level_order').execute();
    await this.db.transaction().execute(async (trx) => {
      for (const c of classes) {
        const pre = PRE.test(c.name);
        await trx.insertInto('class_exam_settings').values({ academic_year_id: yearId, class_id: c.id, assessment: pre ? 'skills' : 'marks',
          grade_scale_id: pre ? null : scales.get(classNo(c.name) <= 5 ? 'Primary (Classes 1-5)' : 'High school (Classes 6-10)') ?? null }).ignore().execute();
      }
      if (has) return;
      const marked = classes.filter((c) => !PRE.test(c.name));
      for (const [i, [code, name, kind, term, max]] of DEFAULT_EXAMS.entries()) {
        const r = await trx.insertInto('exams').values({ academic_year_id: yearId, code, name, kind, term, max_marks: String(max), on_report_card: 1, position: i + 1 }).executeTakeFirstOrThrow();
        if (marked.length) await trx.insertInto('exam_classes').values(marked.map((c) => ({ exam_id: Number(r.insertId), class_id: c.id }))).execute();
      }
      await trx.insertInto('co_areas').values(CO_AREAS.map((name, i) => ({ academic_year_id: yearId, class_id: null, name, position: i + 1 }))).execute();
      let p = 0;
      for (const [g, list] of SKILLS) for (const name of list) await trx.insertInto('skills').values({ academic_year_id: yearId, class_id: null, group_name: g, name, position: ++p }).execute();
    });
  }

  async yearFor(yearId?: number, edit = false) {
    const y = await resolveYear(this.db, yearId, edit);
    await this.ensureYear(y.id);
    return y;
  }

  async rule(yearId: number, classId: number): Promise<ClassRule & { assessment: 'marks' | 'skills' }> {
    const s = await this.db.selectFrom('class_exam_settings').selectAll().where('academic_year_id', '=', yearId).where('class_id', '=', classId).executeTakeFirst();
    const bands = s?.grade_scale_id ? await this.db.selectFrom('grade_bands').select(['grade', 'min_pct', 'label']).where('scale_id', '=', s.grade_scale_id).execute() : [];
    return { assessment: s?.assessment ?? 'marks', formula: s?.formula ?? 'term', faWeight: s?.fa_weight ?? 20, passPct: Number(s?.pass_pct ?? 35), display: s?.display ?? 'both',
      bands: bands.map((b) => ({ grade: b.grade, min: Number(b.min_pct), label: b.label })) };
  }

  async examsFor(yearId: number, classId: number): Promise<ExamDef[]> {
    const rows = await this.db.selectFrom('exams as e').innerJoin('exam_classes as ec', 'ec.exam_id', 'e.id')
      .select(['e.id', 'e.code', 'e.name', 'e.kind', 'e.term', 'e.max_marks', 'e.on_report_card']).where('e.academic_year_id', '=', yearId).where('ec.class_id', '=', classId).orderBy('e.position').execute();
    return rows.map((e) => ({ id: e.id, code: e.code, name: e.name, kind: e.kind, term: e.term, max: Number(e.max_marks), onCard: e.on_report_card === 1 }));
  }

  subjectsFor(yearId: number, classId: number) {
    return this.db.selectFrom('class_subjects as cs').innerJoin('subjects as s', 's.id', 'cs.subject_id').select(['s.id', 's.name'])
      .where('cs.academic_year_id', '=', yearId).where('cs.class_id', '=', classId).orderBy('cs.display_order').orderBy('s.name').execute();
  }

  // ---------------- Setup ----------------
  async setup(yearId?: number) {
    const y = await this.yearFor(yearId);
    const [exams, ec, scales, bands, settings, classes, co, skills] = await Promise.all([
      this.db.selectFrom('exams').selectAll().where('academic_year_id', '=', y.id).orderBy('position').execute(),
      this.db.selectFrom('exam_classes as ec').innerJoin('exams as e', 'e.id', 'ec.exam_id').select(['ec.exam_id', 'ec.class_id']).where('e.academic_year_id', '=', y.id).execute(),
      this.db.selectFrom('grade_scales').selectAll().orderBy('id').execute(),
      this.db.selectFrom('grade_bands').selectAll().orderBy('min_pct', 'desc').execute(),
      this.db.selectFrom('class_exam_settings').selectAll().where('academic_year_id', '=', y.id).execute(),
      this.db.selectFrom('classes').select(['id', 'name']).where('is_active', '=', 1).orderBy('level_order').execute(),
      this.db.selectFrom('co_areas').selectAll().where('academic_year_id', '=', y.id).orderBy('position').execute(),
      this.db.selectFrom('skills').selectAll().where('academic_year_id', '=', y.id).orderBy('position').execute(),
    ]);
    return {
      year: { id: y.id, name: y.name, editable: y.status !== 'closed' },
      exams: exams.map((e) => ({ id: e.id, code: e.code, name: e.name, kind: e.kind, term: e.term, maxMarks: Number(e.max_marks), onReportCard: e.on_report_card === 1, classIds: ec.filter((x) => x.exam_id === e.id).map((x) => x.class_id) })),
      scales: scales.map((s) => ({ ...s, bands: bands.filter((b) => b.scale_id === s.id).map((b) => ({ grade: b.grade, min: Number(b.min_pct), label: b.label })) })),
      classes: classes.map((c) => { const s = settings.find((x) => x.class_id === c.id); return { ...c, assessment: s?.assessment ?? 'marks', gradeScaleId: s?.grade_scale_id ?? null, display: s?.display ?? 'both', formula: s?.formula ?? 'term', faWeight: s?.fa_weight ?? 20, passPct: Number(s?.pass_pct ?? 35) }; }),
      coAreas: co.map((a) => ({ id: a.id, name: a.name, classId: a.class_id })),
      skills: skills.map((s) => ({ id: s.id, group: s.group_name, name: s.name, classId: s.class_id })),
    };
  }

  async addExam(u: RequestUser, yearId: number | undefined, b: { name: string; code: string; kind: 'unit' | 'prefinal'; maxMarks: number; classIds: number[] }, meta: Meta) {
    const y = await this.yearFor(yearId, true);
    const pos = await this.db.selectFrom('exams').select((eb) => eb.fn.max('position').as('m')).where('academic_year_id', '=', y.id).executeTakeFirst();
    const r = await this.db.insertInto('exams').values({ academic_year_id: y.id, code: b.code.toUpperCase(), name: b.name, kind: b.kind, term: null, max_marks: String(b.maxMarks), on_report_card: 0, position: Number(pos?.m ?? 0) + 1 })
      .executeTakeFirstOrThrow().catch((e) => { if (e?.code === 'ER_DUP_ENTRY') throw Errors.validation([{ field: 'code', message: 'An exam with this short name already exists.' }]); throw e; });
    if (b.classIds.length) await this.db.insertInto('exam_classes').values(b.classIds.map((class_id) => ({ exam_id: Number(r.insertId), class_id }))).execute();
    await this.audit.log(u, { module: 'exams', action: 'add_exam', entityType: 'exam', entityId: Number(r.insertId), after: b, ...meta });
    return { id: Number(r.insertId) };
  }

  async updateExam(u: RequestUser, id: number, b: { name?: string; maxMarks?: number; classIds?: number[] }, meta: Meta) {
    const e = await this.db.selectFrom('exams').select(['academic_year_id', 'kind']).where('id', '=', id).executeTakeFirst();
    if (!e) throw Errors.notFound('Exam');
    await resolveYear(this.db, e.academic_year_id, true);
    const hasMarks = await this.db.selectFrom('marks').select('id').where('exam_id', '=', id).executeTakeFirst();
    if (b.maxMarks !== undefined && hasMarks) throw Errors.badRequest('EXAM_HAS_MARKS', 'Marks are already entered for this exam, so its maximum cannot change.');
    const patch: Record<string, unknown> = {};
    if (b.name) patch.name = b.name;
    if (b.maxMarks !== undefined) patch.max_marks = String(b.maxMarks);
    if (Object.keys(patch).length) await this.db.updateTable('exams').set(patch).where('id', '=', id).execute();
    if (b.classIds) {
      await this.db.deleteFrom('exam_classes').where('exam_id', '=', id).execute();
      if (b.classIds.length) await this.db.insertInto('exam_classes').values(b.classIds.map((class_id) => ({ exam_id: id, class_id }))).execute();
    }
    await this.audit.log(u, { module: 'exams', action: 'update_exam', entityType: 'exam', entityId: id, after: b, ...meta });
    return { id };
  }

  async deleteExam(u: RequestUser, id: number, meta: Meta) {
    const e = await this.db.selectFrom('exams').select(['kind', 'academic_year_id']).where('id', '=', id).executeTakeFirst();
    if (!e) throw Errors.notFound('Exam');
    if (e.kind === 'fa' || e.kind === 'sa') throw Errors.badRequest('CORE_EXAM', 'FA and SA exams are part of the report card and cannot be deleted.');
    if (await this.db.selectFrom('marks').select('id').where('exam_id', '=', id).executeTakeFirst()) throw Errors.badRequest('EXAM_HAS_MARKS', 'Marks are entered for this exam; it cannot be deleted.');
    await this.db.deleteFrom('exams').where('id', '=', id).execute();
    await this.audit.log(u, { module: 'exams', action: 'delete_exam', entityType: 'exam', entityId: id, ...meta });
    return { id };
  }

  async setClassRules(u: RequestUser, yearId: number | undefined, rows: Array<{ classId: number; gradeScaleId: number | null; display: 'marks' | 'grades' | 'both'; formula: 'term' | 'year_end' | 'weights'; faWeight: number; passPct: number }>, meta: Meta) {
    const y = await this.yearFor(yearId, true);
    for (const r of rows) {
      const published = await this.db.selectFrom('exam_publications as p').innerJoin('sections as s', 's.id', 'p.section_id').innerJoin('exams as e', 'e.id', 'p.exam_id')
        .select('p.exam_id').where('s.class_id', '=', r.classId).where('e.academic_year_id', '=', y.id).where('e.kind', '=', 'sa').where('e.term', '=', 2).executeTakeFirst();
      if (published) throw Errors.badRequest('RESULTS_PUBLISHED', 'Final results are already published for this class; its result rules cannot change.');
      await this.db.updateTable('class_exam_settings').set({ grade_scale_id: r.gradeScaleId, display: r.display, formula: r.formula, fa_weight: r.faWeight, pass_pct: String(r.passPct) })
        .where('academic_year_id', '=', y.id).where('class_id', '=', r.classId).execute();
    }
    await this.audit.log(u, { module: 'exams', action: 'class_rules', after: rows, ...meta });
    return this.setup(y.id);
  }

  async saveScale(u: RequestUser, id: number | null, b: { name: string; bands: Band[] }, meta: Meta) {
    const grades = new Set(b.bands.map((x) => x.grade.trim().toUpperCase()));
    if (grades.size !== b.bands.length) throw Errors.validation([{ field: 'bands', message: 'Each grade can appear only once.' }]);
    if (!b.bands.some((x) => x.min === 0)) throw Errors.validation([{ field: 'bands', message: 'The lowest grade must start at 0%.' }]);
    const sid = await this.db.transaction().execute(async (trx) => {
      let sid = id;
      if (sid) await trx.updateTable('grade_scales').set({ name: b.name }).where('id', '=', sid).execute();
      else sid = Number((await trx.insertInto('grade_scales').values({ name: b.name }).executeTakeFirstOrThrow()).insertId);
      await trx.deleteFrom('grade_bands').where('scale_id', '=', sid).execute();
      await trx.insertInto('grade_bands').values(b.bands.map((x) => ({ scale_id: sid!, grade: x.grade.trim(), min_pct: String(x.min), label: x.label ?? null }))).execute();
      return sid;
    });
    await this.audit.log(u, { module: 'exams', action: 'save_scale', entityType: 'grade_scale', entityId: sid, after: b, ...meta });
    return { id: sid };
  }

  // ---------------- Schedule ----------------
  async schedule(examId: number, classId: number) {
    const e = await this.db.selectFrom('exams').select(['academic_year_id', 'code', 'name']).where('id', '=', examId).executeTakeFirst();
    if (!e) throw Errors.notFound('Exam');
    const [subjects, rows] = await Promise.all([
      this.subjectsFor(e.academic_year_id, classId),
      this.db.selectFrom('exam_schedule').selectAll().where('exam_id', '=', examId).where('class_id', '=', classId).execute(),
    ]);
    return { exam: e, subjects: subjects.map((s) => { const r = rows.find((x) => x.subject_id === s.id); return { subjectId: s.id, subject: s.name, date: iso(r?.exam_date), start: r?.start_time?.slice(0, 5) ?? null, end: r?.end_time?.slice(0, 5) ?? null }; }) };
  }

  async setSchedule(u: RequestUser, examId: number, classId: number, rows: Array<{ subjectId: number; date: string | null; start: string | null; end: string | null }>, meta: Meta) {
    const e = await this.db.selectFrom('exams').select('academic_year_id').where('id', '=', examId).executeTakeFirst();
    if (!e) throw Errors.notFound('Exam');
    await resolveYear(this.db, e.academic_year_id, true);
    await this.db.transaction().execute(async (trx) => {
      for (const r of rows) {
        await trx.deleteFrom('exam_schedule').where('exam_id', '=', examId).where('class_id', '=', classId).where('subject_id', '=', r.subjectId).execute();
        if (r.date) await trx.insertInto('exam_schedule').values({ exam_id: examId, class_id: classId, subject_id: r.subjectId, exam_date: new Date(`${r.date}T00:00:00Z`), start_time: r.start ? `${r.start}:00` : null, end_time: r.end ? `${r.end}:00` : null }).execute();
      }
      await this.audit.log(u, { module: 'exams', action: 'schedule', entityType: 'exam', entityId: examId, after: { classId, rows }, ...meta }, trx);
    });
    return this.schedule(examId, classId);
  }

  /** Upcoming papers for a class (families, teachers, dashboard). */
  upcomingPapers(yearId: number, from: string, to: string, classIds?: number[]) {
    let q = this.db.selectFrom('exam_schedule as s').innerJoin('exams as e', 'e.id', 's.exam_id').innerJoin('subjects as sub', 'sub.id', 's.subject_id').innerJoin('classes as c', 'c.id', 's.class_id')
      .select(['e.code', 'e.name as exam', 'sub.name as subject', 'c.name as class_name', 's.class_id', 's.exam_date', 's.start_time', 's.end_time'])
      .where('e.academic_year_id', '=', yearId).where('s.exam_date', '>=', new Date(`${from}T00:00:00Z`)).where('s.exam_date', '<=', new Date(`${to}T00:00:00Z`));
    if (classIds) q = classIds.length ? q.where('s.class_id', 'in', classIds) : q.where(sql<boolean>`1 = 0`);
    return q.orderBy('s.exam_date').orderBy('s.start_time').execute();
  }

  // ---------------- Mark sheets ----------------
  private async staffId(u: RequestUser) {
    return (await this.db.selectFrom('staff').select('id').where('user_id', '=', u.id).executeTakeFirst())?.id ?? null;
  }

  /** May this user enter marks for this section and subject? Assigned subject teacher, or anyone with marks.enter for all. */
  async canEnter(u: RequestUser, yearId: number, sectionId: number, subjectId: number) {
    const scope = u.permissions.get('marks.enter');
    if (scope === 'all') return true;
    if (!scope) return false;
    const sid = await this.staffId(u);
    if (!sid) return false;
    return !!(await this.db.selectFrom('teacher_assignments').select('id').where('academic_year_id', '=', yearId).where('staff_id', '=', sid).where('section_id', '=', sectionId).where('subject_id', '=', subjectId).executeTakeFirst());
  }

  /** Sheets this user works on for an exam, with status and progress. */
  async sheets(u: RequestUser, examId: number) {
    const e = await this.db.selectFrom('exams').selectAll().where('id', '=', examId).executeTakeFirst();
    if (!e) throw Errors.notFound('Exam');
    const approver = u.permissions.get('marks.approve') === 'all';
    const enterAll = u.permissions.get('marks.enter') === 'all';
    let q = this.db.selectFrom('exam_classes as ec').innerJoin('sections as sec', 'sec.class_id', 'ec.class_id').innerJoin('classes as c', 'c.id', 'sec.class_id')
      .innerJoin('class_subjects as cs', (j) => j.onRef('cs.class_id', '=', 'ec.class_id').on('cs.academic_year_id', '=', e.academic_year_id))
      .innerJoin('subjects as sub', 'sub.id', 'cs.subject_id')
      .leftJoin('teacher_assignments as ta', (j) => j.onRef('ta.section_id', '=', 'sec.id').onRef('ta.subject_id', '=', 'cs.subject_id').on('ta.academic_year_id', '=', e.academic_year_id))
      .leftJoin('staff as st', 'st.id', 'ta.staff_id').leftJoin('users as tu', 'tu.id', 'st.user_id')
      .leftJoin('mark_sheets as ms', (j) => j.on('ms.exam_id', '=', examId).onRef('ms.section_id', '=', 'sec.id').onRef('ms.subject_id', '=', 'cs.subject_id'))
      .leftJoin('exam_publications as p', (j) => j.on('p.exam_id', '=', examId).onRef('p.section_id', '=', 'sec.id'))
      .select(['sec.id as section_id', 'sec.name as section', 'c.id as class_id', 'c.name as class_name', 'c.level_order', 'sub.id as subject_id', 'sub.name as subject', 'tu.name as teacher', 'ta.staff_id',
        'ms.status', 'ms.return_note', 'p.published_at',
        (eb) => eb.selectFrom('enrollments as en').innerJoin('students as s', 's.id', 'en.student_id').select((x) => x.fn.countAll<number>().as('n'))
          .whereRef('en.section_id', '=', 'sec.id').where('en.academic_year_id', '=', e.academic_year_id).where('s.status', '=', 'active').as('students'),
        (eb) => eb.selectFrom('marks as m').select((x) => x.fn.countAll<number>().as('n')).where('m.exam_id', '=', examId).whereRef('m.section_id', '=', 'sec.id').whereRef('m.subject_id', '=', 'cs.subject_id')
          .where((x) => x.or([x('m.marks', 'is not', null), x('m.is_absent', '=', 1)])).as('entered')])
      .where('ec.exam_id', '=', examId).where('sec.is_active', '=', 1);
    if (!approver && !enterAll) {
      const sid = await this.staffId(u);
      q = sid ? q.where('ta.staff_id', '=', sid) : q.where(sql<boolean>`1 = 0`);
    }
    const rows = await q.orderBy('c.level_order').orderBy('sec.name').orderBy('sub.name').execute();
    return {
      exam: { id: e.id, code: e.code, name: e.name, kind: e.kind, maxMarks: Number(e.max_marks) },
      canApprove: approver, canPublish: u.permissions.get('marks.publish') === 'all',
      sheets: rows.filter((r) => Number(r.students) > 0).map((r) => ({ sectionId: r.section_id, section: `${r.class_name} ${r.section}`, classId: r.class_id, subjectId: r.subject_id, subject: r.subject,
        teacher: r.teacher, status: r.status ?? 'draft', returnNote: r.return_note, published: !!r.published_at, students: Number(r.students), entered: Number(r.entered) })),
    };
  }

  async sheet(u: RequestUser, examId: number, sectionId: number, subjectId: number) {
    const e = await this.db.selectFrom('exams').selectAll().where('id', '=', examId).executeTakeFirst();
    if (!e) throw Errors.notFound('Exam');
    const can = await this.canEnter(u, e.academic_year_id, sectionId, subjectId);
    if (!can && u.permissions.get('marks.approve') !== 'all') throw Errors.forbidden();
    const [ms, pub, students, sec, sub] = await Promise.all([
      this.db.selectFrom('mark_sheets').selectAll().where('exam_id', '=', examId).where('section_id', '=', sectionId).where('subject_id', '=', subjectId).executeTakeFirst(),
      this.db.selectFrom('exam_publications').select('published_at').where('exam_id', '=', examId).where('section_id', '=', sectionId).executeTakeFirst(),
      this.db.selectFrom('enrollments as en').innerJoin('students as s', 's.id', 'en.student_id')
        .leftJoin('marks as m', (j) => j.onRef('m.student_id', '=', 's.id').on('m.exam_id', '=', examId).on('m.subject_id', '=', subjectId))
        .select(['s.public_id', 's.first_name', 's.last_name', 'en.roll_no', 'm.id as mark_id', 'm.marks', 'm.is_absent'])
        .where('en.section_id', '=', sectionId).where('en.academic_year_id', '=', e.academic_year_id).where('s.status', '=', 'active')
        .orderBy(sql`CAST(en.roll_no AS UNSIGNED)`).orderBy('s.first_name').execute(),
      this.db.selectFrom('sections as s').innerJoin('classes as c', 'c.id', 's.class_id').select(['s.name', 'c.name as class_name']).where('s.id', '=', sectionId).executeTakeFirstOrThrow(),
      this.db.selectFrom('subjects').select('name').where('id', '=', subjectId).executeTakeFirstOrThrow(),
    ]);
    const status = ms?.status ?? 'draft';
    return {
      exam: { id: e.id, code: e.code, name: e.name, maxMarks: Number(e.max_marks) }, section: `${sec.class_name} ${sec.name}`, subject: sub.name,
      status, returnNote: ms?.return_note ?? null, published: !!pub, canEdit: can && (status === 'draft' || status === 'returned'), canCorrect: can && !!pub,
      canApprove: u.permissions.get('marks.approve') === 'all' && status === 'submitted',
      students: students.map((s) => ({ id: s.public_id, name: [s.first_name, s.last_name].filter(Boolean).join(' '), rollNo: s.roll_no, marks: s.marks == null ? null : Number(s.marks), absent: s.is_absent === 1 })),
    };
  }

  async saveSheet(u: RequestUser, examId: number, sectionId: number, subjectId: number, entries: Array<{ studentId: string; marks: number | null; absent: boolean }>, submit: boolean, meta: Meta) {
    const e = await this.db.selectFrom('exams').selectAll().where('id', '=', examId).executeTakeFirst();
    if (!e) throw Errors.notFound('Exam');
    await resolveYear(this.db, e.academic_year_id, true);
    if (!(await this.canEnter(u, e.academic_year_id, sectionId, subjectId))) throw Errors.forbidden();
    const max = Number(e.max_marks);
    const errs = entries.flatMap((x, i) => (x.absent || x.marks == null ? [] : x.marks < 0 || x.marks > max ? [{ field: `entries.${i}.marks`, message: `Marks must be between 0 and ${max}.` }] : Math.round(x.marks * 2) !== x.marks * 2 ? [{ field: `entries.${i}.marks`, message: 'Use whole or half marks.' }] : []));
    if (errs.length) throw Errors.validation(errs);
    await this.db.transaction().execute(async (trx) => {
      const ms = await trx.selectFrom('mark_sheets').select('status').where('exam_id', '=', examId).where('section_id', '=', sectionId).where('subject_id', '=', subjectId).forUpdate().executeTakeFirst();
      if (ms && ms.status !== 'draft' && ms.status !== 'returned') throw Errors.badRequest('SHEET_LOCKED', ms.status === 'submitted' ? 'These marks are submitted and waiting for approval.' : 'These marks are approved. Use a correction request to change a mark.');
      const students = new Map((await trx.selectFrom('enrollments as en').innerJoin('students as s', 's.id', 'en.student_id').select(['s.id', 's.public_id'])
        .where('en.section_id', '=', sectionId).where('en.academic_year_id', '=', e.academic_year_id).where('s.status', '=', 'active').execute()).map((s) => [s.public_id, s.id]));
      for (const x of entries) {
        const sid = students.get(x.studentId);
        if (!sid) throw Errors.validation([{ field: 'entries', message: 'A student is not in this section. Refresh and try again.' }]);
        await trx.insertInto('marks').values({ exam_id: examId, student_id: sid, subject_id: subjectId, section_id: sectionId, marks: x.absent || x.marks == null ? null : String(x.marks), is_absent: x.absent ? 1 : 0, updated_by: u.id })
          .onDuplicateKeyUpdate({ marks: x.absent || x.marks == null ? null : String(x.marks), is_absent: x.absent ? 1 : 0, updated_by: u.id, section_id: sectionId }).execute();
      }
      if (submit) {
        const missing = await trx.selectFrom('enrollments as en').innerJoin('students as s', 's.id', 'en.student_id')
          .leftJoin('marks as m', (j) => j.onRef('m.student_id', '=', 's.id').on('m.exam_id', '=', examId).on('m.subject_id', '=', subjectId))
          .select((eb) => eb.fn.countAll<number>().as('n')).where('en.section_id', '=', sectionId).where('en.academic_year_id', '=', e.academic_year_id).where('s.status', '=', 'active')
          .where((eb) => eb.and([eb.or([eb('m.marks', 'is', null)]), eb.or([eb('m.is_absent', 'is', null), eb('m.is_absent', '=', 0)])])).executeTakeFirst();
        if (Number(missing?.n) > 0) throw Errors.badRequest('MARKS_MISSING', `${missing!.n} student${Number(missing!.n) > 1 ? 's have' : ' has'} no marks. Enter marks or AB for everyone before submitting.`);
      }
      await trx.insertInto('mark_sheets').values({ exam_id: examId, section_id: sectionId, subject_id: subjectId, status: submit ? 'submitted' : 'draft', submitted_by: submit ? u.id : null, submitted_at: submit ? new Date() : null })
        .onDuplicateKeyUpdate(submit ? { status: 'submitted', submitted_by: u.id, submitted_at: new Date(), return_note: null } : { status: sql`IF(status = 'returned', 'returned', 'draft')` as any }).execute();
      await this.audit.log(u, { module: 'marks', action: submit ? 'submit' : 'save', entityType: 'mark_sheet', after: { examId, sectionId, subjectId, count: entries.length }, ...meta }, trx);
    });
    return this.sheet(u, examId, sectionId, subjectId);
  }

  /** Principal approves or sends back a submitted sheet (agreed E7). */
  async decideSheet(u: RequestUser, examId: number, sectionId: number, subjectId: number, approve: boolean, note: string | null, meta: Meta) {
    const ms = await this.db.selectFrom('mark_sheets').select(['status', 'submitted_by']).where('exam_id', '=', examId).where('section_id', '=', sectionId).where('subject_id', '=', subjectId).executeTakeFirst();
    if (!ms || ms.status !== 'submitted') throw Errors.badRequest('NOT_SUBMITTED', 'Only submitted marks can be approved or sent back.');
    if (!approve && !note) throw Errors.validation([{ field: 'note', message: 'Say what needs to change.' }]);
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('mark_sheets').set(approve ? { status: 'approved', approved_by: u.id, approved_at: new Date() } : { status: 'returned', return_note: note })
        .where('exam_id', '=', examId).where('section_id', '=', sectionId).where('subject_id', '=', subjectId).execute();
      if (!approve && ms.submitted_by) {
        const info = await trx.selectFrom('exams as e').innerJoin('sections as s', 's.id', 's.id').innerJoin('classes as c', 'c.id', 's.class_id').innerJoin('subjects as sub', 'sub.id', 'sub.id')
          .select(['e.code', 'c.name as class_name', 's.name as section', 'sub.name as subject']).where('e.id', '=', examId).where('s.id', '=', sectionId).where('sub.id', '=', subjectId).executeTakeFirstOrThrow();
        await trx.insertInto('notifications').values({ user_id: ms.submitted_by, workspace: 'staff', category: 'academic', title: `Marks sent back: ${info.code} ${info.subject}, ${info.class_name} ${info.section}`, body: note!, link_path: '/marks' }).execute();
      }
      await this.audit.log(u, { module: 'marks', action: approve ? 'approve' : 'return', entityType: 'mark_sheet', after: { examId, sectionId, subjectId, note }, ...meta }, trx);
    });
    return { status: approve ? 'approved' : 'returned' };
  }

  /** Publish an exam's results for a section once every subject is approved. Families are notified. */
  async publish(u: RequestUser, examId: number, sectionId: number, meta: Meta) {
    const e = await this.db.selectFrom('exams').selectAll().where('id', '=', examId).executeTakeFirst();
    if (!e) throw Errors.notFound('Exam');
    const sec = await this.db.selectFrom('sections as s').innerJoin('classes as c', 'c.id', 's.class_id').select(['s.class_id', 's.name', 'c.name as class_name']).where('s.id', '=', sectionId).executeTakeFirstOrThrow();
    const subjects = await this.subjectsFor(e.academic_year_id, sec.class_id);
    const approved = await this.db.selectFrom('mark_sheets').select('subject_id').where('exam_id', '=', examId).where('section_id', '=', sectionId).where('status', '=', 'approved').execute();
    const missing = subjects.filter((s) => !approved.some((a) => a.subject_id === s.id));
    if (missing.length) throw Errors.badRequest('NOT_ALL_APPROVED', `Not approved yet: ${missing.map((m) => m.name).join(', ')}.`);
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('exam_publications').values({ exam_id: examId, section_id: sectionId, published_by: u.id }).ignore().execute();
      const fams = await trx.selectFrom('enrollments as en').innerJoin('students as s', 's.id', 'en.student_id').innerJoin('families as f', 'f.id', 's.family_id')
        .select(['f.user_id', 's.public_id', 's.first_name']).where('en.section_id', '=', sectionId).where('en.academic_year_id', '=', e.academic_year_id).where('s.status', '=', 'active').execute();
      const rows = fams.filter((f) => f.user_id).map((f) => ({ user_id: f.user_id!, workspace: 'parent' as const, category: 'academic' as const, title: `${e.name} results: ${f.first_name}`, body: 'Marks are now available in the app.', link_path: `/students/${f.public_id}` }));
      if (rows.length) await trx.insertInto('notifications').values(rows).execute();
      await this.audit.log(u, { module: 'marks', action: 'publish', entityType: 'exam', entityId: examId, after: { sectionId }, ...meta }, trx);
    });
    return { published: true, section: `${sec.class_name} ${sec.name}` };
  }

  // ---------------- Corrections (agreed E8) ----------------
  async requestCorrection(u: RequestUser, b: { examId: number; studentId: string; subjectId: number; marks: number | null; absent: boolean; reason: string }, meta: Meta) {
    const m = await this.db.selectFrom('marks as m').innerJoin('students as s', 's.id', 'm.student_id').innerJoin('exams as e', 'e.id', 'm.exam_id')
      .select(['m.id', 'm.marks', 'm.is_absent', 'm.section_id', 'e.academic_year_id', 'e.max_marks']).where('m.exam_id', '=', b.examId).where('s.public_id', '=', b.studentId).where('m.subject_id', '=', b.subjectId).executeTakeFirst();
    if (!m) throw Errors.notFound('Mark');
    if (!(await this.canEnter(u, m.academic_year_id, m.section_id, b.subjectId))) throw Errors.forbidden();
    const ms = await this.db.selectFrom('mark_sheets').select('status').where('exam_id', '=', b.examId).where('section_id', '=', m.section_id).where('subject_id', '=', b.subjectId).executeTakeFirst();
    if (ms?.status !== 'approved') throw Errors.badRequest('NOT_APPROVED_YET', 'These marks are not approved yet; change them directly.');
    if (!b.absent && (b.marks == null || b.marks < 0 || b.marks > Number(m.max_marks))) throw Errors.validation([{ field: 'marks', message: `Marks must be between 0 and ${Number(m.max_marks)}.` }]);
    const pending = await this.db.selectFrom('mark_corrections').select('id').where('mark_id', '=', m.id).where('status', '=', 'pending').executeTakeFirst();
    if (pending) throw Errors.badRequest('CORRECTION_PENDING', 'A correction for this mark is already waiting for approval.');
    const r = await this.db.insertInto('mark_corrections').values({ mark_id: m.id, old_marks: m.marks, old_absent: m.is_absent, new_marks: b.absent ? null : String(b.marks), new_absent: b.absent ? 1 : 0, reason: b.reason, requested_by: u.id }).executeTakeFirstOrThrow();
    await this.audit.log(u, { module: 'marks', action: 'correction_request', entityType: 'mark_correction', entityId: Number(r.insertId), after: b, ...meta });
    return { id: Number(r.insertId), status: 'pending' };
  }

  async corrections(u: RequestUser) {
    const approver = u.permissions.get('marks.approve') === 'all';
    let q = this.db.selectFrom('mark_corrections as mc').innerJoin('marks as m', 'm.id', 'mc.mark_id').innerJoin('students as s', 's.id', 'm.student_id')
      .innerJoin('exams as e', 'e.id', 'm.exam_id').innerJoin('subjects as sub', 'sub.id', 'm.subject_id').innerJoin('sections as sec', 'sec.id', 'm.section_id').innerJoin('classes as c', 'c.id', 'sec.class_id')
      .innerJoin('users as ru', 'ru.id', 'mc.requested_by').leftJoin('users as du', 'du.id', 'mc.decided_by')
      .select(['mc.id', 'mc.old_marks', 'mc.old_absent', 'mc.new_marks', 'mc.new_absent', 'mc.reason', 'mc.status', 'mc.decision_note', 'mc.created_at', 'mc.requested_by',
        's.first_name', 's.last_name', 'e.code', 'e.max_marks', 'sub.name as subject', 'c.name as class_name', 'sec.name as section', 'ru.name as requested_by_name', 'du.name as decided_by_name']);
    if (!approver) q = q.where('mc.requested_by', '=', u.id);
    return (await q.orderBy('mc.id', 'desc').limit(200).execute()).map((r) => ({
      id: r.id, student: [r.first_name, r.last_name].filter(Boolean).join(' '), section: `${r.class_name} ${r.section}`, exam: r.code, subject: r.subject, maxMarks: Number(r.max_marks),
      from: r.old_absent ? 'AB' : r.old_marks == null ? '-' : String(Number(r.old_marks)), to: r.new_absent ? 'AB' : String(Number(r.new_marks)), reason: r.reason, status: r.status,
      decisionNote: r.decision_note, requestedBy: r.requested_by_name, decidedBy: r.decided_by_name, createdAt: r.created_at, canDecide: approver && r.status === 'pending' && r.requested_by !== u.id,
    }));
  }

  async decideCorrection(u: RequestUser, id: number, approve: boolean, note: string | null, meta: Meta) {
    if (u.permissions.get('marks.approve') !== 'all') throw Errors.forbidden();
    const c = await this.db.selectFrom('mark_corrections as mc').innerJoin('marks as m', 'm.id', 'mc.mark_id').innerJoin('students as s', 's.id', 'm.student_id').innerJoin('families as f', 'f.id', 's.family_id')
      .innerJoin('exams as e', 'e.id', 'm.exam_id').innerJoin('subjects as sub', 'sub.id', 'm.subject_id')
      .select(['mc.status', 'mc.mark_id', 'mc.new_marks', 'mc.new_absent', 'mc.requested_by', 'f.user_id as family_user', 's.public_id', 's.first_name', 'e.code', 'sub.name as subject', 'm.exam_id', 'm.section_id'])
      .where('mc.id', '=', id).executeTakeFirst();
    if (!c) throw Errors.notFound('Correction');
    if (c.status !== 'pending') throw Errors.badRequest('ALREADY_DECIDED', 'This correction has already been decided.');
    if (c.requested_by === u.id) throw Errors.forbidden();
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('mark_corrections').set({ status: approve ? 'approved' : 'rejected', decided_by: u.id, decided_at: new Date(), decision_note: note }).where('id', '=', id).execute();
      if (approve) {
        await trx.updateTable('marks').set({ marks: c.new_marks, is_absent: c.new_absent, updated_by: u.id }).where('id', '=', c.mark_id).execute();
        const published = await trx.selectFrom('exam_publications').select('exam_id').where('exam_id', '=', c.exam_id).where('section_id', '=', c.section_id).executeTakeFirst();
        if (published && c.family_user) await trx.insertInto('notifications').values({ user_id: c.family_user, workspace: 'parent', category: 'academic', title: `${c.code} ${c.subject} mark corrected for ${c.first_name}`, body: 'The school corrected a mark. See the latest result in the app.', link_path: `/students/${c.public_id}` }).execute();
      }
      await trx.insertInto('notifications').values({ user_id: c.requested_by, workspace: 'staff', category: 'academic', title: `Correction ${approve ? 'approved' : 'not approved'}: ${c.code} ${c.subject}, ${c.first_name}`, body: note ?? '', link_path: '/marks' }).execute();
      await this.audit.log(u, { module: 'marks', action: approve ? 'correction_approve' : 'correction_reject', entityType: 'mark_correction', entityId: id, after: { note }, ...meta }, trx);
    });
    return { id, status: approve ? 'approved' : 'rejected' };
  }

  // ---------------- Class teacher: co-scholastic, remarks, skills ----------------
  async isClassTeacher(u: RequestUser, yearId: number, sectionId: number) {
    if (u.permissions.get('marks.approve') === 'all') return true;
    const sid = await this.staffId(u);
    return !!sid && !!(await this.db.selectFrom('class_teachers').select('section_id').where('academic_year_id', '=', yearId).where('section_id', '=', sectionId).where('staff_id', '=', sid).executeTakeFirst());
  }

  async classTeacherSheet(u: RequestUser, sectionId: number, term: number) {
    const y = await this.yearFor();
    if (!(await this.isClassTeacher(u, y.id, sectionId))) throw Errors.forbidden();
    const sec = await this.db.selectFrom('sections as s').innerJoin('classes as c', 'c.id', 's.class_id').select(['s.class_id', 's.name', 'c.name as class_name']).where('s.id', '=', sectionId).executeTakeFirstOrThrow();
    const rule = await this.rule(y.id, sec.class_id);
    const students = await this.db.selectFrom('enrollments as en').innerJoin('students as s', 's.id', 'en.student_id').select(['s.id', 's.public_id', 's.first_name', 's.last_name', 'en.roll_no'])
      .where('en.section_id', '=', sectionId).where('en.academic_year_id', '=', y.id).where('s.status', '=', 'active').orderBy(sql`CAST(en.roll_no AS UNSIGNED)`).orderBy('s.first_name').execute();
    const ids = students.map((s) => s.id).concat([0]);
    const [areas, grades, remarks, skills, ratings] = await Promise.all([
      this.db.selectFrom('co_areas').select(['id', 'name', 'class_id']).where('academic_year_id', '=', y.id).where((eb) => eb.or([eb('class_id', 'is', null), eb('class_id', '=', sec.class_id)])).orderBy('position').execute(),
      this.db.selectFrom('co_grades').select(['area_id', 'student_id', 'grade']).where('term', '=', term).where('student_id', 'in', ids).execute(),
      this.db.selectFrom('term_remarks').select(['student_id', 'remarks']).where('academic_year_id', '=', y.id).where('term', '=', term).where('student_id', 'in', ids).execute(),
      this.db.selectFrom('skills').select(['id', 'group_name', 'name']).where('academic_year_id', '=', y.id).where((eb) => eb.or([eb('class_id', 'is', null), eb('class_id', '=', sec.class_id)])).orderBy('position').execute(),
      this.db.selectFrom('skill_ratings').select(['skill_id', 'student_id', 'rating']).where('term', '=', term).where('student_id', 'in', ids).execute(),
    ]);
    return {
      section: `${sec.class_name} ${sec.name}`, classId: sec.class_id, term, assessment: rule.assessment,
      areas: areas.map((a) => ({ id: a.id, name: a.name, classOnly: a.class_id != null })),
      skills: rule.assessment === 'skills' ? skills.map((s) => ({ id: s.id, group: s.group_name, name: s.name })) : [],
      students: students.map((s) => ({ id: s.public_id, name: [s.first_name, s.last_name].filter(Boolean).join(' '), rollNo: s.roll_no,
        grades: Object.fromEntries(grades.filter((g) => g.student_id === s.id).map((g) => [g.area_id, g.grade])),
        ratings: Object.fromEntries(ratings.filter((g) => g.student_id === s.id).map((g) => [g.skill_id, g.rating])),
        remarks: remarks.find((r) => r.student_id === s.id)?.remarks ?? '' })),
    };
  }

  async saveClassTeacherSheet(u: RequestUser, sectionId: number, term: number, rows: Array<{ studentId: string; grades?: Record<string, string>; ratings?: Record<string, 'excellent' | 'good' | 'needs_practice'>; remarks?: string }>, meta: Meta) {
    const y = await this.yearFor(undefined, true);
    if (!(await this.isClassTeacher(u, y.id, sectionId))) throw Errors.forbidden();
    const students = new Map((await this.db.selectFrom('enrollments as en').innerJoin('students as s', 's.id', 'en.student_id').select(['s.id', 's.public_id'])
      .where('en.section_id', '=', sectionId).where('en.academic_year_id', '=', y.id).execute()).map((s) => [s.public_id, s.id]));
    await this.db.transaction().execute(async (trx) => {
      for (const r of rows) {
        const sid = students.get(r.studentId);
        if (!sid) throw Errors.validation([{ field: 'rows', message: 'A student is not in this section.' }]);
        for (const [area, grade] of Object.entries(r.grades ?? {})) {
          if (!grade) await trx.deleteFrom('co_grades').where('area_id', '=', Number(area)).where('student_id', '=', sid).where('term', '=', term).execute();
          else await trx.insertInto('co_grades').values({ area_id: Number(area), student_id: sid, term, grade: grade.slice(0, 6), updated_by: u.id }).onDuplicateKeyUpdate({ grade: grade.slice(0, 6), updated_by: u.id }).execute();
        }
        for (const [skill, rating] of Object.entries(r.ratings ?? {})) {
          await trx.insertInto('skill_ratings').values({ skill_id: Number(skill), student_id: sid, term, rating, updated_by: u.id }).onDuplicateKeyUpdate({ rating, updated_by: u.id }).execute();
        }
        if (r.remarks !== undefined) {
          if (!r.remarks.trim()) await trx.deleteFrom('term_remarks').where('student_id', '=', sid).where('academic_year_id', '=', y.id).where('term', '=', term).execute();
          else await trx.insertInto('term_remarks').values({ student_id: sid, academic_year_id: y.id, term, remarks: r.remarks.trim().slice(0, 600), updated_by: u.id }).onDuplicateKeyUpdate({ remarks: r.remarks.trim().slice(0, 600), updated_by: u.id }).execute();
        }
      }
      await this.audit.log(u, { module: 'marks', action: 'class_teacher_entries', after: { sectionId, term, count: rows.length }, ...meta }, trx);
    });
    return this.classTeacherSheet(u, sectionId, term);
  }

  async addCoArea(u: RequestUser, name: string, classId: number | null, meta: Meta) {
    const y = await this.yearFor(undefined, true);
    if (classId == null && u.permissions.get('exams.configure') !== 'all') throw Errors.forbidden();
    if (classId != null && u.permissions.get('exams.configure') !== 'all') {
      const sections = await this.db.selectFrom('sections').select('id').where('class_id', '=', classId).execute();
      let ok = false;
      for (const s of sections) if (await this.isClassTeacher(u, y.id, s.id)) ok = true;
      if (!ok) throw Errors.forbidden();
    }
    const pos = await this.db.selectFrom('co_areas').select((eb) => eb.fn.max('position').as('m')).where('academic_year_id', '=', y.id).executeTakeFirst();
    const r = await this.db.insertInto('co_areas').values({ academic_year_id: y.id, class_id: classId, name, position: Number(pos?.m ?? 0) + 1, created_by: u.id }).executeTakeFirstOrThrow();
    await this.audit.log(u, { module: 'exams', action: 'add_co_area', after: { name, classId }, ...meta });
    return { id: Number(r.insertId) };
  }

  async deleteCoArea(u: RequestUser, id: number, meta: Meta) {
    const a = await this.db.selectFrom('co_areas').select(['class_id', 'created_by']).where('id', '=', id).executeTakeFirst();
    if (!a) throw Errors.notFound('Area');
    if (u.permissions.get('exams.configure') !== 'all' && !(a.class_id != null && a.created_by === u.id)) throw Errors.forbidden();
    await this.db.deleteFrom('co_areas').where('id', '=', id).execute();
    await this.audit.log(u, { module: 'exams', action: 'delete_co_area', entityId: id, ...meta });
    return { id };
  }

  async saveSkills(u: RequestUser, yearId: number | undefined, list: Array<{ id?: number; group: string; name: string; classId: number | null }>, meta: Meta) {
    const y = await this.yearFor(yearId, true);
    await this.db.transaction().execute(async (trx) => {
      const keep = list.map((s) => s.id).filter((x): x is number => !!x);
      await trx.deleteFrom('skills').where('academic_year_id', '=', y.id).where('id', 'not in', keep.length ? keep : [0]).execute();
      for (const [i, s] of list.entries()) {
        if (s.id) await trx.updateTable('skills').set({ group_name: s.group, name: s.name, class_id: s.classId, position: i + 1 }).where('id', '=', s.id).execute();
        else await trx.insertInto('skills').values({ academic_year_id: y.id, group_name: s.group, name: s.name, class_id: s.classId, position: i + 1 }).execute();
      }
      await this.audit.log(u, { module: 'exams', action: 'save_skills', after: { count: list.length }, ...meta }, trx);
    });
    return this.setup(y.id);
  }

  // ---------------- Results ----------------
  /** Section result table for staff (includes marks not yet published, for checking). */
  async sectionResults(u: RequestUser, sectionId: number) {
    const y = await this.yearFor();
    if (u.workspace !== 'staff' || (u.permissions.get('marks.view') !== 'all' && !(await this.isClassTeacher(u, y.id, sectionId)))) throw Errors.forbidden();
    const sec = await this.db.selectFrom('sections as s').innerJoin('classes as c', 'c.id', 's.class_id').select(['s.class_id', 's.name', 'c.name as class_name']).where('s.id', '=', sectionId).executeTakeFirstOrThrow();
    const cr = await this.classResults(y.id, sec.class_id, false);
    const names = new Map((await this.db.selectFrom('students as s').innerJoin('enrollments as e', (j) => j.onRef('e.student_id', '=', 's.id').on('e.academic_year_id', '=', y.id))
      .select(['s.id', 's.public_id', 's.first_name', 's.last_name', 'e.roll_no']).where('e.section_id', '=', sectionId).execute()).map((s) => [s.id, s]));
    const pubs = (await this.db.selectFrom('exam_publications').select('exam_id').where('section_id', '=', sectionId).execute()).map((p) => p.exam_id);
    return {
      section: `${sec.class_name} ${sec.name}`, rule: cr.rule, exams: cr.exams.map((e) => ({ ...e, published: pubs.includes(e.id) })), subjects: cr.subjects,
      students: cr.results.filter((r) => r.sectionId === sectionId).map((r) => { const s = names.get(r.result.studentId)!; return { id: s.public_id, name: [s.first_name, s.last_name].filter(Boolean).join(' '), rollNo: s.roll_no, ...r.result }; })
        .sort((a, b) => (a.rankSection ?? 9999) - (b.rankSection ?? 9999)),
    };
  }

  /** Students who left, with the TC and bonafide checklist. */
  async exits(u: RequestUser) {
    if (u.permissions.get('students.view') !== 'all') throw Errors.forbidden();
    const rows = await this.db.selectFrom('student_exits as x').innerJoin('students as s', 's.id', 'x.student_id').leftJoin('users as tu', 'tu.id', 'x.tc_marked_by').leftJoin('users as bu', 'bu.id', 'x.bonafide_marked_by')
      .select(['s.public_id', 's.first_name', 's.last_name', 's.admission_no', 'x.leaving_date', 'x.reason', 'x.tc_number', 'x.tc_issued_on', 'tu.name as tc_by', 'x.bonafide_number', 'x.bonafide_issued_on', 'bu.name as bonafide_by'])
      .orderBy('x.leaving_date', 'desc').limit(500).execute();
    return rows.map((r) => ({ studentId: r.public_id, name: [r.first_name, r.last_name].filter(Boolean).join(' '), admissionNo: r.admission_no, leavingDate: iso(r.leaving_date), reason: r.reason,
      tc: r.tc_issued_on ? { number: r.tc_number, issuedOn: iso(r.tc_issued_on), by: r.tc_by } : null, bonafide: r.bonafide_issued_on ? { number: r.bonafide_number, issuedOn: iso(r.bonafide_issued_on), by: r.bonafide_by } : null }));
  }


  /**
   * Results for every student of a class (ranks need the whole class). `publishedOnly` limits each
   * section to exams the principal has published, which is what families see.
   */
  async classResults(yearId: number, classId: number, publishedOnly: boolean) {
    const [rule, examsAll, subjects] = await Promise.all([this.rule(yearId, classId), this.examsFor(yearId, classId), this.subjectsFor(yearId, classId)]);
    const students = await this.db.selectFrom('enrollments as en').innerJoin('students as s', 's.id', 'en.student_id')
      .select(['s.id', 'en.section_id']).where('en.academic_year_id', '=', yearId).where('en.class_id', '=', classId).where('s.status', '=', 'active').execute();
    const ids = students.map((s) => s.id).concat([0]);
    const [marks, pubs] = await Promise.all([
      this.db.selectFrom('marks').select(['exam_id', 'student_id', 'subject_id', 'marks', 'is_absent']).where('student_id', 'in', ids).where('exam_id', 'in', examsAll.map((e) => e.id).concat([0])).execute(),
      this.db.selectFrom('exam_publications').select(['exam_id', 'section_id']).where('exam_id', 'in', examsAll.map((e) => e.id).concat([0])).execute(),
    ]);
    const results = students.map((s) => {
      const visible = publishedOnly ? examsAll.filter((e) => pubs.some((p) => p.exam_id === e.id && p.section_id === s.section_id)) : examsAll;
      const map = new Map<string, MarkCell>();
      for (const m of marks) if (m.student_id === s.id && visible.some((e) => e.id === m.exam_id)) map.set(`${m.exam_id}:${m.subject_id}`, { marks: m.marks == null ? null : Number(m.marks), absent: m.is_absent === 1 });
      return { sectionId: s.section_id, exams: visible, result: studentResult(s.id, subjects, visible, map, rule) };
    });
    const byClass = rank(results, (r) => r.result.totalPct);
    for (const r of results) r.result.rankClass = byClass.get(r);
    for (const sid of new Set(results.map((r) => r.sectionId))) {
      const inSec = results.filter((r) => r.sectionId === sid);
      const bySec = rank(inSec, (r) => r.result.totalPct);
      for (const r of inSec) r.result.rankSection = bySec.get(r);
    }
    return { rule, exams: examsAll, subjects, results, classSize: results.filter((r) => r.result.totalPct != null).length };
  }
}

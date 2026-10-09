import { Inject, Injectable } from '@nestjs/common';
import { sql, type SelectQueryBuilder } from 'kysely';
import { KYSELY, type Database } from '../database/database.module';
import type { DB } from '../database/db.types';
import { Errors } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import { currentYear } from '../common/academic-year';
import { newPublicId } from '../common/ids';
import { takeNext } from '../common/sequences';
import type { RequestUser } from '../common/request-user';
import { PermissionsService } from '../permissions/permissions.service';
import { studentFilter, type StudentFilter } from './student-scope';
import { findOrCreateFamilyUser, syncFamilyLogin } from './family-accounts';

type Meta = { ip: string | null; userAgent: string | null };

export interface FamilyInput {
  familyName: string; fatherName?: string | null; motherName?: string | null; guardianName?: string | null;
  mobile: string; altMobile?: string | null; email?: string | null; address?: string | null;
}
export interface StudentInput {
  admissionNo?: string | null; firstName: string; lastName?: string | null; dob?: string | null;
  gender?: 'male' | 'female' | 'other' | null; bloodGroup?: string | null; admissionDate?: string | null;
  address?: string | null; classId: number; sectionId: number; rollNo?: string | null;
  family: { familyId: string } | FamilyInput;
}

const HIDDEN = '__hidden__';
const toDate = (d?: string | null) => (d ? new Date(`${d}T00:00:00Z`) : null);

/** Gapless admission numbers (requirements 19.2). Must be called inside a transaction. */
export const nextSequence = (trx: Database, key: string, scope = 'global') => takeNext(trx, key, scope, { prefix: '', pad: 4 });

@Injectable()
export class StudentsService {
  constructor(
    @Inject(KYSELY) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly perms: PermissionsService,
  ) {}

  private applyFilter<O>(qb: SelectQueryBuilder<any, any, O>, f: StudentFilter): SelectQueryBuilder<any, any, O> {
    switch (f.kind) {
      case 'all': return qb;
      case 'sections': return f.sectionIds.length ? qb.where('e.section_id', 'in', f.sectionIds) : qb.where(sql<boolean>`1 = 0`);
      case 'family': return qb.where('f.user_id', '=', f.userId);
      case 'self': return qb.where('s.user_id', '=', f.userId);
      default: return qb.where(sql<boolean>`1 = 0`);
    }
  }

  /** Field rules (requirements 5.4): hidden fields are replaced, never silently dropped, so the UI can say so. */
  private async fieldRules(user: RequestUser) {
    if (user.isSuperAdmin && user.workspace === 'staff') return new Map<string, string>();
    return this.perms.fieldAccess(user.id, user.workspace, 'student');
  }
  private mask<T extends Record<string, any>>(row: T, rules: Map<string, string>, map: Record<string, string>): T {
    const out: Record<string, any> = { ...row };
    for (const [field, col] of Object.entries(map)) if (rules.get(field) === 'hidden' && col in out) out[col] = HIDDEN;
    return out as T;
  }

  private base(yearId: number) {
    return this.db.selectFrom('students as s')
      .innerJoin('families as f', 'f.id', 's.family_id')
      .leftJoin('enrollments as e', (j) => j.onRef('e.student_id', '=', 's.id').on('e.academic_year_id', '=', yearId))
      .leftJoin('classes as c', 'c.id', 'e.class_id')
      .leftJoin('sections as sec', 'sec.id', 'e.section_id');
  }

  async list(user: RequestUser, q: { search?: string; classId?: number; sectionId?: number; status: 'active' | 'inactive'; page: number; pageSize: number }) {
    const year = await currentYear(this.db);
    const filter = await studentFilter(this.db, user, 'students.view', year.id);
    // Rule ST2/ST3: inactive students are hidden unless explicitly requested by someone who can deactivate.
    if (q.status === 'inactive' && !user.permissions.has('students.deactivate')) throw Errors.forbidden();
    let qb = this.applyFilter(this.base(year.id), filter).where('s.status', '=', q.status);
    if (q.classId) qb = qb.where('e.class_id', '=', q.classId);
    if (q.sectionId) qb = qb.where('e.section_id', '=', q.sectionId);
    if (q.search) {
      const like = `%${q.search}%`;
      qb = qb.where((eb) => eb.or([
        eb('s.first_name', 'like', like), eb('s.last_name', 'like', like), eb('s.admission_no', 'like', like),
        eb('f.family_name', 'like', like), eb('f.primary_mobile', 'like', like), eb('f.father_name', 'like', like),
      ]));
    }
    const [{ total }] = await qb.select((eb) => eb.fn.countAll<number>().as('total')).execute();
    const rows = await qb.select([
      's.public_id', 's.admission_no', 's.first_name', 's.last_name', 's.gender', 's.status',
      'c.name as class_name', 'c.level_order', 'sec.name as section_name', 'e.roll_no',
      'f.public_id as family_id', 'f.family_name', 'f.father_name', 'f.primary_mobile as family_mobile',
    ]).orderBy('c.level_order').orderBy('sec.name').orderBy(sql`CAST(e.roll_no AS UNSIGNED)`).orderBy('s.first_name')
      .limit(q.pageSize).offset((q.page - 1) * q.pageSize).execute();
    const rules = await this.fieldRules(user);
    return {
      data: rows.map((r) => this.mask(r, rules, { 'family.mobile': 'family_mobile' })),
      meta: { page: q.page, pageSize: q.pageSize, total: Number(total), academicYear: year.name },
    };
  }

  private async findVisible(user: RequestUser, publicId: string, permission = 'students.view') {
    const year = await currentYear(this.db);
    const filter = await studentFilter(this.db, user, permission, year.id);
    const row = await this.applyFilter(this.base(year.id), filter)
      .select(['s.id', 's.family_id', 's.status']).where('s.public_id', '=', publicId).executeTakeFirst();
    if (!row) throw Errors.notFound('Student');
    // Inactive students are visible only to those who manage status (rule ST3), and to their own family for history.
    if (row.status === 'inactive' && filter.kind !== 'family' && !user.permissions.has('students.deactivate')) throw Errors.notFound('Student');
    return { ...row, year };
  }

  /** Student 360 (requirements 17): profile, family, current class, history. */
  async get(user: RequestUser, publicId: string) {
    const { id, year } = await this.findVisible(user, publicId);
    const s = await this.base(year.id).innerJoin('users as fu', 'fu.id', 'f.user_id').select([
      's.public_id', 's.admission_no', 's.first_name', 's.last_name', 's.dob', 's.gender', 's.blood_group', 's.admission_date',
      's.address', 's.status', 's.inactive_reason', 's.inactive_at', 's.created_at',
      'c.id as class_id', 'c.name as class_name', 'sec.id as section_id', 'sec.name as section_name', 'e.roll_no',
      'f.public_id as family_id', 'f.family_name', 'f.father_name', 'f.mother_name', 'f.guardian_name',
      'f.primary_mobile as family_mobile', 'f.alt_mobile as family_alt_mobile', 'f.email as family_email', 'f.address as family_address',
      'fu.public_id as family_user_id', 'fu.status as family_login_status', 'fu.last_login_at as family_last_login',
      sql<boolean>`fu.password_hash IS NOT NULL`.as('family_login_sent'),
    ]).where('s.id', '=', id).executeTakeFirstOrThrow();
    const [siblings, history] = await Promise.all([
      this.base(year.id).select(['s.public_id', 's.first_name', 's.last_name', 's.status', 'c.name as class_name', 'sec.name as section_name'])
        .where('s.family_id', '=', (await this.db.selectFrom('students').select('family_id').where('id', '=', id).executeTakeFirstOrThrow()).family_id)
        .where('s.id', '!=', id).execute(),
      this.db.selectFrom('enrollments as e').innerJoin('academic_years as y', 'y.id', 'e.academic_year_id')
        .innerJoin('classes as c', 'c.id', 'e.class_id').innerJoin('sections as sec', 'sec.id', 'e.section_id')
        .select(['y.name as year', 'c.name as class_name', 'sec.name as section_name', 'e.roll_no', 'e.status', 'e.remarks'])
        .where('e.student_id', '=', id).orderBy('y.start_date', 'desc').execute(),
    ]);
    const rules = await this.fieldRules(user);
    const masked = this.mask({ ...s, family_login_sent: Boolean(Number(s.family_login_sent)) }, rules, {
      'family.mobile': 'family_mobile', 'family.address': 'family_address', address: 'address',
    });
    if (rules.get('family.mobile') === 'hidden') { (masked as any).family_alt_mobile = HIDDEN; (masked as any).family_email = HIDDEN; }
    return { ...masked, academic_year: year.name, siblings, history };
  }

  private async assertSection(trx: Database, classId: number, sectionId: number) {
    const sec = await trx.selectFrom('sections').select(['id', 'class_id', 'is_active']).where('id', '=', sectionId).executeTakeFirst();
    if (!sec || sec.class_id !== classId) throw Errors.validation([{ field: 'sectionId', message: 'Choose a section of the selected class.' }]);
  }

  async create(actor: RequestUser, input: StudentInput, meta: Meta) {
    const year = await currentYear(this.db);
    const publicId = await this.db.transaction().execute(async (trx) => {
      await this.assertSection(trx, input.classId, input.sectionId);
      let familyId: number;
      if ('familyId' in input.family) {
        const fam = await trx.selectFrom('families').select('id').where('public_id', '=', input.family.familyId).executeTakeFirst();
        if (!fam) throw Errors.notFound('Family');
        familyId = fam.id;
      } else {
        familyId = await this.createFamily(trx, input.family, actor.id);
      }
      const admissionNo = input.admissionNo?.trim() || (await nextSequence(trx, 'admission'));
      const dup = await trx.selectFrom('students').select('id').where('admission_no', '=', admissionNo).executeTakeFirst();
      if (dup) throw Errors.validation([{ field: 'admissionNo', message: `Admission number ${admissionNo} is already used.` }]);
      const pid = newPublicId();
      const res = await trx.insertInto('students').values({
        public_id: pid, admission_no: admissionNo, family_id: familyId, first_name: input.firstName, last_name: input.lastName ?? null,
        dob: toDate(input.dob), gender: input.gender ?? null, blood_group: input.bloodGroup ?? null,
        admission_date: toDate(input.admissionDate) ?? new Date(), address: input.address ?? null, created_by: actor.id,
      }).executeTakeFirstOrThrow();
      const studentId = Number(res.insertId);
      await trx.insertInto('enrollments').values({
        student_id: studentId, academic_year_id: year.id, class_id: input.classId, section_id: input.sectionId,
        roll_no: input.rollNo ?? null, joined_on: toDate(input.admissionDate) ?? new Date(),
      }).execute();
      await syncFamilyLogin(trx, familyId);
      await this.audit.log(actor, { module: 'students', action: 'create', entityType: 'student', entityId: studentId, after: { ...input, admissionNo }, ...meta }, trx);
      return pid;
    });
    this.perms.invalidate();
    return this.get(actor, publicId);
  }

  async createFamily(trx: Database, f: FamilyInput, actorId: number) {
    const exists = await trx.selectFrom('families').select('id').where('primary_mobile', '=', f.mobile).executeTakeFirst();
    if (exists) throw Errors.conflict(`A family with mobile ${f.mobile} already exists. Add the student to that family instead.`);
    const userId = await findOrCreateFamilyUser(trx, { name: f.familyName, mobile: f.mobile, email: f.email }, actorId);
    const res = await trx.insertInto('families').values({
      public_id: newPublicId(), user_id: userId, family_name: f.familyName, father_name: f.fatherName ?? null,
      mother_name: f.motherName ?? null, guardian_name: f.guardianName ?? null, primary_mobile: f.mobile,
      alt_mobile: f.altMobile ?? null, email: f.email ?? null, address: f.address ?? null, created_by: actorId,
    }).executeTakeFirstOrThrow();
    return Number(res.insertId);
  }

  async update(actor: RequestUser, publicId: string, input: Partial<Omit<StudentInput, 'family'>>, meta: Meta) {
    const { id, year } = await this.findVisible(actor, publicId, 'students.edit');
    const before = await this.get(actor, publicId);
    await this.db.transaction().execute(async (trx) => {
      const patch: Record<string, unknown> = { updated_by: actor.id };
      if (input.firstName !== undefined) patch.first_name = input.firstName;
      if (input.lastName !== undefined) patch.last_name = input.lastName;
      if (input.dob !== undefined) patch.dob = toDate(input.dob);
      if (input.gender !== undefined) patch.gender = input.gender;
      if (input.bloodGroup !== undefined) patch.blood_group = input.bloodGroup;
      if (input.admissionDate !== undefined) patch.admission_date = toDate(input.admissionDate);
      if (input.address !== undefined) patch.address = input.address;
      if (input.admissionNo) patch.admission_no = input.admissionNo.trim();
      await trx.updateTable('students').set(patch).where('id', '=', id).execute();
      if (input.classId !== undefined || input.sectionId !== undefined || input.rollNo !== undefined) {
        const cur = await trx.selectFrom('enrollments').selectAll().where('student_id', '=', id).where('academic_year_id', '=', year.id).executeTakeFirst();
        const classId = input.classId ?? cur?.class_id; const sectionId = input.sectionId ?? cur?.section_id;
        if (!classId || !sectionId) throw Errors.validation([{ field: 'sectionId', message: 'Choose a class and section.' }]);
        await this.assertSection(trx, classId, sectionId);
        if (cur) {
          await trx.updateTable('enrollments').set({ class_id: classId, section_id: sectionId, roll_no: input.rollNo ?? cur.roll_no }).where('id', '=', cur.id).execute();
        } else {
          await trx.insertInto('enrollments').values({ student_id: id, academic_year_id: year.id, class_id: classId, section_id: sectionId, roll_no: input.rollNo ?? null }).execute();
        }
      }
    });
    const after = await this.get(actor, publicId);
    await this.audit.log(actor, { module: 'students', action: 'update', entityType: 'student', entityId: id, before, after, ...meta });
    return after;
  }

  /** Rules ST1 to ST5. */
  async setStatus(actor: RequestUser, publicId: string, active: boolean, reason: string | null, meta: Meta) {
    const { id, family_id, status } = await this.findVisible(actor, publicId, 'students.deactivate');
    const next = active ? 'active' : 'inactive';
    if (status === next) return this.get(actor, publicId);
    const familyLogin = await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('students').set({
        status: next, inactive_reason: active ? null : reason, inactive_at: active ? null : new Date(), updated_by: actor.id,
      }).where('id', '=', id).execute();
      const r = await syncFamilyLogin(trx, family_id);
      await this.audit.log(actor, { module: 'students', action: active ? 'activate' : 'deactivate', entityType: 'student', entityId: id, after: { reason, familyLogin: r }, ...meta }, trx);
      return r;
    });
    this.perms.invalidate();
    return { ...(await this.get(actor, publicId)), family_login_change: familyLogin };
  }

  async searchFamily(mobile: string) {
    const f = await this.db.selectFrom('families as f').select(['f.public_id', 'f.family_name', 'f.father_name', 'f.mother_name', 'f.primary_mobile'])
      .where('f.primary_mobile', '=', mobile).executeTakeFirst();
    if (!f) {
      const staff = await this.db.selectFrom('users as u').innerJoin('staff as st', 'st.user_id', 'u.id')
        .select(['u.name']).where('u.mobile', '=', mobile).executeTakeFirst();
      return { family: null, staffMatch: staff ? staff.name : null };
    }
    const children = await this.db.selectFrom('students').select(['first_name', 'last_name', 'status'])
      .where('family_id', '=', (await this.db.selectFrom('families').select('id').where('public_id', '=', f.public_id).executeTakeFirstOrThrow()).id).execute();
    return { family: { ...f, children }, staffMatch: null };
  }

  async updateFamily(actor: RequestUser, familyPublicId: string, input: Partial<FamilyInput>, meta: Meta) {
    const fam = await this.db.selectFrom('families').selectAll().where('public_id', '=', familyPublicId).executeTakeFirst();
    if (!fam) throw Errors.notFound('Family');
    await this.db.transaction().execute(async (trx) => {
      const patch: Record<string, unknown> = { updated_by: actor.id };
      const map: Record<string, string> = { familyName: 'family_name', fatherName: 'father_name', motherName: 'mother_name', guardianName: 'guardian_name',
        mobile: 'primary_mobile', altMobile: 'alt_mobile', email: 'email', address: 'address' };
      for (const [k, col] of Object.entries(map)) if ((input as any)[k] !== undefined) patch[col] = (input as any)[k];
      await trx.updateTable('families').set(patch).where('id', '=', fam.id).execute();
      // The family's login follows its mobile/email (L8). Unique keys reject clashes with other accounts.
      if (fam.user_id && (input.mobile !== undefined || input.email !== undefined || input.familyName !== undefined)) {
        const isStaff = await trx.selectFrom('staff').select('id').where('user_id', '=', fam.user_id).executeTakeFirst();
        if (!isStaff) {
          await trx.updateTable('users').set({
            ...(input.mobile !== undefined && { mobile: input.mobile }),
            ...(input.email !== undefined && { email: input.email || null }),
            ...(input.familyName !== undefined && { name: input.familyName }),
          }).where('id', '=', fam.user_id).execute();
        }
      }
      await this.audit.log(actor, { module: 'families', action: 'update', entityType: 'family', entityId: fam.id, before: fam, after: input, ...meta }, trx);
    });
    return { updated: true };
  }
}

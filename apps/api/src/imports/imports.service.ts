import { Inject, Injectable } from '@nestjs/common';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import { FilesService } from '../common/files.service';
import { currentYear } from '../common/academic-year';
import { newPublicId } from '../common/ids';

import type { RequestUser } from '../common/request-user';
import { PermissionsService } from '../permissions/permissions.service';
import { findOrCreateFamilyUser, syncFamilyLogin } from '../students/family-accounts';
import { nextSequence } from '../students/students.service';
import { FeeAccountsService } from '../fees/fee-accounts.service';
import { applyPayment } from '../fees/payments.service';
import { toDb } from '../fees/money';
import { buildTemplate, classKey, isEmail, parseDate, parseGender, parseMobile, readRows, type Column } from './excel';

export type ImportType = 'families_students' | 'staff' | 'opening_fees';
type Meta = { ip: string | null; userAgent: string | null };
interface RowError { row: number; column: string; message: string }

const STUDENT_COLUMNS: Column[] = [
  { key: 'admissionNo', header: 'Admission No', example: '1023', note: 'Leave empty to number automatically.' },
  { key: 'firstName', header: 'First Name', required: true, example: 'Ravi' },
  { key: 'lastName', header: 'Last Name', example: 'Kumar' },
  { key: 'dob', header: 'Date of Birth', example: '2016-05-14' },
  { key: 'gender', header: 'Gender', example: 'M', note: 'M / F / Other' },
  { key: 'className', header: 'Class', required: true, example: 'Class 5', note: 'As shown in Classes & years, e.g. LKG, Class 5 or just 5.' },
  { key: 'section', header: 'Section', required: true, example: 'A' },
  { key: 'rollNo', header: 'Roll No', example: '12' },
  { key: 'admissionDate', header: 'Admission Date', example: '2024-06-12' },
  { key: 'fatherName', header: 'Father Name', example: 'Srinivas Kumar' },
  { key: 'motherName', header: 'Mother Name', example: 'Lakshmi' },
  { key: 'familyMobile', header: 'Family Mobile', required: true, example: '9876543210', note: 'Family login. Brothers and sisters share the same mobile and become one family.' },
  { key: 'altMobile', header: 'Alternate Mobile', example: '' },
  { key: 'familyEmail', header: 'Family Email', example: '', note: 'Optional. Lets the family reset its password by email.' },
  { key: 'address', header: 'Address', example: '2-45, Main Road, Shankarpalli', width: 36 },
];
const STAFF_COLUMNS: Column[] = [
  { key: 'employeeCode', header: 'Employee Code', required: true, example: 'T-014' },
  { key: 'name', header: 'Name', required: true, example: 'Lakshmi Prasanna', width: 24 },
  { key: 'mobile', header: 'Mobile', required: true, example: '9849012345' },
  { key: 'email', header: 'Email', required: true, example: 'lakshmi@school.in', width: 26 },
  { key: 'designation', header: 'Designation', example: 'TGT Maths' },
  { key: 'department', header: 'Department', example: 'Mathematics' },
  { key: 'joiningDate', header: 'Joining Date', example: '2021-06-01' },
  { key: 'roles', header: 'Roles', example: 'Teacher, Class Teacher', note: 'Comma separated role names. Empty = Teacher.', width: 26 },
];
const OPENING_COLUMNS: Column[] = [
  { key: 'admissionNo', header: 'Admission No', required: true, example: '1023' },
  { key: 'studentName', header: 'Student Name', example: 'Ravi Kumar', note: 'For your reference only; matching uses the admission number.', width: 22 },
  { key: 'plan', header: 'Plan', example: 'Quarterly', note: 'Yearly, Half-yearly or Quarterly. Empty = the default plan.' },
  { key: 'tuitionDiscount', header: 'Tuition Discount', example: '3000', note: 'Rupees, fixed amount.' },
  { key: 'concessionType', header: 'Concession Type', example: 'Sibling', note: 'Optional label, must exist in Fee setup.' },
  { key: 'busRoute', header: 'Bus Route', example: '', note: 'Route name exactly as in Fee setup. Empty = no bus.' },
  { key: 'busDiscount', header: 'Bus Discount', example: '' },
  { key: 'tuitionPaid', header: 'Tuition Paid', example: '7000', note: 'Total tuition already paid this year before using the app.' },
  { key: 'busPaid', header: 'Bus Paid', example: '' },
  { key: 'paidOn', header: 'Paid On', example: '2026-09-30', note: 'Date to show on the opening receipt. Empty = today.' },
];
export const COLUMNS: Record<ImportType, Column[]> = { families_students: STUDENT_COLUMNS, staff: STAFF_COLUMNS, opening_fees: OPENING_COLUMNS };
const MAX_ROWS = 5000;

interface PlannedStudent { row: number; d: Record<string, string>; classId: number; sectionId: number; dob: string | null; admissionDate: string | null; gender: any; mobile: string; email: string | null }
interface PlannedStaff { row: number; d: Record<string, string>; mobile: string; email: string; joiningDate: string | null; roleIds: number[]; linkUserId: number | null }

@Injectable()
export class ImportsService {
  constructor(
    @Inject(KYSELY) private readonly db: Database,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    private readonly perms: PermissionsService,
    private readonly accounts: FeeAccountsService,
  ) {}

  async template(type: ImportType) {
    if (type === 'opening_fees') {
      const [routes, conc] = await Promise.all([
        this.db.selectFrom('bus_routes').select('name').where('is_active', '=', 1).orderBy('name').execute(),
        this.db.selectFrom('concession_types').select('name').where('is_active', '=', 1).orderBy('name').execute(),
      ]);
      return buildTemplate('Opening fee balances (students who paid before the app was used)', OPENING_COLUMNS, {
        'Bus routes': routes.map((r) => r.name), 'Concession types': conc.map((c) => c.name),
      });
    }
    if (type === 'staff') {
      const roles = await this.db.selectFrom('roles').select('name').where('workspace', '=', 'staff').where('is_active', '=', 1).orderBy('name').execute();
      return buildTemplate('Staff import', STAFF_COLUMNS, { 'Role names you can use': roles.map((r) => r.name) });
    }
    const classes = await this.db.selectFrom('classes as c').leftJoin('sections as s', 's.class_id', 'c.id')
      .select(['c.name', 's.name as section']).where('c.is_active', '=', 1).orderBy('c.level_order').orderBy('s.name').execute();
    const byClass = new Map<string, string[]>();
    for (const r of classes) byClass.set(r.name, [...(byClass.get(r.name) ?? []), ...(r.section ? [r.section] : [])]);
    return buildTemplate('Families and students import', STUDENT_COLUMNS, {
      'Classes and sections in this school': [...byClass].map(([c, s]) => `${c}: ${s.join(', ') || '(no sections yet)'}`),
    });
  }

  // ---------------- Families + students ----------------

  private async planStudents(rows: Array<{ row: number; data: Record<string, string> }>) {
    const errors: RowError[] = [];
    const err = (row: number, column: string, message: string) => errors.push({ row, column, message });
    const classes = await this.db.selectFrom('classes as c').innerJoin('sections as s', 's.class_id', 'c.id')
      .select(['c.id as class_id', 'c.name', 's.id as section_id', 's.name as section']).where('c.is_active', '=', 1).where('s.is_active', '=', 1).execute();
    const classMap = new Map<string, { classId: number; sections: Map<string, number> }>();
    for (const c of classes) {
      const k = classKey(c.name);
      if (!classMap.has(k)) classMap.set(k, { classId: c.class_id, sections: new Map() });
      classMap.get(k)!.sections.set(c.section.toUpperCase(), c.section_id);
    }
    const planned: PlannedStudent[] = [];
    const admissionSeen = new Map<string, number>();
    for (const { row, data: d } of rows) {
      if (!d.firstName) err(row, 'First Name', 'Required.');
      const cls = classMap.get(classKey(d.className ?? ''));
      if (!d.className) err(row, 'Class', 'Required.');
      else if (!cls) err(row, 'Class', `Class "${d.className}" does not exist.`);
      const sectionId = cls?.sections.get((d.section ?? '').toUpperCase());
      if (!d.section) err(row, 'Section', 'Required.');
      else if (cls && !sectionId) err(row, 'Section', `Section "${d.section}" does not exist in ${d.className}.`);
      const mobile = parseMobile(d.familyMobile ?? '');
      if (!d.familyMobile) err(row, 'Family Mobile', 'Required.');
      else if (!mobile) err(row, 'Family Mobile', `"${d.familyMobile}" is not a valid 10-digit mobile number.`);
      if (d.altMobile && !parseMobile(d.altMobile)) err(row, 'Alternate Mobile', 'Not a valid mobile number.');
      const email = d.familyEmail ? d.familyEmail.toLowerCase() : null;
      if (email && !isEmail(email)) err(row, 'Family Email', 'Not a valid email.');
      const dob = parseDate(d.dob ?? ''); if (dob === 'invalid') err(row, 'Date of Birth', `"${d.dob}" is not a valid date.`);
      const adm = parseDate(d.admissionDate ?? ''); if (adm === 'invalid') err(row, 'Admission Date', `"${d.admissionDate}" is not a valid date.`);
      const gender = parseGender(d.gender ?? ''); if (gender === 'invalid') err(row, 'Gender', 'Use M, F or Other.');
      if (d.admissionNo) {
        if (admissionSeen.has(d.admissionNo)) err(row, 'Admission No', `Same admission number as row ${admissionSeen.get(d.admissionNo)}.`);
        admissionSeen.set(d.admissionNo, row);
      }
      if (d.firstName && cls && sectionId && mobile) {
        planned.push({ row, d, classId: cls.classId, sectionId, dob: dob === 'invalid' ? null : dob, admissionDate: adm === 'invalid' ? null : adm, gender, mobile, email });
      }
    }
    // Database checks in bulk
    const admNos = [...admissionSeen.keys()];
    if (admNos.length) {
      const taken = await this.db.selectFrom('students').select('admission_no').where('admission_no', 'in', admNos).execute();
      const set = new Set(taken.map((t) => t.admission_no));
      for (const p of planned) if (p.d.admissionNo && set.has(p.d.admissionNo)) err(p.row, 'Admission No', `${p.d.admissionNo} already exists in the system.`);
    }
    const groups = new Map<string, PlannedStudent[]>();
    for (const p of planned) groups.set(p.mobile, [...(groups.get(p.mobile) ?? []), p]);
    let newFamilies = 0, existingFamilies = 0, staffFamilies = 0;
    const mobiles = [...groups.keys()];
    const [fams, users] = mobiles.length ? await Promise.all([
      this.db.selectFrom('families').select('primary_mobile').where('primary_mobile', 'in', mobiles).execute(),
      this.db.selectFrom('users as u').leftJoin('staff as st', 'st.user_id', 'u.id').leftJoin('families as f', 'f.user_id', 'u.id')
        .select(['u.mobile', 'u.email', 'st.id as staff_id', 'f.id as family_id']).where('u.mobile', 'in', mobiles).execute(),
    ]) : [[], []];
    const famSet = new Set(fams.map((f) => f.primary_mobile));
    const userByMobile = new Map(users.map((u) => [u.mobile!, u]));
    for (const [mobile, list] of groups) {
      const emails = [...new Set(list.map((p) => p.email).filter(Boolean))];
      if (emails.length > 1) err(list[1].row, 'Family Email', `Rows with mobile ${mobile} have different emails (${emails.join(', ')}).`);
      if (famSet.has(mobile)) { existingFamilies++; continue; }
      const u = userByMobile.get(mobile);
      if (u && !u.staff_id && !u.family_id) err(list[0].row, 'Family Mobile', `${mobile} is already used by another account.`);
      if (u?.staff_id) staffFamilies++; else newFamilies++;
      if (emails[0]) {
        const owner = await this.db.selectFrom('users').select('mobile').where('email', '=', emails[0]).executeTakeFirst();
        if (owner && owner.mobile !== mobile) err(list[0].row, 'Family Email', `${emails[0]} is already used by another account.`);
      }
    }
    return { errors, planned, groups, summary: { students: planned.length, newFamilies, existingFamilies, staffFamilies } };
  }

  private async commitStudents(actor: RequestUser, plan: Awaited<ReturnType<ImportsService['planStudents']>>, meta: Meta) {
    const year = await currentYear(this.db);
    await this.db.transaction().execute(async (trx) => {
      const touched = new Set<number>();
      for (const [mobile, list] of plan.groups) {
        let fam = await trx.selectFrom('families').select('id').where('primary_mobile', '=', mobile).executeTakeFirst();
        let familyId = fam?.id;
        if (!familyId) {
          const first = list[0].d;
          const familyName = first.fatherName || first.motherName || `${first.lastName || first.firstName} family`;
          const email = list.find((p) => p.email)?.email ?? null;
          const userId = await findOrCreateFamilyUser(trx, { name: familyName, mobile, email }, actor.id);
          const res = await trx.insertInto('families').values({
            public_id: newPublicId(), user_id: userId, family_name: familyName, father_name: first.fatherName || null,
            mother_name: first.motherName || null, primary_mobile: mobile, alt_mobile: parseMobile(first.altMobile ?? '') ?? null,
            email, address: first.address || null, created_by: actor.id,
          }).executeTakeFirstOrThrow();
          familyId = Number(res.insertId);
        }
        for (const p of list) {
          const admissionNo = p.d.admissionNo || (await nextSequence(trx, 'admission'));
          const res = await trx.insertInto('students').values({
            public_id: newPublicId(), admission_no: admissionNo, family_id: familyId, first_name: p.d.firstName, last_name: p.d.lastName || null,
            dob: p.dob ? new Date(`${p.dob}T00:00:00Z`) : null, gender: p.gender || null,
            admission_date: p.admissionDate ? new Date(`${p.admissionDate}T00:00:00Z`) : null, address: p.d.address || null, created_by: actor.id,
          }).executeTakeFirstOrThrow();
          await trx.insertInto('enrollments').values({
            student_id: Number(res.insertId), academic_year_id: year.id, class_id: p.classId, section_id: p.sectionId, roll_no: p.d.rollNo || null,
          }).execute();
        }
        touched.add(familyId);
      }
      for (const id of touched) await syncFamilyLogin(trx, id);
      await this.audit.log(actor, { module: 'imports', action: 'families_students', after: plan.summary, ...meta }, trx);
    });
  }

  // ---------------- Staff ----------------

  private async planStaff(actor: RequestUser, rows: Array<{ row: number; data: Record<string, string> }>) {
    const errors: RowError[] = [];
    const err = (row: number, column: string, message: string) => errors.push({ row, column, message });
    const roles = await this.db.selectFrom('roles').select(['id', 'role_key', 'name']).where('workspace', '=', 'staff').where('is_active', '=', 1).execute();
    const roleByName = new Map<string, (typeof roles)[number]>();
    for (const r of roles) { roleByName.set(r.name.toLowerCase(), r); roleByName.set(r.role_key.toLowerCase(), r); }
    const seen = { code: new Map<string, number>(), mobile: new Map<string, number>(), email: new Map<string, number>() };
    const planned: PlannedStaff[] = [];
    for (const { row, data: d } of rows) {
      for (const [k, label] of [['employeeCode', 'Employee Code'], ['name', 'Name'], ['mobile', 'Mobile'], ['email', 'Email']] as const) if (!d[k]) err(row, label, 'Required.');
      const mobile = parseMobile(d.mobile ?? ''); if (d.mobile && !mobile) err(row, 'Mobile', `"${d.mobile}" is not a valid 10-digit mobile number.`);
      const email = (d.email ?? '').toLowerCase(); if (email && !isEmail(email)) err(row, 'Email', 'Not a valid email.');
      const jd = parseDate(d.joiningDate ?? ''); if (jd === 'invalid') err(row, 'Joining Date', `"${d.joiningDate}" is not a valid date.`);
      const roleNames = (d.roles || 'Teacher').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      const roleIds: number[] = [];
      for (const n of roleNames) {
        const r = roleByName.get(n);
        if (!r) err(row, 'Roles', `Unknown role "${n}".`);
        else if (r.role_key === 'institution_admin' && !actor.permissions.has('roles.configure')) err(row, 'Roles', 'You cannot assign Institution Admin.');
        else roleIds.push(r.id);
      }
      for (const [k, v, label] of [['code', d.employeeCode, 'Employee Code'], ['mobile', mobile, 'Mobile'], ['email', email, 'Email']] as const) {
        if (!v) continue;
        const m = seen[k]; if (m.has(v)) err(row, label, `Same as row ${m.get(v)}.`); m.set(v, row);
      }
      if (d.employeeCode && d.name && mobile && email && isEmail(email) && jd !== 'invalid') {
        planned.push({ row, d, mobile, email, joiningDate: jd, roleIds: [...new Set(roleIds)], linkUserId: null });
      }
    }
    if (planned.length) {
      const codes = await this.db.selectFrom('staff').select('employee_code').where('employee_code', 'in', planned.map((p) => p.d.employeeCode)).execute();
      const codeSet = new Set(codes.map((c) => c.employee_code));
      const users = await this.db.selectFrom('users as u').leftJoin('staff as st', 'st.user_id', 'u.id')
        .select(['u.id', 'u.mobile', 'u.email', 'st.id as staff_id'])
        .where((eb) => eb.or([eb('u.mobile', 'in', planned.map((p) => p.mobile)), eb('u.email', 'in', planned.map((p) => p.email))])).execute();
      for (const p of planned) {
        if (codeSet.has(p.d.employeeCode)) err(p.row, 'Employee Code', `${p.d.employeeCode} already exists.`);
        const matches = users.filter((u) => u.mobile === p.mobile || u.email === p.email);
        if (matches.length > 1) err(p.row, 'Mobile', 'Mobile and email belong to two different accounts.');
        else if (matches.length === 1) {
          const u = matches[0];
          if (u.staff_id) err(p.row, 'Mobile', 'A staff member with this mobile or email already exists.');
          else if ((u.email && u.email !== p.email) || (u.mobile && u.mobile !== p.mobile)) err(p.row, 'Email', 'Mobile or email is used by another account with different details.');
          else p.linkUserId = u.id; // a parent who joins the staff: one account (rule L3)
        }
      }
    }
    return { errors, planned, summary: { staff: planned.length, linkedToFamilies: planned.filter((p) => p.linkUserId).length } };
  }

  private async commitStaff(actor: RequestUser, plan: Awaited<ReturnType<ImportsService['planStaff']>>, meta: Meta) {
    await this.db.transaction().execute(async (trx) => {
      for (const p of plan.planned) {
        let userId = p.linkUserId;
        if (userId) {
          await trx.updateTable('users').set({ email: p.email, mobile: p.mobile }).where('id', '=', userId).execute();
        } else {
          const res = await trx.insertInto('users').values({
            public_id: newPublicId(), name: p.d.name, email: p.email, mobile: p.mobile, password_hash: null, must_change_password: 1, created_by: actor.id,
          }).executeTakeFirstOrThrow();
          userId = Number(res.insertId);
        }
        await trx.insertInto('staff').values({
          public_id: newPublicId(), user_id: userId, employee_code: p.d.employeeCode, designation: p.d.designation || null,
          department: p.d.department || null, joining_date: p.joiningDate ? new Date(`${p.joiningDate}T00:00:00Z`) : null, created_by: actor.id,
        }).execute();
        if (p.roleIds.length) await trx.insertInto('user_roles').values(p.roleIds.map((role_id) => ({ user_id: userId!, role_id, assigned_by: actor.id }))).ignore().execute();
      }
      await this.audit.log(actor, { module: 'imports', action: 'staff', after: plan.summary, ...meta }, trx);
    });
    this.perms.invalidate();
  }

  // ---------------- Opening fee balances (requirements 15.2, IM2) ----------------

  private async planOpening(rows: Array<{ row: number; data: Record<string, string> }>) {
    const errors: RowError[] = [];
    const err = (row: number, column: string, message: string) => errors.push({ row, column, message });
    const year = await currentYear(this.db);
    const [plans, routes, routeFees, conc, defaultPlan] = await Promise.all([
      this.db.selectFrom('fee_plans').selectAll().execute(),
      this.db.selectFrom('bus_routes').select(['id', 'name']).where('is_active', '=', 1).execute(),
      this.db.selectFrom('route_fees').select(['bus_route_id', 'amount']).where('academic_year_id', '=', year.id).execute(),
      this.db.selectFrom('concession_types').select(['id', 'name']).execute(),
      this.accounts.setupFor(this.db, year.id),
    ]);
    if (!defaultPlan) throw Errors.badRequest('FEES_NOT_CONFIGURED', 'Set the default plan in Fee setup before importing opening balances.');
    const planByName = new Map<string, (typeof plans)[number]>();
    for (const p of plans) { planByName.set(p.name.toLowerCase().replace(/[^a-z]/g, ''), p); planByName.set(p.plan_key.replace(/_/g, ''), p); }
    const money = (row: number, col: string, v: string) => {
      if (!v) return 0;
      const n = Number(v.replace(/[,₹\s]/g, ''));
      if (!Number.isFinite(n) || n < 0) { err(row, col, `"${v}" is not a valid amount.`); return 0; }
      return Math.round(n * 100);
    };
    const admNos = rows.map((r) => r.data.admissionNo).filter(Boolean);
    const students = admNos.length ? await this.db.selectFrom('students as s')
      .leftJoin('enrollments as e', (j) => j.onRef('e.student_id', '=', 's.id').on('e.academic_year_id', '=', year.id))
      .leftJoin('class_tuition_fees as f', (j) => j.onRef('f.class_id', '=', 'e.class_id').on('f.academic_year_id', '=', year.id))
      .leftJoin('student_fee_accounts as a', (j) => j.onRef('a.student_id', '=', 's.id').on('a.academic_year_id', '=', year.id))
      .select(['s.id', 's.admission_no', 's.status', 'e.class_id', 'f.amount as class_fee', 'a.has_payments'])
      .where('s.admission_no', 'in', admNos).execute() : [];
    const byAdm = new Map(students.map((x) => [x.admission_no, x]));
    const seen = new Map<string, number>();
    const planned: any[] = [];
    for (const { row, data: d } of rows) {
      if (!d.admissionNo) { err(row, 'Admission No', 'Required.'); continue; }
      if (seen.has(d.admissionNo)) err(row, 'Admission No', `Same student as row ${seen.get(d.admissionNo)}.`);
      seen.set(d.admissionNo, row);
      const st = byAdm.get(d.admissionNo);
      if (!st) { err(row, 'Admission No', `No student with admission number ${d.admissionNo}.`); continue; }
      if (st.status !== 'active') err(row, 'Admission No', 'This student is inactive.');
      if (!st.class_id) { err(row, 'Admission No', 'Student is not in a class this academic year.'); continue; }
      if (st.class_fee === null) { err(row, 'Admission No', 'Tuition fee for this student\'s class is not set in Fee setup.'); continue; }
      if (st.has_payments) err(row, 'Admission No', 'Payments already exist for this student this year.');
      const plan = d.plan ? planByName.get(d.plan.toLowerCase().replace(/[^a-z]/g, '')) : plans.find((p) => p.id === defaultPlan);
      if (!plan) err(row, 'Plan', `Unknown plan "${d.plan}". Use Yearly, Half-yearly or Quarterly.`);
      const route = d.busRoute ? routes.find((r) => r.name.toLowerCase() === d.busRoute.toLowerCase()) : null;
      if (d.busRoute && !route) err(row, 'Bus Route', `Unknown route "${d.busRoute}".`);
      const routeFee = route ? routeFees.find((f) => f.bus_route_id === route.id) : null;
      if (route && !routeFee) err(row, 'Bus Route', `Set the fee for route "${route.name}" in Fee setup first.`);
      const concession = d.concessionType ? conc.find((c) => c.name.toLowerCase() === d.concessionType.toLowerCase()) : null;
      if (d.concessionType && !concession) err(row, 'Concession Type', `Unknown concession type "${d.concessionType}".`);
      const tDisc = money(row, 'Tuition Discount', d.tuitionDiscount), bDisc = money(row, 'Bus Discount', d.busDiscount);
      const tPaid = money(row, 'Tuition Paid', d.tuitionPaid), bPaid = money(row, 'Bus Paid', d.busPaid);
      const classFee = Math.round(Number(st.class_fee) * 100);
      const busFee = routeFee ? Math.round(Number(routeFee.amount) * 100) : 0;
      if (tDisc > classFee) err(row, 'Tuition Discount', 'More than the tuition fee.');
      if (tPaid > classFee - tDisc) err(row, 'Tuition Paid', `More than the tuition due (₹${((classFee - tDisc) / 100).toLocaleString('en-IN')}).`);
      if ((bDisc || bPaid) && !route) err(row, 'Bus Route', 'Give the route for bus discount or bus paid.');
      if (bDisc > busFee) err(row, 'Bus Discount', 'More than the bus fee.');
      if (bPaid > busFee - bDisc) err(row, 'Bus Paid', 'More than the bus fee due.');
      const paidOn = parseDate(d.paidOn ?? '');
      if (paidOn === 'invalid') err(row, 'Paid On', `"${d.paidOn}" is not a valid date.`);
      else if (paidOn && paidOn > new Date().toISOString().slice(0, 10)) err(row, 'Paid On', 'Cannot be in the future.');
      planned.push({ row, studentId: st.id, planId: plan?.id, routeId: route?.id ?? null, concessionId: concession?.id ?? null, tDisc, bDisc, tPaid, bPaid, paidOn: paidOn === 'invalid' ? null : paidOn });
    }
    return { errors, planned, yearId: year.id, summary: { students: planned.length, withPayments: planned.filter((p) => p.tPaid + p.bPaid > 0).length,
      tuitionPaid: planned.reduce((t, p) => t + p.tPaid, 0) / 100, busPaid: planned.reduce((t, p) => t + p.bPaid, 0) / 100 } };
  }

  private async commitOpening(actor: RequestUser, plan: Awaited<ReturnType<ImportsService['planOpening']>>, meta: Meta) {
    const today = new Date().toISOString().slice(0, 10);
    await this.db.transaction().execute(async (trx) => {
      for (const p of plan.planned) {
        const accId = await this.accounts.ensureAccount(trx, p.studentId, plan.yearId);
        if (!accId) throw Errors.badRequest('FEES_NOT_CONFIGURED', `Row ${p.row}: fees are not configured for this student.`);
        await trx.updateTable('student_fee_accounts').set({
          fee_plan_id: p.planId, bus_route_id: p.routeId, tuition_discount: toDb(p.tDisc), bus_discount: toDb(p.bDisc),
          tuition_concession_type_id: p.tDisc ? p.concessionId : null, bus_concession_type_id: p.bDisc ? p.concessionId : null,
        }).where('id', '=', accId).execute();
        await this.accounts.rebuild(trx, accId);
        const lines: any[] = [];
        if (p.tPaid) lines.push({ category: 'tuition', academicYearId: plan.yearId, amount: p.tPaid / 100 });
        if (p.bPaid) lines.push({ category: 'bus', academicYearId: plan.yearId, amount: p.bPaid / 100 });
        if (lines.length) {
          await applyPayment(trx, actor.id, { studentId: p.studentId, paymentDate: p.paidOn ?? today, method: 'cash', remarks: 'Paid before the app was used (opening balance import).', lines }, 'opening_balance');
        }
      }
      await this.audit.log(actor, { module: 'imports', action: 'opening_fees', after: plan.summary, ...meta }, trx);
    });
  }

  // ---------------- Validate / commit ----------------

  private async plan(actor: RequestUser, type: ImportType, buf: Buffer) {
    const { rows, missing } = await readRows(buf, COLUMNS[type]);
    if (missing.length) throw Errors.badRequest('TEMPLATE_MISMATCH', `Missing columns: ${missing.join(', ')}. Download the template and keep its header row.`);
    if (!rows.length) throw Errors.badRequest('EMPTY_FILE', 'No rows found. Fill the Data sheet below the header row.');
    if (rows.length > MAX_ROWS) throw Errors.badRequest('TOO_MANY_ROWS', `Up to ${MAX_ROWS} rows per file. Split the file and upload in parts.`);
    if (type === 'families_students') {
      await currentYear(this.db);
      const p = await this.planStudents(rows);
      return { totalRows: rows.length, ...p };
    }
    if (type === 'opening_fees') {
      const p = await this.planOpening(rows);
      return { totalRows: rows.length, ...p };
    }
    const p = await this.planStaff(actor, rows);
    return { totalRows: rows.length, ...p };
  }

  async validate(actor: RequestUser, type: ImportType, file: { buffer: Buffer; originalname: string; mimetype: string }) {
    let result;
    try {
      result = await this.plan(actor, type, file.buffer);
    } catch (e: any) {
      if (e?.code) throw e;
      throw Errors.badRequest('UNREADABLE_FILE', 'Could not read this file. Save it as Excel (.xlsx) and try again.');
    }
    const fileId = await this.files.save(file.buffer, file.originalname, file.mimetype, 'imports', actor.id);
    const errorRows = new Set(result.errors.map((e) => e.row)).size;
    const res = await this.db.insertInto('import_jobs').values({
      import_type: type, file_id: fileId, status: result.errors.length ? 'invalid' : 'ready',
      total_rows: result.totalRows, valid_rows: result.totalRows - errorRows, error_rows: errorRows,
      errors: JSON.stringify(result.errors.slice(0, 1000)), created_by: actor.id,
    }).executeTakeFirstOrThrow();
    return {
      jobId: Number(res.insertId), status: result.errors.length ? 'invalid' : 'ready', totalRows: result.totalRows,
      errorRows, errors: result.errors.slice(0, 500), summary: result.summary,
    };
  }

  /** All rows or nothing (requirements 15.1). Re-validates against the current database first. */
  async commit(actor: RequestUser, jobId: number, meta: Meta) {
    const job = await this.db.selectFrom('import_jobs').selectAll().where('id', '=', jobId).executeTakeFirst();
    if (!job || job.created_by !== actor.id) throw Errors.notFound('Import');
    if (job.status === 'completed') throw Errors.badRequest('ALREADY_IMPORTED', 'This file has already been imported.');
    if (job.status !== 'ready') throw Errors.badRequest('IMPORT_HAS_ERRORS', 'Fix the errors and upload the file again.');
    const type = job.import_type as ImportType;
    this.assertTypePermission(actor, type);
    const plan = await this.plan(actor, type, await this.files.read(job.file_id));
    if (plan.errors.length) {
      await this.db.updateTable('import_jobs').set({ status: 'invalid', errors: JSON.stringify(plan.errors.slice(0, 1000)) }).where('id', '=', jobId).execute();
      return { status: 'invalid', errors: plan.errors.slice(0, 500), message: 'The data changed since validation. Review the errors.' };
    }
    await this.db.updateTable('import_jobs').set({ status: 'importing' }).where('id', '=', jobId).execute();
    try {
      if (type === 'families_students') await this.commitStudents(actor, plan as any, meta);
      else if (type === 'opening_fees') await this.commitOpening(actor, plan as any, meta);
      else await this.commitStaff(actor, plan as any, meta);
    } catch (e) {
      await this.db.updateTable('import_jobs').set({ status: 'failed' }).where('id', '=', jobId).execute();
      throw e;
    }
    await this.db.updateTable('import_jobs').set({ status: 'completed', completed_at: new Date() }).where('id', '=', jobId).execute();
    return { status: 'completed', summary: plan.summary };
  }

  assertTypePermission(actor: RequestUser, type: ImportType) {
    const needed = type === 'staff' ? 'staff.import' : type === 'opening_fees' ? 'payments.collect' : 'students.import';
    if (!actor.permissions.has(needed)) throw Errors.forbidden();
  }

  history(actor: RequestUser) {
    return this.db.selectFrom('import_jobs as j').innerJoin('files as f', 'f.id', 'j.file_id').innerJoin('users as u', 'u.id', 'j.created_by')
      .select(['j.id', 'j.import_type', 'j.status', 'j.total_rows', 'j.error_rows', 'j.created_at', 'j.completed_at', 'f.original_name', 'u.name as by'])
      .orderBy('j.id', 'desc').limit(30).execute()
      .then((rows) => rows.filter(() => actor.permissions.has('imports.view')));
  }
}

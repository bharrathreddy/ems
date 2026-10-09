import type { Scope, Workspace } from '../common/request-user';

/**
 * Single source of truth for permissions. The seed syncs this into the
 * `permissions` table. Modules listed in CORE_MODULES are always on;
 * every other module is controlled by a feature flag of the same key.
 */
export const PERMISSION_CATALOG: Record<string, string[]> = {
  settings: ['view', 'configure'],
  users: ['view', 'create', 'edit', 'disable', 'issue_credentials'],
  roles: ['view', 'configure'],
  audit: ['view'],
  academics: ['view', 'manage'],
  students: ['view', 'create', 'edit', 'deactivate', 'import', 'export'],
  families: ['view', 'create', 'edit'],
  staff: ['view', 'create', 'edit', 'import'],
  announcements: ['view', 'create', 'publish'],
  fees: ['view', 'configure', 'discount'],
  payments: ['view', 'collect', 'void'],
  attendance: ['view', 'mark'],
  timetable: ['view', 'manage'],
  exams: ['view', 'configure'],
  marks: ['view', 'enter', 'approve', 'publish'],
  cms: ['view', 'manage'],
  reports: ['view', 'export'],
  imports: ['view', 'run'],
  hr: ['view', 'manage'],
  payroll: ['view', 'manage', 'finalise'],
  expenses: ['view', 'create', 'approve', 'configure'],
  transport: ['view', 'manage', 'log'],
  inventory: ['view', 'manage', 'sell'],
};

export const CORE_MODULES = new Set(['settings', 'users', 'roles', 'audit']);

/** Feature flags seeded for a new installation. R1 modules on, later releases off. */
export const DEFAULT_FEATURE_FLAGS: Record<string, boolean> = {
  academics: true, students: true, families: true, staff: true, announcements: true, imports: true,
  timetable: true,
  fees: false, payments: false, attendance: false, exams: false, marks: false, cms: true, reports: false,
  hr: false, payroll: false, expenses: false, transport: false, inventory: false,
};

/** Broader scopes win when a user holds several roles. */
export const SCOPE_RANK: Record<Scope, number> = {
  all: 100, class: 60, section: 50, subject: 40, assigned_students: 30, assigned_route: 25, own_children: 10, own_records: 5,
};

type Grant = [perm: string, scope?: Scope];
interface RoleTemplate { key: string; name: string; workspace: Workspace; grants: Grant[] | 'ALL' }

const all = (module: string, scope: Scope = 'all'): Grant[] =>
  PERMISSION_CATALOG[module].map((a) => [`${module}.${a}`, scope] as Grant);
const viewOf = (...modules: string[]): Grant[] => modules.map((m) => [`${m}.view`, 'all'] as Grant);

const principalGrants: Grant[] = [
  ...viewOf('settings', 'users', 'roles', 'audit', 'academics', 'students', 'families', 'staff', 'fees', 'payments',
    'attendance', 'exams', 'marks', 'cms', 'reports', 'timetable', 'hr', 'payroll', 'expenses', 'transport', 'inventory'),
  ...all('announcements'),
  ['marks.approve', 'all'], ['marks.publish', 'all'], ['reports.export', 'all'], ['expenses.approve', 'all'],
];

export const DEFAULT_ROLES: RoleTemplate[] = [
  { key: 'institution_admin', name: 'Institution Admin', workspace: 'staff', grants: 'ALL' },
  { key: 'principal', name: 'Principal', workspace: 'staff', grants: principalGrants },
  { key: 'vice_principal', name: 'Vice Principal', workspace: 'staff', grants: principalGrants },
  {
    key: 'accountant', name: 'Accountant', workspace: 'staff',
    grants: [...viewOf('academics', 'students', 'families', 'announcements'), ...all('fees'), ...all('payments'), ...all('reports'), ...all('imports'),
      ['hr.view', 'all'], ['payroll.view', 'all'], ['payroll.manage', 'all'], ['expenses.view', 'all'], ['expenses.create', 'all'],
      ['transport.view', 'all'], ['transport.log', 'all'], ...all('inventory')],
  },
  {
    key: 'teacher', name: 'Teacher', workspace: 'staff',
    grants: [['academics.view', 'all'], ['students.view', 'subject'], ['attendance.view', 'subject'],
      ['marks.view', 'subject'], ['marks.enter', 'subject'], ['announcements.view', 'all'], ['timetable.view', 'all'], ['attendance.mark', 'subject']],
  },
  {
    key: 'class_teacher', name: 'Class Teacher', workspace: 'staff',
    grants: [['students.view', 'section'], ['families.view', 'section'], ['attendance.view', 'section'],
      ['attendance.mark', 'section'], ['marks.view', 'section'], ['announcements.create', 'section'], ['timetable.view', 'all']],
  },
  {
    key: 'exam_coordinator', name: 'Exam Coordinator', workspace: 'staff',
    grants: [...viewOf('academics', 'students', 'announcements', 'timetable'), ...all('exams'), ['marks.view', 'all'], ['marks.approve', 'all']],
  },
  {
    key: 'receptionist', name: 'Receptionist', workspace: 'staff',
    grants: [...viewOf('academics', 'announcements'), ['students.view', 'all'], ['families.view', 'all'],
      ['families.create', 'all'], ['families.edit', 'all'], ['inventory.view', 'all'], ['inventory.sell', 'all']],
  },
  { key: 'hr_manager', name: 'HR Manager', workspace: 'staff', grants: [...all('staff'), ...all('hr'), ['payroll.view', 'all'], ['payroll.manage', 'all'], ['announcements.view', 'all']] },
  { key: 'librarian', name: 'Librarian', workspace: 'staff', grants: [['announcements.view', 'all'], ['students.view', 'all']] },
  { key: 'transport_manager', name: 'Transport Manager', workspace: 'staff', grants: [['announcements.view', 'all'], ['students.view', 'all'], ...all('transport')] },
  { key: 'driver', name: 'Driver', workspace: 'staff', grants: [['students.view', 'assigned_route'], ['transport.view', 'assigned_route']] },
  { key: 'non_teaching_staff', name: 'Non-Teaching Staff', workspace: 'staff', grants: [['announcements.view', 'all']] },
  {
    key: 'parent', name: 'Parent', workspace: 'parent',
    grants: [['students.view', 'own_children'], ['fees.view', 'own_children'], ['payments.view', 'own_children'],
      ['attendance.view', 'own_children'], ['marks.view', 'own_children'], ['announcements.view', 'own_records'], ['timetable.view', 'own_children'], ['transport.view', 'own_children']],
  },
  {
    key: 'student', name: 'Student', workspace: 'student',
    grants: [['students.view', 'own_records'], ['fees.view', 'own_records'], ['payments.view', 'own_records'],
      ['attendance.view', 'own_records'], ['marks.view', 'own_records'], ['announcements.view', 'own_records'], ['timetable.view', 'own_records']],
  },
];

/** Field rules from requirements 5.4. Fields not listed default to "view" when the entity is viewable. */
export const DEFAULT_FIELD_POLICIES: Array<[role: string, entity: string, field: string, access: 'hidden' | 'view' | 'edit']> = [
  ['teacher', 'student', 'family.mobile', 'hidden'],
  ['teacher', 'student', 'family.address', 'hidden'],
  ['teacher', 'student', 'address', 'hidden'],
  ['teacher', 'student', 'fees', 'hidden'],
  ['class_teacher', 'student', 'fees', 'hidden'],
  ['accountant', 'student', 'marks', 'hidden'],
  ['driver', 'student', 'fees', 'hidden'],
  ['driver', 'student', 'marks', 'hidden'],
];

/**
 * One-time additions to default roles on installations that already exist (roles already
 * have grants there, so the template above is not re-applied). Each patch runs once.
 */
export const GRANT_PATCHES: Array<{ id: string; grants: Array<[role: string, perm: string, scope: Scope]> }> = [
  { id: '2026-r3-attendance', grants: [['teacher', 'attendance.mark', 'subject'], ['class_teacher', 'attendance.view', 'section']] },
];

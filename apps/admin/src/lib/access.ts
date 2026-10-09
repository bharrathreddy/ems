/** Labels and helpers for the Access & roles page. */
export type Scope = 'all' | 'class' | 'section' | 'subject' | 'assigned_students' | 'own_records' | 'own_children' | 'assigned_route';
export type Workspace = 'staff' | 'parent' | 'student';
export type Grants = Record<string, Scope>;
export interface ModuleInfo { key: string; actions: string[]; core: boolean; enabled: boolean }
export type Level = 'none' | 'view' | 'edit' | 'custom';

export const MODULE_LABEL: Record<string, string> = {
  settings: 'School settings', users: 'Logins', roles: 'Roles & year end', audit: 'Audit', academics: 'Classes & teachers', students: 'Students', families: 'Parents',
  staff: 'Staff', announcements: 'Notices', fees: 'Fees', payments: 'Fee receipts', attendance: 'Attendance', timetable: 'Timetable', exams: 'Exams', marks: 'Marks',
  cms: 'Website', reports: 'Reports & downloads', imports: 'Bulk import', hr: 'HR records', payroll: 'Payroll', expenses: 'Expenses', transport: 'Transport', inventory: 'Stock & sales',
};
export const ACTION_LABEL: Record<string, string> = {
  view: 'View', create: 'Add', edit: 'Edit', deactivate: 'Make inactive / leaving', import: 'Import from Excel', export: 'Download lists', configure: 'Set up',
  discount: 'Give discounts and waivers', collect: 'Collect fees', void: 'Void receipts', mark: 'Mark', enter: 'Enter', approve: 'Approve', publish: 'Publish', manage: 'Manage',
  finalise: 'Finalise', run: 'Run imports', issue_credentials: 'Send login details', disable: 'Turn logins on or off', log: 'Log fuel and service', sell: 'Sell at the counter',
};
export const SCOPE_LABEL: Record<Scope, string> = {
  all: "Everyone's records", section: 'Their class-teacher sections', class: 'Their class-teacher classes', subject: 'Sections they teach', assigned_students: 'Students they teach',
  assigned_route: 'Their bus route', own_children: 'Their own children', own_records: 'Their own record',
};
export const DEFAULT_SCOPE: Record<Workspace, Scope> = { staff: 'all', parent: 'own_children', student: 'own_records' };
export const LEVEL_LABEL: Record<Exclude<Level, 'custom'>, string> = { none: 'No access', view: 'View', edit: 'View & edit' };
export const WS_LABEL: Record<Workspace, string> = { staff: 'Staff', parent: 'Parents', student: 'Students' };

/** Modules where "whose records" matters (people's data); elsewhere access is simply on or off. */
export const SCOPED_MODULES = new Set(['students', 'families', 'attendance', 'marks', 'timetable', 'announcements', 'transport', 'fees', 'payments', 'exams']);

export const moduleLabel = (k: string) => MODULE_LABEL[k] ?? k;
export const actionLabel = (a: string) => ACTION_LABEL[a] ?? a.replace(/_/g, ' ');

/** How much of a module a set of grants covers. */
export function levelOf(grants: Record<string, unknown>, m: ModuleInfo): Level {
  const has = m.actions.filter((a) => `${m.key}.${a}` in grants);
  if (!has.length) return 'none';
  if (m.actions.length === 1) return 'view';
  if (has.length === m.actions.length) return 'edit';
  if (has.length === 1 && has[0] === 'view') return 'view';
  return 'custom';
}

/** The scope a module mostly uses in these grants (for keeping it when switching level). */
export function scopeOf(grants: Grants, m: ModuleInfo, ws: Workspace): Scope {
  return (m.actions.map((a) => grants[`${m.key}.${a}`]).find(Boolean) as Scope | undefined) ?? DEFAULT_SCOPE[ws];
}

export function applyLevel(grants: Grants, m: ModuleInfo, level: Exclude<Level, 'custom'>, scope: Scope): Grants {
  const out = { ...grants };
  for (const a of m.actions) delete out[`${m.key}.${a}`];
  if (level === 'view') out[`${m.key}.view`] = scope;
  if (level === 'edit') for (const a of m.actions) out[`${m.key}.${a}`] = scope;
  return out;
}

/**
 * Demo school: fills an EMPTY database with a complete, realistic school so every screen and
 * every login can be tried. Run it on a separate database (for example ems_demo), never on the real one.
 *
 *   npm run demo                 uses DB_NAME from .env (must be empty)
 *   npm run demo -- --db ems_demo
 *
 * Everything goes through the app's own API (same rules and checks as the screens), so the data is
 * exactly what the school would have after using the app for a few months.
 */
import 'reflect-metadata';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

const isCli = require.main === module;
if (isCli) {
  const i = process.argv.indexOf('--db');
  const argDb = i > 0 ? process.argv[i + 1] : undefined;
  if (argDb) {
    if (!/^[A-Za-z0-9_]{1,64}$/.test(argDb)) { console.error('Use a database name with letters, numbers and _ only.'); process.exit(1); }
    process.env.DB_NAME = argDb;
  }
  process.env.MAIL_WORKER = 'off';
  process.env.NODE_ENV = 'test'; // no rate limits or background jobs while filling
  process.env.ACCESS_TOKEN_TTL_MIN = '600';
  process.env.REMINDER_WORKER = 'off';
  process.env.PUSH_WORKER = 'off';
}

export const DEMO_PASSWORD = 'Demo@1234';
const ASSETS = [resolve(__dirname, '../../assets/demo'), resolve(__dirname, '../../../assets/demo')].find((d) => existsSync(join(d, 'logo.png')))!;
const ROOT = resolve(__dirname, '../../../..');

// ---------------------------------------------------------------- helpers
let seedN = 20261010;
const rnd = () => { seedN = (seedN * 1103515245 + 12345) % 2147483648; return seedN / 2147483648; };
const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
const between = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: string, n: number) => iso(new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000));
const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const log = (s: string) => console.log(`  ${s}`);
const say = (s: string) => console.log(isCli ? s : `Demo data: ${s}`);
const warnings: string[] = [];

class ApiError extends Error { constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); } }

let fillHeader: Record<string, string> = {};
class Client {
  constructor(private base: string, public token?: string, private creds?: { identifier: string; password: string }) {}
  async req<T = any>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
    const isForm = body instanceof FormData;
    const r = await fetch(`${this.base}/api/v1${path}`, {
      method, headers: { ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...(isForm || body === undefined ? {} : { 'Content-Type': 'application/json' }), 'X-Client': 'mobile', ...fillHeader },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
    // Sign-ins last 15 minutes on a normal server: sign in again and repeat once.
    if (r.status === 401 && this.creds && !retried) {
      const t = await new Client(this.base).post<{ accessToken: string }>('/auth/login', this.creds);
      this.token = t.accessToken;
      return this.req<T>(method, path, body, true);
    }
    const text = await r.text();
    let j: any = null;
    try { j = JSON.parse(text); } catch { /* binary */ }
    if (!r.ok || (j && j.success === false)) throw new ApiError(r.status, j?.code ?? 'HTTP', `${method} ${path}: ${j?.message ?? r.status} ${j?.details ? JSON.stringify(j.details) : ''}`, j?.details);
    return (j?.data ?? j) as T;
  }
  get = <T = any>(p: string) => this.req<T>('GET', p);
  post = <T = any>(p: string, b: unknown = {}) => this.req<T>('POST', p, b);
  put = <T = any>(p: string, b: unknown) => this.req<T>('PUT', p, b);
  patch = <T = any>(p: string, b: unknown) => this.req<T>('PATCH', p, b);
  /** Same call, but a refusal is only noted (used where clashes are expected, e.g. a teacher already busy that period). */
  async soft<T = any>(method: string, p: string, b?: unknown): Promise<T | null> {
    try { return await this.req<T>(method, p, b); } catch (e) { if (process.env.DEMO_VERBOSE) warnings.push((e as Error).message); return null; }
  }
}
const file = (name: string, type = 'image/jpeg') => {
  const fd = new FormData();
  fd.append('file', new Blob([readFileSync(join(ASSETS, name))], { type }), name);
  return fd;
};

// ---------------------------------------------------------------- the school
const SCHOOL = {
  name: 'Sri Vidya Niketan High School', shortName: 'SVN School', address: 'Plot 14, Station Road, Chevella, Ranga Reddy District, Telangana 501503',
  phone: '08417 244 210', contactEmail: 'office@example.com', contactWhatsapp: '9848012345', brandPrimary: '#1F5F4A',
};
const PLACES = ['Chevella', 'Shankarpalli', 'Moinabad', 'Mokila', 'Aloor', 'Kandawada', 'Damergidda', 'Mudimyal', 'Ibrahimpally', 'Devunierravalli'];
const BOYS = ['Arjun', 'Rahul', 'Sai Teja', 'Charan', 'Vikram', 'Karthik', 'Harsha', 'Abhinav', 'Rohith', 'Nikhil', 'Varun', 'Akhil', 'Pranav', 'Siddharth', 'Manoj', 'Ravi Teja', 'Aditya',
  'Yashwanth', 'Sathvik', 'Rishi', 'Bhanu Prakash', 'Vamshi', 'Sandeep', 'Lokesh', 'Tarun', 'Dheeraj', 'Hemanth', 'Praneeth', 'Srikar', 'Jashwanth'];
const GIRLS = ['Sreeja', 'Ananya', 'Keerthi', 'Harika', 'Deepika', 'Sahithi', 'Varshini', 'Lasya', 'Meghana', 'Pooja', 'Sneha', 'Divya', 'Navya', 'Bhavya', 'Akshaya', 'Tejaswini',
  'Mounika', 'Sindhu', 'Ramya', 'Pranitha', 'Shravya', 'Hasini', 'Nithya', 'Vaishnavi', 'Charitha', 'Likitha', 'Manasa', 'Srinidhi', 'Akshitha', 'Jahnavi'];
const SURNAMES = ['Reddy', 'Rao', 'Goud', 'Yadav', 'Naik', 'Chary', 'Sharma', 'Kumar', 'Varma', 'Mudiraj', 'Netha', 'Patel'];
const OTHER_FAMILIES = [{ boy: 'Mohammed Imran', girl: 'Ayesha Begum', father: 'Mohammed Saleem', mother: 'Shabana Begum', surname: '' },
  { boy: 'Syed Faizan', girl: 'Sana Fatima', father: 'Syed Rafiq', mother: 'Nasreen', surname: '' }, { boy: 'John Paul', girl: 'Grace', father: 'David Raju', mother: 'Mary Suneetha', surname: 'Thomas' }];
const FATHERS = ['Srinivas', 'Ramesh', 'Suresh', 'Venkatesh', 'Mahesh', 'Raju', 'Krishna', 'Prakash', 'Narasimha', 'Anil', 'Ravi', 'Shankar', 'Gopal', 'Balraj', 'Mallesh', 'Chandra Shekar'];
const MOTHERS = ['Lakshmi', 'Padma', 'Sunitha', 'Swapna', 'Kavitha', 'Rajitha', 'Saritha', 'Anitha', 'Manjula', 'Jyothi', 'Vani', 'Radha', 'Sujatha', 'Rani', 'Shailaja', 'Madhavi'];

type Role = string;
interface StaffDef { key: string; name: string; gender: 'male' | 'female'; designation: string; department: string; roles: Role[]; qualification?: string; pay: 'teaching' | 'office' | 'support' | 'senior' }
const STAFF: StaffDef[] = [
  { key: 'principal', name: 'Dr. K. Padmavathi', gender: 'female', designation: 'Principal', department: 'Administration', roles: ['principal'], qualification: 'M.Sc., M.Ed., Ph.D.', pay: 'senior' },
  { key: 'vp', name: 'M. Srinivas Rao', gender: 'male', designation: 'Vice Principal', department: 'Administration', roles: ['vice_principal'], qualification: 'M.Sc., B.Ed.', pay: 'senior' },
  { key: 'admin', name: 'R. Anitha', gender: 'female', designation: 'Office Manager', department: 'Office', roles: ['institution_admin'], qualification: 'MBA', pay: 'office' },
  { key: 'accountant', name: 'P. Venkatesh', gender: 'male', designation: 'Accountant', department: 'Accounts', roles: ['accountant'], qualification: 'M.Com.', pay: 'office' },
  { key: 'reception', name: 'B. Swapna', gender: 'female', designation: 'Front Office', department: 'Office', roles: ['receptionist'], qualification: 'B.Com.', pay: 'office' },
  { key: 'hr', name: 'G. Raghavendra', gender: 'male', designation: 'HR Manager', department: 'Office', roles: ['hr_manager'], qualification: 'MBA (HR)', pay: 'office' },
  { key: 'librarian', name: 'T. Saritha', gender: 'female', designation: 'Librarian', department: 'Library', roles: ['librarian'], qualification: 'B.Lib.Sc.', pay: 'office' },
  { key: 'transport', name: 'Ch. Ramesh', gender: 'male', designation: 'Transport In-charge', department: 'Transport', roles: ['transport_manager'], pay: 'office' },
  { key: 'driver1', name: 'Md. Saleem', gender: 'male', designation: 'Driver', department: 'Transport', roles: ['driver'], pay: 'support' },
  { key: 'driver2', name: 'K. Yadagiri', gender: 'male', designation: 'Driver', department: 'Transport', roles: ['driver'], pay: 'support' },
  { key: 'driver3', name: 'B. Narsimlu', gender: 'male', designation: 'Driver', department: 'Transport', roles: ['driver'], pay: 'support' },
  { key: 'attendant', name: 'N. Lakshmamma', gender: 'female', designation: 'Attendant', department: 'Support', roles: ['non_teaching_staff'], pay: 'support' },
  // Pre-primary and primary class teachers
  { key: 't_nur', name: 'S. Kavya', gender: 'female', designation: 'Pre-primary Teacher', department: 'Pre-primary', roles: ['teacher', 'class_teacher'], qualification: 'B.A., D.El.Ed.', pay: 'teaching' },
  { key: 't_lkg', name: 'M. Renuka', gender: 'female', designation: 'Pre-primary Teacher', department: 'Pre-primary', roles: ['teacher', 'class_teacher'], qualification: 'B.A., D.El.Ed.', pay: 'teaching' },
  { key: 't_ukg', name: 'A. Shirisha', gender: 'female', designation: 'Pre-primary Teacher', department: 'Pre-primary', roles: ['teacher', 'class_teacher'], qualification: 'B.Sc., D.El.Ed.', pay: 'teaching' },
  { key: 't_c1', name: 'V. Sujatha', gender: 'female', designation: 'Primary Teacher', department: 'Primary', roles: ['teacher', 'class_teacher'], qualification: 'B.A., B.Ed.', pay: 'teaching' },
  { key: 't_c2', name: 'K. Rajeshwari', gender: 'female', designation: 'Primary Teacher', department: 'Primary', roles: ['teacher', 'class_teacher'], qualification: 'B.Sc., B.Ed.', pay: 'teaching' },
  { key: 't_c3', name: 'P. Mamatha', gender: 'female', designation: 'Primary Teacher', department: 'Primary', roles: ['teacher', 'class_teacher'], qualification: 'B.A., B.Ed.', pay: 'teaching' },
  { key: 't_c4', name: 'D. Uma Devi', gender: 'female', designation: 'Primary Teacher', department: 'Primary', roles: ['teacher', 'class_teacher'], qualification: 'B.Sc., B.Ed.', pay: 'teaching' },
  { key: 't_c5', name: 'G. Lavanya', gender: 'female', designation: 'Primary Teacher', department: 'Primary', roles: ['teacher', 'class_teacher'], qualification: 'B.Sc., B.Ed.', pay: 'teaching' },
  // High school subject teachers
  { key: 'tel1', name: 'B. Venkataramana', gender: 'male', designation: 'Telugu Teacher', department: 'Languages', roles: ['teacher', 'class_teacher'], qualification: 'M.A. (Telugu), B.Ed.', pay: 'teaching' },
  { key: 'tel2', name: 'J. Sravanthi', gender: 'female', designation: 'Telugu Teacher', department: 'Languages', roles: ['teacher', 'class_teacher'], qualification: 'M.A. (Telugu), B.Ed.', pay: 'teaching' },
  { key: 'hindi', name: 'S. Farhana', gender: 'female', designation: 'Hindi Teacher', department: 'Languages', roles: ['teacher'], qualification: 'M.A. (Hindi), Hindi Pandit', pay: 'teaching' },
  { key: 'eng1', name: 'R. Prasanna Kumar', gender: 'male', designation: 'English Teacher', department: 'Languages', roles: ['teacher', 'class_teacher'], qualification: 'M.A. (English), B.Ed.', pay: 'teaching' },
  { key: 'eng2', name: 'L. Hima Bindu', gender: 'female', designation: 'English Teacher', department: 'Languages', roles: ['teacher', 'class_teacher'], qualification: 'M.A. (English), B.Ed.', pay: 'teaching' },
  { key: 'math1', name: 'S. Madhavi', gender: 'female', designation: 'Mathematics Teacher & Exam Coordinator', department: 'Mathematics', roles: ['teacher', 'class_teacher', 'exam_coordinator'], qualification: 'M.Sc. (Maths), B.Ed.', pay: 'teaching' },
  { key: 'math2', name: 'K. Naveen Kumar', gender: 'male', designation: 'Mathematics Teacher', department: 'Mathematics', roles: ['teacher', 'class_teacher'], qualification: 'M.Sc. (Maths), B.Ed.', pay: 'teaching' },
  { key: 'phy', name: 'V. Raghu Ram', gender: 'male', designation: 'Physical Science Teacher', department: 'Science', roles: ['teacher', 'class_teacher'], qualification: 'M.Sc. (Physics), B.Ed.', pay: 'teaching' },
  { key: 'bio', name: 'N. Swathi', gender: 'female', designation: 'Biological Science Teacher', department: 'Science', roles: ['teacher', 'class_teacher'], qualification: 'M.Sc. (Botany), B.Ed.', pay: 'teaching' },
  { key: 'soc1', name: 'P. Ravinder', gender: 'male', designation: 'Social Studies Teacher', department: 'Social Studies', roles: ['teacher', 'class_teacher'], qualification: 'M.A. (History), B.Ed.', pay: 'teaching' },
  { key: 'soc2', name: 'D. Spandana', gender: 'female', designation: 'Social Studies Teacher', department: 'Social Studies', roles: ['teacher', 'class_teacher'], qualification: 'M.A. (Economics), B.Ed.', pay: 'teaching' },
];
const PRE = ['Nursery', 'LKG', 'UKG'], PRIMARY = ['Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5'], HIGH = ['Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10'];
const SUBJECTS_FOR: Record<string, string[]> = {
  pre: ['English', 'Telugu', 'Mathematics', 'Drawing'],
  primaryLow: ['Telugu', 'English', 'Mathematics', 'EVS'],
  primaryHigh: ['Telugu', 'Hindi', 'English', 'Mathematics', 'EVS'],
  high: ['Telugu', 'Hindi', 'English', 'Mathematics', 'Physical Science', 'Biological Science', 'Social Studies'],
};
const subjectsOf = (cls: string) => PRE.includes(cls) ? SUBJECTS_FOR.pre : ['Class 1', 'Class 2'].includes(cls) ? SUBJECTS_FOR.primaryLow : PRIMARY.includes(cls) ? SUBJECTS_FOR.primaryHigh : SUBJECTS_FOR.high;
const CLASS_TEACHER: Record<string, string> = {
  'Nursery A': 't_nur', 'LKG A': 't_lkg', 'UKG A': 't_ukg', 'Class 1 A': 't_c1', 'Class 2 A': 't_c2', 'Class 3 A': 't_c3', 'Class 4 A': 't_c4', 'Class 5 A': 't_c5',
  'Class 6 A': 'tel1', 'Class 7 A': 'eng1', 'Class 8 A': 'math1', 'Class 9 A': 'soc1', 'Class 10 A': 'phy',
  'Class 6 B': 'tel2', 'Class 7 B': 'eng2', 'Class 8 B': 'math2', 'Class 9 B': 'soc2', 'Class 10 B': 'bio',
};
/** Who teaches a subject in a section. */
function teacherFor(cls: string, sec: string, subject: string): string {
  const label = `${cls} ${sec}`;
  if (PRE.includes(cls)) return CLASS_TEACHER[label];
  if (PRIMARY.includes(cls)) return subject === 'Hindi' ? 'hindi' : subject === 'English' ? 'eng2' : CLASS_TEACHER[label];
  const a = sec === 'A';
  return ({ Telugu: a ? 'tel1' : 'tel2', Hindi: 'hindi', English: a ? 'eng1' : 'eng2', Mathematics: a ? 'math1' : 'math2', 'Physical Science': 'phy', 'Biological Science': 'bio', 'Social Studies': a ? 'soc1' : 'soc2' } as Record<string, string>)[subject];
}

// ---------------------------------------------------------------- main
export interface DemoTarget { base: string; devEmail: string; devPassword: string; writeSheetTo?: string }

/** The command line: migrate and seed the chosen (empty) database, start the app on a private port and fill it. */
async function cli() {
  const { config } = await import('../config');
  const { runMigrations } = await import('./migrate');
  const { createDatabase } = await import('./database.module');
  const { seed, seedOptionsFromEnv } = await import('./seed');
  const { createApp } = await import('../bootstrap');

  console.log(`\nDemo school → database "${config.db.database}" on ${config.db.host}:${config.db.port}\n`);
  await runMigrations(config.db);
  const db = createDatabase();
  const { students, staff } = await schoolSize(db);
  if (students > 0 || staff > 0) {
    console.error(`This database already has ${students} students and ${staff} staff.\nThe demo only fills an EMPTY database, so nothing was changed.\n` +
      'Create a new empty database (for example ems_demo) and run:  npm run demo -- --db ems_demo');
    await db.destroy(); process.exit(1);
  }
  await seed(db, { ...seedOptionsFromEnv(), institutionName: SCHOOL.name });
  const app = await createApp();
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  const r = await fillDemo(db, base);
  await app.close();
  await db.destroy();
  console.log(`\nDone. Every login uses the password  ${DEMO_PASSWORD}  (developer: see the sheet).`);
  if (r.sheet) console.log(`The full list of logins is in ${r.sheet}`);
  console.log(`Start the app with this database (DB_NAME=${config.db.database} in .env), then open http://localhost:${config.port}/app\n`);
  if (warnings.length) {
    console.log(`(${warnings.length} expected refusals skipped, e.g. a teacher already busy in a period.)`);
    if (process.env.DEMO_VERBOSE) { const g = new Map<string, number>(); for (const w of warnings) { const k = w.replace(/\/[0-9A-Z]{26}/g, '/:id').replace(/\/\d+/g, '/:n').slice(0, 220); g.set(k, (g.get(k) ?? 0) + 1); } for (const [k, n] of g) console.log(`  ${n} × ${k}`); }
  }
  process.exit(0);
}

export async function schoolSize(db: import('./database.module').Database) {
  const n = async (t: 'students' | 'staff') => Number((await db.selectFrom(t).select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst().catch(() => ({ n: 0 })))?.n ?? 0);
  return { students: await n('students'), staff: await n('staff') };
}

/** Fills a freshly seeded, empty database through the app running at `base`. Used by "npm run demo" and by DEMO_DATA=yes. */
export async function fillDemo(db: import('./database.module').Database, base: string, header?: Record<string, string>) {
  const { seedOptionsFromEnv } = await import('./seed');
  const { hashPassword } = await import('../auth/passwords');
  const { SchoolCalendar, schoolToday } = await import('../attendance/calendar');
  const { sql } = await import('kysely');
  fillHeader = header ?? {};
  const envSeed = seedOptionsFromEnv();
  // The developer login comes from .env. For a demo database, give it the demo password unless .env sets a real one.
  const devEmail = envSeed.superAdminEmail.toLowerCase();
  const demoHash = await hashPassword(DEMO_PASSWORD);
  const devPassword = ['ChangeMe@123', 'YourPass@123', 'a-strong-password'].includes(envSeed.superAdminPassword) ? DEMO_PASSWORD : envSeed.superAdminPassword;
  if (devPassword === DEMO_PASSWORD) await db.updateTable('users').set({ password_hash: demoHash, must_change_password: 0 }).where('email', '=', devEmail).execute();

  const anon = new Client(base);
  const login = async (identifier: string, password = DEMO_PASSWORD) => new Client(base, (await anon.post<{ accessToken: string }>('/auth/login', { identifier, password })).accessToken, { identifier, password });
  const dev = await login(devEmail, devPassword);
  const year = await db.selectFrom('academic_years').selectAll().where('is_current', '=', 1).executeTakeFirstOrThrow();
  const yStart = iso(year.start_date as Date), yEnd = iso(year.end_date as Date);
  const today = await schoolToday(db);

  // ---------------- school settings, modules
  say('School settings and modules');
  await dev.patch('/settings/institution', SCHOOL);
  await dev.req('POST', '/settings/logo', file('logo.png', 'image/png'));
  for (const m of ['attendance', 'fees', 'payments', 'exams', 'marks', 'cms', 'reports', 'hr', 'payroll', 'expenses', 'transport', 'inventory', 'homework', 'enquiries']) {
    await dev.put(`/developer/feature-flags/${m}`, { enabled: true });
  }

  // ---------------- classes, subjects
  say('Classes, sections and subjects');
  let classes = await dev.get<any[]>('/classes');
  for (const c of classes.filter((x) => HIGH.includes(x.name))) if (!c.sections.some((s: any) => s.name === 'B')) await dev.post(`/classes/${c.id}/sections`, { name: 'B' });
  classes = await dev.get<any[]>('/classes');
  const cls: Record<string, number> = {}, sec: Record<string, number> = {}, secClass: Record<number, string> = {};
  for (const c of classes) { cls[c.name] = c.id; for (const s of c.sections) { sec[`${c.name} ${s.name}`] = s.id; secClass[s.id] = c.name; } }
  const sections = Object.keys(sec).filter((k) => [...PRE, ...PRIMARY, ...HIGH].includes(k.replace(/ [AB]$/, '')))
    .sort((a, b) => [...PRE, ...PRIMARY, ...HIGH].indexOf(a.replace(/ [AB]$/, '')) - [...PRE, ...PRIMARY, ...HIGH].indexOf(b.replace(/ [AB]$/, '')) || a.localeCompare(b));
  const sub: Record<string, number> = {};
  for (const n of [...new Set(Object.values(SUBJECTS_FOR).flat())]) sub[n] = (await dev.post<{ id: number }>('/subjects', { name: n })).id;

  // ---------------- staff
  say(`Staff (${STAFF.length})`);
  const S: Record<string, { public_id: string; user_id: string; mobile: string; email: string; name: string; token?: Client }> = {};
  for (const [i, s] of STAFF.entries()) {
    const parts = s.name.replace(/^Dr\.\s*/, '').split(/\s+/);
    const words = parts.filter((p) => !/^[A-Za-z]{1,2}\.$/.test(p)), initial = parts.find((p) => /^[A-Za-z]{1,2}\.$/.test(p))?.replace('.', '');
    const handle = [...words, ...(words.length === 1 && initial ? [initial] : [])].join('.').replace(/[^A-Za-z.]/g, '').toLowerCase();
    const mobile = `98481${pad(i + 1, 5)}`;
    const email = `${handle}@example.com`;
    const r = await dev.post<any>('/staff', {
      name: s.name, email, mobile, employeeCode: `SVN-${pad(i + 1, 3)}`, designation: s.designation, department: s.department, qualification: s.qualification ?? null,
      joiningDate: `${between(2012, 2025)}-06-${pad(between(1, 12))}`, dob: `${between(1972, 1998)}-${pad(between(1, 12))}-${pad(between(1, 28))}`, gender: s.gender, roleKeys: s.roles,
    });
    S[s.key] = { public_id: r.public_id, user_id: r.user_id, mobile, email, name: s.name };
  }

  // ---------------- teaching grid
  say('Teaching grid and class teachers');
  const classSubjects = [...PRE, ...PRIMARY, ...HIGH].map((c) => ({ classId: cls[c], subjectIds: subjectsOf(c).map((n) => sub[n]) }));
  const classTeachers = sections.map((label) => ({ sectionId: sec[label], staffId: S[CLASS_TEACHER[label]].public_id }));
  const assignments = sections.flatMap((label) => {
    const [c, s] = [label.replace(/ [AB]$/, ''), label.slice(-1)];
    return subjectsOf(c).map((n) => ({ sectionId: sec[label], subjectId: sub[n], staffId: S[teacherFor(c, s, n)].public_id }));
  });
  await dev.put('/teaching/grid', { classSubjects, classTeachers, assignments });

  // ---------------- students and parents
  say('Students and parents');
  const students: Array<{ id: string; name: string; first: string; section: string; className: string; familyUser: string; familyId: string; mobile: string; place: string; ability: number; parentName: string }> = [];
  const parents: Array<{ mobile: string; name: string; children: string[]; userId: string; familyId: string; place: string }> = [];
  let pm = 1, avatar = 0;
  const usedNames = new Set<string>();
  const perSection = (label: string) => (PRE.some((p) => label.startsWith(p)) ? 6 : 8);
  // Younger siblings join an older child's family (picked as we go, from higher classes created first).
  const order = [...sections].reverse();
  const siblingPool: typeof parents = [];
  const dobFor = (c: string) => {
    const lvl = PRE.includes(c) ? PRE.indexOf(c) - 3 : Number(c.replace('Class ', ''));
    return `${2026 - 6 - lvl}-${pad(between(1, 12))}-${pad(between(1, 28))}`;
  };
  for (const label of order) {
    const c = label.replace(/ [AB]$/, '');
    const kids: Array<{ first: string; last: string | null; gender: 'male' | 'female'; fam?: (typeof parents)[number]; other?: (typeof OTHER_FAMILIES)[number] }> = [];
    for (let k = 0; k < perSection(label); k++) {
      const girl = rnd() < 0.5;
      const sibling = siblingPool.length > 0 && rnd() < 0.14 ? siblingPool.splice(Math.floor(rnd() * siblingPool.length), 1)[0] : undefined;
      const other = !sibling && rnd() < 0.05 ? OTHER_FAMILIES.find((o) => !usedNames.has(o.boy) && !usedNames.has(o.girl)) : undefined;
      let first: string, last: string | null;
      if (other) { first = girl ? other.girl : other.boy; last = other.surname || null; usedNames.add(other.boy); usedNames.add(other.girl); }
      else {
        do { first = pick(girl ? GIRLS : BOYS); last = sibling ? sibling.name.split(' ').pop()! : pick(SURNAMES); } while (usedNames.has(`${first} ${last}`));
        usedNames.add(`${first} ${last}`);
      }
      kids.push({ first, last, gender: girl ? 'female' : 'male', fam: sibling, other });
    }
    kids.sort((a, b) => `${a.first} ${a.last}`.localeCompare(`${b.first} ${b.last}`));
    for (const [k, kd] of kids.entries()) {
      const place = kd.fam?.place ?? pick(PLACES);
      let family: any;
      let father = '';
      if (kd.fam) family = { familyId: kd.fam.familyId };
      else {
        const surname = kd.other ? kd.other.surname : kd.last!;
        father = kd.other ? kd.other.father : `${pick(FATHERS)} ${surname}`;
        const mother = kd.other ? kd.other.mother : `${pick(MOTHERS)}`;
        const mobile = `90002${pad(pm++, 5)}`;
        family = { familyName: father, fatherName: father, motherName: mother, mobile,
          email: rnd() < 0.45 ? `${father.split(' ')[0].toLowerCase()}.${(surname || 'parent').toLowerCase()}${pm}@example.com` : null,
          address: `H.No ${between(1, 20)}-${between(1, 150)}, ${place}, Ranga Reddy District` };
      }
      const r = await dev.post<any>('/students', {
        firstName: kd.first, lastName: kd.last, gender: kd.gender, dob: dobFor(c), bloodGroup: pick(['O+', 'B+', 'A+', 'AB+', 'O-', 'B+', 'O+']),
        admissionDate: `${between(2018, 2026)}-06-${pad(between(1, 15))}`, classId: cls[c], sectionId: sec[label], rollNo: String(k + 1), family,
        address: kd.fam ? null : `${place}, Ranga Reddy District`,
      });
      const name = [kd.first, kd.last].filter(Boolean).join(' ');
      let p = kd.fam;
      if (!p) { p = { mobile: family.mobile, name: father, children: [], userId: r.family_user_id, familyId: r.family_id, place }; parents.push(p); if (!HIGH.includes(c) || rnd() < 0.5) siblingPool.push(p); }
      p.children.push(`${name} (${label})`);
      students.push({ id: r.public_id, name, first: kd.first, section: label, className: c, familyUser: p.userId, familyId: p.familyId, mobile: p.mobile, place, ability: 0.55 + rnd() * 0.42, parentName: p.name });
      // Most students have a photo; a few are left without (hall tickets then show a box to paste one).
      if (rnd() < 0.85) { avatar = (avatar % 24) + 1; await dev.req('POST', `/students/${r.public_id}/photo`, file(`student-${pad(avatar)}.jpg`)); }
    }
  }
  log(`${students.length} students, ${parents.length} parent logins (${students.length - parents.length} brothers/sisters share a login)`);

  // ---------------- logins: everybody gets the demo password
  say('Logins (all use the demo password)');
  for (const u of [...Object.values(S).map((s) => s.user_id), ...parents.map((p) => p.userId)]) await dev.post(`/users/${u}/credentials`);
  await db.updateTable('users').set({ password_hash: demoHash, must_change_password: 0 }).where('is_super_admin', '=', 0).execute();
  for (const k of Object.keys(S)) S[k].token = await login(S[k].mobile);
  const T = (k: string) => S[k].token!;
  const parentToken = new Map<string, Client>();
  const asParent = async (mobile: string) => { if (!parentToken.has(mobile)) parentToken.set(mobile, await login(mobile)); return parentToken.get(mobile)!; };

  // ---------------- calendar, timetable
  say('Holidays, timetable');
  for (const [name, s, e] of [['Independence Day', '2026-08-15', null], ['Gandhi Jayanti', '2026-10-02', null], ['Bathukamma and Dasara holidays', '2026-10-14', '2026-10-25'],
    ['Diwali', '2026-11-08', null], ['Christmas', '2026-12-25', null], ['Sankranti holidays', '2027-01-12', '2027-01-16'], ['Republic Day', '2027-01-26', null]] as Array<[string, string, string | null]>) {
    if (s >= yStart && s <= yEnd) await dev.soft('POST', '/attendance/holidays', { name, startDate: s, endDate: e });
  }
  await dev.put('/timetable/saturdays-off', { weeks: [2] });
  const gPre = (await dev.post<any>('/timetable/groups', { name: 'Pre-primary' })).id;
  const gMain = (await dev.post<any>('/timetable/groups', { name: 'Classes 1 to 10' })).id;
  await dev.put(`/timetable/groups/${gPre}/classes`, { classIds: PRE.map((c) => cls[c]) });
  await dev.put(`/timetable/groups/${gMain}/classes`, { classIds: [...PRIMARY, ...HIGH].map((c) => cls[c]) });
  await dev.put(`/timetable/groups/${gPre}/periods`, { periods: [
    { kind: 'period', label: 'P1', start: '09:00', end: '09:40' }, { kind: 'period', label: 'P2', start: '09:40', end: '10:20' }, { kind: 'break', label: 'Snack break', start: '10:20', end: '10:40' },
    { kind: 'period', label: 'P3', start: '10:40', end: '11:20' }, { kind: 'period', label: 'P4', start: '11:20', end: '12:00' }, { kind: 'period', label: 'P5', start: '12:00', end: '12:30' }] });
  await dev.put(`/timetable/groups/${gMain}/periods`, { periods: [
    { kind: 'period', label: 'P1', start: '09:00', end: '09:45' }, { kind: 'period', label: 'P2', start: '09:45', end: '10:30' }, { kind: 'period', label: 'P3', start: '10:30', end: '11:15' },
    { kind: 'break', label: 'Break', start: '11:15', end: '11:30' }, { kind: 'period', label: 'P4', start: '11:30', end: '12:15' }, { kind: 'period', label: 'P5', start: '12:15', end: '13:00' },
    { kind: 'break', label: 'Lunch', start: '13:00', end: '13:40' }, { kind: 'period', label: 'P6', start: '13:40', end: '14:25' }, { kind: 'period', label: 'P7', start: '14:25', end: '15:10' },
    { kind: 'period', label: 'P8', start: '15:10', end: '15:50' }] });
  const ttSetup = await dev.get<any>('/timetable/setup');
  const periodsOf = (gid: number) => (ttSetup.groups.find((g: any) => g.id === gid)?.periods ?? []).filter((p: any) => p.kind === 'period');
  let slots = 0;
  for (const [si, label] of sections.entries()) {
    const c = label.replace(/ [AB]$/, '');
    const subs = subjectsOf(c);
    const periods = periodsOf(PRE.includes(c) ? gPre : gMain);
    for (let day = 1; day <= 6; day++) {
      for (const [pi, p] of periods.entries()) {
        const n = subs[(pi + day * 2 + si) % subs.length];
        if (await dev.soft('PUT', `/timetable/sections/${sec[label]}/slots`, { day, periodId: p.id, subjectId: sub[n] })) slots++;
      }
    }
  }
  log(`${slots} periods filled (a few are left free where the teacher is already busy)`);

  const cal = await SchoolCalendar.load(db, year.id);
  const working: string[] = [];
  for (let d = addDays(today, -60); d <= today; d = addDays(d, 1)) if (d >= yStart && cal.isWorking(d)) working.push(d);

  // ---------------- fees
  say('Fee setup, bus routes, discounts and receipts');
  const acc = T('accountant');
  await acc.put('/fees/setup/default-plan', { planKey: 'quarterly' });
  await acc.put('/fees/setup/installments', { planKey: 'yearly', items: [{ installmentNo: 1, label: 'Annual', dueDate: '2026-06-15' }] });
  await acc.put('/fees/setup/installments', { planKey: 'half_yearly', items: [{ installmentNo: 1, label: 'Term 1', dueDate: '2026-06-15' }, { installmentNo: 2, label: 'Term 2', dueDate: '2026-11-15' }] });
  await acc.put('/fees/setup/installments', { planKey: 'quarterly', items: [{ installmentNo: 1, label: 'Q1', dueDate: '2026-06-15' }, { installmentNo: 2, label: 'Q2', dueDate: '2026-09-15' },
    { installmentNo: 3, label: 'Q3', dueDate: '2026-12-15' }, { installmentNo: 4, label: 'Q4', dueDate: '2027-02-15' }] });
  const FEE: Record<string, number> = { Nursery: 18000, LKG: 20000, UKG: 20000, 'Class 1': 24000, 'Class 2': 24000, 'Class 3': 26000, 'Class 4': 26000, 'Class 5': 28000,
    'Class 6': 32000, 'Class 7': 32000, 'Class 8': 34000, 'Class 9': 38000, 'Class 10': 42000 };
  await acc.put('/fees/setup/class-fees', { items: Object.entries(FEE).map(([c, amount]) => ({ classId: cls[c], amount })) });
  const ROUTES = [{ name: 'Route 1 - Chevella town', places: ['Chevella', 'Ibrahimpally', 'Devunierravalli'], fee: 12000 }, { name: 'Route 2 - Shankarpalli', places: ['Shankarpalli', 'Mokila', 'Kandawada'], fee: 14000 },
    { name: 'Route 3 - Moinabad', places: ['Moinabad', 'Aloor', 'Damergidda', 'Mudimyal'], fee: 15000 }];
  const routeId: number[] = [];
  for (const r of ROUTES) routeId.push((await acc.post<any>('/fees/routes', { name: r.name })).id);
  await acc.put('/fees/setup/route-fees', { items: ROUTES.map((r, i) => ({ routeId: routeId[i], amount: r.fee, dueDate: '2026-07-15' })) });
  for (const n of ['Sibling', 'Staff child', 'Merit scholarship']) await acc.post('/fees/concession-types', { name: n });
  const concessions = (await acc.get<any>('/fees/setup')).concessionTypes ?? [];
  const conc = (n: string) => concessions.find((c: any) => c.name === n)?.id ?? null;
  const examType = (await acc.post<any>('/fees/one-time-types', { name: 'Exam fee' })).id;
  for (const c of ['Class 9', 'Class 10']) await acc.post('/fees/one-time', { classId: cls[c], typeId: examType, title: 'SA1 exam fee', amount: 500, dueDate: '2026-11-05' });

  // Bus users: students living on a route's villages (about a third).
  const busStudents = students.filter((s) => ROUTES.some((r) => r.places.includes(s.place)) && rnd() < 0.55);
  const routeOf = (s: (typeof students)[number]) => ROUTES.findIndex((r) => r.places.includes(s.place));
  const famSeen = new Map<string, number>();
  for (const s of students) famSeen.set(s.familyId, (famSeen.get(s.familyId) ?? 0) + 1);
  const famFirst = new Set<string>();
  for (const s of students) {
    const patch: any = {};
    if (rnd() < 0.15) patch.planKey = pick(['yearly', 'half_yearly']);
    if (busStudents.includes(s)) patch.busRouteId = routeId[routeOf(s)];
    if (famSeen.get(s.familyId)! > 1) { if (famFirst.has(s.familyId)) { patch.tuitionDiscount = 3000; patch.tuitionConcessionTypeId = conc('Sibling'); } famFirst.add(s.familyId); }
    else if (rnd() < 0.04) { patch.tuitionDiscount = 5000; patch.tuitionConcessionTypeId = conc('Merit scholarship'); }
    if (Object.keys(patch).length) await acc.patch(`/students/${s.id}/fee-account`, patch);
  }
  // Payments, oldest first so receipt numbers follow the dates.
  type Plan = { s: (typeof students)[number]; date: string; lines: Array<{ category: string; amount: number }>; method: string };
  const plans: Plan[] = [];
  for (const s of students) {
    const f = await acc.get<any>(`/students/${s.id}/fees`);
    const items = (f.items ?? []).filter((i: any) => !i.previous_year && Number(i.balance) > 0);
    const kind = rnd();
    const tuition = items.filter((i: any) => i.category === 'tuition').sort((a: any, b: any) => String(a.due_date).localeCompare(String(b.due_date)));
    const bus = items.filter((i: any) => i.category === 'bus');
    const firstDue = tuition.filter((i: any) => String(i.due_date ?? '').slice(0, 10) <= '2026-06-30');
    const secondDue = tuition.filter((i: any) => { const d = String(i.due_date ?? '').slice(0, 10); return d > '2026-06-30' && d <= '2026-09-30'; });
    const sum = (a: any[]) => a.reduce((t, i) => t + Number(i.balance), 0);
    const method = () => pick(['cash', 'cash', 'upi', 'upi', 'cheque']);
    if (kind < 0.07) continue; // not paid anything yet
    if (firstDue.length) plans.push({ s, date: `2026-06-${pad(between(5, 30))}`, lines: [{ category: 'tuition', amount: kind < 0.15 ? Math.round(sum(firstDue) / 2 / 100) * 100 : sum(firstDue) }], method: method() });
    if (bus.length && kind > 0.12) plans.push({ s, date: `2026-07-${pad(between(1, 20))}`, lines: [{ category: 'bus', amount: kind < 0.3 ? Math.round(sum(bus) / 2 / 100) * 100 : sum(bus) }], method: method() });
    if (secondDue.length && kind > 0.32) plans.push({ s, date: addDays('2026-09-01', between(0, Math.max(0, Math.min(38, (Date.parse(today) - Date.parse('2026-09-01')) / 86_400_000 - 1)))), lines: [{ category: 'tuition', amount: sum(secondDue) }], method: method() });
  }
  plans.sort((a, b) => a.date.localeCompare(b.date));
  let receipts = 0;
  for (const p of plans) {
    if (p.date > today) continue;
    const ref = p.method === 'cash' ? {} : { referenceNo: p.method === 'upi' ? `UPI${between(100000000, 999999999)}` : `CHQ${between(100000, 999999)}` };
    const lines = p.lines.filter((l) => l.amount > 0).map((l) => ({ ...l, academicYearId: year.id }));
    if (!lines.length) continue;
    if (await acc.soft('POST', '/payments', { studentId: p.s.id, paymentDate: p.date, method: p.method, lines, ...ref })) receipts++;
  }
  log(`${receipts} fee receipts`);

  // ---------------- transport
  say('Buses, stops and the fuel log');
  const tm = T('transport');
  const VEH = [['TS 07 UB 4521', 'Tata Starbus 40', 40, 'driver1'], ['TS 07 UC 1180', 'Ashok Leyland 32', 32, 'driver2'], ['TS 08 EF 2207', 'Force Traveller 26', 26, 'driver3']] as const;
  for (const [regNo, name, seats, d] of VEH) await tm.post('/transport/vehicles', { regNo, name, seats, driverStaffId: S[d].public_id, helperName: pick(['Yadamma', 'Saroja', 'Pochamma']), helperMobile: `96603${pad(between(10000, 99999), 5)}` });
  const vehicles = await tm.get<any[]>('/transport/vehicles');
  const STOPS: string[][] = [['Chevella Bus Stand', 'Ibrahimpally X Roads', 'Devunierravalli'], ['Shankarpalli Station', 'Mokila Village', 'Kandawada Gate'], ['Moinabad Chowrasta', 'Aloor', 'Damergidda', 'Mudimyal']];
  for (const [i, rid] of routeId.entries()) {
    await tm.put(`/transport/routes/${rid}/vehicle`, { vehicleId: vehicles[i].id });
    const r = await tm.put<any>(`/transport/routes/${rid}/stops`, { stops: STOPS[i].map((n, k) => ({ name: n, pickupTime: `07:${pad(10 + k * 12)}`, dropTime: `16:${pad(50 - k * 12)}` })) });
    const stops = r.routes.find((x: any) => x.id === rid).stops;
    const items = busStudents.filter((s) => routeOf(s) === i).map((s) => ({ studentId: s.id, stopId: stops[Math.min(stops.length - 1, ROUTES[i].places.indexOf(s.place))]?.id ?? stops[0].id }));
    if (items.length) await tm.put(`/transport/routes/${rid}/students`, { items });
  }
  for (const v of vehicles) {
    let odo = between(42000, 88000);
    for (let d = addDays(today, -56); d <= today; d = addDays(d, 7)) {
      if (d < yStart) continue;
      const litres = between(32, 48); odo += between(330, 420);
      await tm.soft('POST', '/transport/logs', { vehicleId: v.id, kind: 'fuel', date: d, odometer: odo, litres, amount: Math.round(litres * 96.4), vendor: pick(['HP Petrol Bunk, Chevella', 'Indian Oil, Shankarpalli']), method: pick(['cash', 'upi']) });
    }
    await tm.soft('POST', '/transport/logs', { vehicleId: v.id, kind: 'service', date: addDays(today, -between(10, 30)), odometer: odo - 200, amount: between(4500, 9500), vendor: 'Sai Motors, Chevella', description: 'Oil change, brake check, tyre rotation', method: 'cash' });
  }

  // ---------------- attendance (students and staff)
  say(`Attendance for ${working.length} school days`);
  const bySection = new Map<string, typeof students>();
  for (const s of students) bySection.set(s.section, [...(bySection.get(s.section) ?? []), s]);
  const staffKeys = Object.keys(S);
  for (const d of working) {
    const isToday = d === today;
    for (const [i, label] of sections.entries()) {
      if (isToday && i % 3 === 2) continue; // some sections not marked yet today
      const entries = bySection.get(label)!.map((s) => { const x = rnd(); return { studentId: s.id, status: x < 0.035 ? 'absent' : x < 0.055 ? 'late' : x < 0.06 ? 'half_day' : 'present' }; });
      const who = isToday ? T(CLASS_TEACHER[label]) : dev;
      await who.soft('PUT', `/attendance/sections/${sec[label]}`, { date: d, entries });
    }
    if (!isToday) await dev.soft('PUT', '/staff-attendance', { date: d, entries: staffKeys.map((k) => ({ staffId: S[k].public_id, status: rnd() < 0.03 ? 'absent' : rnd() < 0.03 ? 'leave' : 'present' })) });
  }
  await dev.put('/attendance/location', { lat: 17.3067, lng: 78.1353, radiusM: 250 });

  // ---------------- leave requests
  say('Leave requests');
  const nextWorking = (from: string, n: number) => { const out: string[] = []; for (let d = addDays(from, 1); out.length < n && d <= yEnd; d = addDays(d, 1)) if (cal.isWorking(d)) out.push(d); return out; };
  const future = nextWorking(today, 12);
  const leaveKids = students.filter((s) => !HIGH.includes(s.className)).slice(0, 40).filter((_, i) => i % 9 === 0).slice(0, 4);
  const reasons = ['Going to grandparents’ village for a family function', 'Fever, doctor advised rest', 'Sister’s wedding', 'Temple visit with family'];
  for (const [i, s] of leaveKids.entries()) {
    const p = await asParent(s.mobile);
    const start = future[i * 2] ?? future[0];
    const r = await p.soft<any>('POST', `/students/${s.id}/leave-requests`, { startDate: start, endDate: future[i * 2 + 1] ?? start, reason: reasons[i % reasons.length] });
    if (r && i % 2 === 1) await T(CLASS_TEACHER[s.section]).soft('POST', `/leave-requests/${r.id}/decide`, { approve: true, note: 'Approved. Please complete the class work.' });
  }
  const types = await dev.get<any[]>('/hr/leave-types').catch(() => []);
  const cl = (types as any[]).find((t: any) => /casual/i.test(t.name))?.id ?? null;
  const sl = await T('tel2').soft<any>('POST', '/leave-requests/mine', { startDate: future[3], endDate: future[4], reason: 'Brother’s wedding in Warangal', leaveTypeId: cl });
  const sl2 = await T('phy').soft<any>('POST', '/leave-requests/mine', { startDate: future[7], endDate: future[7], reason: 'Bank work', leaveTypeId: cl });
  if (sl2) await T('hr').soft('POST', `/leave-requests/${sl2.id}/decide`, { approve: true, note: 'OK. Arrange a substitute for Class 10 A.' });
  void sl;

  // ---------------- exams
  say('Exam timetables, marks and results');
  const setup = await dev.get<any>('/exams/setup');
  const exam: Record<string, any> = {}; for (const e of setup.exams) exam[e.code] = e;
  const scheduleDays = (start: string, n: number) => { const out: string[] = []; for (let d = start; out.length < n; d = addDays(d, 1)) if (cal.isWorking(d) || d > today) { if (new Date(`${d}T00:00:00Z`).getUTCDay() !== 0) out.push(d); } return out; };
  for (const [code, start, times] of [['FA1', '2026-07-20', ['10:00', '11:00']], ['FA2', '2026-09-14', ['10:00', '11:00']], ['SA1', '2026-11-16', ['09:30', '12:15']]] as const) {
    for (const c of [...PRIMARY, ...HIGH]) {
      if (!exam[code]?.classIds?.includes(cls[c])) continue;
      const subs = subjectsOf(c);
      const days = scheduleDays(start, subs.length);
      await dev.put(`/exams/${exam[code].id}/schedule`, { classId: cls[c], rows: subs.map((n, i) => ({ subjectId: sub[n], date: days[i], start: times[0], end: times[1] })) });
    }
  }
  const principal = T('principal');
  const marksFor = (s: (typeof students)[number], max: number) => {
    if (rnd() < 0.015) return null;
    const v = max * Math.max(0.15, Math.min(1, s.ability + (rnd() - 0.5) * 0.3));
    return Math.round(v * 2) / 2;
  };
  let sheets = 0;
  for (const code of ['FA1', 'FA2']) {
    const e = exam[code];
    if (!e) continue;
    for (const label of sections) {
      const c = label.replace(/ [AB]$/, '');
      if (PRE.includes(c) || !e.classIds.includes(cls[c])) continue;
      const kids = bySection.get(label)!;
      for (const n of subjectsOf(c)) {
        const teacher = T(teacherFor(c, label.slice(-1), n));
        // Leave a little of FA2 still in progress, so approvals and reminders have something to show.
        const inProgress = code === 'FA2' && label === 'Class 10 B' && (n === 'Social Studies' || n === 'Hindi');
        const entries = kids.map((s) => { const m = marksFor(s, Number(e.maxMarks)); return { studentId: s.id, marks: m, absent: m === null }; });
        if (!(await teacher.soft('PUT', '/marks/sheet', { examId: e.id, sectionId: sec[label], subjectId: sub[n], submit: !(inProgress && n === 'Hindi'), entries }))) continue;
        sheets++;
        if (!inProgress) await principal.soft('POST', '/marks/sheet/decide', { examId: e.id, sectionId: sec[label], subjectId: sub[n], approve: true });
      }
      if (!(code === 'FA2' && label === 'Class 10 B')) await principal.soft('POST', `/exams/${e.id}/publish`, { sectionId: sec[label] });
    }
  }
  log(`${sheets} mark sheets`);
  // Pre-primary: term 1 skill ratings by the class teachers.
  for (const label of sections.filter((l) => PRE.includes(l.replace(/ [AB]$/, '')))) {
    const t = T(CLASS_TEACHER[label]);
    const ct = await t.soft<any>('GET', `/marks/class-teacher?sectionId=${sec[label]}&term=1`);
    if (!ct?.skills?.length) continue;
    await t.soft('PUT', '/marks/class-teacher', { sectionId: sec[label], term: 1, rows: bySection.get(label)!.map((s) => ({ studentId: s.id, ratings: Object.fromEntries(ct.skills.map((k: any) => [k.id, s.ability > 0.8 ? 'excellent' : s.ability > 0.62 ? 'good' : pick(['good', 'needs_practice'])])) })) });
  }
  // A mark correction waiting for the principal.
  const fixKid = bySection.get('Class 8 A')?.[2];
  if (fixKid && exam.FA1) await T('math1').soft('POST', '/marks/corrections', { examId: exam.FA1.id, studentId: fixKid.id, subjectId: sub.Mathematics, marks: 17, reason: 'Totalling mistake on the answer paper; re-checked with the student.' });

  // ---------------- homework and diary
  say('Homework and class diary');
  const HW: Record<string, string[]> = {
    Telugu: ['Write the poem “Amma” in your notebook', 'Learn 10 new words from lesson 4', 'Read lesson 5 aloud at home'],
    Hindi: ['Write 10 sentences about “Mera Vidyalaya”', 'Learn the Hindi numbers 1 to 20'], English: ['Read chapter 3 and answer questions 1–5', 'Write a paragraph on “My favourite festival”', 'Learn the spellings on page 21'],
    Mathematics: ['Exercise 4.2, sums 1 to 10', 'Practise tables 12 to 15', 'Worksheet on fractions (given in class)'], EVS: ['Draw and label the parts of a plant', 'List five sources of water near your home'],
    'Physical Science': ['Answer the questions at the end of “Light”', 'Draw a neat diagram of an electric circuit'], 'Biological Science': ['Draw and label the human heart', 'Revise “Nutrition in plants”'],
    'Social Studies': ['Mark the rivers of Telangana on the outline map', 'Read “Our Constitution” and note five key points'], Drawing: ['Colour the mango picture in the drawing book'], };
  const DIARY = ['Bring a white handkerchief and water bottle every day.', 'Parent–teacher meeting on Saturday at 10 am.', 'Wear house colours on Friday for the sports practice.', 'Library books to be returned this week.'];
  const hwDays = working.slice(-6);
  let hw = 0;
  for (const [i, label] of sections.entries()) {
    const c = label.replace(/ [AB]$/, '');
    const subs = subjectsOf(c);
    for (const [k, d] of hwDays.entries()) {
      const n = subs[(i + k) % subs.length];
      const t = T(teacherFor(c, label.slice(-1), n));
      const fd = new FormData();
      const due = nextWorking(d, 1)[0] ?? d;
      for (const [key, v] of Object.entries({ sectionId: String(sec[label]), subjectId: String(sub[n]), type: 'homework', title: pick(HW[n] ?? ['Revise today’s lesson']), forDate: d, dueDate: due })) fd.append(key, v);
      if (label === 'Class 5 A' && k === hwDays.length - 1 && n === 'Mathematics') fd.append('file', new Blob([readFileSync(join(ASSETS, 'board.jpg'))], { type: 'image/jpeg' }), 'board.jpg');
      if (await t.soft('POST', '/homework', fd)) hw++;
      if (k % 3 === 2) {
        const f2 = new FormData();
        for (const [key, v] of Object.entries({ sectionId: String(sec[label]), type: 'diary', title: DIARY[(i + k) % DIARY.length], forDate: d })) f2.append(key, v);
        if (await T(CLASS_TEACHER[label]).soft('POST', '/homework', f2)) hw++;
      }
    }
  }
  // One homework with a photo of the board, so the attachment can be seen.
  {
    const fd = new FormData();
    for (const [key, v] of Object.entries({ sectionId: String(sec['Class 5 A']), subjectId: String(sub.Mathematics), type: 'homework', title: 'Exercise 4.2, sums 1 to 10 (see the photo of the board)', forDate: today, dueDate: nextWorking(today, 1)[0] ?? today })) fd.append(key, v);
    fd.append('file', new Blob([readFileSync(join(ASSETS, 'board.jpg'))], { type: 'image/jpeg' }), 'board.jpg');
    if (await T('t_c5').soft('POST', '/homework', fd)) hw++;
  }
  log(`${hw} homework and diary entries`);

  // ---------------- notices
  say('Notices');
  await principal.post('/announcements', { title: 'Bathukamma and Dasara holidays', body: 'School will remain closed for Bathukamma and Dasara holidays. Classes resume on the next working day after the holidays. Happy festivals to all families!', audience: { type: 'all' }, publish: true, isPublic: true });
  await principal.post('/announcements', { title: 'SA1 exams from 16 November', body: 'Summative Assessment 1 for Classes 1 to 10 begins on 16 November. Hall tickets are available in the app (child’s page → Marks). Please ensure regular attendance and revision at home.', audience: { type: 'classes', ids: [...PRIMARY, ...HIGH].map((c) => cls[c]) }, publish: true, isPublic: true });
  await principal.post('/announcements', { title: 'Parent–teacher meeting this Saturday', body: 'Parents are requested to meet the class teachers between 10 am and 12 noon to discuss progress in FA1 and FA2.', audience: { type: 'all' }, publish: true });
  await principal.post('/announcements', { title: 'Staff meeting on Monday at 3:45 pm', body: 'All teaching staff: please bring the FA2 mark registers and the SA1 question paper plans.', audience: { type: 'staff' }, publish: true });
  await T('t_c5').soft('POST', '/announcements', { title: 'Class 5 A picnic to Ananthagiri Hills', body: 'A day picnic is planned for next month. Consent forms will be sent home this week.', audience: { type: 'sections', ids: [sec['Class 5 A']] }, publish: true });

  // ---------------- website
  say('Website content');
  const up = async (name: string) => (await dev.req<any>('POST', '/cms/uploads', file(name))).id;
  const img: Record<string, string> = {};
  for (const n of ['campus', 'classroom', 'sports', 'science', 'library', 'annual', 'principal']) img[n] = await up(`${n}.jpg`);
  const home = async (key: string, content: unknown) => dev.soft('PATCH', `/cms/home/${key}`, { content });
  await home('banner', { autoplaySeconds: 6, slides: [
    { imageId: img.campus, heading: 'Admissions open for 2027-28', text: 'Nursery to Class 10, English medium, State syllabus', buttonLabel: 'Enquire now', buttonLink: '/contact' },
    { imageId: img.sports, heading: 'Learning beyond the classroom', text: 'Sports, arts and clubs for every child', buttonLabel: '', buttonLink: '' },
    { imageId: img.annual, heading: 'Annual Day 2026', text: 'Our students on stage', buttonLabel: 'See events', buttonLink: '/events' }] });
  await home('welcome', { heading: 'Welcome to Sri Vidya Niketan', text: 'For over fifteen years we have helped children from Chevella and the surrounding villages learn with confidence. Small classes, caring teachers and regular contact with parents are at the heart of our school.', imageId: img.classroom, linkLabel: 'About us', link: '/about' });
  await home('principal', { heading: 'From the Principal', name: 'Dr. K. Padmavathi', designation: 'Principal', photoId: img.principal, message: 'Every child can learn well when school and home work together. We keep parents informed every day through our app, so no one is left behind.', fullMessage: 'Dear parents,\n\nEvery child can learn well when school and home work together. Our teachers track attendance, homework and progress every day, and you can see all of it in the school app.\n\nWarm regards,\nDr. K. Padmavathi' });
  await home('highlights', { items: [{ value: '15+', label: 'Years of teaching' }, { value: '900+', label: 'Students taught' }, { value: '30', label: 'Teachers and staff' }, { value: '3', label: 'School buses' }] });
  await home('facilities', { heading: 'Our facilities', items: [{ title: 'Library', text: 'Over 3,000 books in English, Telugu and Hindi, with a reading period every week.', imageId: img.library },
    { title: 'Science lab', text: 'Hands-on experiments from Class 6, and a science fair every year.', imageId: img.science }, { title: 'Sports ground', text: 'Athletics, kabaddi, kho-kho and cricket coaching.', imageId: img.sports },
    { title: 'Safe transport', text: 'Three buses with trained drivers and helpers covering 10 villages.', imageId: img.campus }] });
  await home('testimonials', { heading: 'What parents say', items: [{ name: 'Ramesh Goud', relation: 'Father of Sahithi, Class 7', text: 'The teachers know every child by name. I see homework and attendance on my phone every day.' },
    { name: 'Swathi Reddy', relation: 'Mother of Arjun, Class 3', text: 'My son loves going to school. The PTMs are very useful.' }, { name: 'Mohammed Saleem', relation: 'Father of Imran, Class 9', text: 'Good discipline and good results, and the school bus is always on time.' }] });
  await home('admissions', { heading: 'Admissions 2027-28', text: 'Admissions for Nursery to Class 9 are open. Visit the school office between 9 am and 4 pm, or send us a message.', buttonLabel: 'Contact us', buttonLink: '/contact' });
  const ev1 = await dev.post<any>('/cms/events', { title: 'Science Fair 2026', eventDate: '2026-08-22', location: 'School hall', description: 'Students of Classes 6 to 10 presented 40 working models, from solar cookers to water filters.', coverId: img.science });
  await dev.post('/cms/events', { title: 'Annual Sports Day', eventDate: '2026-12-12', location: 'School ground', description: 'Races, relays, kabaddi and kho-kho. Parents are welcome.', coverId: img.sports });
  await dev.post('/cms/events', { title: 'Annual Day Celebrations', eventDate: '2027-01-23', location: 'School auditorium', description: 'Dance, drama and music by our students, with prizes for the year’s achievers.', coverId: img.annual });
  const album = await dev.post<any>('/cms/albums', { title: 'Science Fair 2026', eventSlug: ev1.slug, coverId: img.science });
  for (const n of ['science', 'classroom', 'library']) await dev.req('POST', `/cms/albums/${album.id}/photos`, file(`${n}.jpg`));
  const album2 = await dev.post<any>('/cms/albums', { title: 'Around the campus', coverId: img.campus });
  for (const n of ['campus', 'sports', 'annual']) await dev.req('POST', `/cms/albums/${album2.id}/photos`, file(`${n}.jpg`));
  await dev.put('/cms/settings', { contact: { mapEmbedUrl: '', officeHours: 'Monday to Saturday, 8:30 am to 4:30 pm (second Saturday holiday)' }, social: { facebook: '', instagram: '', youtube: '', x: '' } });

  // ---------------- admission enquiries (as if sent from the website)
  say('Admission enquiries');
  const ENQ: Array<[string, string, string, string, number, string | null]> = [
    ['Ramesh Goud', '9849012345', 'Namaste. Is admission open for Class 1 for 2027-28? What are the fees and is there a school bus from Moinabad?', 'new', 0, null],
    ['Swathi Reddy', '9000011122', 'Please call back about admission for my daughter in Class 6.', 'new', 1, null],
    ['Anil Kumar', '9963300441', 'We are moving to Chevella in December. Can my son join Class 4 in the middle of the year?', 'contacted', 3, 'Called back. Mid-year admission possible with transfer certificate. Father will confirm after visiting.'],
    ['Farzana Begum', '9704455661', 'Do you have a Hindi teacher for Class 8? Looking for admission for twins.', 'visit', 6, 'Visit booked for Saturday 11 am with both children.'],
    ['Prakash Naik', '9391122334', 'Admission for LKG please. What documents are needed?', 'admitted', 20, 'Joined LKG. Documents verified, fees paid at the counter.'],
    ['Sravani', '9876501234', 'What is the timing for UKG?', 'closed', 25, 'Chose a school nearer home.'],
  ];
  for (const [name, mobile, message, status, ago, note] of ENQ) {
    const at = new Date(Date.parse(`${addDays(today, -ago)}T10:30:00+05:30`));
    const r = await db.insertInto('contact_messages').values({ name, mobile, message, status: status as any, seen_at: status === 'new' ? null : at, created_at: at, updated_at: status === 'new' ? null : at }).executeTakeFirstOrThrow();
    if (note) {
      const adminUser = await db.selectFrom('users').select('id').where('mobile', '=', S.admin.mobile).executeTakeFirstOrThrow();
      await db.insertInto('enquiry_notes').values({ message_id: Number(r.insertId), note, status_to: status as any, created_by: adminUser.id, created_at: new Date(at.getTime() + 3_600_000) }).execute();
    }
  }

  // ---------------- HR, payroll and expenses
  say('HR records, payroll and expenses');
  const hr = T('hr');
  for (const [i, k] of Object.keys(S).entries()) {
    await hr.soft('PUT', `/hr/staff/${S[k].public_id}`, { employmentType: STAFF[i].pay === 'support' ? 'contract' : 'permanent', bankName: pick(['State Bank of India', 'Union Bank of India', 'Telangana Grameena Bank']),
      bankAccountNo: String(between(10000000000, 99999999999)), bankIfsc: pick(['SBIN0012345', 'UBIN0567890', 'SBIN0004321']), panNo: `${'ABCDE'.split('').map(() => String.fromCharCode(65 + between(0, 25))).join('')}${between(1000, 9999)}${String.fromCharCode(65 + between(0, 25))}` });
  }
  const comps = async (b: object) => dev.soft<any[]>('POST', '/payroll/components', b);
  await comps({ code: 'DA', name: 'Dearness allowance', kind: 'earning', calc: 'pct_basic', defaultValue: 10, prorate: true, sortOrder: 1 });
  await comps({ code: 'HRA', name: 'House rent allowance', kind: 'earning', calc: 'fixed', defaultValue: 0, prorate: true, sortOrder: 2 });
  await comps({ code: 'PF', name: 'Provident fund', kind: 'deduction', calc: 'pct_basic', defaultValue: 12, maxAmount: 1800, prorate: false, sortOrder: 3 });
  await comps({ code: 'PT', name: 'Professional tax', kind: 'deduction', calc: 'fixed', defaultValue: 200, prorate: false, sortOrder: 4 });
  const all = (await comps({ code: 'EPF', name: 'Employer PF', kind: 'employer', calc: 'pct_basic', defaultValue: 12, maxAmount: 1800, prorate: false, sortOrder: 5 })) ?? await dev.get<any[]>('/payroll/components');
  const C: Record<string, number> = {}; for (const c of all) C[c.code] = c.id;
  const tpl = async (name: string, basic: number, hra: number, pf: boolean) => (await dev.post<any[]>('/payroll/templates', { name, lines: [{ componentId: C.BASIC, value: basic }, { componentId: C.DA, value: 10 }, { componentId: C.HRA, value: hra },
    ...(pf ? [{ componentId: C.PF, value: 12 }, { componentId: C.EPF, value: 12 }] : []), { componentId: C.PT, value: 200 }] })).find((t: any) => t.name === name).id;
  const TPL = { senior: await tpl('Senior staff', 45000, 9000, true), teaching: await tpl('Teaching staff', 24000, 5000, true), office: await tpl('Office staff', 18000, 3500, true), support: await tpl('Support staff', 12000, 1500, false) };
  for (const k of Object.keys(TPL) as Array<keyof typeof TPL>) {
    const ids = STAFF.filter((s) => s.pay === k).map((s) => S[s.key].public_id);
    await T('accountant').post(`/payroll/templates/${TPL[k]}/apply`, { staffIds: ids, effectiveFrom: yStart });
  }
  const monthOf = (d: string) => d.slice(0, 7);
  const prev = (m: string, n: number) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 - n, 1)); return iso(d).slice(0, 7); };
  for (const m of [prev(monthOf(today), 2), prev(monthOf(today), 1)]) {
    if (`${m}-01` < yStart) continue;
    if (!(await T('accountant').soft('POST', '/payroll/runs', { month: m }))) continue;
    await T('accountant').soft('POST', `/payroll/runs/${m}/fill-lop`);
    await dev.soft('POST', `/payroll/runs/${m}/finalise`);
    await T('accountant').soft('POST', `/payroll/runs/${m}/paid`, { paidOn: `${prev(m, -1)}-0${between(1, 5)}` <= today ? `${prev(m, -1)}-0${between(1, 5)}` : today, method: 'bank_transfer', reference: `NEFT-${m.replace('-', '')}` });
  }
  const cats = await T('accountant').get<any[]>('/expenses/categories');
  const cat = (re: RegExp) => (cats.find((c: any) => re.test(c.name)) ?? cats[0]).id;
  const EXP: Array<[number, RegExp, number, string, string, string]> = [
    [40, /electric/i, 4380, 'TSSPDCL', 'upi', 'Electricity bill August'], [38, /water/i, 1500, 'Gram Panchayat', 'cash', 'Water supply'], [33, /internet|phone|tele/i, 1799, 'ACT Fibernet', 'upi', 'Internet for office and lab'],
    [26, /station/i, 2650, 'Sri Sai Stationers', 'cash', 'Chalk, registers, printer paper'], [19, /repair|mainten/i, 3200, 'Raju Electricals', 'cash', 'Fans repaired in Classes 6–8'],
    [12, /electric/i, 4655, 'TSSPDCL', 'upi', 'Electricity bill September'], [8, /event|function|sport/i, 7500, 'Krishna Sports', 'upi', 'Prizes and medals for sports day'],
    [3, /repair|mainten/i, 18500, 'Lakshmi Constructions', 'cheque', 'Toilet block repairs and painting'], [2, /station/i, 1240, 'Sri Sai Stationers', 'cash', 'Exam answer sheets'],
  ];
  const created: any[] = [];
  for (const [ago, re, amount, paidTo, method, description] of EXP) {
    const d = addDays(today, -ago);
    if (d < yStart) continue;
    const r = await T('accountant').soft<any>('POST', '/expenses', { date: d, categoryId: cat(re), amount, paidTo, method, description, ...(method !== 'cash' ? { reference: `${method.toUpperCase()}-${between(10000, 99999)}` } : {}) });
    if (r) created.push({ ...r, amount });
  }
  const big = created.find((e) => e.amount === 7500);
  if (big?.publicId) await principal.soft('POST', `/expenses/${big.publicId}/decide`, { approve: true, note: 'Approved for sports day.' });

  // ---------------- stock and sales counter
  say('Stock and the sales counter');
  const items: Record<string, number> = {};
  const item = async (name: string, category: string, unit: string, salePrice: number | null, openingQty: number, lowStockAt?: number) =>
    (items[name] = (await acc.post<any>('/inventory/items', { name, category, unit, salePrice, trackStock: true, openingQty, lowStockAt: lowStockAt ?? null })).id);
  for (const c of PRIMARY) {
    const n = c.replace('Class ', '');
    await item(`Telugu Reader ${n}`, 'Books', 'pcs', 140 + Number(n) * 10, 20, 3);
    await item(`English Reader ${n}`, 'Books', 'pcs', 180 + Number(n) * 15, 20, 3);
    await item(`Mathematics ${n}`, 'Books', 'pcs', 200 + Number(n) * 15, 20, 3);
  }
  await item('Notebook 200 pages', 'Notebooks', 'pcs', 45, 600, 50);
  await item('Notebook 100 pages', 'Notebooks', 'pcs', 28, 400, 50);
  await item('School tie', 'Uniform', 'pcs', 120, 80, 10);
  await item('School belt', 'Uniform', 'pcs', 150, 60, 10);
  await item('ID card with tag', 'Uniform', 'pcs', 80, 150, 20);
  await item('Chalk box', 'Stationery', 'box', null, 12, 5);
  const stationery = cat(/station/i);
  await acc.soft('POST', '/inventory/movements', { itemId: items['Chalk box'], kind: 'purchase', qty: 20, date: addDays(today, -20), amount: 1200, party: 'Sri Sai Stationers', expense: { categoryId: stationery, method: 'cash' } });
  await acc.soft('POST', '/inventory/movements', { itemId: items['Chalk box'], kind: 'issue', qty: 26, date: addDays(today, -5), party: 'Staff room' });
  const setIds: Record<string, number> = {};
  for (const c of PRIMARY) {
    const n = c.replace('Class ', '');
    const r = await acc.post<any[]>('/inventory/sets', { name: `${c} book set`, classId: cls[c], price: 140 + Number(n) * 10 + 180 + Number(n) * 15 + 200 + Number(n) * 15 + 6 * 45 - 50,
      lines: [{ itemId: items[`Telugu Reader ${n}`], qty: 1 }, { itemId: items[`English Reader ${n}`], qty: 1 }, { itemId: items[`Mathematics ${n}`], qty: 1 }, { itemId: items['Notebook 200 pages'], qty: 6 }] });
    setIds[c] = r.find((s: any) => s.name === `${c} book set`).id;
  }
  let sales = 0;
  for (const s of students.filter((x) => PRIMARY.includes(x.className)).filter((_, i) => i % 3 !== 1)) {
    const d = `2026-06-${pad(between(2, 20))}`;
    if (await T('reception').soft('POST', '/sales', { date: d <= today ? d : today, method: pick(['cash', 'upi']), ...(rnd() < 0.5 ? {} : {}), studentId: s.id,
      lines: [{ setId: setIds[s.className], qty: 1 }, ...(rnd() < 0.5 ? [{ itemId: items['School tie'], qty: 1 }, { itemId: items['ID card with tag'], qty: 1 }] : [])] })) sales++;
  }
  log(`${sales} sales receipts`);

  // ---------------- parents who use the app
  const usingApp = parents.filter(() => rnd() < 0.75).map((p) => p.userId);
  await db.updateTable('users').set({ last_login_at: sql`NOW(3) - INTERVAL FLOOR(RAND() * 72) HOUR` as any }).where('public_id', 'in', usingApp.length ? usingApp : ['-']).execute();
  await db.updateTable('users').set({ last_login_at: new Date() }).where('is_super_admin', '=', 0).where('id', 'in', db.selectFrom('staff').select('user_id').where('user_id', 'is not', null) as any).execute();

  // ---------------- the logins sheet
  let sheet: string | null = null;
  try { sheet = writeLogins(devEmail, devPassword === DEMO_PASSWORD ? DEMO_PASSWORD : '(your password from .env)', STAFF.map((s) => ({ ...s, ...S[s.key] })), parents, students); }
  catch { /* read-only folder: the copy in docs/ has the same logins */ }
  fillHeader = {};
  return { sheet, students: students.length, staff: STAFF.length, parents: parents.length };
}

function writeLogins(devEmail: string, devPw: string, staff: Array<StaffDef & { mobile: string; email: string }>, parents: Array<{ mobile: string; name: string; children: string[] }>, students: Array<{ section: string }>) {
  const ROLE: Record<string, string> = { principal: 'Principal', vice_principal: 'Vice Principal', institution_admin: 'Institution Admin', accountant: 'Accountant', receptionist: 'Receptionist', hr_manager: 'HR Manager',
    librarian: 'Librarian', transport_manager: 'Transport Manager', driver: 'Driver', non_teaching_staff: 'Non-teaching staff', teacher: 'Teacher', class_teacher: 'Class teacher', exam_coordinator: 'Exam coordinator' };
  const ct = Object.fromEntries(Object.entries(CLASS_TEACHER).map(([sec, k]) => [k, sec]));
  const lines = [
    `# Demo school logins: ${SCHOOL.name}`, '',
    `Every login below uses the password **${DEMO_PASSWORD}**. Sign in with the mobile number (or the email for staff).`, '',
    'This is demo data only. Use it on a separate demo database, never for the real school.', '',
    '## Developer', '', '| Login | Password |', '| --- | --- |', `| ${devEmail} | ${devPw} |`, '',
    '## Staff', '', '| Name | What they do | Roles | Mobile (login) | Email |', '| --- | --- | --- | --- | --- |',
    ...staff.map((s) => `| ${s.name} | ${s.designation}${ct[s.key] ? ` · class teacher of ${ct[s.key]}` : ''} | ${s.roles.map((r) => ROLE[r] ?? r).join(', ')} | ${s.mobile} | ${s.email} |`), '',
    '## Good logins to try first', '',
    `- **Principal** ${staff.find((s) => s.key === 'principal')!.mobile}: dashboard, approve marks, publish results, notices.`,
    `- **Institution Admin** ${staff.find((s) => s.key === 'admin')!.mobile}: everything in the office, enquiries.`,
    `- **Accountant** ${staff.find((s) => s.key === 'accountant')!.mobile}: collect fees, dues, receipts, payroll, expenses.`,
    `- **Class teacher (Class 5 A)** ${staff.find((s) => s.key === 't_c5')!.mobile}: attendance, homework, class photos, hall tickets.`,
    `- **Subject teacher (Maths 8 A, exam coordinator)** ${staff.find((s) => s.key === 'math1')!.mobile}: marks entry, a correction waiting for approval.`,
    `- **Driver** ${staff.find((s) => s.key === 'driver1')!.mobile}: their bus route with students and stops.`,
    `- **A parent with two children** ${parents.find((p) => p.children.length > 1)?.mobile ?? parents[0].mobile}: switch between children, fees, homework, hall ticket.`, '',
    `## Parents (${parents.length} logins for ${students.length} students)`, '', '| Parent | Mobile (login) | Children |', '| --- | --- | --- |',
    ...parents.map((p) => `| ${p.name} | ${p.mobile} | ${p.children.join('; ')} |`), '',
  ];
  const path = join(ROOT, 'DEMO-LOGINS.md');
  writeFileSync(path, lines.join('\n'));
  return path;
}

if (isCli) cli().catch((e) => { console.error('\nThe demo stopped:', e?.message ?? e); process.exit(1); });

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { createApp } from '../src/bootstrap';
import { createDatabase, type Database } from '../src/database/database.module';
import { seed } from '../src/database/seed';
import { COLUMNS } from '../src/imports/imports.service';

const DEV = { email: 'dev@test.local', password: 'DevPass@123' };

describe('R1 sprint 2: students, families, scopes, announcements, imports (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let http: any;
  let dev: string;
  const sec: Record<string, number> = {};
  const cls: Record<string, number> = {};

  const login = (identifier: string, password: string) => http.post('/api/v1/auth/login').send({ identifier, password });
  const as = (token: string, ws?: string) => {
    const h = (r: request.Test) => { r.set('Authorization', `Bearer ${token}`); if (ws) r.set('X-Workspace', ws); return r; };
    return {
      get: (u: string) => h(http.get(u)),
      post: (u: string, b: object = {}) => h(http.post(u)).send(b),
      patch: (u: string, b: object) => h(http.patch(u)).send(b),
      put: (u: string, b: object) => h(http.put(u)).send(b),
      upload: (u: string, buf: Buffer, name = 'data.xlsx') => h(http.post(u)).attach('file', buf, name),
    };
  };
  async function activate(identifier: string, userPublicId: string) {
    const cred = (await as(dev).post(`/api/v1/users/${userPublicId}/credentials`)).body.data;
    const first = (await login(identifier, cred.temporaryPassword)).body.data.accessToken;
    await as(first).post('/api/v1/auth/change-password', { currentPassword: cred.temporaryPassword, newPassword: 'NewPass@123' });
    return (await login(identifier, 'NewPass@123')).body.data.accessToken as string;
  }
  async function staff(n: number, roleKeys: string[]) {
    const r = await as(dev).post('/api/v1/staff', { name: `S2 Staff ${n}`, email: `s2staff${n}@test.local`, mobile: `97000000${String(n).padStart(2, '0')}`, employeeCode: `S2-${n}`, roleKeys });
    expect(r.status).toBe(201);
    return { ...r.body.data, token: await activate(r.body.data.mobile, r.body.data.user_id) };
  }
  const student = (firstName: string, klass: string, family: object) =>
    as(dev).post('/api/v1/students', { firstName, classId: cls[klass], sectionId: sec[`${klass}A`], family });
  async function xlsx(type: 'families_students' | 'staff', rows: Array<Record<string, string>>) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Data');
    ws.addRow(COLUMNS[type].map((c) => c.header + (c.required ? ' *' : '')));
    for (const r of rows) ws.addRow(COLUMNS[type].map((c) => r[c.key] ?? ''));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  let classTeacher: any, teacher: any, admin: any;
  let familyA: { userId: string; mobile: string }, ravi: string, sita: string, otherKid: string;

  beforeAll(async () => {
    db = createDatabase();
    await seed(db, { institutionName: 'Test School', superAdminEmail: DEV.email, superAdminPassword: DEV.password });
    app = await createApp();
    await app.init();
    http = request(app.getHttpServer());
    dev = (await login(DEV.email, DEV.password)).body.data.accessToken;
    const classes = (await as(dev).get('/api/v1/classes')).body.data;
    for (const c of classes) { cls[c.name] = c.id; for (const s of c.sections) sec[`${c.name}${s.name}`] = s.id; }
    classTeacher = await staff(1, ['teacher', 'class_teacher']);
    teacher = await staff(2, ['teacher']);
    admin = await staff(3, ['institution_admin']);
    await as(dev).put(`/api/v1/sections/${sec['Class 5A']}/class-teacher`, { staffId: classTeacher.public_id });
    const subj = (await as(dev).post('/api/v1/subjects', { name: 'Mathematics S2', code: 'M' })).body.data.id;
    await as(dev).post('/api/v1/teacher-assignments', { staffId: teacher.public_id, sectionId: sec['Class 6A'], subjectId: subj });
  });

  afterAll(async () => { await app.close(); await db.destroy(); });

  describe('Students and families', () => {
    it('creates a student with a new family, family login and automatic admission number', async () => {
      const r = await student('Ravi', 'Class 5', { familyName: 'Rao family', fatherName: 'Srinivas Rao', mobile: '9811100001', email: 'rao@test.local' });
      expect(r.status).toBe(201);
      ravi = r.body.data.public_id;
      expect(r.body.data.admission_no).toMatch(/^\d{4}$/);
      expect(r.body.data.class_name).toBe('Class 5');
      expect(r.body.data.family_login_sent).toBe(false);
      familyA = { userId: r.body.data.family_user_id, mobile: '9811100001' };
      const roles = await db.selectFrom('user_roles as ur').innerJoin('roles as r', 'r.id', 'ur.role_id').innerJoin('users as u', 'u.id', 'ur.user_id')
        .select('r.role_key').where('u.mobile', '=', '9811100001').execute();
      expect(roles.map((x) => x.role_key)).toEqual(['parent']);
    });

    it('finds the family by mobile and adds a sibling to it', async () => {
      const look = await as(dev).get('/api/v1/families/lookup?mobile=98111%2000001');
      expect(look.body.data.family.family_name).toBe('Rao family');
      const r = await student('Sita', 'Class 6', { familyId: look.body.data.family.public_id });
      expect(r.status).toBe(201);
      sita = r.body.data.public_id;
      expect(r.body.data.siblings.map((s: any) => s.first_name)).toEqual(['Ravi']);
    });

    it('rejects a second family with the same mobile', async () => {
      const r = await student('X', 'Class 5', { familyName: 'Dup', mobile: '9811100001' });
      expect(r.status).toBe(409);
    });

    it('adds a student in another family for scope checks', async () => {
      const r = await student('Other', 'Class 5', { familyName: 'Other family', mobile: '9811100002' });
      otherKid = r.body.data.public_id;
      expect(r.status).toBe(201);
    });
  });

  describe('Data scopes and field rules', () => {
    it('class teacher sees only their section and can see family mobile', async () => {
      const r = await as(classTeacher.token).get('/api/v1/students');
      expect(r.status).toBe(200);
      expect(r.body.data.map((s: any) => s.first_name).sort()).toEqual(['Other', 'Ravi']);
      // Teacher role hides mobiles, Class Teacher role does not: the more permissive role wins (5.4)
      expect(r.body.data.every((s: any) => /^\d{10}$/.test(s.family_mobile))).toBe(true);
    });

    it('subject teacher sees only sections they teach, with family mobile hidden', async () => {
      const r = await as(teacher.token).get('/api/v1/students');
      expect(r.body.data.map((s: any) => s.first_name)).toEqual(['Sita']);
      expect(r.body.data[0].family_mobile).toBe('__hidden__');
      expect((await as(teacher.token).get(`/api/v1/students/${ravi}`)).status).toBe(404);
      const one = (await as(teacher.token).get(`/api/v1/students/${sita}`)).body.data;
      expect(one.family_address).toBe('__hidden__');
    });

    it('teacher cannot create students', async () => {
      expect((await as(teacher.token).post('/api/v1/students', {})).status).toBe(403);
    });
  });

  describe('Family login (L8 to L12)', () => {
    let familyToken: string;
    it('family logs in with mobile and sees only its own children', async () => {
      familyToken = await activate(familyA.mobile, familyA.userId);
      const me = (await as(familyToken).get('/api/v1/auth/me')).body.data;
      expect(me.workspace).toBe('parent');
      const list = await as(familyToken).get('/api/v1/students');
      expect(list.body.data.map((s: any) => s.first_name).sort()).toEqual(['Ravi', 'Sita']);
      expect((await as(familyToken).get(`/api/v1/students/${otherKid}`)).status).toBe(404);
      expect((await as(familyToken).post('/api/v1/students', {})).status).toBe(403);
    });

    it('auto-disables the family login only when all children are inactive, and restores it (ST5)', async () => {
      await as(admin.token).post(`/api/v1/students/${ravi}/deactivate`, { reason: 'Transferred' });
      expect((await login(familyA.mobile, 'NewPass@123')).status).toBe(200);
      const active = (await as(admin.token).get('/api/v1/students')).body.data.map((s: any) => s.first_name);
      expect(active).not.toContain('Ravi');
      const inactive = (await as(admin.token).get('/api/v1/students?status=inactive')).body.data.map((s: any) => s.first_name);
      expect(inactive).toContain('Ravi');
      expect(inactive).not.toContain('Sita');
      expect((await as(teacher.token).get('/api/v1/students?status=inactive')).status).toBe(403);

      const r = await as(admin.token).post(`/api/v1/students/${sita}/deactivate`, { reason: 'Left school' });
      expect(r.body.data.family_login_change).toBe('auto_disabled');
      expect((await as(familyToken).get('/api/v1/auth/me')).status).toBe(401);
      expect((await login(familyA.mobile, 'NewPass@123')).body.code).toBe('ACCOUNT_DISABLED');

      const back = await as(admin.token).post(`/api/v1/students/${sita}/activate`);
      expect(back.body.data.family_login_change).toBe('active');
      expect((await login(familyA.mobile, 'NewPass@123')).status).toBe(200);
      await as(admin.token).post(`/api/v1/students/${ravi}/activate`);
    });
  });

  describe('Staff who are parents', () => {
    it('links a family to the staff account and adds the Parent workspace, without auto-disabling staff', async () => {
      const r = await student('Anu', 'Class 6', { familyName: 'Staff 2 family', mobile: teacher.mobile });
      expect(r.status).toBe(201);
      const me = (await as(teacher.token).get('/api/v1/auth/me')).body.data;
      expect(me.workspaces).toEqual(['staff', 'parent']);
      const kids = (await as(teacher.token, 'parent').get('/api/v1/students')).body.data.map((s: any) => s.first_name);
      expect(kids).toEqual(['Anu']);
      await as(admin.token).post(`/api/v1/students/${r.body.data.public_id}/deactivate`, { reason: 'test' });
      const after = await login(teacher.mobile, 'NewPass@123');
      expect(after.status).toBe(200);
      expect(after.body.data.workspaces).toEqual(['staff']);
    });
  });

  describe('Announcements and notifications', () => {
    it('notifies only families with a child in the chosen section', async () => {
      const r = await as(admin.token).post('/api/v1/announcements', { title: 'Class 5A picnic', body: 'Picnic on Friday.', audience: { type: 'sections', ids: [sec['Class 5A']] }, publish: true });
      expect(r.body.data.status).toBe('published');
      const fam = (await login(familyA.mobile, 'NewPass@123')).body.data.accessToken;
      const n = (await as(fam).get('/api/v1/notifications/unread-count')).body.data.unread;
      expect(n).toBe(1);
      const list = (await as(fam).get('/api/v1/announcements')).body.data.map((a: any) => a.title);
      expect(list).toContain('Class 5A picnic');
      await as(fam).post('/api/v1/notifications/read-all');
      expect((await as(fam).get('/api/v1/notifications/unread-count')).body.data.unread).toBe(0);
    });

    it('lets a class teacher draft only for their own section, and not publish', async () => {
      const bad = await as(classTeacher.token).post('/api/v1/announcements', { title: 'Wrong section', body: 'x', audience: { type: 'sections', ids: [sec['Class 6A']] } });
      expect(bad.body.code).toBe('AUDIENCE_NOT_ALLOWED');
      const ok = await as(classTeacher.token).post('/api/v1/announcements', { title: 'Homework note', body: 'Bring notebooks', audience: { type: 'sections', ids: [sec['Class 5A']] }, publish: true });
      expect(ok.body.data.status).toBe('draft');
      expect((await as(classTeacher.token).post(`/api/v1/announcements/${ok.body.data.id}/publish`)).status).toBe(403);
    });
  });

  describe('Excel imports (15.1, IM1)', () => {
    it('serves a template', async () => {
      const r = await as(admin.token).get('/api/v1/imports/templates/families_students').buffer(true).parse((res: any, cb: any) => {
        const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect(r.status).toBe(200);
      const wb = new ExcelJS.Workbook(); await wb.xlsx.load(r.body);
      expect(wb.getWorksheet('Data')!.getRow(1).getCell(2).value).toBe('First Name *');
    });

    it('reports every bad row and saves nothing until the whole file is valid', async () => {
      const before = Number((await db.selectFrom('students').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow()).n);
      const rows: Array<Record<string, string>> = [
        { firstName: 'Kiran', className: '7', section: 'a', familyMobile: '9822200001', fatherName: 'Mohan', dob: '14-05-2014' },
        { firstName: 'Kavya', className: 'Class 4', section: 'A', familyMobile: '+91 98222 00001', gender: 'F' },
        { firstName: 'Bad', className: 'Class 99', section: 'A', familyMobile: '12345' },
      ];
      const v = await as(admin.token).upload('/api/v1/imports/families_students/validate', await xlsx('families_students', rows));
      expect(v.status).toBe(200);
      expect(v.body.data.status).toBe('invalid');
      expect(v.body.data.errors.map((e: any) => e.column).sort()).toEqual(['Class', 'Family Mobile']);
      expect(v.body.data.errors[0].row).toBe(4);
      const commit = await as(admin.token).post(`/api/v1/imports/${v.body.data.jobId}/commit`);
      expect(commit.body.code).toBe('IMPORT_HAS_ERRORS');
      const mid = Number((await db.selectFrom('students').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow()).n);
      expect(mid).toBe(before);

      const ok = await as(admin.token).upload('/api/v1/imports/families_students/validate', await xlsx('families_students', rows.slice(0, 2)));
      expect(ok.body.data).toMatchObject({ status: 'ready', summary: { students: 2, newFamilies: 1 } });
      const done = await as(admin.token).post(`/api/v1/imports/${ok.body.data.jobId}/commit`);
      expect(done.body.data.status).toBe('completed');
      const fam = await db.selectFrom('families as f').innerJoin('students as s', 's.family_id', 'f.id').select(['f.family_name', 's.first_name'])
        .where('f.primary_mobile', '=', '9822200001').execute();
      expect(fam.map((x) => x.first_name).sort()).toEqual(['Kavya', 'Kiran']);
      expect(fam[0].family_name).toBe('Mohan');
      const again = await as(admin.token).post(`/api/v1/imports/${ok.body.data.jobId}/commit`);
      expect(again.body.code).toBe('ALREADY_IMPORTED');
    });

    it('imports staff with roles and rejects unknown roles', async () => {
      const bad = await as(admin.token).upload('/api/v1/imports/staff/validate', await xlsx('staff', [
        { employeeCode: 'IMP-1', name: 'Imported One', mobile: '9833300001', email: 'imp1@test.local', roles: 'Teacher, Wizard' },
      ]));
      expect(bad.body.data.errors[0]).toMatchObject({ column: 'Roles', message: 'Unknown role "wizard".' });
      const good = await as(admin.token).upload('/api/v1/imports/staff/validate', await xlsx('staff', [
        { employeeCode: 'IMP-1', name: 'Imported One', mobile: '9833300001', email: 'imp1@test.local', roles: 'Teacher, Class Teacher' },
        { employeeCode: 'IMP-2', name: 'Imported Two', mobile: '9833300002', email: 'imp2@test.local' },
      ]));
      expect(good.body.data.status).toBe('ready');
      expect((await as(admin.token).post(`/api/v1/imports/${good.body.data.jobId}/commit`)).body.data.status).toBe('completed');
      const list = (await as(admin.token).get('/api/v1/staff?search=Imported')).body.data;
      expect(list.map((s: any) => s.roles)).toEqual(['Class Teacher, Teacher', 'Teacher']);
    });

    it('rejects non-Excel files', async () => {
      const r = await as(admin.token).upload('/api/v1/imports/staff/validate', Buffer.from('a,b'), 'data.csv');
      expect(r.body.code).toBe('WRONG_FILE_TYPE');
    });
  });
});

import { config } from '../src/config';
import { createDatabase, type Database } from '../src/database/database.module';
import { seed } from '../src/database/seed';
import { demoWanted, isDemoFillRequest, resetInterruptedDemo, startDemoIfWanted } from '../src/database/demo-start';

/** DEMO_DATA must never touch a real school's database. */
describe('Demo data safety (e2e)', () => {
  let db: Database;
  beforeAll(async () => {
    db = createDatabase();
    await seed(db, { institutionName: 'Real School', superAdminEmail: 'dev@test.local', superAdminPassword: 'DevPass@123' });
    const u = await db.insertInto('users').values({ public_id: '01J0000000000000000000USER', name: 'Real Teacher', mobile: '9876500001' }).executeTakeFirstOrThrow();
    await db.insertInto('staff').values({ public_id: '01J0000000000000000000STAF', employee_code: 'R-1', user_id: Number(u.insertId) }).execute();
  });
  afterAll(async () => { delete process.env.DEMO_DATA; await db?.destroy(); });

  it('is off unless DEMO_DATA is set', async () => {
    delete process.env.DEMO_DATA;
    expect(demoWanted()).toBe(false);
    process.env.DEMO_DATA = 'yes';
    expect(demoWanted()).toBe(true);
    // Outside a fill, no request skips the rate limits.
    expect(isDemoFillRequest({ headers: { 'x-demo-fill': 'anything' }, socket: { remoteAddress: '127.0.0.1' } } as any)).toBe(false);
  });

  it('leaves a database that already has a school exactly as it is', async () => {
    process.env.DEMO_DATA = 'yes';
    await startDemoIfWanted(1); // would fail loudly if it tried to call the API
    expect(await db.selectFrom('settings').select('value').where('setting_group', '=', 'demo').executeTakeFirst()).toBeUndefined();
    expect((await db.selectFrom('institution_settings').select('name').executeTakeFirstOrThrow()).name).toBe('Real School');
    // Only a database marked as a half-filled demo is ever cleared.
    await resetInterruptedDemo(config.db);
    expect(Number((await db.selectFrom('staff').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow()).n)).toBe(1);
  });
});

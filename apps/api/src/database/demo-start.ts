import { randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';
import type { Request } from 'express';
import type { DbConfig } from '../config';

/**
 * DEMO_DATA=yes (set only on a demo website): on start, an empty database fills itself with the demo
 * school. Schools never set it, and a database that already has a school is never touched.
 */
export const demoWanted = () => /^(yes|true|1|on)$/i.test(process.env.DEMO_DATA ?? '');

let fillToken: string | null = null;
/** The filling runs through the app's own API from this server; those requests are not rate-limited. */
export function isDemoFillRequest(req: Request) {
  const ip = req.socket?.remoteAddress ?? '';
  return !!fillToken && req.headers['x-demo-fill'] === fillToken && (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1');
}

async function status(conn: mysql.Connection, database: string): Promise<string | null> {
  const [t] = await conn.query<any[]>('SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = ?', [database, 'settings']);
  if (!t.length) return null;
  const [r] = await conn.query<any[]>("SELECT value FROM settings WHERE setting_group = 'demo' AND setting_key = 'status'", []);
  if (!r.length) return null;
  const v = typeof r[0].value === 'string' ? JSON.parse(r[0].value) : r[0].value;
  return v?.state ?? null;
}

/** If an earlier fill was cut short (server restarted), clear the half-filled demo database so it starts again. */
export async function resetInterruptedDemo(db: DbConfig) {
  const conn = await mysql.createConnection({ host: db.host, port: db.port, user: db.user, password: db.password, database: db.database }).catch(() => null);
  if (!conn) return; // database does not exist yet: migrations create it
  try {
    if ((await status(conn, db.database)) !== 'filling') return;
    console.log('Demo data: the last fill did not finish. Clearing the demo database to start again.');
    const [tables] = await conn.query<any[]>('SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?', [db.database]);
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const { t } of tables) await conn.query(`DROP TABLE IF EXISTS \`${String(t).replace(/`/g, '')}\``);
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally { await conn.end(); }
}

/** After the app is listening: fill an empty database in the background. */
export async function startDemoIfWanted(port: number) {
  if (!demoWanted()) return;
  const { createDatabase } = await import('./database.module');
  const { fillDemo, schoolSize } = await import('./demo');
  const db = createDatabase();
  const setStatus = (state: string) => db.insertInto('settings').values({ setting_group: 'demo', setting_key: 'status', value: JSON.stringify({ state, at: new Date().toISOString() }), is_developer_only: 1 })
    .onDuplicateKeyUpdate({ value: JSON.stringify({ state, at: new Date().toISOString() }) }).execute();
  try {
    const current = await db.selectFrom('settings').select('value').where('setting_group', '=', 'demo').where('setting_key', '=', 'status').executeTakeFirst();
    if (current) return; // already filled (or being filled by this start)
    const size = await schoolSize(db);
    if (size.students > 0 || size.staff > 0) {
      console.log('Demo data: DEMO_DATA is set, but this database already has a school, so nothing was added.');
      return;
    }
    console.log('Demo data: filling the demo school. This takes a few minutes; the website and app work meanwhile.');
    await setStatus('filling');
    fillToken = randomBytes(24).toString('hex');
    const r = await fillDemo(db, `http://127.0.0.1:${port}`, { 'X-Demo-Fill': fillToken });
    await setStatus('done');
    console.log(`Demo data: ready. ${r.students} students, ${r.staff} staff, ${r.parents} parent logins. Every login uses the password Demo@1234.`);
  } catch (e: any) {
    console.error(`Demo data: stopped (${e?.message ?? e}). Restart the app to try again from the beginning.`);
  } finally {
    fillToken = null;
    await db.destroy();
  }
}

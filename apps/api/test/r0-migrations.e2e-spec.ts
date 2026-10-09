import mysql from 'mysql2/promise';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../src/database/migrate';

describe('Migration runner (resumes after a failed statement)', () => {
  const db = { host: process.env.DB_HOST!, port: Number(process.env.DB_PORT), user: process.env.DB_USER!, password: process.env.DB_PASSWORD!, database: 'ems_test_migr' };
  const dir = mkdtempSync(join(tmpdir(), 'mig-'));
  afterAll(async () => {
    const c = await mysql.createConnection({ ...db, database: undefined });
    await c.query('DROP DATABASE IF EXISTS ems_test_migr'); await c.end();
  });

  it('resumes at the failed statement, and refuses edits to statements that already ran', async () => {
    const c = await mysql.createConnection({ ...db, database: undefined });
    await c.query('DROP DATABASE IF EXISTS ems_test_migr'); await c.end();
    writeFileSync(join(dir, '0001_a.sql'), 'CREATE TABLE t1 (id INT PRIMARY KEY);\nALTER TABLE t1 ADD COLUMN x INT;\nALTER TABLE t1 ADD COLUMN broken NOPE;\nALTER TABLE t1 ADD COLUMN y INT;');
    await expect(runMigrations(db, dir)).rejects.toThrow(/failed at statement 3/);
    writeFileSync(join(dir, '0001_a.sql'), 'CREATE TABLE t1 (id INT PRIMARY KEY);\nALTER TABLE t1 ADD COLUMN x INT;\nALTER TABLE t1 ADD COLUMN fixed INT;\nALTER TABLE t1 ADD COLUMN y INT;');
    expect(await runMigrations(db, dir)).toEqual(['0001_a.sql']);
    const conn = await mysql.createConnection(db);
    const [cols] = await conn.query("SELECT COLUMN_NAME AS c FROM information_schema.columns WHERE table_schema = 'ems_test_migr' AND table_name = 't1' ORDER BY ORDINAL_POSITION");
    expect((cols as any[]).map((r) => r.c)).toEqual(['id', 'x', 'fixed', 'y']);
    await conn.end();
    writeFileSync(join(dir, '0002_b.sql'), 'CREATE TABLE t2 (id INT);\nALTER TABLE t2 ADD COLUMN bad NOPE;');
    await expect(runMigrations(db, dir)).rejects.toThrow(/statement 2/);
    writeFileSync(join(dir, '0002_b.sql'), 'CREATE TABLE t2 (id INT, changed INT);\nALTER TABLE t2 ADD COLUMN ok INT;');
    await expect(runMigrations(db, dir)).rejects.toThrow(/already ran but has since been changed/);
  });
});

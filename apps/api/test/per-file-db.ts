import { basename } from 'node:path';
import mysql from 'mysql2/promise';
import { runMigrations } from '../src/database/migrate';

/**
 * Every test file gets its own freshly migrated database (ems_test_<file>), so files can never
 * affect each other, whatever order Jest runs them in.
 */
const file = basename(expect.getState().testPath ?? 'x', '.e2e-spec.ts').replace(/[^a-z0-9]/gi, '_').toLowerCase();
process.env.DB_NAME = `ems_test_${file}`.slice(0, 60);

beforeAll(async () => {
  const db = { host: process.env.DB_HOST!, port: Number(process.env.DB_PORT), user: process.env.DB_USER!, password: process.env.DB_PASSWORD! };
  const c = await mysql.createConnection(db);
  await c.query(`DROP DATABASE IF EXISTS \`${process.env.DB_NAME}\``);
  await c.query(`CREATE DATABASE \`${process.env.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await c.end();
  await runMigrations({ ...db, database: process.env.DB_NAME! }, `${__dirname}/../migrations`);
}, 60_000);

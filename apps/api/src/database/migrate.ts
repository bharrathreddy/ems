/**
 * Minimal, dependable SQL migration runner (MySQL 8 and MariaDB 10.4+).
 * - Creates the database if it does not exist (when the user is allowed to).
 * - Applies migrations/*.sql in filename order, once each, recording a checksum.
 * - Refuses to run if an applied file was edited afterwards.
 * - Explains clearly when tables exist without a migration record
 *   (usually a manual phpMyAdmin import or an interrupted first run).
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import mysql from 'mysql2/promise';
import type { DbConfig } from '../config';

/**
 * Each file runs statement by statement with recorded progress. MySQL cannot roll back table
 * changes, so if a statement fails, the next start resumes at that statement (once fixed)
 * instead of failing on the statements that already ran.
 */
export function splitSql(sqlText: string): string[] {
  const out: string[] = [];
  let cur = '', q: string | null = null;
  for (let i = 0; i < sqlText.length; i++) {
    const c = sqlText[i], n = sqlText[i + 1];
    if (!q && c === '-' && n === '-') { const end = sqlText.indexOf('\n', i); i = end === -1 ? sqlText.length : end; cur += '\n'; continue; }
    if (!q && c === '/' && n === '*') { const end = sqlText.indexOf('*/', i + 2); i = end === -1 ? sqlText.length : end + 1; continue; }
    if (q) { cur += c; if (c === '\\') { cur += n ?? ''; i++; } else if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; cur += c; continue; }
    if (c === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const hash = (s: string) => createHash('sha256').update(s.replace(/\s+/g, ' ').trim()).digest('hex');

async function ensureDatabase(db: DbConfig) {
  const conn = await mysql.createConnection({ host: db.host, port: db.port, user: db.user, password: db.password });
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${db.database.replace(/`/g, '')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } catch {
    // Hosting users often may not create databases; the database must then already exist.
  } finally {
    await conn.end();
  }
}

export async function runMigrations(db: DbConfig, dir = join(__dirname, '../../migrations')) {
  await ensureDatabase(db);
  let conn;
  try {
    conn = await mysql.createConnection({ ...db, multipleStatements: true, charset: 'utf8mb4' });
  } catch (e: any) {
    if (e?.code === 'ER_BAD_DB_ERROR') {
      throw new Error(`Database "${db.database}" does not exist and could not be created. Create it in phpMyAdmin/hPanel (collation utf8mb4_unicode_ci), or check DB_NAME.`);
    }
    throw e;
  }
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(200) NOT NULL PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migration_steps (
      filename VARCHAR(200) NOT NULL,
      step INT NOT NULL,
      checksum CHAR(64) NOT NULL,
      PRIMARY KEY (filename, step)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    const [rows] = await conn.query('SELECT filename, checksum FROM schema_migrations');
    const applied = new Map((rows as any[]).map((r) => [r.filename, r.checksum]));

    const [inProgress] = await conn.query('SELECT COUNT(*) AS n FROM schema_migration_steps');
    if (applied.size === 0 && Number((inProgress as any[])[0].n) === 0) {
      const [tables] = await conn.query(
        "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name NOT IN ('schema_migrations', 'schema_migration_steps')",
      );
      if (Number((tables as any[])[0].n) > 0) {
        throw new Error(
          `Database "${db.database}" already contains tables that this app did not create ` +
          '(a manual SQL import or an interrupted first start). Use an empty database: create a new one ' +
          'and set DB_NAME to it, or remove all tables from this one. Do not import .sql files manually.',
        );
      }
    }

    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const done: string[] = [];
    for (const file of files) {
      const sqlText = readFileSync(join(dir, file), 'utf8');
      const checksum = createHash('sha256').update(sqlText.replace(/\r\n/g, '\n')).digest('hex');
      if (applied.has(file)) {
        if (applied.get(file) !== checksum) {
          throw new Error(`Migration ${file} was modified after it was applied. Restore it and put the change in a new migration file.`);
        }
        continue;
      }
      const statements = splitSql(sqlText);
      const [doneRows] = await conn.query('SELECT step, checksum FROM schema_migration_steps WHERE filename = ? ORDER BY step', [file]);
      const doneSteps = doneRows as Array<{ step: number; checksum: string }>;
      for (const d of doneSteps) {
        if (!statements[d.step] || hash(statements[d.step]) !== d.checksum) {
          throw new Error(`Migration ${file}: statement ${d.step + 1} already ran but has since been changed. Restore it; only the failed statement may be fixed.`);
        }
      }
      for (let i = doneSteps.length; i < statements.length; i++) {
        try {
          await conn.query(statements[i]);
        } catch (e: any) {
          throw new Error(`Migration ${file} failed at statement ${i + 1}: ${e?.message}. Send this message to the developer.`);
        }
        await conn.query('INSERT INTO schema_migration_steps (filename, step, checksum) VALUES (?, ?, ?)', [file, i, hash(statements[i])]);
      }
      await conn.query('INSERT INTO schema_migrations (filename, checksum) VALUES (?, ?)', [file, checksum]);
      await conn.query('DELETE FROM schema_migration_steps WHERE filename = ?', [file]);
      done.push(file);
    }
    return done;
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { config } = require('../config');
  runMigrations(config.db)
    .then((done) => {
      console.log(done.length ? `Applied: ${done.join(', ')}` : 'Database is up to date.');
      process.exit(0);
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}

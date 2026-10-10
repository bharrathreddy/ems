import 'reflect-metadata';
import { APP_VERSION, config } from './config';
import { runMigrations } from './database/migrate';
import { createDatabase } from './database/database.module';
import { seed, seedOptionsFromEnv } from './database/seed';
import { createApp } from './bootstrap';
import { demoWanted, resetInterruptedDemo, startDemoIfWanted } from './database/demo-start';

async function main() {
  if (demoWanted()) await resetInterruptedDemo(config.db);
  if (config.autoMigrate) {
    // Hostinger has no deploy hook for database steps, so the app prepares its own database on start.
    const applied = await runMigrations(config.db);
    if (applied.length) console.log(`Migrations applied: ${applied.join(', ')}`);
    const db = createDatabase();
    await seed(db, seedOptionsFromEnv());
    await db.destroy();
  }
  const app = await createApp();
  await app.listen(config.port);
  console.log(`Ready (version ${APP_VERSION}). Website: http://localhost:${config.port}/  App: http://localhost:${config.port}/app`);
  void startDemoIfWanted(config.port);
}

/** Plain-language startup errors with the fix (Windows reports some network errors with an empty message). */
function explain(e: any): string {
  const inner: any[] = Array.isArray(e?.errors) ? e.errors : [];
  const code = e?.code ?? inner[0]?.code;
  const db = (() => { try { return config.db; } catch { return null; } })();
  const where = db ? `${db.host}:${db.port}` : 'the database';
  const hints: Record<string, string> = {
    ECONNREFUSED: `Cannot reach MySQL at ${where}. Start MySQL in the XAMPP Control Panel (it must show green), and check DB_HOST / DB_PORT in .env.`,
    ETIMEDOUT: `MySQL at ${where} did not answer. Check DB_HOST / DB_PORT in .env.`,
    ENOTFOUND: `The database host "${db?.host}" was not found. Check DB_HOST in .env.`,
    ER_ACCESS_DENIED_ERROR: 'MySQL refused the user or password. Check DB_USER / DB_PASSWORD in .env (XAMPP default: root with an empty password).',
    ER_DBACCESS_DENIED_ERROR: `The database user may not use "${db?.database}". Check DB_NAME and the user's permissions.`,
    EADDRINUSE: `Port ${config.port} is already in use, usually by another copy of this app still running. Close its window, or run:  taskkill /F /IM node.exe  then start again.`,
  };
  const msg = e?.message || inner.map((x) => x?.message).filter(Boolean).join('; ') || String(code ?? e);
  return `${msg}${code && hints[code] ? `\n\n  What to do: ${hints[code]}` : ''}`;
}

main().catch((e) => {
  console.error(`\nStartup failed: ${explain(e)}\n\n  For a full check, run:  npm run doctor\n`);
  process.exit(1);
});

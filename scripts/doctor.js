#!/usr/bin/env node
/**
 * npm run doctor: checks the setup step by step and says what to fix.
 * Safe to run any time; it only reads.
 */
const { existsSync, readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const net = require('node:net');
const http = require('node:http');

const root = join(__dirname, '..');
const api = join(root, 'apps/api');
const reqApi = (m) => require(require.resolve(m, { paths: [api, root] }));
const ok = (m) => console.log(`  \u2714 ${m}`);
const bad = (m, fix) => { console.log(`  \u2718 ${m}`); if (fix) console.log(`      Fix: ${fix}`); problems++; };
const info = (m) => console.log(`    ${m}`);
let problems = 0;

(async () => {
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  console.log(`\nSchool app check (version ${version})\n`);

  // 1. Node
  const major = Number(process.versions.node.split('.')[0]);
  major >= 20 ? ok(`Node.js ${process.versions.node}`) : bad(`Node.js ${process.versions.node} is too old`, 'Install Node.js 22 LTS from nodejs.org.');

  // 2. Files: all present and from this version (catches skipped files when unzipping over an old copy)
  const manifestFile = join(root, 'MANIFEST.json');
  if (existsSync(manifestFile)) {
    const { createHash } = require('node:crypto');
    const man = JSON.parse(readFileSync(manifestFile, 'utf8'));
    const missing = [], changed = [];
    for (const [rel, h] of Object.entries(man.files)) {
      const p = join(root, rel);
      if (!existsSync(p)) missing.push(rel);
      else if (createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16) !== h) changed.push(rel);
    }
    if (!missing.length && !changed.length) ok(`All ${Object.keys(man.files).length} program files match version ${man.version}`);
    else {
      bad(`${missing.length + changed.length} program file(s) are missing or from another version`, 'Delete the project folder (keep .env), extract the zip fresh, then npm install and npm run build.');
      for (const f of [...missing.map((x) => `missing: ${x}`), ...changed.map((x) => `different: ${x}`)].slice(0, 8)) info(f);
    }
  }

  // 3. Packages and build
  existsSync(join(root, 'node_modules')) ? ok('Packages installed') : bad('Packages are not installed', 'Run: npm install');
  const built = existsSync(join(api, 'dist/main.js')) && existsSync(join(root, 'apps/admin/dist/index.html'));
  if (!built) bad('App is not built (needed for npm start, not for npm run dev)', 'Run: npm run build');
  else {
    let lost = null;
    try { lost = require(join(api, 'dist/BUILD-OK.json')).files.filter((f) => !existsSync(join(api, 'dist', f))); } catch { lost = null; }
    if (lost === null) bad('The last build did not finish (some program files may be missing)', 'Close any "npm run dev" window, then run: npm run build   and check it ends with "API build complete".');
    else if (lost.length) bad(`The build is incomplete: ${lost.length} file(s) missing, e.g. ${lost.slice(0, 2).join(', ')}`, 'Run: npm run build');
    else ok('App is built (for npm start)');
  }

  // 4. .env
  const envFile = join(root, '.env');
  if (!existsSync(envFile)) { bad('.env file is missing in the project folder', 'Run: copy .env.example .env   then edit it.'); return finish(); }
  reqApi('dotenv').config({ path: envFile, quiet: true });
  const e = process.env;
  const missing = ['DB_NAME'].filter((k) => !e[k]);
  const sec = e.JWT_ACCESS_SECRET || '';
  if (!sec || sec.length < 32 || /change[-_ ]?(this|me)|paste[-_ ]a[-_ ]long|generate[-_ ]a[-_ ]/i.test(sec)) info('JWT_ACCESS_SECRET is empty or an example value: the app uses its own random key from the storage folder (safe). To set your own, use 40+ random characters.');
  else ok('Login signing key is set');
  missing.length ? bad(`.env is missing: ${missing.join(', ')}`, 'Add them to .env (see .env.example).') : ok('.env found');
  if (existsSync(join(api, '.env'))) info('Note: apps/api/.env exists but is NOT used. Only the .env in the project folder is read.');
  const host = !e.DB_HOST || e.DB_HOST === 'localhost' ? '127.0.0.1' : e.DB_HOST;
  const db = { host, port: Number(e.DB_PORT || 3306), user: e.DB_USER || 'root', password: e.DB_PASSWORD || '', database: e.DB_NAME };
  info(`Database: ${db.user}@${db.host}:${db.port} / ${db.database}`);

  // 5. Port
  const port = Number(e.PORT || 3000);
  const free = await new Promise((r) => { const s = net.createServer().once('error', () => r(false)).once('listening', () => s.close(() => r(true))).listen(port); });
  if (free) ok(`Port ${port} is free`);
  else {
    const running = await new Promise((r) => http.get({ host: '127.0.0.1', port, path: '/api/v1/public/version', timeout: 3000 }, (res) => {
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => r({ status: res.statusCode, body: b }));
    }).on('error', () => r(null)));
    if (running && running.status === 200) {
      const v = JSON.parse(running.body).data.version;
      v === version ? ok(`This app (version ${v}) is already running on port ${port}`) : bad(`An OLDER copy (version ${v}) is running on port ${port}`, 'Close its window, or run: taskkill /F /IM node.exe   then start again.');
    } else if (running && running.status === 404) bad(`An OLDER copy of the app is running on port ${port} (before version 0.6)`, 'Close its window, or run: taskkill /F /IM node.exe   then start again.');
    else bad(`Port ${port} is used by another program`, `Close it, or set PORT=3001 in .env.`);
  }

  // 6. Database
  const mysql = reqApi('mysql2/promise');
  let conn;
  try {
    conn = await mysql.createConnection({ host: db.host, port: db.port, user: db.user, password: db.password });
    const [[v]] = await conn.query('SELECT VERSION() AS v');
    ok(`MySQL is running (${v.v})`);
  } catch (err) {
    const code = err.code || (err.errors && err.errors[0] && err.errors[0].code);
    if (code === 'ECONNREFUSED') bad(`Cannot reach MySQL at ${db.host}:${db.port}`, 'Start MySQL in the XAMPP Control Panel (green), and check DB_PORT in .env.');
    else if (code === 'ER_ACCESS_DENIED_ERROR') bad('MySQL refused the user or password', 'Check DB_USER and DB_PASSWORD in .env (XAMPP default: root, empty password).');
    else bad(`MySQL connection failed: ${err.message || code}`);
    return finish();
  }
  try {
    await conn.query(`USE \`${db.database}\``);
    ok(`Database "${db.database}" exists`);
  } catch {
    info(`Database "${db.database}" does not exist yet; the app creates it on start.`);
    await conn.end(); return finish();
  }
  const files = readdirSync(join(api, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
  const [tbl] = await conn.query("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()");
  const tables = new Set(tbl.map((r) => r.t || r.TABLE_NAME));
  if (!tables.has('schema_migrations')) {
    tables.size ? bad('The database has tables but no migration record (manual import?)', 'Use an empty database: create a new one and set DB_NAME to it.') : info('Database is empty; the app sets it up on start.');
  } else {
    const [rows] = await conn.query('SELECT filename FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.filename));
    const pending = files.filter((f) => !applied.has(f));
    pending.length ? info(`Database updates waiting: ${pending.join(', ')} (applied automatically on start)`) : ok(`Database is up to date (${files.length} updates)`);
    if (tables.has('schema_migration_steps')) {
      const [st] = await conn.query('SELECT filename, COUNT(*) AS n FROM schema_migration_steps GROUP BY filename');
      for (const s of st) bad(`Update ${s.filename} stopped part-way (${s.n} steps done)`, 'Start the app again; it continues from the failed step. If it fails again, send the error to the developer.');
    }
    if (applied.has('0005_website.sql')) {
      const [[f]] = await conn.query("SELECT is_enabled FROM feature_flags WHERE module_key = 'cms'").catch(() => [[null]]);
      f && f.is_enabled ? ok('Website is switched on') : bad('Website is switched off', 'Developer console > Modules > switch on "Website".');
      const [[p]] = await conn.query("SELECT COUNT(*) AS n FROM cms_pages");
      p.n > 0 ? ok('Website content is set up') : info('Website content will be created on next start.');
    }
  }
  await conn.end();
  finish();
})().catch((err) => { console.error('\nCheck stopped:', err.message || err); process.exit(1); });

function finish() {
  console.log(problems ? `\n${problems} problem${problems > 1 ? 's' : ''} found. Fix them and run "npm run doctor" again.\n` : '\nEverything looks fine. Start with "npm start" (or "npm run dev").\n');
  process.exit(problems ? 1 : 0);
}

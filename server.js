// Entry file for Hostinger and `npm start`. Runs the compiled API, which also serves the website and the app.
const { existsSync } = require('node:fs');
const { join } = require('node:path');

const api = join(__dirname, 'apps/api/dist/main.js');
const site = join(__dirname, 'apps/admin/dist/index.html');
if (!existsSync(api) || !existsSync(site)) {
  console.error('\n  The app has not been built yet.\n');
  console.error('  Run these two commands in this folder:\n');
  console.error('    npm run build');
  console.error('    npm start\n');
  console.error('  (For development without building, use: npm run dev)\n');
  process.exit(1);
}
// A half-written build (for example after stopping a build or an old `npm run dev` part-way) fails with
// "Cannot find module ..."; check the list written by the last complete build first.
const okFile = join(__dirname, 'apps/api/dist/BUILD-OK.json');
let missing = [];
try {
  missing = require(okFile).files.filter((f) => !existsSync(join(__dirname, 'apps/api/dist', f)));
} catch {
  missing = ['(no record of a finished build)'];
}
if (missing.length) {
  console.error('\n  The last build did not finish, so some program files are missing');
  console.error(`  (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ' ...' : ''}).\n`);
  console.error('  Close any window running "npm run dev", then run:\n');
  console.error('    npm run build');
  console.error('    npm start\n');
  console.error('  If "npm run build" shows an error, send that error.\n');
  process.exit(1);
}
require(api);

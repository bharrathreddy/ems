// Runs after `nest build`. Confirms every source file was compiled, then writes dist/BUILD-OK.json,
// which server.js and `npm run doctor` use to tell a complete build from a half-written one.
const { existsSync, readdirSync, statSync, writeFileSync } = require('node:fs');
const { join, relative } = require('node:path');

const root = join(__dirname, '..');
const src = join(root, 'src'), dist = join(root, 'dist');
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const expected = walk(src).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts') && !f.endsWith('.spec.ts'))
  .map((f) => relative(src, f).replace(/\\/g, '/').replace(/\.ts$/, '.js'));
const missing = expected.filter((f) => !existsSync(join(dist, f)));
if (missing.length) {
  console.error(`\n  Build incomplete: ${missing.length} of ${expected.length} files were not compiled (for example ${missing.slice(0, 3).join(', ')}).`);
  console.error('  Scroll up for the error that stopped the build, fix it, and run  npm run build  again.\n');
  process.exit(1);
}
const version = require(join(root, '..', '..', 'package.json')).version;
writeFileSync(join(dist, 'BUILD-OK.json'), JSON.stringify({ version, builtAt: new Date().toISOString(), files: expected }, null, 1));
console.log(`  API build complete: ${expected.length} files (version ${version}).`);

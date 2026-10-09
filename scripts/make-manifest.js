// Writes MANIFEST.json: a fingerprint of every source file, so `npm run doctor` can spot old or missing files.
const { createHash } = require('node:crypto');
const { readdirSync, readFileSync, statSync, writeFileSync } = require('node:fs');
const { join, relative, sep } = require('node:path');
const root = join(__dirname, '..');
// Files that legitimately change on each PC (build notes, the npm lock file) are not checked.
const skip = /(^|\/)(node_modules|dist|\.git|storage|\.env$|MANIFEST\.json$|package-lock\.json$|[^/]*\.tsbuildinfo$)/;
const files = {};
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f), rel = relative(root, p).split(sep).join('/');
    if (skip.test(rel)) continue;
    if (statSync(p).isDirectory()) walk(p);
    else files[rel] = createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16);
  }
})(root);
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
writeFileSync(join(root, 'MANIFEST.json'), JSON.stringify({ version, files }, null, 0));
console.log(`MANIFEST.json: ${Object.keys(files).length} files, version ${version}`);

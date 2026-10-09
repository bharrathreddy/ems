// kysely-codegen does not detect MySQL generated columns. Mark them as Generated so inserts never set them.
const fs = require('fs');
const f = 'src/database/db.types.ts';
const generated = ['current_flag: number | null;', 'balance: Decimal;'];
let s = fs.readFileSync(f, 'utf8');
for (const g of generated) {
  const [name, type] = g.replace(';', '').split(': ');
  s = s.replace(g, `${name}: Generated<${type}>;`);
}
fs.writeFileSync(f, s);
console.log('Generated-column types fixed.');

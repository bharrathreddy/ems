/**
 * MySQL returns JSON columns already parsed; MariaDB (XAMPP, some Hostinger servers)
 * stores JSON as LONGTEXT and returns a string. Always read JSON columns through this.
 */
export function readJson<T = unknown>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return null; }
  }
  if (Buffer.isBuffer(value)) return readJson<T>(value.toString('utf8'));
  return value as T;
}

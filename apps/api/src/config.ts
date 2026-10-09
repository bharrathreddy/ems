import { config as loadEnv } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// One .env file at the project root (works from src/ with ts-node and from dist/ after build).
// On Hostinger, variables come from the hPanel "Environment variables" screen instead.
loadEnv({ path: resolve(__dirname, '../../../.env'), quiet: true } as any);

export interface DbConfig { host: string; port: number; user: string; password: string; database: string }

/**
 * Database settings. Use either separate DB_* variables (easiest for XAMPP and Hostinger,
 * no URL-encoding of special characters in passwords) or a single DATABASE_URL.
 */
export function dbConfigFromEnv(env = process.env): DbConfig {
  // On Windows "localhost" means both ::1 and 127.0.0.1; XAMPP's MySQL listens on 127.0.0.1 only.
  const host = (h?: string) => (!h || h === 'localhost' ? '127.0.0.1' : h);
  if (env.DB_NAME) {
    return {
      host: host(env.DB_HOST),
      port: Number(env.DB_PORT || 3306),
      user: env.DB_USER || 'root',
      password: env.DB_PASSWORD ?? '',
      database: env.DB_NAME,
    };
  }
  if (env.DATABASE_URL) {
    const u = new URL(env.DATABASE_URL);
    return {
      host: host(u.hostname), port: Number(u.port || 3306), user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password), database: u.pathname.slice(1),
    };
  }
  throw new Error('Database is not configured. Set DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD in .env');
}

/** Secrets copied from the examples, or too short, can be guessed: anyone knowing them could sign in as anyone. */
const EXAMPLE_SECRETS = new Set(['change-this-to-a-long-random-string-0123456789', 'paste-a-long-random-string-here', 'change-me', 'secret', 'generate-a-64-char-random-string']);
export function isWeakSecret(v: string | undefined) {
  return !v || v.length < 32 || EXAMPLE_SECRETS.has(v) || /change[-_ ]?(this|me)|paste[-_ ]a[-_ ]long|generate[-_ ]a[-_ ]/i.test(v);
}

let jwtSecret: string | null = null;
/**
 * The key that signs logins. A strong JWT_ACCESS_SECRET from .env is used as is. If it is missing or still the
 * example value, the app makes its own random key once and keeps it in the storage folder (never in the code or
 * the zip), and says so at start-up.
 */
function signingSecret(): string {
  if (jwtSecret) return jwtSecret;
  const fromEnv = process.env.JWT_ACCESS_SECRET;
  if (!isWeakSecret(fromEnv)) return (jwtSecret = fromEnv!);
  const dir = resolve(process.env.STORAGE_DIR || resolve(__dirname, '../../../storage'));
  const file = join(dir, '.jwt-secret');
  if (existsSync(file)) jwtSecret = readFileSync(file, 'utf8').trim();
  if (!jwtSecret || jwtSecret.length < 32) {
    mkdirSync(dir, { recursive: true });
    jwtSecret = randomBytes(48).toString('base64url');
    writeFileSync(file, jwtSecret, { mode: 0o600 });
  }
  if (process.env.NODE_ENV !== 'test') {
    console.warn(`\n  Security: JWT_ACCESS_SECRET in .env is ${fromEnv ? 'the example value or too short' : 'not set'}.`
      + `\n  Using a random key saved in ${file} instead. To set your own, put 40+ random characters in JWT_ACCESS_SECRET.\n`);
  }
  return jwtSecret;
}

export const config = {
  get db() { return dbConfigFromEnv(); },
  port: Number(process.env.PORT ?? 3000),
  appUrl: (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  get jwtAccessSecret() { return signingSecret(); },
  accessTokenTtlMin: Number(process.env.ACCESS_TOKEN_TTL_MIN ?? 15),
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30),
  // Secure cookies whenever the site runs on https, unless explicitly turned off.
  cookieSecure: process.env.COOKIE_SECURE === 'true' || (process.env.COOKIE_SECURE !== 'false' && /^https:/i.test(process.env.APP_URL ?? '')),
  autoMigrate: process.env.AUTO_MIGRATE !== 'false',
  apiDocs: process.env.API_DOCS === 'true',
  maxFailedLogins: 5,
  lockMinutes: 15,
  passwordResetTtlMin: 60,
};

/** App version (root package.json), shown by /api/v1/public/version and compared by the screens. */
export const APP_VERSION: string = (() => {
  for (const p of [resolve(__dirname, '../../../package.json'), resolve(process.cwd(), 'package.json')]) {
    try { const j = require(p); if (j.name === 'ems') return j.version; } catch { /* try next */ }
  }
  return 'unknown';
})();

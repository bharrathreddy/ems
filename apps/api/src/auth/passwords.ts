import { randomBytes, randomInt, createHash, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';

/**
 * Password hashing with Node's built-in scrypt (no native modules, so it installs on
 * Windows/XAMPP and Hostinger without compiling). Parameters are OWASP's equivalent
 * low-memory option N=2^14, r=8, p=5 (about 16 MB per hash instead of 128 MB), which
 * suits shared hosting memory limits. Parameters are stored in each hash, so they can be
 * raised later without breaking existing passwords. Format: scrypt$N$r$p$saltB64$hashB64
 */
const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const N = 2 ** 14, R = 8, P = 5, KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(plain, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(stored: string, plain: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  try {
    const key = await scrypt(plain, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM });
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

// Used to keep timing similar when the user does not exist.
let dummyHash: Promise<string> | null = null;
export const dummyVerify = async (plain: string) => {
  dummyHash ??= hashPassword('not-a-real-password-1');
  await verifyPassword(await dummyHash, plain);
  return false;
};

/** Readable temporary password: no 0/O/1/l/I, always has letters and digits. 10 chars. */
export function generateTempPassword(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const pool = letters + digits;
  const chars = [letters[randomInt(letters.length)], digits[randomInt(digits.length)]];
  while (chars.length < 10) chars.push(pool[randomInt(pool.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export const newToken = () => randomBytes(32).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export const passwordPolicy = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .max(128)
  .regex(/[A-Za-z]/, 'Include at least one letter.')
  .regex(/[0-9]/, 'Include at least one number.')
  .refine((v) => !['changeme@123', 'yourpass@123', 'password1', 'password@123', 'admin@123', 'welcome@123', 'school@123', '12345678a'].includes(v.toLowerCase()),
    'This password is too common. Choose another.');

/** Accepts 10-digit Indian mobiles with optional +91 / 91 / 0 prefix and spaces. Returns 10 digits or null. */
export function normalizeMobile(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  const ten = digits.length === 12 && digits.startsWith('91') ? digits.slice(2)
    : digits.length === 11 && digits.startsWith('0') ? digits.slice(1)
    : digits;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}

import type { Database } from '../database/database.module';
import { Errors } from './app-error';

export async function currentYear(db: Database) {
  const y = await db.selectFrom('academic_years').select(['id', 'name', 'start_date', 'end_date'])
    .where('is_current', '=', 1).executeTakeFirst();
  if (!y) throw Errors.badRequest('NO_CURRENT_YEAR', 'Set the current academic year first (Classes & years).');
  return y;
}

/** A specific year (or the current one). `forEdit` refuses closed years (they are read-only). */
export async function resolveYear(db: Database, yearId: number | undefined, forEdit: boolean) {
  const y = yearId
    ? await db.selectFrom('academic_years').select(['id', 'name', 'start_date', 'end_date', 'status', 'is_current']).where('id', '=', yearId).executeTakeFirst()
    : await db.selectFrom('academic_years').select(['id', 'name', 'start_date', 'end_date', 'status', 'is_current']).where('is_current', '=', 1).executeTakeFirst();
  if (!y) throw yearId ? Errors.notFound('Academic year') : Errors.badRequest('NO_CURRENT_YEAR', 'Set the current academic year first (Classes & years).');
  if (forEdit && y.status === 'closed') throw Errors.badRequest('YEAR_CLOSED', `${y.name} is closed and can no longer be changed.`);
  return y;
}

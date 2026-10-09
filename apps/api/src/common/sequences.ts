import type { Database } from '../database/database.module';

/**
 * Gapless counter row, locked for the rest of the transaction.
 * Lock first, insert only when missing: "INSERT IGNORE then SELECT FOR UPDATE" can deadlock
 * when several receipts are saved at the same moment.
 */
export async function takeNext(trx: Database, key: string, scope: string, init: { prefix: string; pad: number }) {
  const find = () => trx.selectFrom('number_sequences').select(['id', 'prefix', 'next_value', 'pad_length'])
    .where('seq_key', '=', key).where('scope_key', '=', scope).forUpdate().executeTakeFirst();
  let row = await find();
  if (!row) {
    try {
      await trx.insertInto('number_sequences').values({ seq_key: key, scope_key: scope, prefix: init.prefix, next_value: 1, pad_length: init.pad }).execute();
    } catch (e: any) {
      if (e?.code !== 'ER_DUP_ENTRY') throw e; // someone else created it first
    }
    row = (await find())!;
  }
  await trx.updateTable('number_sequences').set({ next_value: row.next_value + 1 }).where('id', '=', row.id).execute();
  return `${row.prefix}${String(row.next_value).padStart(row.pad_length, '0')}`;
}

/** Runs a transaction, retrying a few times if MySQL/MariaDB reports a deadlock or lock timeout. */
export async function withRetry<T>(db: Database, fn: (trx: Database) => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await db.transaction().execute(fn);
    } catch (e: any) {
      const retriable = e?.code === 'ER_LOCK_DEADLOCK' || e?.code === 'ER_LOCK_WAIT_TIMEOUT';
      if (!retriable || i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, 20 * i + Math.random() * 30));
    }
  }
}

import { Global, Module, OnModuleDestroy, Inject } from '@nestjs/common';
import { Kysely, MysqlDialect, type MysqlPool } from 'kysely';
import { createPool } from 'mysql2';
import { config, type DbConfig } from '../config';
import type { DB } from './db.types';

export const KYSELY = Symbol('KYSELY');
export type Database = Kysely<DB>;

export function createDatabase(db: DbConfig = config.db): Database {
  return new Kysely<DB>({
    dialect: new MysqlDialect({
      // mysql2's callback typings drift slightly from Kysely's interface; the runtime contract matches.
      pool: createPool({ ...db, connectionLimit: 10, timezone: 'Z', dateStrings: false, charset: 'utf8mb4' }) as unknown as MysqlPool,
    }),
  });
}

@Global()
@Module({
  providers: [{ provide: KYSELY, useFactory: () => createDatabase() }],
  exports: [KYSELY],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(KYSELY) private readonly db: Database) {}
  async onModuleDestroy() {
    await this.db.destroy();
  }
}

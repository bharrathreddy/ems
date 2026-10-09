import { Inject, Injectable } from '@nestjs/common';
import { KYSELY, type Database } from '../database/database.module';
import type { RequestUser } from './request-user';

export interface AuditEntry {
  module: string;
  action: string;
  entityType?: string;
  entityId?: number;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

/** Append-only audit trail (rule AU1). */
@Injectable()
export class AuditService {
  constructor(@Inject(KYSELY) private readonly db: Database) {}

  async log(actor: RequestUser | null, e: AuditEntry, trx: Database = this.db) {
    await trx
      .insertInto('audit_logs')
      .values({
        user_id: actor?.id ?? null,
        acting_user_id: actor?.actingUserId ?? null,
        workspace: actor ? (actor.isSuperAdmin && actor.workspace === 'staff' ? 'developer' : actor.workspace) : 'system',
        module_key: e.module,
        action: e.action,
        entity_type: e.entityType ?? null,
        entity_id: e.entityId ?? null,
        before_data: e.before === undefined ? null : JSON.stringify(e.before),
        after_data: e.after === undefined ? null : JSON.stringify(e.after),
        ip_address: e.ip ?? null,
        user_agent: e.userAgent ?? null,
      })
      .execute();
  }
}

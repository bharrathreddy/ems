import { Body, Controller, Get, Inject, Param, ParseIntPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { KYSELY, type Database } from '../database/database.module';
import { sql } from 'kysely';
import { Errors } from '../common/app-error';
import { ZodPipe } from '../common/zod.pipe';
import { AuditService } from '../common/audit.service';
import { clientMeta, CurrentUser, type AppRequest, type RequestUser } from '../common/request-user';
import { RequirePermission } from '../permissions/permission.guard';

const STATUSES = ['new', 'contacted', 'visit', 'admitted', 'closed'] as const;
type Status = (typeof STATUSES)[number];
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-06-15.');
const Update = z.object({ status: z.enum(STATUSES).optional(), followUpOn: date.nullish(), note: z.string().trim().max(1000).optional() })
  .refine((b) => b.status !== undefined || b.followUpOn !== undefined || !!b.note, 'Nothing to change.');
const iso = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** Admission enquiries: every message from the website contact form, followed up to admission. */
@ApiTags('Enquiries')
@ApiBearerAuth()
@Controller('enquiries')
export class EnquiriesController {
  constructor(@Inject(KYSELY) private readonly db: Database, private readonly audit: AuditService) {}

  @Get() @RequirePermission('enquiries', 'view')
  async list(@Query('status') status?: string, @Query('q') q?: string) {
    let rows = this.db.selectFrom('contact_messages as m').leftJoin('users as u', 'u.id', 'm.updated_by')
      .select(['m.id', 'm.name', 'm.mobile', 'm.message', 'm.status', 'm.seen_at', 'm.follow_up_on', 'm.created_at', 'm.updated_at', 'u.name as updated_by_name',
        (eb) => eb.selectFrom('enquiry_notes as n').select((x) => x.fn.countAll<number>().as('c')).whereRef('n.message_id', '=', 'm.id').as('notes')])
      .orderBy('m.id', 'desc').limit(300);
    if (status === 'open') rows = rows.where('m.status', 'in', ['new', 'contacted', 'visit']);
    else if (STATUSES.includes(status as Status)) rows = rows.where('m.status', '=', status as Status);
    if (q?.trim()) { const t = `%${q.trim()}%`; rows = rows.where((eb) => eb.or([eb('m.name', 'like', t), eb('m.mobile', 'like', t), eb('m.message', 'like', t)])); }
    const counts = await this.db.selectFrom('contact_messages').select(['status', (eb) => eb.fn.countAll<number>().as('n')]).groupBy('status').execute();
    const unseen = await this.db.selectFrom('contact_messages').select((eb) => eb.fn.countAll<number>().as('n')).where('seen_at', 'is', null).executeTakeFirstOrThrow();
    return {
      counts: Object.fromEntries(STATUSES.map((s) => [s, Number(counts.find((c) => c.status === s)?.n ?? 0)])), unseen: Number(unseen.n),
      rows: (await rows.execute()).map((r) => ({ id: r.id, name: r.name, mobile: r.mobile, message: r.message, status: r.status, seen: !!r.seen_at, followUpOn: iso(r.follow_up_on),
        createdAt: r.created_at, updatedAt: r.updated_at, updatedBy: r.updated_by_name, notes: Number(r.notes ?? 0) })),
    };
  }

  @Get(':id') @RequirePermission('enquiries', 'view')
  async one(@Param('id', ParseIntPipe) id: number) {
    const m = await this.db.selectFrom('contact_messages').selectAll().where('id', '=', id).executeTakeFirst();
    if (!m) throw Errors.notFound('Enquiry');
    if (!m.seen_at) await this.db.updateTable('contact_messages').set({ seen_at: new Date() }).where('id', '=', id).execute();
    const notes = await this.db.selectFrom('enquiry_notes as n').leftJoin('users as u', 'u.id', 'n.created_by').select(['n.id', 'n.note', 'n.status_to', 'n.created_at', 'u.name as by'])
      .where('n.message_id', '=', id).orderBy('n.id', 'desc').execute();
    return { id: m.id, name: m.name, mobile: m.mobile, message: m.message, status: m.status, followUpOn: iso(m.follow_up_on), createdAt: m.created_at,
      notes: notes.map((n) => ({ id: n.id, note: n.note, statusTo: n.status_to, at: n.created_at, by: n.by })) };
  }

  /** Move along the pipeline, set a follow-up date and/or add a note (each change is kept in the history). */
  @Patch(':id') @RequirePermission('enquiries', 'manage')
  async update(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(Update)) b: z.infer<typeof Update>, @Req() req: AppRequest) {
    const m = await this.db.selectFrom('contact_messages').select(['id', 'status', 'follow_up_on']).where('id', '=', id).executeTakeFirst();
    if (!m) throw Errors.notFound('Enquiry');
    const statusChanged = b.status !== undefined && b.status !== m.status;
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('contact_messages').set({
        ...(b.status ? { status: b.status } : {}), ...(b.followUpOn !== undefined ? { follow_up_on: b.followUpOn ? new Date(`${b.followUpOn}T00:00:00Z`) : null } : {}),
        seen_at: sql`COALESCE(seen_at, NOW(3))` as any, updated_by: u.id, updated_at: new Date(),
      }).where('id', '=', id).execute();
      if (b.note || statusChanged) await trx.insertInto('enquiry_notes').values({ message_id: id, note: b.note || '', status_to: statusChanged ? b.status! : null, created_by: u.id }).execute();
      await this.audit.log(u, { module: 'enquiries', action: 'update', entityType: 'enquiry', entityId: id, before: { status: m.status, followUpOn: iso(m.follow_up_on) }, after: b, ...clientMeta(req) }, trx);
    });
    return this.one(id);
  }
}

import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { readJson } from '../common/json';
import type { RequestUser } from '../common/request-user';
import { MailService } from '../mail/mail.service';
import { PermissionsService } from '../permissions/permissions.service';
import { addDays, iso, schoolToday } from '../attendance/calendar';
import { formatINR, toPaise } from './money';

export interface ReminderSettings { enabled: boolean; daysBefore: number; overdueEveryDays: number }
const DEFAULTS: ReminderSettings = { enabled: false, daysBefore: 3, overdueEveryDays: 7 };
const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * Fee due reminders by email (requirements 9.9: due dates drive reminders; no late fine).
 * Off until the admin switches it on. Runs once a day after 9 am school time: one email per family per
 * student listing what falls due in N days, and a reminder for overdue fees at most every M days.
 * Families without an email are skipped and counted, so the office can use WhatsApp instead.
 */
@Injectable()
export class FeeRemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('FeeReminders');
  private timer?: NodeJS.Timeout;
  constructor(@Inject(KYSELY) private readonly db: Database, private readonly mail: MailService, private readonly perms: PermissionsService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.REMINDER_WORKER === 'off') return;
    this.timer = setInterval(() => void this.daily().catch((e) => this.logger.error(e?.message ?? e)), 30 * 60_000);
    setTimeout(() => void this.daily().catch(() => undefined), 60_000);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async getSetting<T>(key: string): Promise<T | null> {
    const r = await this.db.selectFrom('settings').select('value').where('setting_group', '=', 'fees').where('setting_key', '=', key).executeTakeFirst();
    return readJson<T>(r?.value);
  }
  private async putSetting(key: string, value: unknown, by: number | null = null) {
    await this.db.insertInto('settings').values({ setting_group: 'fees', setting_key: key, value: JSON.stringify(value), updated_by: by })
      .onDuplicateKeyUpdate({ value: JSON.stringify(value), updated_by: by }).execute();
  }

  async settings() {
    const s = { ...DEFAULTS, ...(await this.getSetting<ReminderSettings>('reminders')) };
    const last = await this.getSetting<{ date: string; result: unknown }>('reminders_last_run');
    const noEmail = await this.db.selectFrom('fee_items as i').innerJoin('students as st', 'st.id', 'i.student_id').innerJoin('families as f', 'f.id', 'st.family_id')
      .select((eb) => eb.fn.count<number>('st.id').distinct().as('n')).where('i.balance', '>', '0').where('st.status', '=', 'active')
      .where((eb) => eb.or([eb('f.email', 'is', null), eb('f.email', '=', '')])).executeTakeFirst();
    const smtp = await this.db.selectFrom('institution_settings').select('smtp_config').where('id', '=', 1).executeTakeFirst();
    return { ...s, lastRun: last, studentsWithDuesWithoutEmail: Number(noEmail?.n ?? 0), emailConfigured: !!readJson<{ host?: string }>(smtp?.smtp_config)?.host };
  }

  async saveSettings(u: RequestUser, s: ReminderSettings) {
    await this.putSetting('reminders', s, u.id);
    return this.settings();
  }

  /** Runs at most once per school day, after 9 am. */
  async daily() {
    const s = { ...DEFAULTS, ...(await this.getSetting<ReminderSettings>('reminders')) };
    if (!s.enabled || !(await this.perms.isModuleEnabled('fees'))) return;
    const tz = (await this.db.selectFrom('institution_settings').select('timezone').where('id', '=', 1).executeTakeFirst())?.timezone || 'Asia/Kolkata';
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date()));
    const today = await schoolToday(this.db);
    const last = await this.getSetting<{ date: string }>('reminders_last_run');
    if (hour < 9 || last?.date === today) return;
    const result = await this.run(today);
    this.logger.log(`Fee reminders ${today}: ${result.emails} emails, ${result.noEmail} parents without email`);
  }

  private async school() {
    return this.db.selectFrom('institution_settings').select(['name', 'phone']).where('id', '=', 1).executeTakeFirstOrThrow();
  }

  /** Unpaid items per active student with their family's contact. */
  private dueItems(studentIds?: number[]) {
    let q = this.db.selectFrom('fee_items as i').innerJoin('students as st', 'st.id', 'i.student_id').innerJoin('families as f', 'f.id', 'st.family_id').innerJoin('academic_years as y', 'y.id', 'i.academic_year_id')
      .leftJoin('enrollments as e', (j) => j.onRef('e.student_id', '=', 'st.id').on('e.academic_year_id', '=', this.db.selectFrom('academic_years').select('id').where('is_current', '=', 1).limit(1)))
      .leftJoin('sections as sec', 'sec.id', 'e.section_id').leftJoin('classes as c', 'c.id', 'sec.class_id')
      .select(['st.id as student_id', 'st.first_name', 'st.last_name', 'f.email', 'f.father_name', 'f.family_name', 'c.name as class_name', 'sec.name as section',
        'i.label', 'i.due_date', 'i.balance', 'y.name as year', 'y.is_current'])
      .where('i.balance', '>', '0').where('st.status', '=', 'active');
    if (studentIds) q = q.where('st.id', 'in', studentIds.length ? studentIds : [0]);
    return q.orderBy('st.id').orderBy('i.due_date').execute();
  }

  private async queue(student: Awaited<ReturnType<FeeRemindersService['dueItems']>>, items: typeof student, school: { name: string; phone: string | null }) {
    const s = items[0];
    const lines = items.map((i) => `${i.label}${i.is_current ? '' : ` (${i.year})`}: ${formatINR(toPaise(i.balance))}${i.due_date ? `  ·  due ${fmt(iso(i.due_date)!)}` : ''}`);
    const total = items.reduce((t, i) => t + toPaise(i.balance), 0);
    await this.mail.queueTemplate(s.email!, 'fee_reminder', {
      parent: s.father_name || s.family_name, student: [s.first_name, s.last_name].filter(Boolean).join(' '), class: [s.class_name, s.section].filter(Boolean).join(' ') || 'previous class',
      items: lines.join('\n'), total: formatINR(total), school: school.name, phone: school.phone ?? '',
    });
    return total;
  }

  /** The automatic run (also "Send now" in settings). */
  async run(today: string) {
    const s = { ...DEFAULTS, ...(await this.getSetting<ReminderSettings>('reminders')) };
    const school = await this.school();
    const soon = addDays(today, s.daysBefore);
    const rows = await this.dueItems();
    const byStudent = new Map<number, typeof rows>();
    for (const r of rows) byStudent.set(r.student_id, [...(byStudent.get(r.student_id) ?? []), r]);
    const logs = await this.db.selectFrom('fee_reminder_log').select(['student_id', 'kind', 'due_date', 'sent_on']).where('sent_on', '>=', new Date(`${addDays(today, -60)}T00:00:00Z`)).execute();
    let emails = 0, noEmail = 0;
    for (const [sid, items] of byStudent) {
      const upcoming = items.filter((i) => i.due_date && iso(i.due_date) === soon);
      const overdue = items.filter((i) => i.due_date && iso(i.due_date)! < today);
      const mine = logs.filter((l) => l.student_id === sid);
      const sendUpcoming = upcoming.length > 0 && !mine.some((l) => l.kind === 'before_due' && iso(l.due_date) === soon);
      const lastOverdue = mine.filter((l) => l.kind === 'overdue' || l.kind === 'manual').map((l) => iso(l.sent_on)!).sort().pop();
      const sendOverdue = overdue.length > 0 && (!lastOverdue || lastOverdue <= addDays(today, -s.overdueEveryDays));
      if (!sendUpcoming && !sendOverdue) continue;
      if (!items[0].email) { noEmail++; continue; }
      const list = [...(sendOverdue ? overdue : []), ...(sendUpcoming ? upcoming : [])];
      const amount = await this.queue(items, list, school);
      await this.db.insertInto('fee_reminder_log').values({ student_id: sid, kind: sendOverdue ? 'overdue' : 'before_due', due_date: sendUpcoming ? new Date(`${soon}T00:00:00Z`) : null,
        sent_on: new Date(`${today}T00:00:00Z`), to_email: items[0].email!, amount: (amount / 100).toFixed(2) }).execute();
      if (sendOverdue && sendUpcoming) await this.db.insertInto('fee_reminder_log').values({ student_id: sid, kind: 'before_due', due_date: new Date(`${soon}T00:00:00Z`), sent_on: new Date(`${today}T00:00:00Z`), to_email: items[0].email!, amount: '0' }).execute();
      emails++;
    }
    const result = { emails, noEmail };
    await this.putSetting('reminders_last_run', { date: today, result });
    return result;
  }

  /** "Email reminder" for one student from the dues list: everything unpaid. */
  async sendOne(u: RequestUser, studentPublicId: string) {
    const st = await this.db.selectFrom('students').select('id').where('public_id', '=', studentPublicId).executeTakeFirst();
    if (!st) throw Errors.notFound('Student');
    const items = await this.dueItems([st.id]);
    if (!items.length) throw Errors.badRequest('NOTHING_DUE', 'This student has nothing due.');
    if (!items[0].email) throw Errors.badRequest('NO_EMAIL', 'The parent has no email address. Add it on the student’s Parents tab, or send a WhatsApp reminder.');
    const today = await schoolToday(this.db);
    const amount = await this.queue(items, items, await this.school());
    await this.db.insertInto('fee_reminder_log').values({ student_id: st.id, kind: 'manual', sent_on: new Date(`${today}T00:00:00Z`), to_email: items[0].email, amount: (amount / 100).toFixed(2), sent_by: u.id }).execute();
    return { sentTo: items[0].email, amount: amount / 100 };
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import ExcelJS from 'exceljs';
import { KYSELY, type Database } from '../database/database.module';
import { currentYear } from '../common/academic-year';
import { FeeAccountsService } from './fee-accounts.service';
import { toPaise } from './money';

const r2 = (p: number) => Math.round(p) / 100;

/** Finance reports (requirements 9.11). Amounts returned in rupees. */
@Injectable()
export class FeeReportsService {
  constructor(@Inject(KYSELY) private readonly db: Database, private readonly accounts: FeeAccountsService) {}

  async summary() {
    const year = await currentYear(this.db);
    await this.accounts.syncYear(year.id);
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = `${today.slice(0, 7)}-01`;
    const [todayRow, monthRow, due] = await Promise.all([
      this.db.selectFrom('payments').select((eb) => [eb.fn.sum<string>('total_amount').as('sum'), eb.fn.countAll<number>().as('n')])
        .where('status', '=', 'valid').where('receipt_type', '=', 'regular').where('payment_date', '=', new Date(`${today}T00:00:00Z`)).executeTakeFirst(),
      this.db.selectFrom('payments').select((eb) => eb.fn.sum<string>('total_amount').as('sum'))
        .where('status', '=', 'valid').where('receipt_type', '=', 'regular').where('payment_date', '>=', new Date(`${monthStart}T00:00:00Z`)).executeTakeFirst(),
      this.db.selectFrom('fee_items as i').innerJoin('students as s', 's.id', 'i.student_id')
        .select([
          sql<string>`SUM(i.balance)`.as('outstanding'),
          sql<string>`SUM(CASE WHEN i.due_date < CURRENT_DATE() THEN i.balance ELSE 0 END)`.as('overdue'),
          sql<number>`COUNT(DISTINCT CASE WHEN i.balance > 0 AND i.due_date < CURRENT_DATE() THEN i.student_id END)`.as('overdueStudents'),
        ]).where('s.status', '=', 'active').executeTakeFirst(),
    ]);
    return {
      academicYear: year.name,
      today: { amount: r2(toPaise(todayRow?.sum)), receipts: Number(todayRow?.n ?? 0) },
      thisMonth: r2(toPaise(monthRow?.sum)),
      outstanding: r2(toPaise(due?.outstanding)), overdue: r2(toPaise(due?.overdue)), overdueStudents: Number(due?.overdueStudents ?? 0),
    };
  }

  async collection(from: string, to: string) {
    const rows = await this.db.selectFrom('payments as p').innerJoin('students as s', 's.id', 'p.student_id').innerJoin('users as u', 'u.id', 'p.collected_by')
      .leftJoin('enrollments as e', (j) => j.onRef('e.student_id', '=', 's.id').onRef('e.academic_year_id', '=', 'p.academic_year_id'))
      .leftJoin('classes as c', 'c.id', 'e.class_id').leftJoin('sections as sec', 'sec.id', 'e.section_id')
      .select(['p.public_id', 'p.receipt_no', 'p.receipt_type', 'p.payment_date', 'p.total_amount', 'p.method', 'p.reference_no', 'p.status', 'p.void_reason',
        'u.name as collected_by', 's.public_id as student_id', 's.first_name', 's.last_name', 's.admission_no', 'c.name as class_name', 'sec.name as section_name'])
      .where('p.payment_date', '>=', new Date(`${from}T00:00:00Z`)).where('p.payment_date', '<=', new Date(`${to}T00:00:00Z`))
      .orderBy('p.payment_date', 'desc').orderBy('p.id', 'desc').execute();
    const valid = rows.filter((r) => r.status === 'valid' && r.receipt_type === 'regular');
    const byMethod: Record<string, number> = {};
    const byCollector: Record<string, number> = {};
    for (const r of valid) {
      byMethod[r.method] = (byMethod[r.method] ?? 0) + toPaise(r.total_amount);
      byCollector[r.collected_by] = (byCollector[r.collected_by] ?? 0) + toPaise(r.total_amount);
    }
    return {
      from, to,
      total: r2(valid.reduce((t, r) => t + toPaise(r.total_amount), 0)),
      count: valid.length,
      byMethod: Object.fromEntries(Object.entries(byMethod).map(([k, v]) => [k, r2(v)])),
      byCollector: Object.fromEntries(Object.entries(byCollector).map(([k, v]) => [k, r2(v)])),
      voided: rows.filter((r) => r.status === 'void').length,
      receipts: rows,
    };
  }

  /** Who owes what (current year + previous years), per student. */
  async outstanding(q: { classId?: number; sectionId?: number; overdueOnly?: boolean; search?: string }) {
    const year = await currentYear(this.db);
    await this.accounts.syncYear(year.id);
    let qb = this.db.selectFrom('students as s').innerJoin('families as f', 'f.id', 's.family_id')
      .innerJoin('fee_items as i', 'i.student_id', 's.id')
      .leftJoin('enrollments as e', (j) => j.onRef('e.student_id', '=', 's.id').on('e.academic_year_id', '=', year.id))
      .leftJoin('classes as c', 'c.id', 'e.class_id').leftJoin('sections as sec', 'sec.id', 'e.section_id')
      .select([
        's.public_id', 's.first_name', 's.last_name', 's.admission_no', 'c.name as class_name', 'c.level_order', 'sec.name as section_name', 'e.roll_no',
        'f.father_name', 'f.family_name', 'f.primary_mobile',
        sql<string>`SUM(CASE WHEN i.academic_year_id = ${year.id} AND i.category = 'tuition' THEN i.balance ELSE 0 END)`.as('tuition'),
        sql<string>`SUM(CASE WHEN i.academic_year_id = ${year.id} AND i.category = 'bus' THEN i.balance ELSE 0 END)`.as('bus'),
        sql<string>`SUM(CASE WHEN i.academic_year_id = ${year.id} AND i.category = 'one_time' THEN i.balance ELSE 0 END)`.as('one_time'),
        sql<string>`SUM(CASE WHEN i.academic_year_id <> ${year.id} THEN i.balance ELSE 0 END)`.as('previous'),
        sql<string>`SUM(CASE WHEN i.due_date < CURRENT_DATE() THEN i.balance ELSE 0 END)`.as('overdue'),
        sql<string>`SUM(i.balance)`.as('total'),
      ])
      .where('s.status', '=', 'active')
      .groupBy(['s.id', 's.public_id', 's.first_name', 's.last_name', 's.admission_no', 'c.name', 'c.level_order', 'sec.name', 'e.roll_no', 'f.father_name', 'f.family_name', 'f.primary_mobile'])
      .having(sql<boolean>`SUM(i.balance) > 0`);
    if (q.classId) qb = qb.where('e.class_id', '=', q.classId);
    if (q.sectionId) qb = qb.where('e.section_id', '=', q.sectionId);
    if (q.overdueOnly) qb = qb.having(sql<boolean>`SUM(CASE WHEN i.due_date < CURRENT_DATE() THEN i.balance ELSE 0 END) > 0`);
    if (q.search) {
      const like = `%${q.search}%`;
      qb = qb.where((eb) => eb.or([eb('s.first_name', 'like', like), eb('s.last_name', 'like', like), eb('s.admission_no', 'like', like), eb('f.primary_mobile', 'like', like)]));
    }
    const rows = await qb.orderBy('c.level_order').orderBy('sec.name').orderBy(sql`CAST(e.roll_no AS UNSIGNED)`).orderBy('s.first_name').execute();
    const out = rows.map((r) => ({
      ...r, tuition: r2(toPaise(r.tuition)), bus: r2(toPaise(r.bus)), one_time: r2(toPaise(r.one_time)),
      previous: r2(toPaise(r.previous)), overdue: r2(toPaise(r.overdue)), total: r2(toPaise(r.total)),
    }));
    return { academicYear: year.name, students: out.length, total: r2(out.reduce((t, r) => t + Math.round(r.total * 100), 0)), rows: out };
  }

  async outstandingXlsx(q: Parameters<FeeReportsService['outstanding']>[0]) {
    const d = await this.outstanding(q);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`Dues ${d.academicYear}`);
    ws.columns = [
      { header: 'Adm No', key: 'admission_no', width: 10 }, { header: 'Student', key: 'name', width: 24 }, { header: 'Class', key: 'cls', width: 12 },
      { header: 'Roll', key: 'roll_no', width: 6 }, { header: 'Parent', key: 'parent', width: 22 }, { header: 'Mobile', key: 'primary_mobile', width: 13 },
      { header: 'Tuition', key: 'tuition', width: 11 }, { header: 'Bus', key: 'bus', width: 10 }, { header: 'One-time', key: 'one_time', width: 10 },
      { header: 'Previous years', key: 'previous', width: 13 }, { header: 'Overdue', key: 'overdue', width: 11 }, { header: 'Total due', key: 'total', width: 12 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const r of d.rows) ws.addRow({ ...r, name: [r.first_name, r.last_name].filter(Boolean).join(' '), cls: `${r.class_name ?? ''} ${r.section_name ?? ''}`.trim(), parent: r.father_name || r.family_name });
    ws.addRow({ name: 'Total', total: d.total }).font = { bold: true };
    for (const k of ['tuition', 'bus', 'one_time', 'previous', 'overdue', 'total']) ws.getColumn(k).numFmt = '#,##,##0';
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async collectionXlsx(from: string, to: string) {
    const d = await this.collection(from, to);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Collection');
    ws.columns = [
      { header: 'Date', key: 'date', width: 12 }, { header: 'Receipt', key: 'receipt_no', width: 22 }, { header: 'Student', key: 'name', width: 24 },
      { header: 'Adm No', key: 'admission_no', width: 10 }, { header: 'Class', key: 'cls', width: 12 }, { header: 'Method', key: 'method', width: 12 },
      { header: 'Reference', key: 'reference_no', width: 16 }, { header: 'Amount', key: 'amount', width: 12 }, { header: 'Status', key: 'status', width: 10 },
      { header: 'Collected by', key: 'collected_by', width: 18 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const r of d.receipts) ws.addRow({ ...r, date: new Date(r.payment_date).toISOString().slice(0, 10), name: [r.first_name, r.last_name].filter(Boolean).join(' '),
      cls: `${r.class_name ?? ''} ${r.section_name ?? ''}`.trim(), amount: r2(toPaise(r.total_amount)), status: r.status === 'void' ? 'VOID' : r.receipt_type === 'opening_balance' ? 'Opening' : 'Valid' });
    ws.addRow({ name: 'Total (valid receipts)', amount: d.total }).font = { bold: true };
    ws.getColumn('amount').numFmt = '#,##,##0.00';
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}

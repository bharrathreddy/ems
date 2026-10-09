import { Inject, Injectable } from '@nestjs/common';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import { newPublicId } from '../common/ids';
import { resolveYear } from '../common/academic-year';
import { withRetry } from '../common/sequences';
import type { RequestUser } from '../common/request-user';
import { iso, schoolToday } from '../attendance/calendar';
import { visibleStudentId } from '../students/student-scope';
import { ExpensesService, type Method } from '../payroll/expenses.service';
import { toDb, toPaise } from '../fees/money';

type Meta = { ip: string | null; userAgent: string | null };
export interface VehicleBody { regNo: string; name?: string | null; seats?: number | null; driverStaffId?: string | null; helperName?: string | null; helperMobile?: string | null; isActive?: boolean; notes?: string | null }
export interface StopBody { id?: number | null; name: string; landmark?: string | null; pickupTime?: string | null; dropTime?: string | null }
export interface LogBody { vehicleId: number; kind: 'fuel' | 'service'; date: string; odometer?: number | null; litres?: number | null; amount: number; vendor?: string | null; description?: string | null; method: Method; reference?: string | null }

const hhmm = (t: string | null | undefined) => (t ? String(t).slice(0, 5) : null);
const fullName = (f: string, l: string | null) => [f, l].filter(Boolean).join(' ');

@Injectable()
export class TransportService {
  constructor(@Inject(KYSELY) private readonly db: Database, private readonly audit: AuditService, private readonly expenses: ExpensesService) {}

  private async myStaffId(u: RequestUser) {
    return (await this.db.selectFrom('staff').select('id').where('user_id', '=', u.id).executeTakeFirst())?.id ?? null;
  }

  /** Route ids this user may see: all, or (drivers) the routes of the vehicle they drive. */
  private async visibleRouteIds(u: RequestUser): Promise<number[] | 'all'> {
    const scope = u.permissions.get('transport.view');
    if (scope === 'all') return 'all';
    if (scope !== 'assigned_route') return [];
    const sid = await this.myStaffId(u);
    if (!sid) return [];
    const rows = await this.db.selectFrom('bus_routes as r').innerJoin('vehicles as v', 'v.id', 'r.vehicle_id').select('r.id').where('v.driver_staff_id', '=', sid).execute();
    return rows.map((r) => r.id);
  }

  // ---------- Vehicles ----------
  async vehicles() {
    const rows = await this.db.selectFrom('vehicles as v').leftJoin('staff as s', 's.id', 'v.driver_staff_id').leftJoin('users as us', 'us.id', 's.user_id')
      .select(['v.id', 'v.reg_no', 'v.name', 'v.seats', 'v.helper_name', 'v.helper_mobile', 'v.is_active', 'v.notes', 's.public_id as driver_id', 'us.name as driver_name', 'us.mobile as driver_mobile'])
      .orderBy('v.is_active', 'desc').orderBy('v.reg_no').execute();
    const routes = await this.db.selectFrom('bus_routes').select(['id', 'name', 'vehicle_id']).where('vehicle_id', 'is not', null).execute();
    return rows.map((v) => ({
      id: v.id, regNo: v.reg_no, name: v.name, seats: v.seats, helperName: v.helper_name, helperMobile: v.helper_mobile, isActive: !!v.is_active, notes: v.notes,
      driver: v.driver_id ? { id: v.driver_id, name: v.driver_name!, mobile: v.driver_mobile } : null,
      routes: routes.filter((r) => r.vehicle_id === v.id).map((r) => r.name),
    }));
  }

  /** Active staff to choose a driver from; people with the Driver role first. */
  async driverOptions() {
    const rows = await this.db.selectFrom('staff as s').innerJoin('users as us', 'us.id', 's.user_id')
      .leftJoin((eb) => eb.selectFrom('user_roles as ur').innerJoin('roles as ro', 'ro.id', 'ur.role_id').select('ur.user_id').where('ro.role_key', '=', 'driver').as('d'), (j) => j.onRef('d.user_id', '=', 'us.id'))
      .select(['s.public_id', 'us.name', 'us.mobile', 's.employee_code', 's.designation', 'd.user_id as is_driver'])
      .where('s.status', '=', 'active').where('s.deleted_at', 'is', null).orderBy('us.name').execute();
    return rows.map((r) => ({ id: r.public_id, name: r.name, mobile: r.mobile, code: r.employee_code, designation: r.designation, isDriver: !!r.is_driver }))
      .sort((a, b) => Number(b.isDriver) - Number(a.isDriver) || a.name.localeCompare(b.name));
  }

  async saveVehicle(u: RequestUser, id: number | null, b: VehicleBody, meta: Meta) {
    const regNo = b.regNo.toUpperCase().replace(/\s+/g, ' ').trim();
    const dup = await this.db.selectFrom('vehicles').select('id').where('reg_no', '=', regNo).executeTakeFirst();
    if (dup && dup.id !== id) throw Errors.validation([{ field: 'regNo', message: 'This vehicle is already added.' }]);
    let driverId: number | null = null;
    if (b.driverStaffId) {
      const s = await this.db.selectFrom('staff').select(['id', 'status']).where('public_id', '=', b.driverStaffId).executeTakeFirst();
      if (!s || s.status !== 'active') throw Errors.validation([{ field: 'driverStaffId', message: 'Choose an active staff member.' }]);
      driverId = s.id;
    }
    const row = { reg_no: regNo, name: b.name || null, seats: b.seats ?? null, driver_staff_id: driverId, helper_name: b.helperName || null, helper_mobile: b.helperMobile || null, notes: b.notes || null, is_active: b.isActive === false ? 0 : 1 };
    if (id) {
      if (!(await this.db.selectFrom('vehicles').select('id').where('id', '=', id).executeTakeFirst())) throw Errors.notFound('Vehicle');
      await this.db.updateTable('vehicles').set(row).where('id', '=', id).execute();
      if (b.isActive === false) await this.db.updateTable('bus_routes').set({ vehicle_id: null }).where('vehicle_id', '=', id).execute();
    } else id = Number((await this.db.insertInto('vehicles').values(row).executeTakeFirstOrThrow()).insertId);
    await this.audit.log(u, { module: 'transport', action: 'save_vehicle', entityType: 'vehicle', entityId: id, after: row, ...meta });
    return this.vehicles();
  }

  // ---------- Routes and stops ----------
  async routes(u: RequestUser) {
    const ids = await this.visibleRouteIds(u);
    if (ids !== 'all' && !ids.length) return { year: null, routes: [] };
    const year = await resolveYear(this.db, undefined, false);
    let q = this.db.selectFrom('bus_routes as r').leftJoin('vehicles as v', 'v.id', 'r.vehicle_id').leftJoin('staff as s', 's.id', 'v.driver_staff_id').leftJoin('users as us', 'us.id', 's.user_id')
      .select(['r.id', 'r.name', 'r.is_active', 'v.id as vehicle_id', 'v.reg_no', 'us.name as driver_name', 'us.mobile as driver_mobile', 'v.helper_name', 'v.helper_mobile', 'v.seats']);
    if (ids !== 'all') q = q.where('r.id', 'in', ids);
    const routes = await q.orderBy('r.is_active', 'desc').orderBy('r.name').execute();
    if (!routes.length) return { year: { id: year.id, name: year.name }, routes: [] };
    const rids = routes.map((r) => r.id);
    const stops = await this.db.selectFrom('route_stops').selectAll().where('bus_route_id', 'in', rids).where('is_active', '=', 1).orderBy('sort_order').orderBy('id').execute();
    const counts = await this.db.selectFrom('student_fee_accounts as a').innerJoin('students as st', 'st.id', 'a.student_id')
      .leftJoin('student_stops as ss', (j) => j.onRef('ss.student_id', '=', 'a.student_id').onRef('ss.academic_year_id', '=', 'a.academic_year_id'))
      .select(['a.bus_route_id', 'ss.route_stop_id']).where('a.academic_year_id', '=', year.id).where('a.bus_route_id', 'in', rids).where('st.status', '=', 'active').execute();
    return {
      year: { id: year.id, name: year.name },
      routes: routes.map((r) => {
        const mine = counts.filter((c) => c.bus_route_id === r.id);
        const rs = stops.filter((s) => s.bus_route_id === r.id);
        return {
          id: r.id, name: r.name, isActive: !!r.is_active, students: mine.length, withoutStop: mine.filter((c) => !c.route_stop_id || !rs.some((s) => s.id === c.route_stop_id)).length,
          vehicle: r.vehicle_id ? { id: r.vehicle_id, regNo: r.reg_no!, seats: r.seats, driverName: r.driver_name, driverMobile: r.driver_mobile, helperName: r.helper_name, helperMobile: r.helper_mobile } : null,
          stops: rs.map((s) => ({ id: s.id, name: s.name, landmark: s.landmark, pickupTime: hhmm(s.pickup_time as any), dropTime: hhmm(s.drop_time as any), students: mine.filter((c) => c.route_stop_id === s.id).length })),
        };
      }),
    };
  }

  async setRouteVehicle(u: RequestUser, routeId: number, vehicleId: number | null, meta: Meta) {
    const r = await this.db.selectFrom('bus_routes').select('id').where('id', '=', routeId).executeTakeFirst();
    if (!r) throw Errors.notFound('Route');
    if (vehicleId) {
      const v = await this.db.selectFrom('vehicles').select('is_active').where('id', '=', vehicleId).executeTakeFirst();
      if (!v || !v.is_active) throw Errors.validation([{ field: 'vehicleId', message: 'Choose an active vehicle.' }]);
    }
    await this.db.updateTable('bus_routes').set({ vehicle_id: vehicleId }).where('id', '=', routeId).execute();
    await this.audit.log(u, { module: 'transport', action: 'route_vehicle', entityType: 'bus_route', entityId: routeId, after: { vehicleId }, ...meta });
    return this.routes(u);
  }

  /** Replaces the stop list of a route (order = list order). A stop students use this year cannot be removed. */
  async saveStops(u: RequestUser, routeId: number, list: StopBody[], meta: Meta) {
    const r = await this.db.selectFrom('bus_routes').select('id').where('id', '=', routeId).executeTakeFirst();
    if (!r) throw Errors.notFound('Route');
    const names = list.map((s) => s.name.toLowerCase());
    const dupAt = names.findIndex((n, i) => names.indexOf(n) !== i);
    if (dupAt >= 0) throw Errors.validation([{ field: `stops.${dupAt}.name`, message: 'Two stops have the same name.' }]);
    const year = await resolveYear(this.db, undefined, false);
    await this.db.transaction().execute(async (trx) => {
      const existing = await trx.selectFrom('route_stops').select(['id', 'name']).where('bus_route_id', '=', routeId).where('is_active', '=', 1).execute();
      const keep = new Set(list.filter((s) => s.id).map((s) => s.id!));
      for (const s of list) if (s.id && !existing.some((e) => e.id === s.id)) throw Errors.validation([{ field: 'stops', message: 'A stop in the list belongs to another route. Reload and try again.' }]);
      for (const gone of existing.filter((e) => !keep.has(e.id))) {
        const usedNow = await trx.selectFrom('student_stops').select('student_id').where('route_stop_id', '=', gone.id).where('academic_year_id', '=', year.id).executeTakeFirst();
        if (usedNow) throw Errors.badRequest('STOP_IN_USE', `Students use "${gone.name}" this year. Move them to another stop first.`);
        const usedEver = await trx.selectFrom('student_stops').select('student_id').where('route_stop_id', '=', gone.id).executeTakeFirst();
        if (usedEver) await trx.updateTable('route_stops').set({ is_active: 0 }).where('id', '=', gone.id).execute();
        else await trx.deleteFrom('route_stops').where('id', '=', gone.id).execute();
      }
      for (const [i, s] of list.entries()) {
        const row = { name: s.name, landmark: s.landmark || null, pickup_time: s.pickupTime || null, drop_time: s.dropTime || null, sort_order: i + 1 };
        if (s.id) await trx.updateTable('route_stops').set(row).where('id', '=', s.id).execute();
        else await trx.insertInto('route_stops').values({ ...row, bus_route_id: routeId }).execute();
      }
      await this.audit.log(u, { module: 'transport', action: 'save_stops', entityType: 'bus_route', entityId: routeId, after: list, ...meta }, trx);
    });
    return this.routes(u);
  }

  /** Bus students of a route this year, with their stop and family phone (drivers call families). */
  async routeStudents(u: RequestUser, routeId: number) {
    const ids = await this.visibleRouteIds(u);
    if (ids !== 'all' && !ids.includes(routeId)) throw Errors.notFound('Route');
    const year = await resolveYear(this.db, undefined, false);
    const rows = await this.db.selectFrom('student_fee_accounts as a').innerJoin('students as st', 'st.id', 'a.student_id').innerJoin('families as f', 'f.id', 'st.family_id')
      .leftJoin('enrollments as e', (j) => j.onRef('e.student_id', '=', 'st.id').on('e.academic_year_id', '=', year.id))
      .leftJoin('classes as c', 'c.id', 'e.class_id').leftJoin('sections as sec', 'sec.id', 'e.section_id')
      .leftJoin('student_stops as ss', (j) => j.onRef('ss.student_id', '=', 'st.id').on('ss.academic_year_id', '=', year.id))
      .select(['st.public_id', 'st.first_name', 'st.last_name', 'st.admission_no', 'c.name as class_name', 'c.level_order', 'sec.name as section', 'f.father_name', 'f.mother_name', 'f.family_name', 'f.primary_mobile', 'ss.route_stop_id'])
      .where('a.academic_year_id', '=', year.id).where('a.bus_route_id', '=', routeId).where('st.status', '=', 'active').execute();
    const stops = await this.db.selectFrom('route_stops').select(['id', 'sort_order']).where('bus_route_id', '=', routeId).where('is_active', '=', 1).execute();
    const order = new Map(stops.map((s) => [s.id, s.sort_order]));
    return rows.map((r) => ({
      id: r.public_id, name: fullName(r.first_name, r.last_name), admissionNo: r.admission_no, className: r.class_name ? `${r.class_name} ${r.section ?? ''}`.trim() : null,
      parent: r.father_name || r.mother_name || r.family_name, mobile: r.primary_mobile, stopId: r.route_stop_id && order.has(r.route_stop_id) ? r.route_stop_id : null, _o: [order.get(r.route_stop_id ?? -1) ?? 999, r.level_order ?? 0, r.first_name],
    })).sort((a, b) => (a._o[0] as number) - (b._o[0] as number) || (a._o[1] as number) - (b._o[1] as number) || String(a._o[2]).localeCompare(String(b._o[2]))).map(({ _o, ...x }) => x);
  }

  async setStops(u: RequestUser, routeId: number, items: Array<{ studentId: string; stopId: number | null }>, meta: Meta) {
    const year = await resolveYear(this.db, undefined, true);
    const stops = new Set((await this.db.selectFrom('route_stops').select('id').where('bus_route_id', '=', routeId).where('is_active', '=', 1).execute()).map((s) => s.id));
    await this.db.transaction().execute(async (trx) => {
      for (const [i, it] of items.entries()) {
        const st = await trx.selectFrom('students as s').innerJoin('student_fee_accounts as a', (j) => j.onRef('a.student_id', '=', 's.id').on('a.academic_year_id', '=', year.id))
          .select(['s.id', 'a.bus_route_id']).where('s.public_id', '=', it.studentId).executeTakeFirst();
        if (!st || st.bus_route_id !== routeId) throw Errors.validation([{ field: `items.${i}.studentId`, message: 'This student is not on this route this year.' }]);
        if (it.stopId && !stops.has(it.stopId)) throw Errors.validation([{ field: `items.${i}.stopId`, message: 'Choose a stop on this route.' }]);
        if (it.stopId) await trx.insertInto('student_stops').values({ academic_year_id: year.id, student_id: st.id, route_stop_id: it.stopId, updated_by: u.id })
          .onDuplicateKeyUpdate({ route_stop_id: it.stopId, updated_by: u.id }).execute();
        else await trx.deleteFrom('student_stops').where('academic_year_id', '=', year.id).where('student_id', '=', st.id).execute();
      }
      await this.audit.log(u, { module: 'transport', action: 'set_student_stops', entityType: 'bus_route', entityId: routeId, after: items, ...meta }, trx);
    });
    return this.routeStudents(u, routeId);
  }

  /** What a family (or staff) sees on the child's page. */
  async forStudent(u: RequestUser, studentPublicId: string) {
    const year = await resolveYear(this.db, undefined, false);
    const sid = await visibleStudentId(this.db, u, studentPublicId, 'transport.view', year.id).catch(async (e) => {
      // Drivers and transport staff without student scope: allow only students on routes they can see.
      if (u.permissions.get('transport.view') === 'own_children') throw e;
      const ids = await this.visibleRouteIds(u);
      const row = await this.db.selectFrom('students as s').innerJoin('student_fee_accounts as a', (j) => j.onRef('a.student_id', '=', 's.id').on('a.academic_year_id', '=', year.id))
        .select(['s.id', 'a.bus_route_id']).where('s.public_id', '=', studentPublicId).executeTakeFirst();
      if (!row || !row.bus_route_id || (ids !== 'all' && !ids.includes(row.bus_route_id))) throw e;
      return row.id;
    });
    const a = await this.db.selectFrom('student_fee_accounts as a').innerJoin('bus_routes as r', 'r.id', 'a.bus_route_id')
      .leftJoin('vehicles as v', (j) => j.onRef('v.id', '=', 'r.vehicle_id').on('v.is_active', '=', 1)).leftJoin('staff as s', 's.id', 'v.driver_staff_id').leftJoin('users as us', 'us.id', 's.user_id')
      .leftJoin('student_stops as ss', (j) => j.onRef('ss.student_id', '=', 'a.student_id').onRef('ss.academic_year_id', '=', 'a.academic_year_id'))
      .leftJoin('route_stops as rs', (j) => j.onRef('rs.id', '=', 'ss.route_stop_id').on('rs.is_active', '=', 1))
      .select(['r.name as route', 'v.reg_no', 'us.name as driver_name', 'us.mobile as driver_mobile', 'v.helper_name', 'v.helper_mobile', 'rs.name as stop', 'rs.landmark', 'rs.pickup_time', 'rs.drop_time'])
      .where('a.student_id', '=', sid).where('a.academic_year_id', '=', year.id).executeTakeFirst();
    if (!a) return { usesBus: false as const };
    return {
      usesBus: true as const, route: a.route, stop: a.stop, landmark: a.landmark, pickupTime: hhmm(a.pickup_time as any), dropTime: hhmm(a.drop_time as any),
      vehicle: a.reg_no, driverName: a.driver_name, driverMobile: a.driver_mobile, helperName: a.helper_name, helperMobile: a.helper_mobile,
    };
  }

  // ---------- Fuel and service log ----------
  async logs(q: { vehicleId?: number; from?: string; to?: string }) {
    const today = await schoolToday(this.db);
    const from = q.from ?? `${today.slice(0, 7)}-01`, to = q.to ?? today;
    let s = this.db.selectFrom('vehicle_logs as l').innerJoin('vehicles as v', 'v.id', 'l.vehicle_id').innerJoin('users as cu', 'cu.id', 'l.created_by').leftJoin('expenses as e', 'e.id', 'l.expense_id')
      .select(['l.public_id', 'l.vehicle_id', 'v.reg_no', 'l.kind', 'l.log_date', 'l.odometer', 'l.litres', 'l.amount', 'l.vendor', 'l.description', 'l.status', 'l.cancel_reason', 'cu.name as created_by', 'e.voucher_no', 'e.status as expense_status'])
      .where('l.log_date', '>=', new Date(`${from}T00:00:00Z`)).where('l.log_date', '<=', new Date(`${to}T00:00:00Z`));
    if (q.vehicleId) s = s.where('l.vehicle_id', '=', q.vehicleId);
    const rows = await s.orderBy('l.log_date', 'desc').orderBy('l.id', 'desc').limit(2000).execute();
    // Mileage: distance since the previous fuel fill of the same vehicle (with an odometer reading) ÷ litres of this fill.
    const vids = [...new Set(rows.map((r) => r.vehicle_id))];
    const fills = vids.length ? await this.db.selectFrom('vehicle_logs').select(['public_id', 'vehicle_id', 'odometer', 'litres', 'log_date', 'id'])
      .where('vehicle_id', 'in', vids).where('kind', '=', 'fuel').where('status', '=', 'active').where('odometer', 'is not', null).orderBy('log_date').orderBy('id').execute() : [];
    const kmpl = new Map<string, { km: number; kmpl: number | null }>();
    for (const v of vids) {
      const list = fills.filter((f) => f.vehicle_id === v);
      for (let i = 1; i < list.length; i++) {
        const km = Number(list[i].odometer) - Number(list[i - 1].odometer);
        const l = Number(list[i].litres ?? 0);
        if (km > 0) kmpl.set(list[i].public_id, { km, kmpl: l > 0 ? Math.round((km / l) * 10) / 10 : null });
      }
    }
    const active = rows.filter((r) => r.status === 'active');
    const sum = (k: 'fuel' | 'service') => active.filter((r) => r.kind === k).reduce((t, r) => t + toPaise(r.amount), 0) / 100;
    return {
      from, to,
      totals: { fuel: sum('fuel'), service: sum('service'), litres: Math.round(active.reduce((t, r) => t + Number(r.litres ?? 0), 0) * 100) / 100 },
      rows: rows.map((r) => ({
        id: r.public_id, vehicleId: r.vehicle_id, regNo: r.reg_no, kind: r.kind, date: iso(r.log_date), odometer: r.odometer, litres: r.litres == null ? null : Number(r.litres), amount: Number(r.amount),
        vendor: r.vendor, description: r.description, status: r.status, cancelReason: r.cancel_reason, createdBy: r.created_by, voucherNo: r.voucher_no, expenseStatus: r.expense_status,
        ...(kmpl.get(r.public_id) ?? { km: null, kmpl: null }),
      })),
    };
  }

  async addLog(u: RequestUser, b: LogBody, meta: Meta) {
    const v = await this.db.selectFrom('vehicles').select(['id', 'reg_no', 'is_active']).where('id', '=', b.vehicleId).executeTakeFirst();
    if (!v || !v.is_active) throw Errors.validation([{ field: 'vehicleId', message: 'Choose a vehicle.' }]);
    if (b.kind === 'fuel' && !(b.litres && b.litres > 0)) throw Errors.validation([{ field: 'litres', message: 'Enter the litres filled.' }]);
    if (b.odometer != null) {
      const last = await this.db.selectFrom('vehicle_logs').select(['odometer', 'log_date']).where('vehicle_id', '=', v.id).where('status', '=', 'active').where('odometer', 'is not', null)
        .where('log_date', '<=', new Date(`${b.date}T00:00:00Z`)).orderBy('log_date', 'desc').orderBy('id', 'desc').executeTakeFirst();
      if (last && Number(last.odometer) > b.odometer) throw Errors.validation([{ field: 'odometer', message: `The last reading was ${new Intl.NumberFormat('en-IN').format(Number(last.odometer))} km on ${iso(last.log_date)}.` }]);
    }
    const cat = await this.db.selectFrom('expense_categories').select(['id', 'is_active']).where('name', '=', 'Transport & fuel').executeTakeFirst();
    if (!cat || !cat.is_active) throw Errors.badRequest('NO_CATEGORY', 'Switch on the "Transport & fuel" category in Expenses → Settings first.');
    const what = b.kind === 'fuel' ? `Fuel ${b.litres} L` : (b.description || 'Service');
    return withRetry(this.db, async (trx) => {
      const exp = await this.expenses.create(u, {
        date: b.date, categoryId: cat.id, amount: b.amount, paidTo: b.vendor || (b.kind === 'fuel' ? 'Fuel station' : 'Garage'), method: b.method, reference: b.reference ?? null,
        description: `${v.reg_no}: ${what}${b.odometer != null ? ` at ${b.odometer} km` : ''}`.slice(0, 500),
      }, meta, 'transport', trx);
      const publicId = newPublicId();
      await trx.insertInto('vehicle_logs').values({
        public_id: publicId, vehicle_id: v.id, kind: b.kind, log_date: new Date(`${b.date}T00:00:00Z`), odometer: b.odometer ?? null, litres: b.kind === 'fuel' ? String(b.litres) : null,
        amount: toDb(toPaise(b.amount)), vendor: b.vendor || null, description: b.description || null, expense_id: exp.id, created_by: u.id,
      }).execute();
      await this.audit.log(u, { module: 'transport', action: 'add_log', entityType: 'vehicle', entityId: v.id, after: { ...b, voucher: exp.voucher }, ...meta }, trx);
      return { id: publicId, voucherNo: exp.voucher, expenseStatus: exp.status };
    });
  }

  async cancelLog(u: RequestUser, publicId: string, reason: string, meta: Meta) {
    const l = await this.db.selectFrom('vehicle_logs').selectAll().where('public_id', '=', publicId).executeTakeFirst();
    if (!l) throw Errors.notFound('Entry');
    if (l.status === 'cancelled') throw Errors.badRequest('ALREADY_CANCELLED', 'This entry is already cancelled.');
    if (!(u.permissions.has('transport.manage') || l.created_by === u.id)) throw Errors.forbidden();
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('vehicle_logs').set({ status: 'cancelled', cancel_reason: reason }).where('id', '=', l.id).execute();
      if (l.expense_id) await trx.updateTable('expenses').set({ status: 'cancelled', decision_note: `Transport entry cancelled: ${reason}`.slice(0, 255), decided_by: u.id, decided_at: new Date() })
        .where('id', '=', l.expense_id).where('status', 'in', ['pending', 'approved']).execute();
      await this.audit.log(u, { module: 'transport', action: 'cancel_log', entityType: 'vehicle', entityId: l.vehicle_id, after: { id: publicId, reason }, ...meta }, trx);
    });
    return { id: publicId, status: 'cancelled' };
  }
}

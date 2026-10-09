import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Bus, Fuel, Phone, Plus, Trash2, Wrench } from 'lucide-react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { api, ApiError, fieldErrors } from '../lib/api';
import { useAuth } from '../lib/auth';
import { inr, METHOD_LABEL, todayISO } from '../lib/fees';
import ExportButtons from '../components/ExportButtons';
import { Badge, EmptyState, ErrorState, Field, MobileAction, PageHeader, Sheet, Skeleton, Toggle } from '../components/ui';

interface Stop { id: number; name: string; landmark: string | null; pickupTime: string | null; dropTime: string | null; students: number }
interface RouteVehicle { id: number; regNo: string; seats: number | null; driverName: string | null; driverMobile: string | null; helperName: string | null; helperMobile: string | null }
interface Route { id: number; name: string; isActive: boolean; students: number; withoutStop: number; vehicle: RouteVehicle | null; stops: Stop[] }
interface RoutesData { year: { id: number; name: string } | null; routes: Route[] }
interface Vehicle { id: number; regNo: string; name: string | null; seats: number | null; helperName: string | null; helperMobile: string | null; isActive: boolean; notes: string | null; driver: { id: string; name: string; mobile: string | null } | null; routes: string[] }
interface RouteStudent { id: string; name: string; admissionNo: string; className: string | null; parent: string; mobile: string; stopId: number | null }
interface LogRow { id: string; vehicleId: number; regNo: string; kind: 'fuel' | 'service'; date: string; odometer: number | null; litres: number | null; amount: number; vendor: string | null; description: string | null;
  status: 'active' | 'cancelled'; cancelReason: string | null; createdBy: string; voucherNo: string | null; expenseStatus: string | null; km: number | null; kmpl: number | null }
interface LogsData { from: string; to: string; totals: { fuel: number; service: number; litres: number }; rows: LogRow[] }

const err = (e: unknown) => toast.error((e as ApiError).details?.[0]?.message ?? (e as ApiError).message);
const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const num = (v: string) => v.replace(/[^0-9.]/g, '');
const time12 = (t: string | null) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
const useRoutes = () => useQuery({ queryKey: ['transport-routes'], queryFn: () => api<RoutesData>('/transport/routes').then((r) => r.data) });
const useVehicles = (enabled = true) => useQuery({ queryKey: ['transport-vehicles'], enabled, queryFn: () => api<Vehicle[]>('/transport/vehicles').then((r) => r.data) });

// ---------------- Routes ----------------
function StopsEditor({ route, onSaved }: { route: Route; onSaved: () => void }) {
  type S = { id: number | null; name: string; landmark: string; pickupTime: string; dropTime: string; students: number };
  const toRows = () => route.stops.map((s) => ({ id: s.id, name: s.name, landmark: s.landmark ?? '', pickupTime: s.pickupTime ?? '', dropTime: s.dropTime ?? '', students: s.students }));
  const [rows, setRows] = useState<S[]>(toRows);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => setRows(toRows()), [route]); // eslint-disable-line react-hooks/exhaustive-deps
  const qc = useQueryClient();
  const m = useMutation({ mutationFn: () => api<RoutesData>(`/transport/routes/${route.id}/stops`, { method: 'PUT', body: { stops: rows.map(({ students, ...s }) => s) } }),
    onSuccess: ({ data }) => { qc.setQueryData(['transport-routes'], data); setErrors({}); toast.success('Stops saved'); onSaved(); },
    onError: (e) => { const fe = fieldErrors(e); setErrors(fe); if (!Object.keys(fe).length) err(e); } });
  const set = (i: number, k: keyof S, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const move = (i: number, d: -1 | 1) => { const n = [...rows]; [n[i], n[i + d]] = [n[i + d], n[i]]; setRows(n); };
  return (
    <section className="space-y-3">
      <h3 className="font-semibold">Stops, in the order the bus reaches them</h3>
      {!rows.length && <p className="text-sm text-ink-muted">No stops yet. Add them in the order the bus reaches them in the morning.</p>}
      <ol className="space-y-3">{rows.map((r, i) => (
        <li key={r.id ?? `n${i}`} className="rounded-lg border border-line p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-semibold text-brand">{i + 1}</span>
            <input className="field" aria-label={`Stop ${i + 1} name`} placeholder="Stop name" value={r.name} onChange={(e) => set(i, 'name', e.target.value)} />
            <button className="rounded-md p-2 text-ink-muted hover:bg-chalk disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp size={18} /></button>
            <button className="rounded-md p-2 text-ink-muted hover:bg-chalk disabled:opacity-30" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown size={18} /></button>
            <button className="rounded-md p-2 text-danger hover:bg-danger-soft disabled:opacity-30" disabled={r.students > 0} title={r.students ? 'Students use this stop' : 'Remove'} onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove stop"><Trash2 size={18} /></button>
          </div>
          {errors[`stops.${i}.name`] && <p className="mb-2 text-sm text-danger">{errors[`stops.${i}.name`]}</p>}
          <div className="grid grid-cols-2 gap-2">
            <input className="field col-span-2" placeholder="Landmark (optional)" value={r.landmark} onChange={(e) => set(i, 'landmark', e.target.value)} aria-label={`Stop ${i + 1} landmark`} />
            <label className="block"><span className="mb-1 block text-xs font-medium text-ink-muted">Pickup (morning)</span><input type="time" className="field" value={r.pickupTime} onChange={(e) => set(i, 'pickupTime', e.target.value)} aria-label={`Stop ${i + 1} pickup time`} /></label>
            <label className="block"><span className="mb-1 block text-xs font-medium text-ink-muted">Drop (evening)</span><input type="time" className="field" value={r.dropTime} onChange={(e) => set(i, 'dropTime', e.target.value)} aria-label={`Stop ${i + 1} drop time`} /></label>
          </div>
          {r.students > 0 && <p className="mt-1.5 text-xs text-ink-muted">{r.students} student{r.students > 1 ? 's' : ''}</p>}
        </li>))}</ol>
      <div className="flex gap-2">
        <button className="btn-quiet min-h-10 text-sm" onClick={() => setRows([...rows, { id: null, name: '', landmark: '', pickupTime: '', dropTime: '', students: 0 }])}><Plus size={16} aria-hidden />Add stop</button>
        <button className="btn-primary min-h-10 flex-1 text-sm" disabled={m.isPending || rows.some((r) => r.name.trim().length < 2)} onClick={() => m.mutate()}>Save stops</button>
      </div>
    </section>
  );
}

function RouteStudents({ route, editable }: { route: Route; editable: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['route-students', route.id], queryFn: () => api<RouteStudent[]>(`/transport/routes/${route.id}/students`).then((r) => r.data) });
  const [picks, setPicks] = useState<Record<string, string>>({});
  useEffect(() => setPicks({}), [q.data]);
  const changed = Object.entries(picks).filter(([id, v]) => String(q.data?.find((s) => s.id === id)?.stopId ?? '') !== v);
  const m = useMutation({ mutationFn: () => api<RouteStudent[]>(`/transport/routes/${route.id}/students`, { method: 'PUT', body: { items: changed.map(([studentId, v]) => ({ studentId, stopId: v ? Number(v) : null })) } }),
    onSuccess: ({ data }) => { qc.setQueryData(['route-students', route.id], data); qc.invalidateQueries({ queryKey: ['transport-routes'] }); toast.success('Stops saved'); }, onError: err });
  const stopName = new Map(route.stops.map((s) => [s.id, s]));
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Students on this bus ({q.data?.length ?? route.students})</h3>
        <ExportButtons list="route-students" params={{ routeId: route.id }} name={`bus-list-${route.name}`} /></div>
      {editable && <p className="text-sm text-ink-muted">Students join a route on their page (Fees tab → Bus route). Here you choose their stop.</p>}
      {q.isLoading ? <Skeleton rows={3} /> : !q.data?.length ? <p className="text-sm text-ink-muted">No students on this route this year.</p> : (
        <ul className="divide-y divide-line rounded-lg border border-line">{q.data.map((s) => (
          <li key={s.id} className="space-y-2 px-3 py-2.5">
            <div className="min-w-0"><p className="font-medium">{s.name} <span className="font-normal text-ink-muted">· {s.className ?? '-'}</span></p>
              <p className="text-sm text-ink-muted">{s.parent} · <a className="font-semibold text-brand" href={`tel:${s.mobile}`}>{s.mobile}</a></p></div>
            {editable ? (
              <select className="field w-full" aria-label={`Stop for ${s.name}`} value={picks[s.id] ?? String(s.stopId ?? '')} onChange={(e) => setPicks({ ...picks, [s.id]: e.target.value })}>
                <option value="">No stop yet</option>{route.stops.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}</select>
            ) : <span className="text-sm">{s.stopId ? `${stopName.get(s.stopId)?.name} · ${time12(stopName.get(s.stopId)?.pickupTime ?? null) ?? ''}` : <span className="text-ink-muted">No stop yet</span>}</span>}
          </li>))}</ul>
      )}
      {editable && changed.length > 0 && <button className="btn-primary w-full" disabled={m.isPending} onClick={() => m.mutate()}>Save {changed.length} change{changed.length > 1 ? 's' : ''}</button>}
    </section>
  );
}

function RouteSheet({ route, onClose }: { route: Route | null; onClose: () => void }) {
  const { can } = useAuth();
  const manage = can('transport.manage');
  const qc = useQueryClient();
  const vehicles = useVehicles(manage && !!route);
  const setVehicle = useMutation({ mutationFn: (vehicleId: number | null) => api<RoutesData>(`/transport/routes/${route!.id}/vehicle`, { method: 'PUT', body: { vehicleId } }),
    onSuccess: ({ data }) => { qc.setQueryData(['transport-routes'], data); qc.invalidateQueries({ queryKey: ['transport-vehicles'] }); toast.success('Bus saved'); }, onError: err });
  if (!route) return null;
  const v = route.vehicle;
  return (
    <Sheet open onClose={onClose} title={route.name}>
      <div className="space-y-7">
        <section className="space-y-2">
          <h3 className="font-semibold">Bus</h3>
          {manage ? (
            <select className="field" value={v?.id ?? ''} onChange={(e) => setVehicle.mutate(e.target.value ? Number(e.target.value) : null)} aria-label="Bus for this route">
              <option value="">No bus chosen</option>{vehicles.data?.filter((x) => x.isActive).map((x) => <option key={x.id} value={x.id}>{x.regNo}{x.driver ? ` · ${x.driver.name}` : ''}</option>)}</select>
          ) : null}
          {v ? <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1 text-[15px]">
            <dt className="text-ink-muted">Vehicle</dt><dd>{v.regNo}{v.seats ? ` · ${v.seats} seats` : ''}</dd>
            <dt className="text-ink-muted">Driver</dt><dd>{v.driverName ?? '-'}{v.driverMobile && <> · <a className="font-semibold text-brand" href={`tel:${v.driverMobile}`}>{v.driverMobile}</a></>}</dd>
            {v.helperName && <><dt className="text-ink-muted">Helper</dt><dd>{v.helperName}{v.helperMobile && <> · <a className="font-semibold text-brand" href={`tel:${v.helperMobile}`}>{v.helperMobile}</a></>}</dd></>}
          </dl> : !manage && <p className="text-sm text-ink-muted">No bus chosen yet.</p>}
        </section>
        {manage ? <StopsEditor route={route} onSaved={() => undefined} /> : (
          <section><h3 className="mb-2 font-semibold">Stops</h3>
            <ol className="space-y-2">{route.stops.map((s, i) => <li key={s.id} className="text-[15px]"><p>{i + 1}. {s.name}{s.landmark ? <span className="text-ink-muted"> · {s.landmark}</span> : ''}</p>
              <p className="pl-4 text-sm tabular-nums text-ink-muted">Pickup {time12(s.pickupTime) ?? '-'} · Drop {time12(s.dropTime) ?? '-'}</p></li>)}</ol></section>
        )}
        <RouteStudents route={route} editable={manage} />
      </div>
    </Sheet>
  );
}

function RoutesTab() {
  const q = useRoutes();
  const [open, setOpen] = useState<number | null>(null);
  if (q.isLoading) return <Skeleton />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />;
  const routes = q.data!.routes;
  if (!routes.length) return <EmptyState title="No routes yet" body="Bus routes are added in Fee setup with their yearly fee. They appear here to add stops, a bus and a driver." />;
  return (
    <>
      <ul className="grid gap-3 lg:grid-cols-2">{routes.map((r) => (
        <li key={r.id} className="min-w-0">
          <button className={clsx('panel block w-full p-4 text-left hover:border-brand/40', !r.isActive && 'opacity-60')} onClick={() => setOpen(r.id)}>
            <div className="flex items-start justify-between gap-3">
              <div><p className="font-semibold">{r.name}</p>
                <p className="text-sm text-ink-muted">{r.vehicle ? `${r.vehicle.regNo}${r.vehicle.driverName ? ` · ${r.vehicle.driverName}` : ''}` : 'No bus chosen'}</p></div>
              <Bus size={20} className="shrink-0 text-ink-muted" aria-hidden />
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              <Badge>{r.stops.length} stop{r.stops.length === 1 ? '' : 's'}</Badge><Badge tone="brand">{r.students} student{r.students === 1 ? '' : 's'}</Badge>
              {r.withoutStop > 0 && <Badge tone="attention">{r.withoutStop} without a stop</Badge>}
              {r.vehicle?.seats && r.students > r.vehicle.seats && <Badge tone="danger">More students than seats</Badge>}
            </div>
            {r.stops.length > 0 && <p className="mt-2 truncate text-sm text-ink-muted">{r.stops.map((s) => s.name).join(' → ')}</p>}
          </button>
        </li>))}</ul>
      <RouteSheet route={routes.find((r) => r.id === open) ?? null} onClose={() => setOpen(null)} />
    </>
  );
}

// ---------------- Vehicles ----------------
function VehicleSheet({ vehicle, open, onClose }: { vehicle: Vehicle | null; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const drivers = useQuery({ queryKey: ['driver-options'], enabled: open, queryFn: () => api<Array<{ id: string; name: string; mobile: string | null; code: string; designation: string | null; isDriver: boolean }>>('/transport/driver-options').then((r) => r.data) });
  const blank = { regNo: '', name: '', seats: '', driverStaffId: '', helperName: '', helperMobile: '', notes: '', isActive: true };
  const [f, setF] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setErrors({}); setF(vehicle ? { regNo: vehicle.regNo, name: vehicle.name ?? '', seats: vehicle.seats ? String(vehicle.seats) : '', driverStaffId: vehicle.driver?.id ?? '', helperName: vehicle.helperName ?? '', helperMobile: vehicle.helperMobile ?? '', notes: vehicle.notes ?? '', isActive: vehicle.isActive } : blank); } }, [open, vehicle]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = useMutation({ mutationFn: () => api<Vehicle[]>(vehicle ? `/transport/vehicles/${vehicle.id}` : '/transport/vehicles', { method: vehicle ? 'PATCH' : 'POST',
    body: { ...f, seats: f.seats ? Number(f.seats) : null, driverStaffId: f.driverStaffId || null, name: f.name || null, helperName: f.helperName || null, helperMobile: f.helperMobile || null, notes: f.notes || null } }),
    onSuccess: ({ data }) => { qc.setQueryData(['transport-vehicles'], data); qc.invalidateQueries({ queryKey: ['transport-routes'] }); toast.success('Vehicle saved'); onClose(); },
    onError: (e) => { const fe = fieldErrors(e); setErrors(fe); if (!Object.keys(fe).length) err(e); } });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Sheet open={open} onClose={onClose} title={vehicle ? vehicle.regNo : 'Add vehicle'} footer={<button className="btn-primary w-full" disabled={m.isPending} onClick={() => m.mutate()}>Save vehicle</button>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Registration no" error={errors.regNo} hint="e.g. TS 07 UB 1234"><input className="field uppercase" value={f.regNo} onChange={set('regNo')} /></Field>
          <Field label="Seats" error={errors.seats}><input className="field" inputMode="numeric" value={f.seats} onChange={(e) => setF({ ...f, seats: e.target.value.replace(/\D/g, '') })} /></Field>
        </div>
        <Field label="Make or name (optional)" hint="e.g. Tata Starbus"><input className="field" value={f.name} onChange={set('name')} /></Field>
        <Field label="Driver" error={errors.driverStaffId} hint="Add the driver as a staff member (role Driver) first, so parents see the name and phone.">
          <select className="field" value={f.driverStaffId} onChange={set('driverStaffId')}><option value="">No driver</option>
            {drivers.data?.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.code}{d.isDriver ? '' : d.designation ? ` · ${d.designation}` : ''}</option>)}</select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Helper / attendant"><input className="field" value={f.helperName} onChange={set('helperName')} /></Field>
          <Field label="Helper mobile" error={errors.helperMobile}><input className="field" inputMode="numeric" maxLength={10} value={f.helperMobile} onChange={(e) => setF({ ...f, helperMobile: e.target.value.replace(/\D/g, '') })} /></Field>
        </div>
        <Field label="Notes (optional)"><textarea className="field min-h-16" value={f.notes} onChange={set('notes')} maxLength={255} /></Field>
        {vehicle && <label className="flex items-center justify-between gap-3"><span><span className="font-medium">In use</span><span className="block text-sm text-ink-muted">Switching off removes it from its routes.</span></span>
          <Toggle checked={f.isActive} label="Vehicle in use" onChange={(v) => setF({ ...f, isActive: v })} /></label>}
      </div>
    </Sheet>
  );
}

function VehiclesTab() {
  const { can } = useAuth();
  const q = useVehicles();
  const [edit, setEdit] = useState<Vehicle | null>(null);
  const [open, setOpen] = useState(false);
  const add = can('transport.manage') && <button className="btn-primary w-full sm:w-auto" onClick={() => { setEdit(null); setOpen(true); }}><Plus size={18} aria-hidden />Add vehicle</button>;
  if (q.isLoading) return <Skeleton />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />;
  return (
    <>
      <div className="mb-3 hidden justify-end sm:flex">{add}</div>
      {!q.data!.length ? <EmptyState title="No vehicles yet" body="Add each school bus or van with its driver and helper." action={add} /> : (
        <ul className="panel divide-y divide-line">{q.data!.map((v) => (
          <li key={v.id}>
            <button className={clsx('flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-chalk', !v.isActive && 'opacity-60')} onClick={() => { if (can('transport.manage')) { setEdit(v); setOpen(true); } }}>
              <span><span className="block font-semibold">{v.regNo}{v.name ? <span className="font-normal text-ink-muted"> · {v.name}</span> : ''}</span>
                <span className="block text-sm text-ink-muted">{v.driver ? `${v.driver.name}${v.driver.mobile ? ` · ${v.driver.mobile}` : ''}` : 'No driver'}{v.helperName ? ` · helper ${v.helperName}` : ''}</span>
                {v.routes.length > 0 && <span className="block text-sm text-ink-muted">{v.routes.join(', ')}</span>}</span>
              <span className="flex shrink-0 gap-1.5">{v.seats && <Badge>{v.seats} seats</Badge>}{!v.isActive && <Badge>Not in use</Badge>}</span>
            </button>
          </li>))}</ul>
      )}
      {add && <MobileAction>{add}</MobileAction>}
      <VehicleSheet vehicle={edit} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

// ---------------- Fuel & service ----------------
function LogSheet({ open, onClose, vehicles }: { open: boolean; onClose: () => void; vehicles: Vehicle[] }) {
  const qc = useQueryClient();
  const blank = { vehicleId: '', kind: 'fuel' as 'fuel' | 'service', date: todayISO(), odometer: '', litres: '', amount: '', vendor: '', description: '', method: 'cash', reference: '' };
  const [f, setF] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setErrors({}); setF({ ...blank, vehicleId: vehicles.length === 1 ? String(vehicles[0].id) : '' }); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = useMutation({ mutationFn: () => api<{ voucherNo: string; expenseStatus: string }>('/transport/logs', { method: 'POST', body: {
    vehicleId: Number(f.vehicleId), kind: f.kind, date: f.date, odometer: f.odometer ? Number(f.odometer) : null, litres: f.kind === 'fuel' && f.litres ? Number(f.litres) : null, amount: Number(f.amount),
    vendor: f.vendor || null, description: f.description || null, method: f.method, reference: f.reference || null } }),
    onSuccess: ({ data }) => { toast.success(`Saved as expense ${data.voucherNo}${data.expenseStatus === 'pending' ? ', waiting for approval' : ''}`); qc.invalidateQueries({ queryKey: ['transport-logs'] }); qc.invalidateQueries({ queryKey: ['expenses'] }); onClose(); },
    onError: (e) => { const fe = fieldErrors(e); setErrors(Object.keys(fe).length ? fe : { form: (e as ApiError).message }); } });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const price = f.kind === 'fuel' && Number(f.litres) > 0 && Number(f.amount) > 0 ? Number(f.amount) / Number(f.litres) : null;
  return (
    <Sheet open={open} onClose={onClose} title={f.kind === 'fuel' ? 'Add fuel fill' : 'Add service or repair'} footer={<button className="btn-primary w-full" disabled={m.isPending} onClick={() => m.mutate()}>Save</button>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-chalk p-0.5">
          {([['fuel', 'Fuel', Fuel], ['service', 'Service / repair', Wrench]] as const).map(([k, label, Icon]) => (
            <button key={k} aria-pressed={f.kind === k} className={clsx('inline-flex items-center justify-center gap-2 rounded-md py-2 text-sm font-semibold', f.kind === k ? 'bg-surface text-brand shadow-sm' : 'text-ink-muted')} onClick={() => setF({ ...f, kind: k })}><Icon size={16} aria-hidden />{label}</button>))}
        </div>
        <Field label="Vehicle" error={errors.vehicleId}><select className="field" value={f.vehicleId} onChange={set('vehicleId')}><option value="">Choose…</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.regNo}</option>)}</select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" error={errors.date}><input type="date" className="field" max={todayISO()} value={f.date} onChange={set('date')} /></Field>
          <Field label="Odometer (km)" error={errors.odometer} hint={f.kind === 'fuel' ? 'Needed for km per litre' : undefined}><input className="field" inputMode="numeric" value={f.odometer} onChange={(e) => setF({ ...f, odometer: e.target.value.replace(/\D/g, '') })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {f.kind === 'fuel' && <Field label="Litres" error={errors.litres}><input className="field" inputMode="decimal" value={f.litres} onChange={(e) => setF({ ...f, litres: num(e.target.value) })} /></Field>}
          <Field label="Amount (₹)" error={errors.amount} hint={price ? `₹${price.toFixed(2)} per litre` : undefined}><input className="field" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: num(e.target.value) })} /></Field>
        </div>
        <Field label={f.kind === 'fuel' ? 'Fuel station' : 'Garage or mechanic'}><input className="field" value={f.vendor} onChange={set('vendor')} /></Field>
        {f.kind === 'service' && <Field label="Work done"><input className="field" placeholder="e.g. Oil change, brake pads" value={f.description} onChange={set('description')} maxLength={255} /></Field>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="How paid"><select className="field" value={f.method} onChange={set('method')}>{Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Bill no (optional)"><input className="field" value={f.reference} onChange={set('reference')} /></Field>
        </div>
        <p className="text-sm text-ink-muted">This is also saved in Expenses (Transport &amp; fuel), with the school's approval rule.</p>
        {errors.form && <p className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger" role="alert">{errors.form}</p>}
      </div>
    </Sheet>
  );
}

function LogsTab() {
  const qc = useQueryClient();
  const today = todayISO();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [vehicleId, setVehicleId] = useState('');
  const [adding, setAdding] = useState(false);
  const vehicles = useVehicles();
  const params = { from, to, vehicleId: vehicleId || undefined };
  const q = useQuery({ queryKey: ['transport-logs', params], queryFn: () => api<LogsData>('/transport/logs', { query: params as any }).then((r) => r.data) });
  const cancel = useMutation({ mutationFn: (v: { id: string; reason: string }) => api(`/transport/logs/${v.id}/cancel`, { method: 'POST', body: { reason: v.reason } }),
    onSuccess: () => { toast.success('Cancelled, with its expense'); qc.invalidateQueries({ queryKey: ['transport-logs'] }); }, onError: err });
  const active = vehicles.data?.filter((v) => v.isActive) ?? [];
  const add = <button className="btn-primary w-full sm:w-auto" disabled={!active.length} onClick={() => setAdding(true)}><Plus size={18} aria-hidden />Add fuel or service</button>;
  const d = q.data;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="grid flex-1 grid-cols-2 gap-2 sm:flex sm:flex-none">
          <Field label="From"><input type="date" className="field" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input type="date" className="field" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
          <div className="col-span-2 sm:w-48"><Field label="Vehicle"><select className="field" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}><option value="">All</option>{vehicles.data?.map((v) => <option key={v.id} value={v.id}>{v.regNo}</option>)}</select></Field></div>
        </div>
        <div className="flex flex-wrap gap-2 sm:ml-auto"><ExportButtons list="vehicle-log" params={params} name={`vehicle-log-${from}-to-${to}`} /><span className="hidden sm:inline">{add}</span></div>
      </div>
      {!active.length && vehicles.isSuccess && <p className="mb-3 rounded-lg bg-tangedu-soft px-4 py-3 text-sm">Add a vehicle first (Vehicles tab).</p>}
      {q.isLoading ? <Skeleton /> : q.isError ? <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} /> : (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <div className="panel p-4"><p className="text-sm text-ink-muted">Fuel</p><p className="mt-1 text-xl font-semibold tabular-nums sm:text-2xl">{inr(d!.totals.fuel)}</p><p className="text-sm text-ink-muted">{d!.totals.litres} L</p></div>
            <div className="panel p-4"><p className="text-sm text-ink-muted">Service</p><p className="mt-1 text-xl font-semibold tabular-nums sm:text-2xl">{inr(d!.totals.service)}</p></div>
            <div className="panel p-4"><p className="text-sm text-ink-muted">Total</p><p className="mt-1 text-xl font-semibold tabular-nums sm:text-2xl">{inr(d!.totals.fuel + d!.totals.service)}</p><p className="text-sm text-ink-muted">{fmt(d!.from)} to {fmt(d!.to)}</p></div>
          </div>
          {!d!.rows.length ? <EmptyState title="Nothing logged in these dates" body="Add each fuel fill with the odometer reading to see km per litre. Services and repairs go here too." /> : (
            <ul className="panel divide-y divide-line">{d!.rows.map((r) => (
              <li key={r.id} className={clsx('px-4 py-3', r.status === 'cancelled' && 'opacity-60')}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold">{r.kind === 'fuel' ? <Fuel size={15} className="mr-1.5 inline text-ink-muted" aria-hidden /> : <Wrench size={15} className="mr-1.5 inline text-ink-muted" aria-hidden />}
                    {r.regNo} <span className="font-normal text-ink-muted">· {r.kind === 'fuel' ? `${r.litres} L` : r.description ?? 'Service'}</span></p>
                  <p className="font-semibold tabular-nums">{inr(r.amount)}</p>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-ink-muted">{fmt(r.date)}{r.odometer != null ? ` · ${new Intl.NumberFormat('en-IN').format(r.odometer)} km` : ''}{r.vendor ? ` · ${r.vendor}` : ''}{r.voucherNo ? ` · ${r.voucherNo}` : ''} · by {r.createdBy}</p>
                  <span className="flex gap-1.5">{r.kmpl != null && <Badge tone="brand">{r.kmpl} km/L · {r.km} km</Badge>}
                    {r.status === 'cancelled' ? <Badge>Cancelled</Badge> : r.expenseStatus === 'pending' ? <Badge tone="attention">Waiting approval</Badge> : r.expenseStatus === 'rejected' ? <Badge tone="danger">Not approved</Badge> : null}</span>
                </div>
                {r.status === 'cancelled' ? <p className="text-sm text-ink-muted">Cancelled: {r.cancelReason}</p> : (
                  <button className="mt-1 text-sm font-semibold text-danger" onClick={() => { const reason = prompt('Why cancel this entry? Its expense is cancelled too.'); if (reason) cancel.mutate({ id: r.id, reason }); }}>Cancel</button>)}
              </li>))}</ul>
          )}
        </>
      )}
      <MobileAction>{add}</MobileAction>
      <LogSheet open={adding} onClose={() => setAdding(false)} vehicles={active} />
    </>
  );
}

export default function TransportPage() {
  const { can, me } = useAuth();
  const tabs = useMemo(() => ([['routes', 'Routes & stops'], ...(me?.permissions['transport.view'] === 'all' ? [['vehicles', 'Vehicles']] : []), ...(can('transport.log') ? [['logs', 'Fuel & service']] : [])] as Array<[string, string]>), [can, me]);
  const [tab, setTab] = useState('routes');
  const driverOnly = me?.permissions['transport.view'] === 'assigned_route';
  return (
    <div>
      <PageHeader title={driverOnly ? 'My bus' : 'Transport'} description={driverOnly ? 'Your route, stops and the students you pick up, with their parents’ phone numbers.' : 'Buses, drivers, stops and pickup times; fuel and service costs.'} />
      {tabs.length > 1 && <div className="mb-5 flex gap-1 overflow-x-auto rounded-lg border border-line bg-chalk p-0.5 sm:inline-flex">
        {tabs.map(([k, label]) => <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)} className={clsx('shrink-0 rounded-md px-4 py-2 text-sm font-semibold', tab === k ? 'bg-surface text-brand shadow-sm' : 'text-ink-muted')}>{label}</button>)}
      </div>}
      {tab === 'vehicles' ? <VehiclesTab /> : tab === 'logs' ? <LogsTab /> : <RoutesTab />}
    </div>
  );
}

/** Bus card on a student's page (parents and staff). */
export function StudentBusCard({ studentId }: { studentId: string }) {
  const { me } = useAuth();
  const enabled = !!me?.features?.transport && !!me?.permissions['transport.view'];
  const q = useQuery({ queryKey: ['student-transport', studentId], enabled, retry: false, queryFn: () => api<any>(`/students/${studentId}/transport`).then((r) => r.data) });
  if (!enabled || !q.data?.usesBus) return null;
  const t = q.data;
  return (
    <section className="panel p-4">
      <div className="mb-2 flex items-center gap-2"><Bus size={18} className="text-brand" aria-hidden /><h3 className="font-semibold">School bus</h3></div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 text-[15px]">
        <dt className="text-ink-muted">Route</dt><dd>{t.route}</dd>
        <dt className="text-ink-muted">Stop</dt><dd>{t.stop ? `${t.stop}${t.landmark ? ` (${t.landmark})` : ''}` : 'Not set yet'}</dd>
        {t.stop && <><dt className="text-ink-muted">Pickup</dt><dd>{time12(t.pickupTime) ?? '-'}</dd><dt className="text-ink-muted">Drop</dt><dd>{time12(t.dropTime) ?? '-'}</dd></>}
        {t.vehicle && <><dt className="text-ink-muted">Bus</dt><dd>{t.vehicle}</dd></>}
        {t.driverName && <><dt className="text-ink-muted">Driver</dt><dd>{t.driverName}{t.driverMobile && <> · <a className="inline-flex items-center gap-1 font-semibold text-brand" href={`tel:${t.driverMobile}`}><Phone size={14} aria-hidden />{t.driverMobile}</a></>}</dd></>}
        {t.helperName && <><dt className="text-ink-muted">Helper</dt><dd>{t.helperName}{t.helperMobile && <> · <a className="inline-flex items-center gap-1 font-semibold text-brand" href={`tel:${t.helperMobile}`}><Phone size={14} aria-hidden />{t.helperMobile}</a></>}</dd></>}
      </dl>
    </section>
  );
}

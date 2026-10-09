import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, RefreshCw, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { inr, todayISO, METHOD_LABEL } from '../lib/fees';
import { CALC_LABEL, DIVISOR_LABEL, KIND_LABEL, monthLabel, openProtected, prevMonthOf, previewSalary, type Calc, type Component, type Kind, type Line, type Template } from '../lib/payroll';
import ExportButtons from '../components/ExportButtons';
import { Badge, EmptyState, ErrorState, Field, PageHeader, Sheet, Skeleton, Toggle } from '../components/ui';

const err = (e: unknown) => toast.error((e as ApiError).details?.[0]?.message ?? (e as ApiError).message);
const STATUS: Record<string, [string, 'attention' | 'brand' | 'neutral']> = { draft: ['Draft', 'attention'], finalised: ['Finalised', 'brand'], paid: ['Paid', 'neutral'] };

interface Hint { absent: number; halfDays: number; unpaidLeave: number; notMarked: number; beforeJoining: number; afterLeaving: number; suggested: number }
interface SlipRow { id: string; staffId: string; name: string; code: string; designation: string | null; lopDays: number; paidDays: number; gross: number; deductions: number; employer: number; net: number; note: string | null;
  lines: Array<{ componentId: number; code: string; name: string; kind: Kind; amount: number }>; adjustments: Array<{ label: string; kind: 'earning' | 'deduction'; amount: number }>; bankReady: boolean; hint: Hint }
interface Run { month: string; label: string; status: 'draft' | 'finalised' | 'paid'; divisorRule: string; divisor: number; paidOn: string | null; paidMethod: string | null; paidReference: string | null;
  totals: { staff: number; gross: number; deductions: number; employer: number; net: number }; missing: Array<{ id: string; name: string; code: string }>; slips: SlipRow[] }
interface RunsData { currentMonth: string; rules: { lopDivisor: string }; runs: Array<{ month: string; label: string; status: string; staff: number; net: number; paidOn: string | null }> }

function hintText(h: Hint) {
  const parts = [h.absent && `${h.absent} absent`, h.halfDays && `${h.halfDays} half day${h.halfDays > 1 ? 's' : ''}`, h.unpaidLeave && `${h.unpaidLeave} unpaid leave`,
    h.beforeJoining && `${h.beforeJoining} before joining`, h.afterLeaving && `${h.afterLeaving} after leaving`].filter(Boolean);
  return [parts.length ? `Attendance suggests ${h.suggested}: ${parts.join(', ')}` : 'No absences', h.notMarked ? `${h.notMarked} day${h.notMarked > 1 ? 's' : ''} not marked` : ''].filter(Boolean).join(' · ');
}

// ---------------- Monthly payroll ----------------

function SlipSheet({ slip, run, onClose }: { slip: SlipRow | null; run: Run; onClose: () => void }) {
  const qc = useQueryClient();
  const [lop, setLop] = useState('0');
  const [adj, setAdj] = useState<SlipRow['adjustments']>([]);
  const [note, setNote] = useState('');
  useEffect(() => { if (slip) { setLop(String(slip.lopDays)); setAdj(slip.adjustments); setNote(slip.note ?? ''); } }, [slip]);
  const save = useMutation({
    mutationFn: () => api<Run>(`/payroll/runs/${run.month}/slips/${slip!.id}`, { method: 'PATCH', body: { lopDays: Number(lop) || 0, adjustments: adj.filter((a) => a.label.trim() && a.amount > 0), note: note || null } }),
    onSuccess: ({ data }) => { qc.setQueryData(['payroll-run', run.month], data); toast.success('Payslip updated'); onClose(); }, onError: err,
  });
  if (!slip) return null;
  const draft = run.status === 'draft';
  const by = (k: Kind) => slip.lines.filter((l) => l.kind === k);
  return (
    <Sheet open onClose={onClose} title={slip.name}
      footer={draft ? <button className="btn-primary w-full" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save payslip'}</button>
        : <button className="btn-quiet w-full" onClick={() => openProtected(`/payslips/${slip.id}/pdf`).catch(err)}><FileText size={16} aria-hidden />Open payslip PDF</button>}>
      <div className="space-y-5">
        <div>
          <Field label={`Loss-of-pay days (out of ${run.divisor})`} hint={hintText(slip.hint)}>
            <input className="field" inputMode="decimal" disabled={!draft} value={lop} onChange={(e) => setLop(e.target.value.replace(/[^0-9.]/g, ''))} />
          </Field>
          {draft && slip.hint.suggested !== Number(lop) && <button className="mt-2 text-sm font-semibold text-brand" onClick={() => setLop(String(slip.hint.suggested))}>Use {slip.hint.suggested} from attendance</button>}
        </div>
        <section>
          <h3 className="label">One-off additions and deductions</h3>
          <ul className="space-y-2">{adj.map((a, i) => (
            <li key={i} className="grid grid-cols-[1fr_7rem_6rem_auto] items-center gap-2">
              <input className="field" placeholder="e.g. Exam duty" disabled={!draft} value={a.label} onChange={(e) => setAdj(adj.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} aria-label="What for" />
              <select className="field" disabled={!draft} value={a.kind} onChange={(e) => setAdj(adj.map((x, j) => (j === i ? { ...x, kind: e.target.value as any } : x)))} aria-label="Type"><option value="earning">Add</option><option value="deduction">Deduct</option></select>
              <input className="field" inputMode="decimal" disabled={!draft} value={a.amount || ''} onChange={(e) => setAdj(adj.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) || 0 } : x)))} aria-label="Amount" />
              {draft && <button className="text-sm text-danger" onClick={() => setAdj(adj.filter((_, j) => j !== i))}>Remove</button>}
            </li>))}</ul>
          {draft && <button className="btn-quiet mt-2 min-h-9 text-sm" onClick={() => setAdj([...adj, { label: '', kind: 'earning', amount: 0 }])}><Plus size={16} aria-hidden />Add a line</button>}
        </section>
        <Field label="Note on the payslip (optional)"><input className="field" disabled={!draft} value={note} onChange={(e) => setNote(e.target.value)} maxLength={255} /></Field>
        <section className="rounded-lg border border-line">
          <p className="border-b border-line px-3 py-2 text-sm font-semibold">Saved payslip · {slip.paidDays} paid days</p>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 px-3 py-2 text-sm">
            {[
              ...by('earning').map((l) => [l.name, inr(l.amount), '']),
              ...slip.adjustments.filter((a) => a.kind === 'earning').map((a) => [a.label, inr(a.amount), '']),
              ['Gross', inr(slip.gross), 'font-semibold'],
              ...by('deduction').map((l) => [l.name, `-${inr(l.amount)}`, 'text-ink-muted']),
              ...slip.adjustments.filter((a) => a.kind === 'deduction').map((a) => [a.label, `-${inr(a.amount)}`, 'text-ink-muted']),
              ['Net pay', inr(slip.net), 'font-semibold'],
              ...by('employer').map((l) => [`${l.name} (paid by school)`, inr(l.amount), 'text-xs text-ink-muted']),
            ].map(([a, b, cls], i) => <div key={i} className="contents"><dt className={cls}>{a}</dt><dd className={clsx('text-right tabular-nums', cls)}>{b}</dd></div>)}
          </dl>
        </section>
      </div>
    </Sheet>
  );
}

function PaidSheet({ run, open, onClose }: { run: Run; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ paidOn: todayISO(), method: 'bank_transfer', reference: '' });
  const m = useMutation({ mutationFn: () => api<Run>(`/payroll/runs/${run.month}/paid`, { method: 'POST', body: { ...f, reference: f.reference || null } }),
    onSuccess: ({ data }) => { qc.setQueryData(['payroll-run', run.month], data); qc.invalidateQueries({ queryKey: ['payroll-runs'] }); toast.success('Marked as paid'); onClose(); }, onError: err });
  return (
    <Sheet open={open} onClose={onClose} title={`Salaries paid for ${run.label}`} footer={<button className="btn-primary w-full" disabled={m.isPending} onClick={() => m.mutate()}>Mark {inr(run.totals.net)} as paid</button>}>
      <div className="space-y-4">
        <Field label="Paid on"><input type="date" className="field" max={todayISO()} value={f.paidOn} onChange={(e) => setF({ ...f, paidOn: e.target.value })} /></Field>
        <Field label="How"><select className="field" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Reference (optional)" hint="Bank batch number, cheque number…"><input className="field" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        <p className="text-sm text-ink-muted">The net pay is also added to Expenses under "Salaries" (when Expenses is switched on). A paid month can no longer be reopened.</p>
      </div>
    </Sheet>
  );
}

function RunView({ month, onDeleted }: { month: string; onDeleted: () => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['payroll-run', month], queryFn: () => api<Run>(`/payroll/runs/${month}`).then((r) => r.data) });
  const [slip, setSlip] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [lops, setLops] = useState<Record<string, string>>({});
  const set = (data: Run) => { qc.setQueryData(['payroll-run', month], data); qc.invalidateQueries({ queryKey: ['payroll-runs'] }); };
  const act = useMutation({
    mutationFn: (v: { path: string; body?: object; method?: string }) => api<Run>(`/payroll/runs/${month}${v.path}`, { method: v.method ?? 'POST', body: v.body }),
    onSuccess: ({ data }, v) => { if (v.method === 'DELETE') { qc.invalidateQueries({ queryKey: ['payroll-runs'] }); onDeleted(); return; } set(data); setLops({}); toast.success('Done'); }, onError: err,
  });
  const lop = useMutation({
    mutationFn: (v: { s: SlipRow; lop: number }) => api<Run>(`/payroll/runs/${month}/slips/${v.s.id}`, { method: 'PATCH', body: { lopDays: v.lop, adjustments: v.s.adjustments, note: v.s.note } }),
    onSuccess: ({ data }) => set(data), onError: (e, v) => { err(e); setLops((l) => ({ ...l, [v.s.id]: String(v.s.lopDays) })); },
  });
  if (q.isLoading) return <Skeleton rows={4} />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />;
  const r = q.data!;
  const draft = r.status === 'draft';
  const card = (label: string, value: string) => <div className="panel p-4"><p className="text-sm text-ink-muted">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{value}</p></div>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><h2 className="text-xl font-semibold">{r.label}</h2><Badge tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge></div>
        <div className="flex flex-wrap gap-2">
          <ExportButtons list="payroll-register" params={{ month }} name={`salary-register-${month}`} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {card('Staff', String(r.totals.staff))}{card('Gross pay', inr(r.totals.gross))}{card('Deductions', inr(r.totals.deductions))}{card('Net pay', inr(r.totals.net))}
      </div>
      {r.missing.length > 0 && <p className="rounded-lg bg-tangedu-soft px-4 py-3 text-sm">No salary set for {r.missing.map((m) => m.name).join(', ')}. Set it in <b>Staff salaries</b>, then press <b>Update salaries</b>.</p>}
      <div className="flex flex-wrap gap-2">
        {draft && can('payroll.manage') && <>
          <button className="btn-quiet min-h-10 text-sm" disabled={act.isPending} onClick={() => act.mutate({ path: '/fill-lop' })}><Wand2 size={16} aria-hidden />Fill loss-of-pay from attendance</button>
          <button className="btn-quiet min-h-10 text-sm" disabled={act.isPending} onClick={() => act.mutate({ path: '/refresh' })}><RefreshCw size={16} aria-hidden />Update salaries</button>
        </>}
        {draft && can('payroll.finalise') && <button className="btn-primary min-h-10 text-sm" disabled={act.isPending || !r.slips.length} onClick={() => confirm(`Finalise payroll for ${r.label}? Staff will see their payslips, and no more changes can be made unless you reopen it.`) && act.mutate({ path: '/finalise' })}>Finalise and send payslips</button>}
        {r.status === 'finalised' && can('payroll.manage') && <button className="btn-primary min-h-10 text-sm" onClick={() => setPaying(true)}>Mark salaries as paid</button>}
        {r.status === 'finalised' && can('payroll.finalise') && <button className="btn-quiet min-h-10 text-sm" onClick={() => { const reason = prompt('Why reopen this month? (kept in the audit log)'); if (reason) act.mutate({ path: '/reopen', body: { reason } }); }}>Reopen</button>}
        {r.status !== 'draft' && <span className="inline-flex items-center gap-2 text-sm text-ink-muted">Bank list: <ExportButtons list="bank-transfer" params={{ month }} name={`bank-transfer-${month}`} /></span>}
        {draft && can('payroll.manage') && <button className="btn-quiet min-h-10 text-sm text-danger" onClick={() => confirm(`Delete the draft for ${r.label}?`) && act.mutate({ path: '', method: 'DELETE' })}>Delete draft</button>}
      </div>
      {r.status === 'paid' && <p className="text-sm text-ink-muted">Paid on {r.paidOn} by {METHOD_LABEL[r.paidMethod ?? ''] ?? r.paidMethod}{r.paidReference ? ` · ${r.paidReference}` : ''}.</p>}
      {draft && <p className="text-sm text-ink-muted">Loss-of-pay days are out of {r.divisor}: {DIVISOR_LABEL[r.divisorRule]?.toLowerCase().replace(' (28 to 31)', '')}. Type them in the LOP column, or use the attendance suggestion.</p>}

      {!r.slips.length ? <EmptyState title="No payslips yet" body="Set staff salaries first, then press Update salaries." /> : (
        <div className="panel overflow-x-auto">
          <table className="w-full text-left text-[15px] sm:min-w-[720px]">
            <thead className="border-b border-line text-sm text-ink-muted"><tr>
              <th className="px-4 py-3 font-medium">Staff</th><th className="px-3 py-3 font-medium">LOP days</th><th className="hidden px-3 py-3 text-right font-medium sm:table-cell">Gross</th>
              <th className="hidden px-3 py-3 text-right font-medium sm:table-cell">Deductions</th><th className="hidden px-3 py-3 text-right font-medium sm:table-cell">Net pay</th><th className="hidden px-3 py-3 sm:table-cell" /></tr></thead>
            <tbody className="divide-y divide-line">{r.slips.map((s) => (
              <tr key={s.id} className="align-top">
                <td className="px-4 py-3"><p className="font-semibold">{s.name}</p><p className="text-sm text-ink-muted">{s.code}{s.designation ? ` · ${s.designation}` : ''}{!s.bankReady ? ' · no bank details' : ''}</p>
                  <p className="text-xs text-ink-muted">{hintText(s.hint)}</p>
                  <div className="mt-2 flex items-center gap-4 text-sm sm:hidden"><span>Net <b className="tabular-nums">{inr(s.net)}</b></span>
                    <button className="font-semibold text-brand" onClick={() => setSlip(s.id)}>{draft ? 'Edit' : 'Details'}</button>
                    <button className="font-semibold text-brand" onClick={() => openProtected(`/payslips/${s.id}/pdf`).catch(err)}>PDF</button></div></td>
                <td className="px-3 py-3">{draft && can('payroll.manage') ? (
                  <input className="field w-20" inputMode="decimal" aria-label={`Loss-of-pay days for ${s.name}`} value={lops[s.id] ?? String(s.lopDays)}
                    onChange={(e) => setLops({ ...lops, [s.id]: e.target.value.replace(/[^0-9.]/g, '') })}
                    onBlur={() => { const v = Number(lops[s.id] ?? s.lopDays); if (v !== s.lopDays) lop.mutate({ s, lop: v }); }} />) : <span className="tabular-nums">{s.lopDays}</span>}</td>
                <td className="hidden px-3 py-3 sm:table-cell text-right tabular-nums">{inr(s.gross)}</td>
                <td className="hidden px-3 py-3 sm:table-cell text-right tabular-nums">{inr(s.deductions)}</td>
                <td className="hidden px-3 py-3 sm:table-cell text-right font-semibold tabular-nums">{inr(s.net)}</td>
                <td className="hidden px-3 py-3 sm:table-cell text-right"><div className="flex justify-end gap-3 text-sm font-semibold text-brand">
                  <button onClick={() => setSlip(s.id)}>{draft ? 'Edit' : 'Details'}</button>
                  <button onClick={() => openProtected(`/payslips/${s.id}/pdf`).catch(err)}>PDF</button></div></td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      <SlipSheet slip={r.slips.find((s) => s.id === slip) ?? null} run={r} onClose={() => setSlip(null)} />
      <PaidSheet run={r} open={paying} onClose={() => setPaying(false)} />
    </div>
  );
}

function MonthlyTab() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['payroll-runs'], queryFn: () => api<RunsData>('/payroll/runs').then((r) => r.data) });
  const [month, setMonth] = useState<string | null>(null);
  const [newMonth, setNewMonth] = useState('');
  useEffect(() => { if (q.data && month === null) { setMonth(q.data.runs[0]?.month ?? ''); setNewMonth(prevMonthOf(`${q.data.currentMonth}-01`)); } }, [q.data, month]);
  const create = useMutation({ mutationFn: () => api<Run>('/payroll/runs', { method: 'POST', body: { month: newMonth } }),
    onSuccess: ({ data }) => { qc.setQueryData(['payroll-run', data.month], data); qc.invalidateQueries({ queryKey: ['payroll-runs'] }); setMonth(data.month); toast.success(`Draft for ${data.label} ready`); }, onError: err });
  if (q.isLoading) return <Skeleton rows={3} />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const exists = d.runs.some((r) => r.month === newMonth);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        {d.runs.length > 0 && <Field label="Month"><select className="field min-w-56" value={month ?? ''} onChange={(e) => setMonth(e.target.value)}>
          {d.runs.map((r) => <option key={r.month} value={r.month}>{r.label} · {STATUS[r.status][0]} · {inr(r.net)}</option>)}</select></Field>}
        {can('payroll.manage') && <div className="flex items-end gap-2">
          <Field label="Prepare payroll for"><input type="month" className="field" max={d.currentMonth} value={newMonth} onChange={(e) => setNewMonth(e.target.value)} /></Field>
          <button className="btn-primary" disabled={!newMonth || exists || create.isPending} onClick={() => create.mutate()}>{exists ? 'Already prepared' : create.isPending ? 'Preparing…' : `Prepare ${newMonth ? monthLabel(newMonth) : ''}`}</button>
        </div>}
      </div>
      {month ? <RunView key={month} month={month} onDeleted={() => setMonth(d.runs.find((r) => r.month !== month)?.month ?? '')} />
        : <EmptyState title="No payroll yet" body="1. Add pay items (Basic is ready). 2. Make a template. 3. Set each staff member's salary. 4. Prepare the month here." />}
    </div>
  );
}

// ---------------- Salary lines editor (templates and staff) ----------------

function LinesEditor({ components, lines, onChange }: { components: Component[]; lines: Line[]; onChange: (l: Line[]) => void }) {
  const active = components.filter((c) => c.isActive);
  const value = (id: number) => lines.find((l) => l.componentId === id)?.value;
  const set = (c: Component, v: string) => {
    const n = v === '' ? undefined : Number(v);
    const rest = lines.filter((l) => l.componentId !== c.id);
    onChange(n === undefined || Number.isNaN(n) ? rest : [...rest, { componentId: c.id, value: n }]);
  };
  const p = previewSalary(components, lines);
  return (
    <div className="space-y-4">
      {(['earning', 'deduction', 'employer'] as Kind[]).map((k) => active.some((c) => c.kind === k) && (
        <section key={k}>
          <h3 className="label">{k === 'earning' ? 'Earnings' : k === 'deduction' ? 'Deductions' : 'Paid by the school (not deducted)'}</h3>
          <ul className="space-y-2">{active.filter((c) => c.kind === k).map((c) => {
            const amount = p.rows.find((r) => r.c.id === c.id)?.amount;
            return (
              <li key={c.id} className="grid grid-cols-[1fr_7.5rem] items-center gap-3">
                <div><p className="text-[15px] font-medium">{c.name}</p><p className="text-xs text-ink-muted">{c.calc === 'fixed' ? '₹ per month' : CALC_LABEL[c.calc]}{c.maxAmount ? ` · up to ${inr(c.maxAmount)}` : ''}{amount != null && c.calc !== 'fixed' ? ` · ${inr(amount)}` : ''}</p></div>
                <div className="relative"><input className="field pr-8 text-right" inputMode="decimal" placeholder={c.isBasic ? 'Required' : 'Not used'} value={value(c.id) ?? ''} onChange={(e) => set(c, e.target.value.replace(/[^0-9.]/g, ''))} aria-label={c.name} />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-muted">{c.calc === 'fixed' ? '₹' : '%'}</span></div>
              </li>);
          })}</ul>
        </section>
      ))}
      <dl className="grid grid-cols-2 gap-2 rounded-lg bg-chalk p-3 text-sm sm:grid-cols-4">
        <div><dt className="text-ink-muted">Gross</dt><dd className="font-semibold tabular-nums">{inr(p.gross)}</dd></div>
        <div><dt className="text-ink-muted">Deductions</dt><dd className="font-semibold tabular-nums">{inr(p.deductions)}</dd></div>
        <div><dt className="text-ink-muted">Net pay</dt><dd className="font-semibold tabular-nums">{inr(p.net)}</dd></div>
        <div><dt className="text-ink-muted">School pays extra</dt><dd className="font-semibold tabular-nums">{inr(p.employer)}</dd></div>
      </dl>
    </div>
  );
}

const useComponents = () => useQuery({ queryKey: ['pay-components'], queryFn: () => api<Component[]>('/payroll/components').then((r) => r.data) });
const useTemplates = () => useQuery({ queryKey: ['pay-templates'], queryFn: () => api<Template[]>('/payroll/templates').then((r) => r.data) });

// ---------------- Staff salaries ----------------

interface SalaryRow { id: string; name: string; code: string; designation: string | null; effectiveFrom: string | null; template: string | null; upcoming: boolean; gross: number | null; deductions: number | null; net: number | null }

function SalarySheet({ staffId, onClose }: { staffId: string | null; onClose: () => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const comps = useComponents(); const tpls = useTemplates();
  const q = useQuery({ queryKey: ['salary', staffId], enabled: !!staffId, queryFn: () => api<any>(`/payroll/salaries/${staffId}`).then((r) => r.data) });
  const [f, setF] = useState<{ effectiveFrom: string; templateId: number | null; lines: Line[]; note: string }>({ effectiveFrom: '', templateId: null, lines: [], note: '' });
  useEffect(() => {
    if (!q.data) return;
    const cur = q.data.revisions[0];
    setF({ effectiveFrom: `${todayISO().slice(0, 7)}-01`, templateId: cur?.templateId ?? null, lines: cur?.lines ?? [], note: '' });
  }, [q.data]);
  const save = useMutation({ mutationFn: () => api(`/payroll/salaries/${staffId}`, { method: 'PUT', body: { ...f, note: f.note || null } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['salary', staffId] }); qc.invalidateQueries({ queryKey: ['salaries'] }); toast.success('Salary saved'); onClose(); }, onError: err });
  const edit = can('payroll.manage');
  return (
    <Sheet open={!!staffId} onClose={onClose} title={q.data?.staff.name ?? 'Salary'}
      footer={edit && <button className="btn-primary w-full" disabled={save.isPending || !f.effectiveFrom} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save salary'}</button>}>
      {!q.data || !comps.data ? <Skeleton rows={4} /> : (
        <div className="space-y-5">
          {edit && <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Starts from" hint="Payroll for this month onwards uses it."><input type="date" className="field" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} /></Field>
              <Field label="Start from a template"><select className="field" value={f.templateId ?? ''} onChange={(e) => {
                const t = tpls.data?.find((x) => x.id === Number(e.target.value));
                setF({ ...f, templateId: t?.id ?? null, lines: t ? t.lines : f.lines });
              }}><option value="">None</option>{tpls.data?.filter((t) => t.isActive).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
            </div>
            <LinesEditor components={comps.data} lines={f.lines} onChange={(lines) => setF({ ...f, lines })} />
            <Field label="Note (optional)" hint="e.g. Annual increment"><input className="field" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={255} /></Field>
          </>}
          <section>
            <h3 className="label">History</h3>
            {!q.data.revisions.length ? <p className="text-sm text-ink-muted">No salary yet.</p> : (
              <ul className="divide-y divide-line rounded-lg border border-line">{q.data.revisions.map((r: any) => (
                <li key={r.effectiveFrom} className="flex justify-between gap-3 px-3 py-2 text-sm">
                  <span>From {r.effectiveFrom}{r.template ? ` · ${r.template}` : ''}{r.note ? ` · ${r.note}` : ''}</span><span className="tabular-nums">Net {inr(r.preview.net)}</span></li>))}</ul>)}
          </section>
        </div>
      )}
    </Sheet>
  );
}

function ApplyTemplateSheet({ open, onClose, staff }: { open: boolean; onClose: () => void; staff: SalaryRow[] }) {
  const qc = useQueryClient();
  const tpls = useTemplates();
  const [tid, setTid] = useState<number | ''>('');
  const [from, setFrom] = useState(`${todayISO().slice(0, 7)}-01`);
  const [ids, setIds] = useState<string[]>([]);
  const m = useMutation({ mutationFn: () => api<{ updated: number }>(`/payroll/templates/${tid}/apply`, { method: 'POST', body: { staffIds: ids, effectiveFrom: from } }),
    onSuccess: ({ data }) => { qc.invalidateQueries({ queryKey: ['salaries'] }); toast.success(`Salary set for ${data.updated} staff`); setIds([]); onClose(); }, onError: err });
  return (
    <Sheet open={open} onClose={onClose} title="Give a template to several staff"
      footer={<button className="btn-primary w-full" disabled={!tid || !ids.length || m.isPending} onClick={() => m.mutate()}>Set salary for {ids.length} staff</button>}>
      <div className="space-y-4">
        <Field label="Template"><select className="field" value={tid} onChange={(e) => setTid(e.target.value ? Number(e.target.value) : '')}><option value="">Choose…</option>{tpls.data?.filter((t) => t.isActive).map((t) => <option key={t.id} value={t.id}>{t.name} · net {inr(t.preview.net)}</option>)}</select></Field>
        <Field label="Starts from"><input type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <p className="text-sm text-ink-muted">The template's amounts are copied. You can change any one person afterwards.</p>
        <div className="flex gap-3 text-sm font-semibold text-brand"><button onClick={() => setIds(staff.map((s) => s.id))}>Select all</button><button onClick={() => setIds(staff.filter((s) => s.gross == null).map((s) => s.id))}>Only staff without a salary</button><button onClick={() => setIds([])}>Clear</button></div>
        <ul className="space-y-1.5">{staff.map((s) => (
          <li key={s.id}><label className="flex min-h-11 items-center gap-2.5 rounded-lg border border-line px-3 has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
            <input type="checkbox" className="h-4 w-4 accent-[var(--color-brand)]" checked={ids.includes(s.id)} onChange={(e) => setIds(e.target.checked ? [...ids, s.id] : ids.filter((x) => x !== s.id))} />
            <span className="flex-1">{s.name}</span><span className="text-sm text-ink-muted">{s.template ?? (s.gross == null ? 'No salary' : 'Custom')}</span></label></li>))}</ul>
      </div>
    </Sheet>
  );
}

function SalariesTab() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['salaries'], queryFn: () => api<SalaryRow[]>('/payroll/salaries').then((r) => r.data) });
  const [open, setOpen] = useState<string | null>(null);
  const [bulk, setBulk] = useState(false);
  if (q.isLoading) return <Skeleton rows={4} />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} />;
  const rows = q.data!;
  const missing = rows.filter((r) => r.gross == null).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">{rows.length} active staff{missing ? ` · ${missing} without a salary` : ''}</p>
        {can('payroll.manage') && <button className="btn-quiet min-h-10 text-sm" onClick={() => setBulk(true)}>Give a template to several staff</button>}
      </div>
      {!rows.length ? <EmptyState title="No staff yet" body="Add staff first." /> : (
        <ul className="panel divide-y divide-line">{rows.map((s) => (
          <li key={s.id}><button className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left hover:bg-chalk" onClick={() => setOpen(s.id)}>
            <span><span className="font-semibold">{s.name}</span><span className="block text-sm text-ink-muted">{s.code}{s.designation ? ` · ${s.designation}` : ''}{s.template ? ` · ${s.template}` : ''}{s.effectiveFrom ? ` · from ${s.effectiveFrom}` : ''}{s.upcoming ? ' (upcoming)' : ''}</span></span>
            {s.gross == null ? <Badge tone="attention">Set salary</Badge> : <span className="text-right text-sm"><span className="block font-semibold tabular-nums">Net {inr(s.net)}</span><span className="text-ink-muted tabular-nums">Gross {inr(s.gross)}</span></span>}
          </button></li>))}</ul>
      )}
      <SalarySheet staffId={open} onClose={() => setOpen(null)} />
      <ApplyTemplateSheet open={bulk} onClose={() => setBulk(false)} staff={rows} />
    </div>
  );
}

// ---------------- Pay items ----------------

const emptyComp = { code: '', name: '', kind: 'earning' as Kind, calc: 'fixed' as Calc, defaultValue: 0, maxAmount: null as number | null, prorate: true, isActive: true, sortOrder: 10 };

function ComponentSheet({ comp, onClose }: { comp: Component | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState(emptyComp);
  useEffect(() => { if (comp) setF(comp === 'new' ? emptyComp : { code: comp.code, name: comp.name, kind: comp.kind, calc: comp.calc, defaultValue: comp.defaultValue, maxAmount: comp.maxAmount, prorate: comp.prorate, isActive: comp.isActive, sortOrder: comp.sortOrder }); }, [comp]);
  const m = useMutation({ mutationFn: () => api<Component[]>(comp === 'new' ? '/payroll/components' : `/payroll/components/${(comp as Component).id}`, { method: comp === 'new' ? 'POST' : 'PATCH', body: f }),
    onSuccess: ({ data }) => { qc.setQueryData(['pay-components'], data); qc.invalidateQueries({ queryKey: ['pay-templates'] }); toast.success('Saved'); onClose(); }, onError: err });
  if (!comp) return null;
  const c = comp === 'new' ? null : comp;
  const locked = !!c?.inUse, basic = !!c?.isBasic;
  return (
    <Sheet open onClose={onClose} title={c ? c.name : 'New pay item'} footer={<button className="btn-primary w-full" disabled={m.isPending} onClick={() => m.mutate()}>Save</button>}>
      <div className="space-y-4">
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <Field label="Name" hint="As it appears on the payslip"><input className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. House rent allowance" /></Field>
          <Field label="Short code"><input className="field uppercase" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="HRA" /></Field>
        </div>
        <Field label="Type" hint={locked ? 'Already in salaries, so the type cannot change.' : undefined}>
          <select className="field" disabled={locked || basic} value={f.kind} onChange={(e) => { const kind = e.target.value as Kind; setF({ ...f, kind, calc: kind === 'earning' && f.calc === 'pct_gross' ? 'fixed' : f.calc, prorate: kind === 'earning' }); }}>
            {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="How it is worked out">
          <select className="field" disabled={locked || basic} value={f.calc} onChange={(e) => setF({ ...f, calc: e.target.value as Calc })}>
            {Object.entries(CALC_LABEL).filter(([k]) => !(f.kind === 'earning' && k === 'pct_gross')).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        {!basic && <div className="grid grid-cols-2 gap-3">
          <Field label={f.calc === 'fixed' ? 'Usual amount (₹)' : 'Usual percentage'} hint="Filled in for new salaries; change per person."><input className="field" inputMode="decimal" value={f.defaultValue} onChange={(e) => setF({ ...f, defaultValue: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 })} /></Field>
          <Field label="Most it can be (₹, optional)" hint="e.g. PF up to 1,800"><input className="field" inputMode="decimal" value={f.maxAmount ?? ''} onChange={(e) => setF({ ...f, maxAmount: e.target.value ? Number(e.target.value.replace(/[^0-9.]/g, '')) : null })} /></Field>
        </div>}
        {f.calc === 'fixed' && !basic && <label className="flex items-center justify-between gap-4"><span><span className="block font-medium">Reduce for loss-of-pay days</span><span className="text-sm text-ink-muted">Percentages always follow the reduced Basic or Gross.</span></span>
          <Toggle checked={f.prorate} onChange={(v) => setF({ ...f, prorate: v })} label="Reduce for loss-of-pay days" /></label>}
        {!basic && c && <label className="flex items-center justify-between gap-4"><span className="font-medium">In use</span><Toggle checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} label="In use" /></label>}
        <Field label="Order on the payslip"><input className="field w-24" inputMode="numeric" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: Number(e.target.value) || 0 })} /></Field>
      </div>
    </Sheet>
  );
}

function ItemsTab() {
  const { can } = useAuth();
  const q = useComponents();
  const [open, setOpen] = useState<Component | 'new' | null>(null);
  if (q.isLoading) return <Skeleton rows={4} />;
  const rows = q.data ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-ink-muted">Add your own earnings (DA, HRA, allowances), deductions (PF, ESI, professional tax, advances) and what the school pays on top (employer PF). Each is a fixed amount or a percentage.</p>
        {can('payroll.manage') && <button className="btn-primary min-h-10 text-sm" onClick={() => setOpen('new')}><Plus size={16} aria-hidden />Add pay item</button>}
      </div>
      <ul className="panel divide-y divide-line">{rows.map((c) => (
        <li key={c.id}><button disabled={!can('payroll.manage')} className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left hover:bg-chalk disabled:hover:bg-transparent" onClick={() => setOpen(c)}>
          <span><span className={clsx('font-semibold', !c.isActive && 'text-ink-muted line-through')}>{c.name}</span> <span className="text-sm text-ink-muted">{c.code}</span>
            <span className="block text-sm text-ink-muted">{CALC_LABEL[c.calc]}{c.calc !== 'fixed' && c.defaultValue ? ` · usually ${c.defaultValue}%` : ''}{c.maxAmount ? ` · up to ${inr(c.maxAmount)}` : ''}{c.calc === 'fixed' && !c.isBasic ? (c.prorate ? ' · reduced for LOP' : ' · not reduced for LOP') : ''}</span></span>
          <Badge tone={c.kind === 'earning' ? 'brand' : c.kind === 'deduction' ? 'attention' : 'neutral'}>{KIND_LABEL[c.kind]}</Badge>
        </button></li>))}</ul>
      <ComponentSheet comp={open} onClose={() => setOpen(null)} />
    </div>
  );
}

// ---------------- Templates ----------------

function TemplateSheet({ tpl, onClose }: { tpl: Template | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const comps = useComponents();
  const [f, setF] = useState<{ name: string; isActive: boolean; lines: Line[] }>({ name: '', isActive: true, lines: [] });
  useEffect(() => {
    if (!tpl || !comps.data) return;
    setF(tpl === 'new' ? { name: '', isActive: true, lines: comps.data.filter((c) => c.isActive && !c.isBasic && c.defaultValue > 0).map((c) => ({ componentId: c.id, value: c.defaultValue })) }
      : { name: tpl.name, isActive: tpl.isActive, lines: tpl.lines });
  }, [tpl, comps.data]);
  const save = useMutation({ mutationFn: () => api<Template[]>(tpl === 'new' ? '/payroll/templates' : `/payroll/templates/${(tpl as Template).id}`, { method: tpl === 'new' ? 'POST' : 'PATCH', body: f }),
    onSuccess: ({ data }) => { qc.setQueryData(['pay-templates'], data); toast.success('Template saved'); onClose(); }, onError: err });
  const del = useMutation({ mutationFn: () => api<Template[]>(`/payroll/templates/${(tpl as Template).id}`, { method: 'DELETE' }),
    onSuccess: ({ data }) => { qc.setQueryData(['pay-templates'], data); onClose(); }, onError: err });
  if (!tpl) return null;
  return (
    <Sheet open onClose={onClose} title={tpl === 'new' ? 'New salary template' : tpl.name}
      footer={<div className="flex gap-2">{tpl !== 'new' && <button className="btn-quiet text-danger" onClick={() => confirm('Delete this template? Salaries already set from it stay as they are.') && del.mutate()}>Delete</button>}
        <button className="btn-primary flex-1" disabled={save.isPending || f.name.trim().length < 2} onClick={() => save.mutate()}>Save template</button></div>}>
      {!comps.data ? <Skeleton /> : (
        <div className="space-y-4">
          <Field label="Template name" hint="e.g. Primary teacher, High school teacher, Office staff, Driver"><input className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <LinesEditor components={comps.data} lines={f.lines} onChange={(lines) => setF({ ...f, lines })} />
        </div>
      )}
    </Sheet>
  );
}

function TemplatesTab() {
  const { can } = useAuth();
  const q = useTemplates();
  const [open, setOpen] = useState<Template | 'new' | null>(null);
  if (q.isLoading) return <Skeleton rows={3} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">A template is a ready salary for a kind of post. Copy it to staff, then change amounts for any one person.</p>
        {can('payroll.manage') && <button className="btn-primary min-h-10 text-sm" onClick={() => setOpen('new')}><Plus size={16} aria-hidden />New template</button>}
      </div>
      {!q.data?.length ? <EmptyState title="No templates yet" body="Make one for each kind of post, for example Teacher and Office staff." /> : (
        <ul className="grid gap-3 sm:grid-cols-2">{q.data.map((t) => (
          <li key={t.id}><button disabled={!can('payroll.manage')} onClick={() => setOpen(t)} className="panel w-full p-4 text-left">
            <p className="font-semibold">{t.name}</p>
            <p className="mt-1 text-sm text-ink-muted tabular-nums">Gross {inr(t.preview.gross)} · Deductions {inr(t.preview.deductions)} · <b className="text-ink">Net {inr(t.preview.net)}</b></p>
          </button></li>))}</ul>
      )}
      <TemplateSheet tpl={open} onClose={() => setOpen(null)} />
    </div>
  );
}

// ---------------- Settings ----------------

function SettingsTab() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['payroll-settings'], queryFn: () => api<{ lopDivisor: string }>('/payroll/settings').then((r) => r.data) });
  const m = useMutation({ mutationFn: (lopDivisor: string) => api('/payroll/settings', { method: 'PUT', body: { lopDivisor } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payroll-settings'] }); qc.invalidateQueries({ queryKey: ['payroll-runs'] }); toast.success('Saved. New months use this rule.'); }, onError: err });
  if (!q.data) return <Skeleton rows={2} />;
  return (
    <section className="panel max-w-xl p-5">
      <h2 className="font-semibold">One day's pay = monthly pay divided by</h2>
      <p className="mb-3 text-sm text-ink-muted">Used for loss-of-pay days. Months already prepared keep the rule they were made with.</p>
      <div className="space-y-2">{Object.entries(DIVISOR_LABEL).map(([k, v]) => (
        <label key={k} className="flex min-h-11 items-center gap-3 rounded-lg border border-line px-3 has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
          <input type="radio" name="divisor" className="accent-[var(--color-brand)]" disabled={!can('payroll.finalise') || m.isPending} checked={q.data!.lopDivisor === k} onChange={() => m.mutate(k)} />{v}</label>))}</div>
      {!can('payroll.finalise') && <p className="mt-3 text-sm text-ink-muted">Only the Institution Admin can change this.</p>}
    </section>
  );
}

const TABS = [['monthly', 'Monthly payroll'], ['salaries', 'Staff salaries'], ['items', 'Pay items'], ['templates', 'Templates'], ['settings', 'Rules']] as const;

export default function PayrollPage() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>(() => (new URLSearchParams(location.search).get('tab') as any) ?? 'monthly');
  const body = useMemo(() => ({ monthly: <MonthlyTab />, salaries: <SalariesTab />, items: <ItemsTab />, templates: <TemplatesTab />, settings: <SettingsTab /> }[tab]), [tab]);
  return (
    <div>
      <PageHeader title="Payroll" description="Salaries, loss-of-pay, payslips and the salary register." />
      <div className="mb-5 flex gap-1 overflow-x-auto rounded-lg border border-line bg-chalk p-0.5 sm:inline-flex">
        {TABS.map(([k, label]) => <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)} className={clsx('shrink-0 rounded-md px-4 py-2 text-sm font-semibold', tab === k ? 'bg-surface text-brand shadow-sm' : 'text-ink-muted')}>{label}</button>)}
      </div>
      {body}
    </div>
  );
}

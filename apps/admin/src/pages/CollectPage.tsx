import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, MessageCircle, Search, X } from 'lucide-react';
import clsx from 'clsx';
import { api, ApiError, fieldErrors, shown } from '../lib/api';
import { fullName, initials } from '../lib/academics';
import { inr, METHOD_LABEL, todayISO, whatsappLink, type FeeItem, type StudentFees } from '../lib/fees';
import { EmptyState, ErrorState, Field, PageHeader, Skeleton } from '../components/ui';
import { ReceiptActions, StatusChip } from '../components/FeeParts';
import type { StudentRow } from './StudentsPage';

interface Group { key: string; title: string; subtitle: string; outstanding: number; items: FeeItem[]; line: (amount: number) => object; previous: boolean }

function buildGroups(f: StudentFees): Group[] {
  const open = f.items.filter((i) => Number(i.balance) > 0);
  const years = [...new Set(open.map((i) => i.academic_year_id))];
  const groups: Group[] = [];
  for (const y of years) {
    const ofYear = open.filter((i) => i.academic_year_id === y);
    const prev = ofYear[0].previous_year, yearName = ofYear[0].year;
    const tuition = ofYear.filter((i) => i.category === 'tuition');
    if (tuition.length) groups.push({ key: `t${y}`, title: prev ? `Tuition ${yearName}` : 'Tuition', previous: prev, items: tuition,
      subtitle: tuition.map((i) => `${i.label.replace('Tuition ', '')} ${inr(i.balance)}`).join(' · '),
      outstanding: tuition.reduce((t, i) => t + Number(i.balance), 0), line: (amount) => ({ category: 'tuition', academicYearId: y, amount }) });
    const bus = ofYear.filter((i) => i.category === 'bus');
    if (bus.length) groups.push({ key: `b${y}`, title: prev ? `Bus ${yearName}` : 'Bus fee', previous: prev, items: bus, subtitle: bus[0].due_date ? `Due ${new Date(bus[0].due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : '',
      outstanding: bus.reduce((t, i) => t + Number(i.balance), 0), line: (amount) => ({ category: 'bus', academicYearId: y, amount }) });
    for (const o of ofYear.filter((i) => i.category === 'one_time')) {
      groups.push({ key: `o${o.id}`, title: o.label + (prev ? ` (${yearName})` : ''), previous: prev, items: [o], subtitle: '',
        outstanding: Number(o.balance), line: (amount) => ({ category: 'one_time', feeItemId: o.id, amount }) });
    }
  }
  return groups.sort((a, b) => Number(b.previous) - Number(a.previous));
}

export function StudentPicker({ onPick, placeholder }: { onPick: (id: string, row: StudentRow) => void; placeholder?: string }) {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const res = useQuery({ queryKey: ['students', 'pick', term], enabled: term.length >= 2, queryFn: () => api<StudentRow[]>('/students', { query: { search: term, pageSize: 20 } }).then((r) => r.data) });
  return (
    <div className="max-w-xl">
      <div className="relative">
        <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden />
        <input autoFocus className="field pl-10 text-base" placeholder={placeholder ?? "Student name, admission no, or parent mobile"} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find student" />
      </div>
      {term.length >= 2 && (
        <ul className="panel mt-2 divide-y divide-line">
          {res.isLoading ? <li className="p-4 text-ink-muted">Searching…</li> : !res.data?.length ? <li className="p-4 text-ink-muted">No student found.</li> : res.data.map((s) => (
            <li key={s.public_id}>
              <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-chalk" onClick={() => onPick(s.public_id, s)}>
                <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-soft text-sm font-semibold text-brand">{initials(fullName(s))}</span>
                <span className="flex-1"><span className="block font-semibold">{fullName(s)}</span><span className="text-sm text-ink-muted">{s.class_name} {s.section_name} · Adm {s.admission_no} · {s.father_name ?? s.family_name}</span></span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface Receipt { public_id: string; receipt_no: string; total_amount: string; balance_due: string; payment_date: string; method: string }

export default function CollectPage() {
  const [params, setParams] = useSearchParams();
  const studentId = params.get('student');
  const qc = useQueryClient();
  const student = useQuery({ queryKey: ['student', studentId], enabled: !!studentId, queryFn: () => api<any>(`/students/${studentId}`).then((r) => r.data) });
  const fees = useQuery({ queryKey: ['fees', studentId], enabled: !!studentId, queryFn: () => api<StudentFees>(`/students/${studentId}/fees`).then((r) => r.data) });
  const groups = useMemo(() => (fees.data ? buildGroups(fees.data) : []), [fees.data]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [method, setMethod] = useState<'cash' | 'upi' | 'cheque' | 'bank_transfer' | 'card'>('cash');
  const [ref, setRef] = useState('');
  const [date, setDate] = useState(todayISO());
  const [remarks, setRemarks] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Receipt | null>(null);
  useEffect(() => { setAmounts({}); setErrors({}); setDone(null); setRef(''); setRemarks(''); }, [studentId]);

  const total = groups.reduce((t, g) => t + (Number(amounts[g.key]) || 0), 0);
  const save = useMutation({
    mutationFn: () => api<Receipt>('/payments', { method: 'POST', body: {
      studentId, paymentDate: date, method, referenceNo: ref || null, remarks: remarks || null,
      lines: groups.filter((g) => Number(amounts[g.key]) > 0).map((g) => g.line(Number(amounts[g.key]))),
    } }),
    onSuccess: ({ data }) => { setDone(data); qc.invalidateQueries({ queryKey: ['fees'] }); qc.invalidateQueries({ queryKey: ['fees-summary'] }); },
    onError: (e) => {
      const fe = fieldErrors(e);
      const mapped: Record<string, string> = {};
      for (const [k, v] of Object.entries(fe)) {
        const m = /^lines\.(\d+)\./.exec(k);
        if (m) { const g = groups.filter((x) => Number(amounts[x.key]) > 0)[Number(m[1])]; if (g) mapped[g.key] = v; } else mapped[k] = v;
      }
      setErrors(Object.keys(mapped).length ? mapped : { form: (e as ApiError).message });
    },
  });

  if (!studentId) return (<div><PageHeader title="Collect fees" description="Find the student, enter what the parent is paying, and share the receipt." /><StudentPicker onPick={(id) => setParams({ student: id })} /></div>);
  if (student.isLoading || fees.isLoading) return <Skeleton rows={5} />;
  if (student.isError || fees.isError) return <ErrorState message={((student.error || fees.error) as Error).message} />;
  const s = student.data, f = fees.data!;
  const name = fullName(s);

  if (done) {
    const text = `Dear Parent, received ${inr(done.total_amount)} towards fees of ${name} (${s.class_name ?? ''} ${s.section_name ?? ''}). Receipt ${done.receipt_no}.${Number(done.balance_due) > 0 ? ` Balance due: ${inr(done.balance_due)}.` : ' No dues pending.'} Thank you.`;
    return (
      <div className="mx-auto max-w-lg">
        <div className="panel p-6 text-center">
          <CheckCircle2 size={44} className="mx-auto text-brand" aria-hidden />
          <h1 className="mt-3 text-2xl font-semibold">{inr(done.total_amount)} received</h1>
          <p className="mt-1 text-ink-muted">{name} · {done.receipt_no}</p>
          <p className={clsx('mt-3 inline-block rounded-lg px-3 py-1.5 text-sm font-semibold', Number(done.balance_due) > 0 ? 'bg-tangedu-soft text-[#7A5A00]' : 'bg-brand-soft text-brand')}>
            {Number(done.balance_due) > 0 ? `Balance still due ${inr(done.balance_due)}` : 'No dues pending'}</p>
          <div className="mt-6 flex flex-col items-stretch gap-2">
            <ReceiptActions publicId={done.public_id} receiptNo={done.receipt_no} shareText={text} />
            {s.family_mobile && s.family_mobile !== '__hidden__' && (
              <a className="btn w-full bg-[#1F7A4D] text-white hover:brightness-110" href={whatsappLink(s.family_mobile, text)} target="_blank" rel="noreferrer"><MessageCircle size={18} aria-hidden />Send message on WhatsApp</a>
            )}
            <p className="text-sm text-ink-muted">On a phone, <strong>Share PDF</strong> lets you pick WhatsApp and attach the receipt directly.</p>
          </div>
        </div>
        <div className="mt-4 flex justify-center gap-2">
          <button className="btn-quiet" onClick={() => setParams({})}>Collect from another student</button>
          <Link className="btn-quiet" to={`/students/${studentId}`}>Open student</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-24 lg:pb-0">
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-lg font-semibold text-brand">{initials(name)}</span>
        <div className="flex-1">
          <h1 className="text-xl font-semibold">{name}</h1>
          <p className="text-sm text-ink-muted">{s.class_name} {s.section_name} · Adm {s.admission_no} · {s.father_name ?? s.family_name} · {shown(s.family_mobile)}</p>
        </div>
        <button className="rounded-lg p-2 text-ink-muted hover:bg-chalk" onClick={() => setParams({})} aria-label="Choose another student"><X size={20} /></button>
      </div>

      {!f.configured ? <EmptyState title="Fees are not set up for this class" body="Set the default plan and this class's tuition fee in Fee setup." action={<Link to="/fees/setup" className="btn-primary">Open fee setup</Link>} />
        : groups.length === 0 ? <EmptyState title="Nothing due" body={`${s.first_name} has paid everything for now.`} /> : (
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <section className="space-y-3">
            {groups.map((g) => (
              <div key={g.key} className={clsx('panel p-4', g.previous && 'border-danger/30 bg-danger-soft/30')}>
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{g.title} {g.previous && <span className="text-sm font-medium text-danger">· previous year</span>}</p>
                    <p className="text-sm text-ink-muted">{g.subtitle}</p>
                    <div className="mt-1 flex flex-wrap gap-1">{g.items.filter((i) => i.overdue).length > 0 && <StatusChip item={g.items.find((i) => i.overdue)!} />}</div>
                  </div>
                  <div className="text-right"><p className="text-xs text-ink-muted">Due</p><p className="font-semibold tabular-nums">{inr(g.outstanding)}</p></div>
                </div>
                <div className="mt-3 flex gap-2">
                  <div className="relative flex-1">
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted">₹</span>
                    <input className="field pl-8 tabular-nums" inputMode="decimal" placeholder="0" aria-label={`Amount for ${g.title}`}
                      value={amounts[g.key] ?? ''} onChange={(e) => setAmounts({ ...amounts, [g.key]: e.target.value.replace(/[^\d.]/g, '') })} />
                  </div>
                  <button className="btn-quiet min-h-11 px-3 text-sm" onClick={() => setAmounts({ ...amounts, [g.key]: String(g.outstanding) })}>Full</button>
                </div>
                {errors[g.key] && <p className="mt-1.5 text-sm text-danger" role="alert">{errors[g.key]}</p>}
              </div>
            ))}
          </section>

          <aside className="space-y-4 lg:sticky lg:top-8 lg:self-start">
            <div className="panel space-y-4 p-4">
              <div>
                <p className="label">Paid by</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {(Object.keys(METHOD_LABEL) as Array<keyof typeof METHOD_LABEL>).map((m) => (
                    <button key={m} onClick={() => setMethod(m as any)} aria-pressed={method === m}
                      className={clsx('min-h-10 rounded-lg border text-sm font-semibold', method === m ? 'border-brand bg-brand-soft text-brand' : 'border-line')}>{METHOD_LABEL[m]}</button>
                  ))}
                </div>
              </div>
              {method !== 'cash' && <Field label={method === 'cheque' ? 'Cheque number' : 'Transaction reference'} error={errors.referenceNo}><input className="field" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>}
              <Field label="Date" error={errors.paymentDate}><input type="date" className="field" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} /></Field>
              <Field label="Note (optional)"><input className="field" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
              {errors.form && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{errors.form}</p>}
              {errors.lines && <p className="text-sm text-danger" role="alert">{errors.lines}</p>}
              <button className="btn-primary hidden w-full lg:flex" disabled={total <= 0 || save.isPending} onClick={() => { setErrors({}); save.mutate(); }}>
                {save.isPending ? 'Saving…' : total > 0 ? `Collect ${inr(total)}` : 'Enter an amount'}</button>
            </div>
          </aside>
          <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-20 border-t border-line bg-surface/95 p-3 backdrop-blur lg:hidden">
            <button className="btn-primary w-full" disabled={total <= 0 || save.isPending} onClick={() => { setErrors({}); save.mutate(); }}>
              {save.isPending ? 'Saving…' : total > 0 ? `Collect ${inr(total)}` : 'Enter an amount'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

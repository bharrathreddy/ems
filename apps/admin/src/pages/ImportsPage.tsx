import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileSpreadsheet, Upload, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { api, ApiError, downloadFile, uploadFile } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, PageHeader } from '../components/ui';

type ImportType = 'families_students' | 'staff' | 'opening_fees';
interface Result {
  jobId: number; status: 'ready' | 'invalid'; totalRows: number; errorRows: number;
  errors: Array<{ row: number; column: string; message: string }>;
  summary: Record<string, number>;
}
const TYPES: Record<ImportType, { title: string; body: string; perm: string; file: string }> = {
  families_students: { title: 'Students and parents', body: 'One row per student. Brothers and sisters with the same parent mobile share one parent login.', perm: 'students.import', file: 'families-students-template.xlsx' },
  staff: { title: 'Staff', body: 'One row per staff member, with their roles.', perm: 'staff.import', file: 'staff-template.xlsx' },
  opening_fees: { title: 'Opening fee balances', body: 'Starting mid-year? Plan, discounts and what each student already paid this year.', perm: 'payments.collect', file: 'opening-fee-balances-template.xlsx' },
};
const SUMMARY_LABEL: Record<string, string> = {
  students: 'students', newFamilies: 'new parents', existingFamilies: 'existing parents', staffFamilies: 'parents linked to staff',
  staff: 'staff members', linkedToFamilies: 'linked to existing parent logins',
  withPayments: 'with earlier payments', tuitionPaid: 'rupees tuition already paid', busPaid: 'rupees bus fee already paid',
};

export default function ImportsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const available = (Object.keys(TYPES) as ImportType[]).filter((t) => can(TYPES[t].perm));
  const [type, setType] = useState<ImportType>(available[0] ?? 'families_students');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const history = useQuery({ queryKey: ['imports'], queryFn: () => api<any[]>('/imports').then((r) => r.data) });

  const reset = () => { setFile(null); setResult(null); if (input.current) input.current.value = ''; };
  const validate = useMutation({
    mutationFn: (f: File) => uploadFile<Result>(`/imports/${type}/validate`, f),
    onSuccess: ({ data }) => { setResult(data); qc.invalidateQueries({ queryKey: ['imports'] }); },
    onError: (e) => { toast.error((e as ApiError).message); },
  });
  const commit = useMutation({
    mutationFn: () => api<{ status: string; errors?: Result['errors']; message?: string }>(`/imports/${result!.jobId}/commit`, { method: 'POST' }),
    onSuccess: ({ data }) => {
      if (data.status === 'completed') { toast.success('Import complete'); reset(); qc.invalidateQueries(); }
      else { toast.error(data.message ?? 'Some rows need attention.'); setResult({ ...result!, status: 'invalid', errors: data.errors ?? [], errorRows: new Set((data.errors ?? []).map((e) => e.row)).size }); }
    },
    onError: (e) => toast.error((e as ApiError).message),
  });

  const pick = (f: File | undefined) => { if (!f) return; setFile(f); setResult(null); validate.mutate(f); };

  return (
    <div className="max-w-3xl">
      <PageHeader title="Bulk import" description="Bring existing records in from Excel. Nothing is saved until every row is correct and you confirm." />

      <div className="mb-5 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="What to import">
        {available.map((t) => (
          <button key={t} role="radio" aria-checked={type === t} onClick={() => { setType(t); reset(); }}
            className={clsx('panel p-4 text-left transition-colors', type === t ? 'border-brand bg-brand-soft' : 'hover:border-brand/40')}>
            <p className="font-semibold">{TYPES[t].title}</p><p className="mt-0.5 text-sm text-ink-muted">{TYPES[t].body}</p>
          </button>
        ))}
      </div>

      <ol className="space-y-4">
        <li className="panel p-5">
          <p className="font-semibold">1. Download the template</p>
          <p className="mb-3 text-sm text-ink-muted">It lists the exact column names and, for students, the classes and sections of this school.</p>
          <button className="btn-quiet" onClick={() => downloadFile(`/imports/templates/${type}`, TYPES[type].file).catch((e) => toast.error(e.message))}><Download size={16} aria-hidden />Download template</button>
        </li>
        <li className="panel p-5">
          <p className="font-semibold">2. Upload the filled file</p>
          <label className={clsx('mt-3 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors',
            validate.isPending ? 'border-brand bg-brand-soft' : 'border-line hover:border-brand/50')}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}>
            <FileSpreadsheet size={28} className="text-brand" aria-hidden />
            <span className="font-semibold">{validate.isPending ? 'Checking every row…' : file ? file.name : 'Choose an Excel file'}</span>
            <span className="text-sm text-ink-muted">.xlsx, up to 5 MB</span>
            <input ref={input} type="file" accept=".xlsx" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
          </label>
        </li>
        {result && (
          <li className="panel p-5">
            <p className="font-semibold">3. Check and confirm</p>
            {result.status === 'ready' ? (
              <div className="mt-3 space-y-4">
                <p className="flex items-start gap-2 text-brand"><CheckCircle2 size={20} className="mt-0.5 shrink-0" aria-hidden /><span>All {result.totalRows} rows are correct. Ready to import:{' '}
                  {Object.entries(result.summary).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${SUMMARY_LABEL[k] ?? k}`).join(', ')}.</span></p>
                <div className="flex flex-wrap gap-2">
                  <button className="btn-primary" disabled={commit.isPending} onClick={() => commit.mutate()}><Upload size={16} aria-hidden />{commit.isPending ? 'Importing…' : `Import ${result.totalRows} rows`}</button>
                  <button className="btn-quiet" onClick={reset}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="mt-3">
                <p className="flex items-start gap-2 text-danger"><AlertTriangle size={20} className="mt-0.5 shrink-0" aria-hidden />
                  <span>{result.errorRows} of {result.totalRows} rows need fixing. Correct them in Excel and upload the file again.</span></p>
                <div className="mt-3 max-h-96 overflow-auto rounded-lg border border-line">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-chalk text-ink-muted"><tr><th className="px-3 py-2 font-medium">Row</th><th className="px-3 py-2 font-medium">Column</th><th className="px-3 py-2 font-medium">Problem</th></tr></thead>
                    <tbody className="divide-y divide-line">{result.errors.map((e, i) => <tr key={i}><td className="px-3 py-2 font-semibold">{e.row}</td><td className="px-3 py-2">{e.column}</td><td className="px-3 py-2">{e.message}</td></tr>)}</tbody>
                  </table>
                </div>
              </div>
            )}
          </li>
        )}
      </ol>

      {!!history.data?.length && (
        <section className="mt-10">
          <h2 className="mb-3 text-lg font-semibold">Recent imports</h2>
          <ul className="panel divide-y divide-line">
            {history.data.slice(0, 10).map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[15px]">
                <span><span className="font-medium">{h.original_name}</span> <span className="text-sm text-ink-muted">· {h.total_rows} rows · {h.by} · {new Date(h.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span></span>
                <Badge tone={h.status === 'completed' ? 'brand' : h.status === 'invalid' || h.status === 'failed' ? 'danger' : 'neutral'}>
                  {h.status === 'completed' ? 'Imported' : h.status === 'invalid' ? 'Had errors' : h.status === 'ready' ? 'Not confirmed' : h.status}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

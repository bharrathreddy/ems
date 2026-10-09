import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '../lib/api';
import { Field, Sheet } from './ui';

const today = () => new Date().toISOString().slice(0, 10);

/** Agreed E11: relieving checklist. The school prepares the TC and bonafide; the app records number and date. */
export default function LeavingSheet({ studentId, name, open, onClose }: { studentId: string; name: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['exit', studentId], enabled: open, queryFn: () => api<any>(`/students/${studentId}/exit`).then((r) => r.data) });
  const [f, setF] = useState({ leavingDate: today(), reason: '', tc: false, tcNumber: '', tcIssuedOn: today(), bon: false, bonafideNumber: '', bonafideIssuedOn: today() });
  useEffect(() => { const x = q.data; if (x) setF({ leavingDate: x.leavingDate, reason: x.reason, tc: !!x.tcIssuedOn, tcNumber: x.tcNumber ?? '', tcIssuedOn: x.tcIssuedOn ?? today(), bon: !!x.bonafideIssuedOn, bonafideNumber: x.bonafideNumber ?? '', bonafideIssuedOn: x.bonafideIssuedOn ?? today() }); }, [q.data]);
  const save = useMutation({
    mutationFn: () => api(`/students/${studentId}/exit`, { method: 'PUT', body: { leavingDate: f.leavingDate, reason: f.reason, tcNumber: f.tc ? f.tcNumber : null, tcIssuedOn: f.tc ? f.tcIssuedOn : null, bonafideNumber: f.bon ? f.bonafideNumber : null, bonafideIssuedOn: f.bon ? f.bonafideIssuedOn : null } }),
    onSuccess: () => { toast.success('Saved'); qc.invalidateQueries({ queryKey: ['student'] }); qc.invalidateQueries({ queryKey: ['exit', studentId] }); qc.invalidateQueries({ queryKey: ['student-exits'] }); onClose(); },
    onError: (e) => toast.error((e as ApiError).details?.[0]?.message ?? (e as ApiError).message),
  });
  return (
    <Sheet open={open} onClose={onClose} title={`${name} is leaving`} footer={<button className="btn-primary w-full" disabled={save.isPending || f.reason.trim().length < 3 || (f.tc && !f.tcNumber) || (f.bon && !f.bonafideNumber)} onClick={() => save.mutate()}>Save</button>}>
      <div className="space-y-4">
        {!q.data && <p className="rounded-lg bg-tangedu-soft px-3 py-2 text-sm text-[#7A5A00]">Saving makes the student inactive. Their records and fees stay. You can complete the checklist later.</p>}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Leaving date"><input type="date" className="field" value={f.leavingDate} onChange={(e) => setF({ ...f, leavingDate: e.target.value })} /></Field>
          <Field label="Reason"><input className="field" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Moved to Hyderabad" /></Field>
        </div>
        {([['tc', 'Transfer certificate (TC) issued', 'tcNumber', 'tcIssuedOn'], ['bon', 'Bonafide certificate issued', 'bonafideNumber', 'bonafideIssuedOn']] as const).map(([k, label, num, on]) => (
          <div key={k} className="rounded-xl border border-line p-3">
            <label className="flex items-center gap-3 font-semibold"><input type="checkbox" className="h-5 w-5" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />{label}</label>
            {f[k] && <div className="mt-3 grid grid-cols-2 gap-2">
              <Field label="Certificate number"><input className="field" value={f[num]} onChange={(e) => setF({ ...f, [num]: e.target.value })} /></Field>
              <Field label="Issued on"><input type="date" className="field" value={f[on]} onChange={(e) => setF({ ...f, [on]: e.target.value })} /></Field>
            </div>}
          </div>
        ))}
      </div>
    </Sheet>
  );
}

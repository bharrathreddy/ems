import { useState } from 'react';
import { FileSpreadsheet, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { downloadFile } from '../lib/api';

/**
 * Excel and PDF download of the list on screen, with the same filters. The server applies the same
 * permissions and hidden fields as the screen (requirements 15.4).
 */
export default function ExportButtons({ list, params = {}, name }: { list: string; params?: Record<string, string | number | boolean | undefined | null>; name?: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false).map(([k, v]) => [k, v === true ? '1' : String(v)])).toString();
  const go = async (fmt: 'xlsx' | 'pdf') => {
    setBusy(fmt);
    try { await downloadFile(`/exports/${list}.${fmt}${qs ? `?${qs}` : ''}`, `${name ?? list}.${fmt}`); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(null); }
  };
  return (
    <span className="inline-flex gap-2">
      <button type="button" className="btn-quiet min-h-10 px-3 text-sm" disabled={!!busy} onClick={() => go('xlsx')}><FileSpreadsheet size={16} aria-hidden />{busy === 'xlsx' ? 'Preparing…' : 'Excel'}</button>
      <button type="button" className="btn-quiet min-h-10 px-3 text-sm" disabled={!!busy} onClick={() => go('pdf')}><FileText size={16} aria-hidden />{busy === 'pdf' ? 'Preparing…' : 'PDF'}</button>
    </span>
  );
}

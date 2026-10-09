import { useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { fileUrl, uploadImage } from '../lib/images';

/** Pick an image, shrink it in the browser, upload it as a public website image. */
export default function ImageField({ value, onChange, label, aspect = 'aspect-[16/9]', path = '/cms/uploads' }: { value?: string | null; onChange: (id: string | null) => void; label: string; aspect?: string; path?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    try { onChange((await uploadImage(path, f)).data.id); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  return (
    <div>
      <span className="label">{label}</span>
      <div className={`relative overflow-hidden rounded-xl border border-dashed border-line bg-chalk ${aspect}`}>
        {value ? <img src={fileUrl(value)} alt="" className="h-full w-full object-cover" /> : (
          <button type="button" onClick={() => input.current?.click()} className="flex h-full w-full flex-col items-center justify-center gap-1 text-sm text-ink-muted hover:text-brand">
            <ImagePlus size={24} aria-hidden />{busy ? 'Uploading…' : 'Add image'}
          </button>
        )}
        {value && (
          <div className="absolute bottom-2 right-2 flex gap-1.5">
            <button type="button" className="rounded-md bg-white/95 px-2.5 py-1 text-xs font-semibold shadow" onClick={() => input.current?.click()}>{busy ? 'Uploading…' : 'Change'}</button>
            <button type="button" className="rounded-md bg-white/95 p-1.5 text-danger shadow" aria-label="Remove image" onClick={() => onChange(null)}><Trash2 size={14} /></button>
          </div>
        )}
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
    </div>
  );
}

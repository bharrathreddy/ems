import { Copy, MessageCircle, Share2 } from 'lucide-react';
import { toast } from 'sonner';

export interface Credentials { username: string; temporaryPassword: string; message: string; whatsappUrl: string | null }

/** Shows a just-generated temporary password once, with WhatsApp / copy / share actions (rule L9). */
export function CredentialsPanel({ c }: { c: Credentials }) {
  const copy = async (text: string, what: string) => { await navigator.clipboard.writeText(text); toast.success(`${what} copied`); };
  const share = async () => {
    if (navigator.share) await navigator.share({ text: c.message }).catch(() => undefined);
    else copy(c.message, 'Message');
  };
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-tangedu-soft p-4">
        <p className="text-sm font-medium text-[#7A5A00]">Shown only once. Send it now; it cannot be viewed again.</p>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          <dt className="text-sm text-ink-muted">Username</dt><dd className="font-semibold">{c.username}</dd>
          <dt className="text-sm text-ink-muted">Password</dt><dd className="font-mono text-lg font-semibold tracking-wider">{c.temporaryPassword}</dd>
        </dl>
      </div>
      {c.whatsappUrl && (
        <a href={c.whatsappUrl} target="_blank" rel="noreferrer" className="btn w-full bg-[#1F7A4D] text-white hover:brightness-110"><MessageCircle size={18} aria-hidden />Send on WhatsApp</a>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button className="btn-quiet" onClick={() => copy(c.message, 'Message')}><Copy size={16} aria-hidden />Copy message</button>
        <button className="btn-quiet" onClick={share}><Share2 size={16} aria-hidden />Share</button>
      </div>
    </div>
  );
}

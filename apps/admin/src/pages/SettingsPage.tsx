import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError, fieldErrors } from '../lib/api';
import { useAuth } from '../lib/auth';
import { applyBrand } from '../lib/brand';
import { ErrorState, Field, PageHeader, Skeleton } from '../components/ui';
import ImageField from '../components/ImageField';

function CheckInLocation({ edit }: { edit: boolean }) {
  const q = useQuery({ queryKey: ['att-location'], queryFn: () => api<{ lat: number; lng: number; radiusM: number } | null>('/attendance/location').then((r) => r.data) });
  const [radius, setRadius] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (lat: number, lng: number, radiusM: number) => {
    try { await api('/attendance/location', { method: 'PUT', body: { lat, lng, radiusM } }); toast.success('Check-in location saved'); q.refetch(); }
    catch (e) { toast.error((e as Error).message); }
  };
  const here = () => {
    if (!navigator.geolocation) return toast.error('This browser cannot share its location.');
    setBusy(true);
    navigator.geolocation.getCurrentPosition((p) => { setBusy(false); save(p.coords.latitude, p.coords.longitude, radius ?? q.data?.radiusM ?? 200); },
      () => { setBusy(false); toast.error('Could not get the location. Allow location access and try again.'); }, { enableHighAccuracy: true, timeout: 20000 });
  };
  const r = radius ?? q.data?.radiusM ?? 200;
  return (
    <section className="panel space-y-3 p-5">
      <h2 className="text-lg font-semibold">Staff check-in location</h2>
      <p className="text-sm text-ink-muted">Staff can check in only within this distance of the school. Stand inside the school and press the button.</p>
      <p className="text-sm">{q.data ? <>Set: {q.data.lat.toFixed(5)}, {q.data.lng.toFixed(5)} · within {q.data.radiusM} m · <a className="font-semibold text-brand" href={`https://maps.google.com/?q=${q.data.lat},${q.data.lng}`} target="_blank" rel="noreferrer">view on map</a></> : <span className="text-danger">Not set yet: staff cannot check in.</span>}</p>
      {edit && <div className="flex flex-wrap items-end gap-2">
        <Field label="Allowed distance (metres)"><input type="number" min={50} max={2000} step={50} className="field w-32" value={r} onChange={(e) => setRadius(Number(e.target.value))} /></Field>
        <button className="btn-primary" disabled={busy} onClick={here}>{busy ? 'Finding location…' : 'Use my current location'}</button>
        {q.data && radius != null && radius !== q.data.radiusM && <button className="btn-quiet" onClick={() => save(q.data!.lat, q.data!.lng, radius)}>Save distance</button>}
      </div>}
    </section>
  );
}

export default function SettingsPage() {
  const { can } = useAuth();
  const edit = can('settings.configure');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['institution'], queryFn: () => api<any>('/settings/institution').then((r) => r.data) });
  const [f, setF] = useState<Record<string, string>>({});
  const [smtp, setSmtp] = useState({ host: '', port: '587', secure: false, user: '', pass: '', fromName: '', fromEmail: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [logo, setLogo] = useState<string | null>(null);
  useEffect(() => { api<{ logo: string | null }>('/public/branding').then((r) => setLogo(r.data?.logo ?? null)).catch(() => undefined); }, []);

  useEffect(() => {
    if (!q.data) return;
    const d = q.data;
    setF({ name: d.name ?? '', shortName: d.short_name ?? '', address: d.address ?? '', phone: d.phone ?? '', contactEmail: d.contact_email ?? '',
      contactWhatsapp: d.contact_whatsapp ?? '', websiteUrl: d.website_url ?? '', brandPrimary: d.brand_primary ?? '#1F5F4A' });
    const s = d.smtp_config;
    if (s) setSmtp({ host: s.host, port: String(s.port), secure: s.secure, user: s.user ?? '', pass: s.pass ?? '', fromName: s.fromName, fromEmail: s.fromEmail });
  }, [q.data]);

  const save = useMutation({
    mutationFn: () => api('/settings/institution', { method: 'PATCH', body: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? null : v])) }),
    onSuccess: () => { toast.success('School details saved'); applyBrand(f.brandPrimary); qc.invalidateQueries({ queryKey: ['institution'] }); qc.invalidateQueries({ queryKey: ['setup-status'] }); },
    onError: (e) => { const fe = fieldErrors(e); setErrors(fe); if (!Object.keys(fe).length) toast.error((e as ApiError).message); },
  });
  const saveSmtp = useMutation({
    mutationFn: () => api('/settings/smtp', { method: 'PUT', body: { ...smtp, port: Number(smtp.port), user: smtp.user || undefined, pass: smtp.pass || undefined } }),
    onSuccess: () => { toast.success('Email settings saved'); qc.invalidateQueries({ queryKey: ['setup-status'] }); },
    onError: (e) => toast.error((e as ApiError).message),
  });

  if (q.isLoading) return <Skeleton rows={6} />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />;
  const input = (k: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) =>
    <input className="field" disabled={!edit} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} />;

  return (
    <div className="max-w-2xl">
      <PageHeader title="School settings" description="Details shown on receipts, the login screen and messages to families." />
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); setErrors({}); save.mutate(); }} className="panel space-y-4 p-5">
        <h2 className="text-lg font-semibold">School details</h2>
        {edit && <div className="w-40"><ImageField label="Logo" aspect="aspect-square" path="/settings/logo" value={logo}
          onChange={async (id) => { if (!id) { await api('/settings/logo', { method: 'DELETE' }); setLogo(null); } else setLogo(id); qc.invalidateQueries({ queryKey: ['institution'] }); }} /></div>}
        <Field label="School name" error={errors.name}>{input('name')}</Field>
        <Field label="Short name" error={errors.shortName} hint="Shown on small screens.">{input('shortName')}</Field>
        <Field label="Address" error={errors.address}>{input('address')}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone" error={errors.phone}>{input('phone', { inputMode: 'tel' })}</Field>
          <Field label="WhatsApp number" error={errors.contactWhatsapp} hint="Website contact form opens WhatsApp to this number.">{input('contactWhatsapp', { inputMode: 'tel' })}</Field>
        </div>
        <Field label="Contact email" error={errors.contactEmail} hint="Website contact messages are emailed here.">{input('contactEmail', { type: 'email' })}</Field>
        <Field label="Website" error={errors.websiteUrl}>{input('websiteUrl', { type: 'url', placeholder: 'https://' })}</Field>
        <Field label="School colour" error={errors.brandPrimary} hint="Darkened automatically if text on it would be hard to read.">
          <div className="flex items-center gap-3">
            <input type="color" disabled={!edit} aria-label="Pick school colour" className="h-11 w-14 cursor-pointer rounded-lg border border-line bg-surface p-1"
              value={f.brandPrimary || '#1F5F4A'} onChange={(e) => { setF({ ...f, brandPrimary: e.target.value.toUpperCase() }); applyBrand(e.target.value); }} />
            {input('brandPrimary')}
          </div>
        </Field>
        {edit && <button className="btn-primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save school details'}</button>}
      </form>

      {can('settings.view') && <div className="mt-6"><CheckInLocation edit={edit} /></div>}

      {edit && (
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); saveSmtp.mutate(); }} className="panel mt-6 space-y-4 p-5">
          <div>
            <h2 className="text-lg font-semibold">Email sending (SMTP)</h2>
            <p className="text-sm text-ink-muted">Used for password reset emails and, later, receipts and reminders.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
            <Field label="SMTP host"><input className="field" value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} placeholder="smtp.gmail.com" /></Field>
            <Field label="Port"><input className="field" inputMode="numeric" value={smtp.port} onChange={(e) => setSmtp({ ...smtp, port: e.target.value })} /></Field>
          </div>
          <label className="flex items-center gap-2.5 text-[15px]"><input type="checkbox" className="h-4 w-4" checked={smtp.secure} onChange={(e) => setSmtp({ ...smtp, secure: e.target.checked })} />Use SSL (port 465)</label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Username"><input className="field" value={smtp.user} onChange={(e) => setSmtp({ ...smtp, user: e.target.value })} autoComplete="off" /></Field>
            <Field label="Password"><input className="field" type="password" value={smtp.pass} onChange={(e) => setSmtp({ ...smtp, pass: e.target.value })} autoComplete="new-password" /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Sender name"><input className="field" value={smtp.fromName} onChange={(e) => setSmtp({ ...smtp, fromName: e.target.value })} /></Field>
            <Field label="Sender email"><input className="field" type="email" value={smtp.fromEmail} onChange={(e) => setSmtp({ ...smtp, fromEmail: e.target.value })} /></Field>
          </div>
          <button className="btn-primary" disabled={saveSmtp.isPending || !smtp.host || !smtp.fromEmail}>{saveSmtp.isPending ? 'Saving…' : 'Save email settings'}</button>
        </form>
      )}
    </div>
  );
}

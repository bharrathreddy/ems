import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { currentSubscription, disablePush, enablePush, GROUP_LABEL, isIOS, pushSupport, type DeviceState, type PushGroup } from '../lib/push';
import { Skeleton, Toggle } from './ui';

const WS_NAME = { staff: 'staff', parent: 'parent', student: 'student' } as const;

/** "Phone notifications" for this phone: on/off, and each group on its own. */
export default function PhoneAlerts({ compact }: { compact?: boolean }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const support = pushSupport();
  const [endpoint, setEndpoint] = useState<string | null | undefined>(undefined);
  useEffect(() => { void currentSubscription().then((s) => setEndpoint(s?.endpoint ?? null)).catch(() => setEndpoint(null)); }, []);
  const groups = useQuery({ queryKey: ['push-key'], enabled: support === 'ok', staleTime: Infinity, queryFn: () => api<{ publicKey: string; groups: PushGroup[] }>('/push/key').then((r) => r.data.groups) });
  const state = useQuery({ queryKey: ['push-device', endpoint, me?.workspace], enabled: !!endpoint, queryFn: () => api<DeviceState>('/push/device', { method: 'POST', body: { endpoint } }).then((r) => r.data) });
  const on = useMutation({
    mutationFn: enablePush,
    onSuccess: async (d) => { const s = await currentSubscription(); setEndpoint(s?.endpoint ?? null); qc.setQueryData(['push-device', s?.endpoint, me?.workspace], d); toast.success('Notifications are on for this phone'); },
    onError: (e) => toast.error((e as Error).message, { duration: 8000 }),
  });
  const off = useMutation({ mutationFn: disablePush, onSuccess: () => { setEndpoint(null); toast.success('Notifications are off for this phone'); } });
  const prefs = useMutation({
    mutationFn: (p: Partial<Record<PushGroup, boolean>>) => api<DeviceState>('/push/device', { method: 'PATCH', body: { endpoint, ...p } }).then((r) => r.data),
    onSuccess: (d) => qc.setQueryData(['push-device', endpoint, me?.workspace], d), onError: (e) => toast.error((e as ApiError).message),
  });
  const test = useMutation({ mutationFn: () => api('/push/test', { method: 'POST', body: { endpoint } }), onSuccess: () => toast.success('Test sent. It should appear in a few seconds.'), onError: (e) => toast.error((e as ApiError).message) });

  if (me?.proxy) return null;
  const subscribed = !!endpoint && state.data?.subscribed;
  const head = (
    <div className="flex items-start gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand" aria-hidden><BellRing size={20} /></span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Phone notifications</p>
        <p className="text-sm text-ink-muted">{subscribed ? `On for this ${isIOS() ? 'iPhone' : 'phone'} (your ${WS_NAME[me!.workspace]} login). Choose what to get:` : 'Get alerts on this phone even when the app is closed.'}</p>
      </div>
    </div>
  );
  if (support === 'insecure') return compact ? null : <section className="panel p-4">{head}<p className="mt-3 text-sm text-ink-muted">Phone notifications work once the app is opened over https (on the live website).</p></section>;
  if (support === 'ios-install') return (
    <section className="panel p-4">{head}
      <p className="mt-3 flex gap-2 rounded-lg bg-chalk p-3 text-sm"><Smartphone size={18} className="shrink-0 text-brand" aria-hidden />On iPhone: tap the Share button in Safari, choose <strong>Add to Home Screen</strong>, open the app from the Home Screen, and turn notifications on here.</p>
    </section>
  );
  if (support === 'unsupported') return compact ? null : <section className="panel p-4">{head}<p className="mt-3 text-sm text-ink-muted">This browser does not support notifications. Use Chrome on Android, or Safari on iPhone with the app added to the Home Screen.</p></section>;
  if (endpoint === undefined || (endpoint && state.isLoading)) return compact ? null : <section className="panel p-4"><Skeleton rows={2} /></section>;
  if (compact && subscribed) return null;
  return (
    <section className="panel p-4">
      {head}
      {!subscribed ? (
        <button className="btn-primary mt-3 w-full sm:w-auto" disabled={on.isPending} onClick={() => on.mutate()}>{on.isPending ? 'Turning on…' : 'Turn on notifications'}</button>
      ) : (
        <>
          <ul className="mt-3 divide-y divide-line">
            {(groups.data ?? []).map((g) => (
              <li key={g} className="flex items-center justify-between gap-4 py-2.5">
                <div><p className="text-[15px] font-medium">{GROUP_LABEL[g][0]}</p><p className="text-sm text-ink-muted">{GROUP_LABEL[g][1]}</p></div>
                <Toggle checked={!!state.data?.prefs[g]} label={GROUP_LABEL[g][0]} disabled={prefs.isPending} onChange={(v) => prefs.mutate({ [g]: v })} />
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-quiet min-h-10 text-sm" disabled={test.isPending} onClick={() => test.mutate()}>Send a test</button>
            <button className="btn-quiet min-h-10 text-sm" disabled={off.isPending} onClick={() => off.mutate()}>Turn off on this phone</button>
          </div>
        </>
      )}
    </section>
  );
}

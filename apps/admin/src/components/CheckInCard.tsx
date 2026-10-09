import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '../lib/api';

interface Mine { today: string; workingToday: boolean; offReason: string | null; locationSet: boolean; todayStatus: { status: string; checkInAt: string | null } | null }
const time = (t: string) => new Date(t).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

function position(): Promise<GeolocationPosition> {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('This phone or browser cannot share its location.'));
    navigator.geolocation.getCurrentPosition(res, (e) => rej(new Error(e.code === 1 ? 'Location permission is off. Allow location for this app in your phone settings, then try again.' : 'Could not get your location. Turn on location (GPS) and try again.')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  });
}

/** Agreed A6/A7: staff check themselves in on the school premises; the time is recorded. */
export default function CheckInCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['staff-att-mine'], queryFn: () => api<Mine>('/staff-attendance/mine').then((r) => r.data), retry: false });
  const [locating, setLocating] = useState(false);
  const m = useMutation({
    mutationFn: async () => { setLocating(true); try { const p = await position(); return api<{ checkInAt: string }>('/staff-attendance/check-in', { method: 'POST', body: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy } }); } finally { setLocating(false); } },
    onSuccess: ({ data }) => { toast.success(`Checked in at ${time(data.checkInAt)}`); qc.invalidateQueries({ queryKey: ['staff-att-mine'] }); },
    onError: (e) => toast.error((e as ApiError).message ?? String(e), { duration: 8000 }),
  });
  if (!q.data) return null;
  const d = q.data;
  return (
    <section className="panel flex flex-wrap items-center gap-3 p-4">
      <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-soft text-brand"><MapPin size={20} aria-hidden /></span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">My attendance today</p>
        <p className="text-sm text-ink-muted">
          {!d.workingToday ? `No school today (${d.offReason}).`
            : d.todayStatus ? (d.todayStatus.checkInAt ? `Checked in at ${time(d.todayStatus.checkInAt)}` : `Marked ${d.todayStatus.status.replace('_', ' ')} by the office`)
            : !d.locationSet ? 'Check-in is not set up yet (the admin sets the school location in School settings).' : 'Not checked in yet. Check in when you reach school.'}
        </p>
      </div>
      {d.workingToday && !d.todayStatus && d.locationSet && <button className="btn-primary" disabled={m.isPending} onClick={() => m.mutate()}>{locating ? 'Finding your location…' : m.isPending ? 'Checking in…' : 'Check in'}</button>}
      <Link to="/leave" className="text-sm font-semibold text-brand">Leave</Link>
    </section>
  );
}

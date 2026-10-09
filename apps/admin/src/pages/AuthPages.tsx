import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError, fieldErrors } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Field } from '../components/ui';

/** The one bold moment: the school's name written on a blackboard. */
function AuthFrame({ children }: { children: ReactNode }) {
  const { branding } = useAuth();
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[1.1fr_1fr]">
      <section className="relative overflow-hidden bg-brand px-6 pb-10 pt-[calc(2.5rem+env(safe-area-inset-top))] text-white lg:flex lg:flex-col lg:justify-between lg:px-14 lg:py-14"
        style={{ backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0 39px, rgba(255,255,255,.06) 39px 40px)' }}>
        <p className="text-sm font-medium text-white/70">{branding?.institution_type === 'college' ? 'College office' : 'School office'}</p>
        <h1 className="mt-6 max-w-[14ch] text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">{branding?.name ?? 'Welcome'}</h1>
        <p className="mt-4 max-w-sm text-[15px] text-white/75 lg:mt-0">Staff, parents and students sign in with the details given by the school office.</p>
      </section>
      <section className="flex items-start justify-center px-5 py-10 lg:items-center">
        <div className="w-full max-w-sm">{children}</div>
      </section>
    </div>
  );
}

function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={show ? 'text' : 'password'} className="field pr-12" />
      <button type="button" onClick={() => setShow(!show)} className="absolute inset-y-0 right-0 grid w-12 place-items-center text-ink-muted" aria-label={show ? 'Hide password' : 'Show password'}>
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}

export function LoginPage() {
  const { login } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await login(identifier, password); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not sign in.'); }
    finally { setBusy(false); }
  };
  return (
    <AuthFrame>
      <h2 className="text-2xl font-semibold">Sign in</h2>
      <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
        <Field label="Mobile number or email">
          <input className="field" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" inputMode="email" required />
        </Field>
        <Field label="Password">
          <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
        {error && <p className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger" role="alert">{error}</p>}
        <button className="btn-primary w-full" disabled={busy || !identifier || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <p className="mt-6 text-sm text-ink-muted">
        Forgot your password? Staff and parents with an email can <Link to="/forgot-password" className="font-semibold text-brand underline-offset-2 hover:underline">reset it by email</Link>. Otherwise, ask the school office to send new login details.
      </p>
    </AuthFrame>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { await api('/auth/forgot-password', { method: 'POST', body: { email } }); setSent(true); }
    catch (err) { toast.error(err instanceof ApiError ? err.message : 'Could not send the email.'); }
    finally { setBusy(false); }
  };
  return (
    <AuthFrame>
      <h2 className="text-2xl font-semibold">Reset password</h2>
      {sent ? (
        <p className="mt-4 text-ink-muted">If an account uses <strong className="text-ink">{email}</strong>, a reset link is on its way. It expires in 60 minutes.</p>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4">
          <Field label="Email"><input type="email" className="field" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></Field>
          <button className="btn-primary w-full" disabled={busy || !email}>{busy ? 'Sending…' : 'Send reset link'}</button>
        </form>
      )}
      <Link to="/login" className="mt-6 inline-block text-sm font-semibold text-brand">Back to sign in</Link>
    </AuthFrame>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [pw, setPw] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErrors({});
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token: params.get('token') ?? '', newPassword: pw } });
      toast.success('Password changed. Sign in with your new password.');
      navigate('/login');
    } catch (err) {
      const fe = fieldErrors(err);
      setErrors(Object.keys(fe).length ? fe : { form: err instanceof ApiError ? err.message : 'Could not reset the password.' });
    } finally { setBusy(false); }
  };
  return (
    <AuthFrame>
      <h2 className="text-2xl font-semibold">Choose a new password</h2>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="New password" error={errors.newPassword} hint="At least 8 characters, with a letter and a number.">
          <PasswordInput value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
        </Field>
        {errors.form && <p className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger" role="alert">{errors.form}</p>}
        <button className="btn-primary w-full" disabled={busy || pw.length < 8}>{busy ? 'Saving…' : 'Save password'}</button>
      </form>
    </AuthFrame>
  );
}

export function ChangePasswordForm({ forced = false, onDone }: { forced?: boolean; onDone?: () => void }) {
  const { reload } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return setErrors({ confirm: 'The two passwords do not match.' });
    setBusy(true); setErrors({});
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
      toast.success('Password changed');
      await reload();
      onDone?.();
    } catch (err) {
      const fe = fieldErrors(err);
      setErrors(Object.keys(fe).length ? fe : { currentPassword: err instanceof ApiError ? err.message : 'Could not change the password.' });
    } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label={forced ? 'Password you signed in with' : 'Current password'} error={errors.currentPassword}>
        <PasswordInput value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
      </Field>
      <Field label="New password" error={errors.newPassword} hint="At least 8 characters, with a letter and a number.">
        <PasswordInput value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
      </Field>
      <Field label="Repeat new password" error={errors.confirm}>
        <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      </Field>
      <button className="btn-primary w-full" disabled={busy || !current || next.length < 8}>{busy ? 'Saving…' : 'Change password'}</button>
    </form>
  );
}

export function ForcedPasswordPage() {
  const { logout } = useAuth();
  return (
    <AuthFrame>
      <h2 className="text-2xl font-semibold">Set your own password</h2>
      <p className="mb-6 mt-2 text-ink-muted">You signed in with a temporary or example password. Choose your own to continue.</p>
      <ChangePasswordForm forced />
      <button onClick={logout} className="mt-4 text-sm font-semibold text-ink-muted hover:text-ink">Sign out</button>
    </AuthFrame>
  );
}

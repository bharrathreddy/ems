import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1 max-w-prose text-[15px] text-ink-muted">{description}</p>}
      </div>
      {action && <div className="hidden sm:block">{action}</div>}
    </div>
  );
}

/** Primary action pinned above the bottom nav on phones (requirements 17: sticky action). */
export function MobileAction({ children }: { children: ReactNode }) {
  return <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-20 border-t border-line bg-surface/95 p-3 backdrop-blur sm:hidden">{children}</div>;
}

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {error ? <span className="mt-1.5 block text-sm text-danger" role="alert">{error}</span>
        : hint ? <span className="mt-1.5 block text-sm text-ink-muted">{hint}</span> : null}
    </label>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'brand' | 'attention' | 'danger'; children: ReactNode }) {
  const tones = {
    neutral: 'bg-chalk text-ink-muted border-line',
    brand: 'bg-brand-soft text-brand border-transparent',
    attention: 'bg-tangedu-soft text-[#7A5A00] border-transparent',
    danger: 'bg-danger-soft text-danger border-transparent',
  };
  return <span className={clsx('inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold', tones[tone])}>{children}</span>;
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-line/50" />)}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="panel px-6 py-12 text-center">
      <p className="text-lg font-semibold">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-ink-muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="panel border-danger/30 bg-danger-soft/40 px-5 py-6">
      <p className="font-semibold text-danger">{message}</p>
      {onRetry && <button className="btn-quiet mt-3" onClick={onRetry}>Try again</button>}
    </div>
  );
}

/** Bottom sheet on phones, side panel on larger screens. */
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title}
        className="absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col rounded-t-2xl bg-surface sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[440px] sm:rounded-none sm:border-l sm:border-line">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-md p-2 text-ink-muted hover:bg-chalk" aria-label="Close"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <div className="border-t border-line px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={clsx('relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50', checked ? 'bg-brand' : 'bg-line')}>
      <span className={clsx('absolute left-0 top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform', checked ? 'translate-x-6' : 'translate-x-1')} />
    </button>
  );
}

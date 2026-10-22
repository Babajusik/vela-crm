import { createContext, forwardRef, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes,
  type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';
import { hexAlpha, initials } from '../lib/format.ts';

export function cx(...a: (string | false | null | undefined | 0)[]) { return a.filter(Boolean).join(' '); }

// ---------------- Button ----------------
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft' | 'accent';
interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant; size?: 'xs' | 'sm' | 'md'; icon?: ReactNode; loading?: boolean; full?: boolean;
}
const BTN: Record<BtnVariant, string> = {
  primary: 'bg-primary text-primary-fg hover:bg-primary-hover shadow-sm',
  accent: 'bg-accent text-white hover:brightness-95 shadow-sm',
  secondary: 'bg-surface text-fg border border-line hover:bg-surface-2 hover:border-line-strong',
  ghost: 'text-muted hover:text-fg hover:bg-surface-2',
  danger: 'bg-danger text-white hover:brightness-95',
  soft: 'bg-primary-soft text-primary hover:brightness-95',
};
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = 'secondary', size = 'md', icon, loading, full, className, children, disabled, ...rest }, ref) {
  const sz = size === 'xs' ? 'h-7 px-2 text-xs gap-1' : size === 'sm' ? 'h-8 px-2.5 text-[13px] gap-1.5' : 'h-9 px-3.5 text-sm gap-2';
  return (
    <button ref={ref} type="button" disabled={disabled || loading}
      className={cx('inline-flex items-center justify-center rounded-lg font-semibold whitespace-nowrap transition-colors disabled:opacity-50 disabled:pointer-events-none select-none', sz, BTN[variant], full && 'w-full', className)}
      {...rest}>
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function IconButton({ label, className, children, active, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label}
      className={cx('inline-flex size-9 items-center justify-center rounded-lg text-muted hover:text-fg hover:bg-surface-2 transition-colors', active && 'bg-surface-2 text-fg', className)} {...rest}>
      {children}
    </button>
  );
}

// ---------------- inputs ----------------
const inputCls = 'w-full rounded-lg border border-line bg-surface px-3 text-sm text-fg placeholder:text-faint transition-colors hover:border-line-strong focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }>(function Input({ className, icon, ...rest }, ref) {
  if (icon) {
    return (
      <div className={cx('relative', className)}>
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint">{icon}</span>
        <input ref={ref} className={cx(inputCls, 'h-9 pl-9')} {...rest} />
      </div>
    );
  }
  return <input ref={ref} className={cx(inputCls, 'h-9', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, rows = 3, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} className={cx(inputCls, 'py-2 leading-relaxed resize-y', className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(inputCls, 'h-9 pr-8 cursor-pointer', className)} {...rest}>{children}</select>;
}

export function Checkbox({ checked, onChange, label, className }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; className?: string }) {
  return (
    <label className={cx('inline-flex cursor-pointer items-center gap-2 text-sm select-none', className)}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 rounded border-line-strong accent-[var(--c-primary)] cursor-pointer" />
      {label}
    </label>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx('inline-flex items-center gap-2.5 text-sm select-none', disabled ? 'opacity-60' : 'cursor-pointer')}>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={cx('relative h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-primary' : 'bg-line-strong')}>
        <span className={cx('absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-4.5' : 'translate-x-0.5')} />
      </button>
      {label}
    </label>
  );
}

export function FormRow({ label, required, hint, children, className }: { label: ReactNode; required?: boolean; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-[13px] font-semibold text-muted">{label}{required && <span className="text-danger"> *</span>}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-faint">{hint}</span>}
    </label>
  );
}

// ---------------- display ----------------
export function Badge({ color, children, className, dot }: { color?: string; children: ReactNode; className?: string; dot?: boolean }) {
  const c = color ?? '#64748b';
  return (
    <span className={cx('inline-flex max-w-full items-center gap-1.5 truncate rounded-md px-2 py-0.5 text-xs font-semibold', className)}
      style={{ background: hexAlpha(c, 0.13), color: c }}>
      {dot && <span className="size-1.5 shrink-0 rounded-full" style={{ background: c }} />}
      {children}
    </span>
  );
}

export function Avatar({ name, color, size = 28, className, title }: { name?: string; color?: string; size?: number; className?: string; title?: string }) {
  return (
    <span title={title ?? name} className={cx('inline-flex shrink-0 select-none items-center justify-center rounded-full font-bold text-white ring-2 ring-surface', className)}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38), background: color ?? '#64748b' }}>
      {initials(name ?? '')}
    </span>
  );
}

export function AvatarStack({ users, max = 4, size = 26 }: { users: { id: number; title?: string; name?: string; color?: string }[]; max?: number; size?: number }) {
  const uniq = users.filter((u, i) => users.findIndex((x) => x.id === u.id) === i);
  const shown = uniq.slice(0, max);
  return (
    <span className="inline-flex items-center -space-x-1.5">
      {shown.map((u) => <Avatar key={u.id} name={u.title ?? u.name} color={u.color} size={size} />)}
      {uniq.length > max && <span className="ml-2 text-xs font-semibold text-muted">+{uniq.length - max}</span>}
    </span>
  );
}

export function Card({ children, className, title, actions, padded = true, subtitle }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode; padded?: boolean; subtitle?: ReactNode }) {
  return (
    <section className={cx('rounded-xl border border-line bg-surface', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-bold">{title}</h3>
            {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, icon, tone = 'default', onClick }: { label: ReactNode; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: 'default' | 'primary' | 'danger' | 'accent' | 'success'; onClick?: () => void }) {
  const toneCls = { default: 'text-muted bg-surface-2', primary: 'text-primary bg-primary-soft', danger: 'text-danger bg-danger-soft', accent: 'text-accent bg-accent-soft', success: 'text-success bg-primary-soft' }[tone];
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={cx('flex w-full items-start gap-3 rounded-xl border border-line bg-surface p-4 text-left', onClick && 'transition-colors hover:border-line-strong')}>
      {icon && <span className={cx('flex size-10 shrink-0 items-center justify-center rounded-lg', toneCls)}>{icon}</span>}
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-muted">{label}</span>
        <span className="tabular mt-0.5 block truncate text-xl font-extrabold tracking-tight">{value}</span>
        {sub && <span className="mt-0.5 block truncate text-xs text-muted">{sub}</span>}
      </span>
    </Tag>
  );
}

export function Progress({ value, color, className }: { value: number; color?: string; className?: string }) {
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-surface-2', className)}>
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color ?? 'var(--c-primary)' }} />
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-5 animate-spin text-faint', className)} />;
}

export function Loading({ label = 'Загружаем…' }: { label?: string }) {
  return <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted"><Spinner />{label}</div>;
}

export function EmptyState({ icon, title, text, action, compact }: { icon?: ReactNode; title: ReactNode; text?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={cx('flex flex-col items-center justify-center text-center', compact ? 'py-8' : 'py-16')}>
      {icon && <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">{icon}</div>}
      <p className="text-[15px] font-bold">{title}</p>
      {text && <p className="mt-1 max-w-sm text-sm text-muted">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[11px] font-semibold text-muted">{children}</kbd>;
}

// ---------------- tabs ----------------
export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { value: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cx('flex gap-1 overflow-x-auto border-b border-line', className)}>
      {tabs.map((t) => (
        <button key={t.value} role="tab" type="button" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          className={cx('relative -mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors',
            value === t.value ? 'border-primary text-fg' : 'border-transparent text-muted hover:text-fg')}>
          {t.label}
          {t.count !== undefined && <span className={cx('rounded-full px-1.5 text-[11px] tabular', value === t.value ? 'bg-primary-soft text-primary' : 'bg-surface-2 text-muted')}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: ReactNode; icon?: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)} aria-pressed={value === o.value}
          className={cx('inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-semibold transition-colors', value === o.value ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg')}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------- overlay ----------------
function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
}

export function Modal({ open, onClose, title, children, footer, size = 'md', subtitle }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl'; subtitle?: ReactNode }) {
  useEscape(open, onClose);
  if (!open) return null;
  const w = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/45 p-0 backdrop-blur-[2px] anim-fade sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" className={cx('flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-line bg-surface shadow-2xl anim-in sm:rounded-2xl', w)}>
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
          </div>
          <IconButton label="Закрыть" onClick={onClose} className="-mr-2 -mt-1"><X className="size-5" /></IconButton>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ open, onClose, title, children, footer, width = 560 }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-ink-950/35 anim-fade" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" className="flex h-full w-full flex-col border-l border-line bg-surface shadow-2xl anim-slide" style={{ maxWidth: width }}>
        <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
          <h2 className="truncate text-lg font-bold">{title}</h2>
          <IconButton label="Закрыть" onClick={onClose}><X className="size-5" /></IconButton>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function Popover({ trigger, children, align = 'left', className, open: controlled, onOpenChange }: { trigger: (p: { open: boolean; toggle: () => void }) => ReactNode; children: ReactNode | ((close: () => void) => ReactNode); align?: 'left' | 'right'; className?: string; open?: boolean; onOpenChange?: (v: boolean) => void }) {
  const [inner, setInner] = useState(false);
  const open = controlled ?? inner;
  const set = (v: boolean) => { setInner(v); onOpenChange?.(v); };
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) set(false); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') set(false); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  });
  return (
    <div ref={ref} className="relative inline-block">
      {trigger({ open, toggle: () => set(!open) })}
      {open && (
        <div className={cx('absolute z-40 mt-1.5 min-w-48 rounded-xl border border-line bg-surface p-1 shadow-xl anim-in', align === 'right' ? 'right-0' : 'left-0', className)}>
          {typeof children === 'function' ? children(() => set(false)) : children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ icon, children, onClick, danger, active }: { icon?: ReactNode; children: ReactNode; onClick?: () => void; danger?: boolean; active?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={cx('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors', danger ? 'text-danger hover:bg-danger-soft' : 'hover:bg-surface-2', active && 'bg-surface-2')}>
      {icon && <span className="text-muted">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

// ---------------- toasts & confirm ----------------
interface Toast { id: number; kind: 'success' | 'error' | 'info'; text: string }
interface ToastApi { success: (t: string) => void; error: (t: string | unknown) => void; info: (t: string) => void; confirm: (o: ConfirmOpts) => Promise<boolean> }
interface ConfirmOpts { title: string; text?: string; ok?: string; danger?: boolean }
const ToastCtx = createContext<ToastApi>(null as unknown as ToastApi);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const [confirmState, setConfirm] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-3), { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);
  const apiValue: ToastApi = {
    success: (t) => push('success', t),
    info: (t) => push('info', t),
    error: (e) => push('error', typeof e === 'string' ? e : (e as Error)?.message ?? 'Что-то пошло не так'),
    confirm: (o) => new Promise((resolve) => setConfirm({ ...o, resolve })),
  };
  const close = (v: boolean) => { confirmState?.resolve(v); setConfirm(null); };
  return (
    <ToastCtx.Provider value={apiValue}>
      {children}
      {createPortal(
        <div aria-live="polite" className="fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
          {items.map((t) => (
            <div key={t.id} className="flex items-start gap-2.5 rounded-xl border border-line bg-surface px-3.5 py-3 text-sm shadow-xl anim-in">
              {t.kind === 'success' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : t.kind === 'error' ? <XCircle className="mt-0.5 size-4 shrink-0 text-danger" /> : <Info className="mt-0.5 size-4 shrink-0 text-primary" />}
              <span className="min-w-0 flex-1 whitespace-pre-line">{t.text}</span>
            </div>
          ))}
        </div>,
        document.body,
      )}
      <Modal open={!!confirmState} onClose={() => close(false)} size="sm" title={confirmState?.title ?? ''}
        footer={<><Button onClick={() => close(false)}>Отмена</Button><Button variant={confirmState?.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>{confirmState?.ok ?? 'Подтвердить'}</Button></>}>
        <div className="flex gap-3">
          {confirmState?.danger && <AlertTriangle className="size-5 shrink-0 text-danger" />}
          <p className="text-sm text-muted">{confirmState?.text ?? 'Действие нельзя будет отменить.'}</p>
        </div>
      </Modal>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/** White header band across the page: title, sub-navigation under it, actions on the right */
export function PageHeader({ title, subtitle, actions, children, tabs }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode; tabs?: ReactNode }) {
  return (
    <div className="-mx-4 -mt-5 mb-5 border-b border-line bg-surface px-4 pt-4 sm:-mx-6 sm:px-6 lg:-mt-6">
      <div className={cx('flex flex-wrap items-start justify-between gap-3', !tabs && 'pb-4')}>
        <div className="min-w-0">
          <h1 className="text-[22px] font-extrabold leading-tight tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {tabs && <div className="mt-3">{tabs}</div>}
      {children && <div className="pb-4">{children}</div>}
    </div>
  );
}

/** Record card sliding over a list (tasks, deals). Full screen on phones. */
export function SlideOver({ onClose, children, width = 1080 }: { onClose: () => void; children: ReactNode; width?: number }) {
  useEscape(true, onClose);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  return createPortal(
    <div className="fixed inset-0 top-14 z-[35] md:left-[72px]">
      <div className="absolute inset-0 bg-ink-950/25 anim-fade" onMouseDown={onClose} />
      <div className="absolute inset-y-0 right-0 flex w-full anim-slide" style={{ maxWidth: width }}>
        <button type="button" aria-label="Закрыть карточку" onClick={onClose}
          className="absolute -left-12 top-3 hidden size-9 items-center justify-center rounded-full bg-surface text-muted shadow-lg hover:text-fg 2xl:flex"><X className="size-5" /></button>
        <div className="relative h-full w-full overflow-y-auto bg-canvas shadow-2xl">
          <button type="button" aria-label="Закрыть карточку" onClick={onClose} className="absolute right-3 top-3 z-10 flex size-9 items-center justify-center rounded-full bg-surface-2 text-muted shadow hover:text-fg 2xl:hidden"><X className="size-5" /></button>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function useMediaQuery(q: string) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const h = () => setM(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [q]);
  return m;
}

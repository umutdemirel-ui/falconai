import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';

export function Panel({
  children,
  className,
  red = false,
}: {
  children: ReactNode;
  className?: string;
  red?: boolean;
}) {
  return <div className={cn('panel', red && 'panel-red', className)}>{children}</div>;
}

export function CardHeader({
  icon,
  title,
  accessory,
  className,
}: {
  icon?: ReactNode;
  title: string;
  accessory?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('card-head', className)}>
      {icon ? <span className="text-falcon-400">{icon}</span> : null}
      <span className="flex-1 truncate">{title}</span>
      {accessory}
    </div>
  );
}

export function IconChip({ children, className, size = 'md' }: { children: ReactNode; className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const dims = size === 'sm' ? 'h-7 w-7 rounded-lg' : size === 'lg' ? 'h-11 w-11 rounded-2xl' : 'h-9 w-9 rounded-xl';
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center border border-falcon-500/25 bg-gradient-to-b from-falcon-600/25 to-falcon-900/10 text-falcon-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]',
        dims,
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusDot({ tone = 'green', pulse = false }: { tone?: 'green' | 'red' | 'amber' | 'gray'; pulse?: boolean }) {
  const colors = {
    green: 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.85)]',
    red: 'bg-falcon-500 shadow-[0_0_10px_rgba(255,47,47,0.85)]',
    amber: 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.8)]',
    gray: 'bg-white/25',
  } as const;
  return <span className={cn('dot', colors[tone], pulse && 'animate-pulse-slow')} />;
}

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-[22px] w-[40px] shrink-0 rounded-full border transition-all duration-200 disabled:opacity-40',
        checked
          ? 'border-falcon-400/60 bg-gradient-to-r from-falcon-600 to-falcon-500 shadow-[0_0_16px_-4px_rgba(255,47,47,0.8)]'
          : 'border-white/12 bg-white/[0.06]',
      )}
    >
      <span
        className={cn(
          'absolute top-[2px] h-[16px] w-[16px] rounded-full bg-white shadow transition-all duration-200',
          checked ? 'left-[21px]' : 'left-[3px] bg-white/70',
        )}
      />
    </button>
  );
}

export function Field({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('field', className)} {...props} />;
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn('field resize-none', className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'field appearance-none bg-[right_0.7rem_center] bg-no-repeat pr-9',
        'cursor-pointer bg-ink-800/95',
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23ffffff70' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
      }}
      {...props}
    >
      {children}
    </select>
  );
}

export function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  suffix,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  suffix?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1"
      />
      <span className="w-[52px] shrink-0 text-right text-[11.5px] font-medium tabular-nums text-white/60">
        {value}
        {suffix}
      </span>
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
}: {
  options: { value: T; label: string; hint?: string }[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="inline-flex w-full rounded-xl border border-white/[0.07] bg-black/30 p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            'flex-1 rounded-lg font-medium transition-all duration-200',
            size === 'sm' ? 'px-2.5 py-1.5 text-[11.5px]' : 'px-3 py-2 text-[12.5px]',
            value === opt.value
              ? 'border border-falcon-400/50 bg-gradient-to-b from-falcon-500 to-falcon-700 text-white shadow-[0_0_18px_-6px_rgba(255,47,47,0.85)]'
              : 'border border-transparent text-white/45 hover:text-white/80',
          )}
          title={opt.hint}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean;
  onClose?: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
      <div className={cn('panel panel-red w-full overflow-hidden fade-up', width)}>
        <div className="flex items-start gap-3 border-b border-white/[0.07] px-5 py-4">
          <div className="flex-1">
            <h3 className="text-[15px] font-semibold text-white">{title}</h3>
            {description ? <p className="mt-0.5 text-[12.5px] leading-relaxed text-white/45">{description}</p> : null}
          </div>
          {onClose ? (
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Kapat">
              <X size={16} />
            </button>
          ) : null}
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer ? <div className="flex justify-end gap-2 border-t border-white/[0.07] px-5 py-3.5">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Button({
  variant = 'ghost',
  size = 'md',
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'plain'; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <button
      type="button"
      className={cn(
        'btn',
        variant === 'primary' && 'btn-primary',
        variant === 'ghost' && 'btn-ghost',
        variant === 'danger' && 'btn-danger',
        variant === 'plain' && 'text-white/60 hover:text-white',
        size === 'sm' && 'px-3 py-1.5 text-[12px]',
        size === 'lg' && 'px-5 py-3 text-[14px]',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/[0.08] px-6 py-12 text-center">
      <IconChip size="lg">{icon}</IconChip>
      <div>
        <p className="text-[14px] font-medium text-white/80">{title}</p>
        <p className="mt-1 max-w-sm text-[12.5px] leading-relaxed text-white/40">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function KeyValue({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-[12px] text-white/40">{label}</span>
      <span className={cn('truncate text-[12px] font-medium text-white/80', mono && 'font-mono text-[11px]')}>{value}</span>
    </div>
  );
}

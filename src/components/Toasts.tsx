import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useStore } from '../lib/store';
import { cn } from '../lib/utils';

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[336px] flex-col gap-2">
      {toasts.map((toast) => {
        const Icon = toast.kind === 'success' ? CheckCircle2 : toast.kind === 'error' ? AlertCircle : Info;
        return (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-ink-850/95 px-3 py-2.5 shadow-card backdrop-blur-xl fade-up',
              toast.kind === 'success'
                ? 'border-emerald-500/30'
                : toast.kind === 'error'
                  ? 'border-falcon-500/45 shadow-[0_0_30px_-16px_rgba(255,47,47,0.9)]'
                  : 'border-white/10',
            )}
          >
            <Icon
              size={16}
              className={cn(
                'mt-0.5 shrink-0',
                toast.kind === 'success' ? 'text-emerald-400' : toast.kind === 'error' ? 'text-falcon-400' : 'text-white/50',
              )}
            />
            <div className="min-w-0 flex-1">
              {toast.title ? <p className="text-[12.5px] font-semibold text-white/90">{toast.title}</p> : null}
              {toast.body ? <p className="mt-0.5 break-words text-[11.5px] leading-relaxed text-white/50">{toast.body}</p> : null}
            </div>
            <button type="button" className="icon-btn h-5 w-5" onClick={() => dismiss(toast.id)} aria-label="Kapat">
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

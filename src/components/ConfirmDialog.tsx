import { useEffect, useState } from 'react';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { useStore } from '../lib/store';
import { Modal, Button } from './ui';
import { cn } from '../lib/utils';

const RISK_LABEL: Record<string, string> = {
  safe: 'Güvenli işlem',
  moderate: 'Dikkat gerektiren işlem',
  dangerous: 'Geri alınamaz işlem',
};

export function ConfirmDialog() {
  const confirm = useStore((s) => s.confirm);
  const respond = useStore((s) => s.respondConfirm);
  const [remaining, setRemaining] = useState(100);

  useEffect(() => {
    if (!confirm) return;
    const started = Date.now();
    const timer = setInterval(() => {
      const pct = 100 - ((Date.now() - started) / confirm.timeoutMs) * 100;
      setRemaining(Math.max(0, pct));
      if (pct <= 0) {
        void respond(false);
        clearInterval(timer);
      }
    }, 200);
    return () => clearInterval(timer);
  }, [confirm, respond]);

  if (!confirm) return null;
  const dangerous = confirm.risk === 'dangerous';

  return (
    <Modal
      open
      title={confirm.title}
      description={`${confirm.agent} bu işlemi yapmak istiyor. Onaylıyor musun?`}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={() => void respond(false)}>
            Reddet
          </Button>
          <Button variant="primary" onClick={() => void respond(true)} autoFocus>
            {dangerous ? 'Yine de onayla' : 'Onayla'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div
          className={cn(
            'flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-[11.5px]',
            dangerous ? 'border-falcon-500/40 bg-falcon-600/10 text-falcon-100' : 'border-amber-400/25 bg-amber-500/[0.07] text-amber-100/90',
          )}
        >
          {dangerous ? <ShieldAlert size={15} className="mt-0.5 shrink-0" /> : <AlertTriangle size={15} className="mt-0.5 shrink-0" />}
          <div>
            <p className="font-semibold">{RISK_LABEL[confirm.risk]}</p>
            <p className="mt-0.5 font-mono text-[10.5px] opacity-70">{confirm.tool}</p>
          </div>
        </div>
        <div className="rounded-xl border border-white/[0.07] bg-black/40 px-3 py-2.5">
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-white/70">
            {confirm.detail}
          </pre>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-falcon-500 to-falcon-400 transition-all duration-200"
            style={{ width: `${remaining}%` }}
          />
        </div>
        <p className="text-center text-[10px] text-white/30">Süre dolduğunda işlem otomatik iptal edilir.</p>
      </div>
    </Modal>
  );
}

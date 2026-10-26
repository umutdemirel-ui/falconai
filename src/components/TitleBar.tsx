import { useEffect, useState } from 'react';
import { Minus, Square, X } from 'lucide-react';
import { api, isElectron } from '../lib/api';
import { useStore } from '../lib/store';
import { cn } from '../lib/utils';

function WinButton({ onClick, children, danger = false, label }: { onClick: () => void; children: React.ReactNode; danger?: boolean; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        'no-drag flex h-7 w-9 items-center justify-center rounded-md text-white/45 transition-colors',
        danger ? 'hover:bg-falcon-600 hover:text-white' : 'hover:bg-white/10 hover:text-white',
      )}
    >
      {children}
    </button>
  );
}

export function TitleBar() {
  const [isMac, setIsMac] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const agentState = useStore((s) => s.agentState);
  const busy = useStore((s) => s.busy);

  useEffect(() => {
    void api.app.platform().then((platform) => setIsMac(platform === 'darwin'));
    void api.window.isMaximized().then(setMaximized);
  }, []);

  if (!isElectron) {
    return (
      <div className="drag flex h-9 shrink-0 items-center justify-center border-b border-white/[0.05] bg-black/30">
        <span className="text-[10.5px] uppercase tracking-[0.3em] text-white/25">Falcon · tarayıcı önizlemesi</span>
      </div>
    );
  }

  return (
    <div className="drag relative flex h-10 shrink-0 items-center justify-between pl-4 pr-2">
      <span className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 text-[9px] font-medium uppercase tracking-[0.34em] text-white/20 lg:block">
        Falcon • Daha akıllı bir yarın için
      </span>
      <div className={cn('flex items-center gap-2.5', isMac && 'pl-14')}>
        <span className={cn('dot', busy ? 'bg-falcon-500 shadow-[0_0_10px_rgba(255,47,47,0.9)] animate-pulse' : 'bg-emerald-400/80 shadow-[0_0_8px_rgba(52,211,153,0.6)]')} />
        <span className="text-[10.5px] font-medium uppercase tracking-[0.26em] text-white/30">
          {busy ? (agentState.status === 'tool' ? 'Araç çalışıyor' : 'Düşünüyor') : 'Hazır'}
        </span>
      </div>
      {!isMac ? (
        <div className="flex items-center gap-0.5">
          <WinButton label="Küçült" onClick={() => void api.window.minimize()}>
            <Minus size={14} />
          </WinButton>
          <WinButton
            label={maximized ? 'Geri yükle' : 'Büyüt'}
            onClick={() => {
              void api.window.maximize();
              setTimeout(() => void api.window.isMaximized().then(setMaximized), 200);
            }}
          >
            <Square size={11} />
          </WinButton>
          <WinButton label="Kapat" danger onClick={() => void api.window.close()}>
            <X size={14} />
          </WinButton>
        </div>
      ) : null}
    </div>
  );
}

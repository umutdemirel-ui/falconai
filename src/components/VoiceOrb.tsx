import { Mic, Square, Waves } from 'lucide-react';
import { cn } from '../lib/utils';

interface Props {
  listening: boolean;
  speaking: boolean;
  thinking: boolean;
  level: number;
  size?: 'md' | 'lg';
  onToggle: () => void;
  onStopSpeaking?: () => void;
  statusText?: string;
  hint?: string;
}

function Waveform({ active, level, side, bars = 11 }: { active: boolean; level: number; side: 'left' | 'right'; bars?: number }) {
  return (
    <div className={cn('flex h-16 items-center gap-[3.5px]', side === 'left' ? 'justify-end' : 'justify-start')}>
      {Array.from({ length: bars }).map((_, i) => {
        const index = side === 'left' ? bars - i : i + 1;
        const base = Math.max(0.16, 1 - index / (bars + 2));
        const wobble = 0.55 + 0.45 * Math.abs(Math.sin(index * 1.7));
        const height = active ? Math.max(6, base * wobble * 52 * (0.55 + level * 0.9)) : 6 + base * 8;
        return (
          <span
            key={i}
            className={cn('wave-bar', !active && 'wave-bar-idle')}
            style={{
              height,
              animationDelay: `${(index % 6) * 0.09}s`,
              opacity: active ? 0.95 : 0.4,
            }}
          />
        );
      })}
    </div>
  );
}

export function VoiceOrb({
  listening,
  speaking,
  thinking,
  level,
  size = 'lg',
  onToggle,
  onStopSpeaking,
  statusText,
  hint,
}: Props) {
  const dimension = size === 'lg' ? 158 : 118;
  const active = listening || speaking;
  const status = statusText ?? (listening ? 'Dinliyorum…' : speaking ? 'Konuşuyorum…' : thinking ? 'Düşünüyorum…' : 'Seni dinlemeye hazırım');

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative flex items-center justify-center gap-5">
        <div className="hidden sm:block">
          <Waveform active={active} level={Math.max(level, 0.25)} side="left" />
        </div>

        <div className="relative" style={{ width: dimension, height: dimension }}>
          {listening ? (
            <>
              <span className="ripple absolute inset-0 rounded-full border border-falcon-500/40" />
              <span className="ripple absolute inset-0 rounded-full border border-falcon-500/30" style={{ animationDelay: '0.9s' }} />
            </>
          ) : null}
          <span className="orb-ring inset-[6px]" />
          <span className="orb-ring inset-[-10px] border-falcon-500/10" />
          <span className="orb-ring inset-[-26px] border-falcon-500/[0.07]" />

          <button
            type="button"
            onClick={listening ? onToggle : speaking ? (onStopSpeaking ?? onToggle) : onToggle}
            className={cn(
              'group relative flex h-full w-full items-center justify-center rounded-full transition-transform duration-300 active:scale-[0.97]',
              'bg-[radial-gradient(circle_at_50%_32%,rgba(255,86,86,0.95),rgba(190,16,38,0.92)_46%,rgba(74,4,14,0.95)_78%,rgba(20,2,6,1))]',
              'border border-falcon-400/40 shadow-[0_0_60px_-10px_rgba(255,45,45,0.75),inset_0_2px_18px_rgba(255,160,150,0.22)]',
              (listening || speaking) && 'shadow-[0_0_90px_-6px_rgba(255,45,45,0.95),inset_0_2px_18px_rgba(255,190,180,0.3)]',
            )}
            aria-label={listening ? 'Mikrofonu kapat' : 'Mikrofonu aç'}
          >
            <span className="absolute inset-[14%] rounded-full border border-white/10" />
            <span className="absolute inset-[26%] rounded-full bg-black/20 blur-[2px]" />
            {speaking ? (
              <Square size={size === 'lg' ? 38 : 28} className="relative z-10 fill-white text-white drop-shadow-[0_0_14px_rgba(255,255,255,0.55)]" />
            ) : listening ? (
              <Waves size={size === 'lg' ? 46 : 34} className="relative z-10 text-white drop-shadow-[0_0_16px_rgba(255,255,255,0.6)]" />
            ) : (
              <Mic size={size === 'lg' ? 48 : 34} className="relative z-10 text-white drop-shadow-[0_0_16px_rgba(255,255,255,0.55)]" />
            )}
          </button>
        </div>

        <div className="hidden sm:block">
          <Waveform active={active} level={Math.max(level, 0.25)} side="right" />
        </div>
      </div>

      <div className="flex flex-col items-center gap-1.5">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'dot',
              listening || speaking ? 'bg-falcon-500 shadow-[0_0_10px_rgba(255,47,47,0.9)]' : 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]',
              (listening || speaking) && 'animate-pulse',
            )}
          />
          <span className={cn('text-[13px] font-medium', listening || speaking ? 'text-falcon-200' : 'text-white/55')}>{status}</span>
        </div>
        {hint ? <p className="max-w-[320px] text-center text-[11.5px] leading-relaxed text-white/30">{hint}</p> : null}
      </div>
    </div>
  );
}

import { Mic, MicOff, Settings2, Square, X } from 'lucide-react';
import { useStore } from '../lib/store';
import { voiceEngine } from '../lib/voice';
import { cn } from '../lib/utils';
import { VoiceOrb } from './VoiceOrb';

/**
 * Tasarımdaki "Sesli Asistan" penceresi: konuşma sırasında ekranın sol altında
 * beliren, mikrofon durumunu, canlı seviyeyi ve yazıya dökülen metni gösteren panel.
 */
export function VoicePanel() {
  const open = useStore((s) => s.voicePanelOpen);
  const voice = useStore((s) => s.voice);
  const config = useStore((s) => s.config);
  const setView = useStore((s) => s.setView);
  const setVoicePanelOpen = useStore((s) => s.setVoicePanelOpen);
  const busy = useStore((s) => s.busy);

  if (!open) return null;

  return (
    <div className="fixed bottom-4 left-[268px] z-40 w-[420px] fade-up">
      <div className="panel panel-red overflow-hidden backdrop-blur-2xl">
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2.5">
          <Mic size={14} className="text-falcon-400" />
          <span className="flex-1 text-[12.5px] font-semibold text-white/85">Sesli Asistan</span>
          <span className={cn('mr-1 flex items-center gap-1.5 text-[10.5px]', voice.listening ? 'text-falcon-300' : voice.transcribing ? 'text-white/50' : 'text-emerald-300/80')}>
            <span className={cn('dot', voice.listening ? 'bg-falcon-500 animate-pulse' : voice.transcribing ? 'bg-amber-400' : 'bg-emerald-400')} />
            {voice.listening ? 'Dinliyorum' : voice.transcribing ? 'Yazıya dökülüyor' : 'Hazır'}
          </span>
          <button
            type="button"
            className="icon-btn h-6 w-6"
            title="Ses ayarları"
            onClick={() => {
              setView('voice');
              setVoicePanelOpen(false);
            }}
          >
            <Settings2 size={13} />
          </button>
          <button type="button" className="icon-btn h-6 w-6" title="Kapat" onClick={() => setVoicePanelOpen(false)}>
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-4">
          <div className="flex items-center gap-4">
            <div className="shrink-0">
              <VoiceOrb
                size="md"
                listening={voice.listening}
                speaking={voice.speaking}
                thinking={busy}
                level={voice.level}
                onToggle={() => {
                  if (voice.listening) void voiceEngine.finishListening();
                  else void voiceEngine.startListening('push');
                }}
                onStopSpeaking={() => voiceEngine.stopSpeaking()}
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="label mb-1.5">Duyduğum</p>
              <div className="min-h-[64px] rounded-xl border border-white/[0.07] bg-black/30 px-3 py-2.5">
                <p className={cn('text-[12.5px] leading-relaxed', voice.transcript ? 'text-white/85' : 'text-white/30')}>
                  {voice.transcript || (voice.listening ? 'Konuşman bekleniyor…' : 'Henüz konuşma yok.')}
                </p>
                {voice.transcribing ? (
                  <div className="mt-2 flex items-center gap-1.5 text-[10.5px] text-falcon-300/90">
                    <span className="h-1.5 w-1.5 animate-ping rounded-full bg-falcon-500" />
                    Gemini sesi yazıya döküyor…
                  </div>
                ) : null}
              </div>
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (voice.listening) void voiceEngine.finishListening();
                    else void voiceEngine.startListening('push');
                  }}
                  className="btn btn-ghost flex-1 py-2 text-[11.5px]"
                >
                  {voice.listening ? <MicOff size={13} /> : <Mic size={13} />}
                  {voice.listening ? 'Mikrofonu Kapat' : 'Mikrofonu Aç'}
                </button>
                {voice.speaking ? (
                  <button type="button" onClick={() => voiceEngine.stopSpeaking()} className="btn btn-danger py-2 text-[11.5px]">
                    <Square size={12} className="fill-current" /> Sustur
                  </button>
                ) : null}
              </div>
              <p className="mt-1.5 text-[10px] text-white/25">
                {config?.voice.engine === 'gemini'
                  ? `Gemini TTS · ${config.voice.voice}`
                  : config?.voice.engine === 'system'
                    ? 'Sistem sesi'
                    : 'Ses kapalı'}
                {config?.voice.engine !== 'off' ? ' · yanıtlar sesli okunur' : ''}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { CheckCircle2, Mic, Play, Square, Wand2 } from 'lucide-react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { voiceEngine, type RecorderResult } from '../lib/voice';
import { Button, Panel } from './ui';
import { cn } from '../lib/utils';

/**
 * Mikrofon testi: kaydı başlatır, geri dinletir ve yazıya döker.
 * Sesli komut çalışmadığında sorunun mikrofon, izin, ağ yoksa API olduğunu
 * ayırt etmeyi sağlar.
 */
export function MicTestPanel() {
  const voice = useStore((s) => s.voice);
  const config = useStore((s) => s.config);
  const [state, setState] = useState<'idle' | 'recording' | 'ready' | 'transcribing'>('idle');
  const [result, setResult] = useState<RecorderResult | null>(null);
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [provider, setProvider] = useState('');
  const [error, setError] = useState('');

  const providerLabel =
    config?.ai.voiceProvider === 'openai' ? 'OpenAI (Whisper + TTS)' : 'Gemini';

  const record = async () => {
    setError('');
    setText('');
    setProvider('');
    setState('recording');
    try {
      const recorded = await voiceEngine.testMicrophone(4000);
      setResult(recorded);
      setUrl(recorded.frames ? `data:${recorded.mime};base64,${recorded.base64}` : '');
      setState('ready');
      if (!recorded.frames) {
        setError('Mikrofon hiç veri göndermedi. Cihaz seçimini ve sistem izinlerini kontrol et.');
      } else if (!recorded.hasSpeech) {
        setError('Kayıt alındı ama ses çok kısık. Mikrofona yaklaşarak tekrar dene.');
      }
    } catch (err) {
      setState('idle');
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const transcribe = async () => {
    if (!result) return;
    setState('transcribing');
    setError('');
    try {
      const res = await api.voice.transcribe(result.base64, result.mime, 'Falcon sesli asistan mikrofon testi');
      setText(res.text || '(boş yanıt)');
      setProvider(res.provider ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setState('ready');
    }
  };

  return (
    <Panel className="p-4">
      <div className="mb-2 flex items-center gap-2">
        <Mic size={14} className="text-falcon-400" />
        <span className="flex-1 text-[12.5px] font-semibold text-white/85">Mikrofon testi</span>
        <span className="text-[10px] text-white/25">{providerLabel}</span>
      </div>

      <p className="text-[10.5px] leading-relaxed text-white/35">
        4 saniyelik kayıt alır, geri dinletir ve yazıya döker. Sesli komut çalışmıyorsa önce buradan dene.
      </p>

      {state === 'recording' ? (
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-falcon-500 to-falcon-300 transition-[width] duration-100"
              style={{ width: `${Math.max(4, Math.round(voice.level * 100))}%` }}
            />
          </div>
          <p className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-falcon-200">
            <span className="dot animate-pulse bg-falcon-500" /> Dinliyorum… konuş
          </p>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant={state === 'recording' ? 'danger' : 'primary'} onClick={() => void record()} disabled={state === 'recording' || state === 'transcribing'}>
          {state === 'recording' ? <Square size={11} /> : <Mic size={11} />}
          {state === 'recording' ? 'Kaydediliyor…' : 'Kaydet'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void transcribe()} disabled={!result || state === 'transcribing'}>
          <Wand2 size={11} /> {state === 'transcribing' ? 'Yazıya dökülüyor…' : 'Yazıya dök'}
        </Button>
        {url ? (
          <Button size="sm" variant="ghost" onClick={() => void new Audio(url).play().catch(() => undefined)}>
            <Play size={11} /> Kaydı dinle
          </Button>
        ) : null}
      </div>

      {url ? <audio className="mt-2 w-full" controls src={url} /> : null}

      {result ? (
        <div className="mt-2 flex flex-wrap gap-1.5 text-[9.5px] text-white/35">
          <span className={cn('rounded border px-1.5 py-0.5', result.frames ? 'border-emerald-400/25 text-emerald-300/80' : 'border-falcon-500/30 text-falcon-200')}>
            {result.frames ? `${result.frames.toLocaleString('tr-TR')} örnek` : 'veri yok'}
          </span>
          <span className="rounded border border-white/10 px-1.5 py-0.5">{(result.durationMs / 1000).toFixed(1)} sn</span>
          <span className="rounded border border-white/10 px-1.5 py-0.5">tepe {result.peak.toFixed(2)}</span>
          <span className={cn('rounded border px-1.5 py-0.5', result.hasSpeech ? 'border-emerald-400/25 text-emerald-300/80' : 'border-amber-400/25 text-amber-300/80')}>
            {result.hasSpeech ? 'konuşma algılandı' : 'konuşma yok'}
          </span>
        </div>
      ) : null}

      {text ? (
        <div className="mt-2 rounded-lg border border-emerald-400/20 bg-emerald-500/[0.06] px-2.5 py-2">
          <p className="flex items-center gap-1 text-[9.5px] uppercase tracking-wide text-emerald-300/70">
            <CheckCircle2 size={10} /> yazıya döküldü {provider ? `· ${provider}` : ''}
          </p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-white/80">{text}</p>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-[10px] leading-relaxed text-falcon-200/90">{error}</p> : null}
    </Panel>
  );
}

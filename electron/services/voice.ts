import { getConfig, hasProviderKey, providerKey } from '../core/config';
import { log } from '../core/logger';
import { chunkForSpeech, synthesizeSpeech, transcribe, type TtsResult } from '../core/gemini';

/**
 * Ses hizmeti (ana süreç).
 * - Metni Gemini TTS ile sese çevirir, WAV base64 olarak arayüze döndürür.
 * - Arayüzden gelen mikrofon kaydını Gemini ile yazıya döker.
 * Uzun metinler cümle sınırlarından bölünür ve tek WAV dosyasında birleştirilir.
 */

export interface SpeakResult {
  audioBase64: string;
  mime: string;
  model: string;
  chars: number;
  chunks: number;
  provider: 'gemini' | 'openai' | 'system';
}

function mergeWav(buffers: Buffer[]): Buffer {
  if (buffers.length === 1) return buffers[0];
  const pcmParts: Buffer[] = [];
  let sampleRate = 24000;
  for (const buf of buffers) {
    if (buf.subarray(0, 4).toString('ascii') === 'RIFF') {
      sampleRate = buf.readUInt32LE(24);
      const dataLen = buf.readUInt32LE(40);
      const start = buf.indexOf('data') + 8;
      pcmParts.push(buf.subarray(start, Math.min(buf.length, start + dataLen)));
    } else {
      pcmParts.push(buf);
    }
  }
  const pcm = Buffer.concat(pcmParts);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function openAiAudioBase(): string {
  const cfg = getConfig();
  const base = cfg.ai.providers.openai.baseUrl?.trim() || 'https://api.openai.com/v1';
  return base.replace(/\/+$/, '');
}

/** OpenAI TTS: tek parça WAV döndürür. */
async function openAiSpeech(text: string, signal?: AbortSignal): Promise<TtsResult> {
  const cfg = getConfig();
  const key = providerKey('openai');
  if (!key) throw new Error('OpenAI anahtarı yok.');
  const model = cfg.ai.openaiTtsModel || 'gpt-4o-mini-tts';
  const res = await fetch(`${openAiAudioBase()}/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      input: text,
      voice: cfg.ai.openaiVoice || 'nova',
      response_format: 'wav',
    }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI seslendirme hatası (${res.status}): ${body.slice(0, 300)}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  return { audioBase64: buffer.toString('base64'), mime: 'audio/wav', model };
}

export async function speak(
  text: string,
  opts: { voice?: string; style?: string; signal?: AbortSignal } = {},
): Promise<SpeakResult> {
  const cfg = getConfig();
  const chunks = chunkForSpeech(text, 1200);
  if (!chunks.length) throw new Error('Seslendirilecek metin yok.');

  const preferOpenAi = cfg.ai.voiceProvider === 'openai' && hasProviderKey('openai');
  const geminiReady = hasProviderKey('gemini');
  const order: ('openai' | 'gemini')[] = preferOpenAi
    ? geminiReady
      ? ['openai', 'gemini']
      : ['openai']
    : geminiReady
      ? ['gemini', ...(hasProviderKey('openai') ? (['openai'] as const) : [])]
      : hasProviderKey('openai')
        ? ['openai']
        : ['gemini'];

  let lastError: unknown = null;
  for (const provider of order) {
    try {
      if (provider === 'openai') {
        const merged = mergeWav(
          await Promise.all(chunks.map((chunk) => openAiSpeech(chunk, opts.signal).then((r) => Buffer.from(r.audioBase64, 'base64')))),
        );
        log.info(`ses üretildi (openai): ${chunks.length} parça, ${Math.round(merged.length / 1024)} KB`);
        return {
          audioBase64: merged.toString('base64'),
          mime: 'audio/wav',
          model: cfg.ai.openaiTtsModel || 'gpt-4o-mini-tts',
          chars: text.length,
          chunks: chunks.length,
          provider: 'openai',
        };
      }

      const results: TtsResult[] = [];
      for (const chunk of chunks) {
        results.push(
          await synthesizeSpeech(chunk, {
            model: cfg.models.tts,
            voice: opts.voice ?? cfg.voice.voice,
            style: opts.style ?? cfg.voice.style,
            signal: opts.signal,
          }),
        );
      }
      const merged = mergeWav(results.map((r) => Buffer.from(r.audioBase64, 'base64')));
      log.info(`ses üretildi (gemini): ${chunks.length} parça, ${Math.round(merged.length / 1024)} KB`);
      return {
        audioBase64: merged.toString('base64'),
        mime: 'audio/wav',
        model: results[0]?.model ?? cfg.models.tts,
        chars: text.length,
        chunks: chunks.length,
        provider: 'gemini',
      };
    } catch (err) {
      lastError = err;
      log.warn(`seslendirme başarısız (${provider})`, err instanceof Error ? err.message : err);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Seslendirme yapılamadı. Ayarlar → API ve Modeller bölümünden geçerli bir anahtar ekleyin.');
}

async function openAiTranscribe(
  audioBase64: string,
  mime: string,
  signal?: AbortSignal,
): Promise<string> {
  const cfg = getConfig();
  const key = providerKey('openai');
  if (!key) throw new Error('OpenAI anahtarı yok.');
  const buffer = Buffer.from(audioBase64, 'base64');
  const ext = mime.includes('webm') ? 'webm' : mime.includes('ogg') ? 'ogg' : mime.includes('mp3') ? 'mp3' : 'wav';
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime || 'audio/wav' }), `kayit.${ext}`);
  form.append('model', cfg.ai.openaiSttModel || 'whisper-1');
  form.append('language', 'tr');
  form.append('response_format', 'json');
  const res = await fetch(`${openAiAudioBase()}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI yazıya dökme hatası (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { text?: string };
  return (data.text ?? '').trim();
}

export async function speechToText(
  audioBase64: string,
  mime: string,
  opts: { hint?: string; signal?: AbortSignal } = {},
): Promise<{ text: string; provider: 'gemini' | 'openai' }> {
  const cfg = getConfig();
  if (!audioBase64) throw new Error('Ses kaydı boş.');
  const openAiReady = hasProviderKey('openai');
  const geminiReady = hasProviderKey('gemini');
  const order: ('openai' | 'gemini')[] =
    cfg.ai.voiceProvider === 'openai' && openAiReady ? (geminiReady ? ['openai', 'gemini'] : ['openai']) : geminiReady ? (openAiReady ? ['gemini', 'openai'] : ['gemini']) : ['openai'];

  let lastError: unknown = null;
  for (const provider of order) {
    try {
      if (provider === 'openai') {
        const text = await openAiTranscribe(audioBase64, mime, opts.signal);
        if (text) return { text, provider };
        lastError = new Error('OpenAI konuşma algılayamadı.');
        continue;
      }
      const text = await transcribe(audioBase64, mime || 'audio/wav', {
        model: cfg.models.stt,
        language: 'tr-TR',
        hint: opts.hint,
        signal: opts.signal,
      });
      if (text) return { text, provider };
      lastError = new Error('Konuşma algılanamadı.');
    } catch (err) {
      lastError = err;
      log.warn(`yazıya dökme başarısız (${provider})`, err instanceof Error ? err.message : err);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Ses yazıya çevrilemedi. Ayarlar → API ve Modeller bölümünden anahtarınızı kontrol edin.');
}

/** Konuşma tamamlandığında söylenecek kısa onay cümleleri */
export function shortAck(toolName: string): string {
  const map: Record<string, string> = {
    open_app: 'Açıyorum.',
    close_app: 'Kapatıyorum.',
    system_power: 'Tamam.',
    write_file: 'Dosyayı kaydettim.',
    read_file: 'Dosyayı okudum.',
    save_note: 'Notu kaydettim.',
  };
  return map[toolName] ?? 'Tamam.';
}

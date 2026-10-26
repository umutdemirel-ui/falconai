import { getConfig } from '../core/config';
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

export async function speak(text: string, opts: { voice?: string; style?: string; signal?: AbortSignal } = {}): Promise<SpeakResult> {
  const cfg = getConfig();
  const model = cfg.models.tts;
  const voice = opts.voice ?? cfg.voice.voice;
  const style = opts.style ?? cfg.voice.style;
  const chunks = chunkForSpeech(text, 1200);
  if (!chunks.length) throw new Error('Seslendirilecek metin yok.');

  const results: TtsResult[] = [];
  for (const chunk of chunks) {
    const r = await synthesizeSpeech(chunk, { model, voice, style, signal: opts.signal });
    results.push(r);
  }
  const merged = mergeWav(results.map((r) => Buffer.from(r.audioBase64, 'base64')));
  log.info(`ses üretildi: ${chunks.length} parça, ${Math.round(merged.length / 1024)} KB`);
  return {
    audioBase64: merged.toString('base64'),
    mime: 'audio/wav',
    model: results[0]?.model ?? model,
    chars: text.length,
    chunks: chunks.length,
  };
}

export async function speechToText(
  audioBase64: string,
  mime: string,
  opts: { hint?: string; signal?: AbortSignal } = {},
): Promise<{ text: string; durationSec?: number }> {
  const cfg = getConfig();
  if (!audioBase64) throw new Error('Ses kaydı boş.');
  const text = await transcribe(audioBase64, mime || 'audio/wav', {
    model: cfg.models.stt,
    language: 'tr-TR',
    hint: opts.hint,
    signal: opts.signal,
  });
  return { text };
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

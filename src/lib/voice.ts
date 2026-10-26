import { api } from './api';
import { useStore } from './store';

/**
 * Ses motoru.
 * - Mikrofon: WebAudio ile 16 kHz mono WAV kaydı (Gemini STT'ye gönderilir)
 * - Konuşma: Gemini TTS (WAV) → WebAudio; başarısızsa sistem sesi (speechSynthesis)
 * - Kesme (barge-in): Falcon konuşurken mikrofona basılırsa ses durdurulur
 */

interface RecorderResult {
  base64: string;
  mime: string;
  durationMs: number;
  hasSpeech: boolean;
}

class WavRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private sampleRate = 48000;
  private startedAt = 0;
  private level = 0;
  private running = false;

  async start(deviceId?: string): Promise<void> {
    if (this.running) return;
    const constraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
      video: false,
    };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AudioCtx();
    this.sampleRate = this.ctx.sampleRate;
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    this.processor.onaudioprocess = (event) => {
      const data = event.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(data));
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += data[i] * data[i];
      const rms = Math.sqrt(sum / (data.length / 4));
      this.level = Math.min(1, rms * 12);
      useStore.getState().setVoice({ level: this.level });
    };
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    this.source.connect(this.processor);
    this.processor.connect(mute);
    mute.connect(this.ctx.destination);
    this.startedAt = Date.now();
    this.running = true;
  }

  getLevel(): number {
    return this.level;
  }

  get elapsed(): number {
    return Date.now() - this.startedAt;
  }

  async stop(): Promise<RecorderResult> {
    this.running = false;
    const chunks = this.chunks;
    this.chunks = [];
    const sampleRate = this.sampleRate;
    try {
      this.processor?.disconnect();
      this.source?.disconnect();
      this.stream?.getTracks().forEach((t) => t.stop());
      await this.ctx?.close();
    } catch {
      /* yoksay */
    }
    this.processor = null;
    this.source = null;
    this.stream = null;
    this.ctx = null;
    this.level = 0;
    useStore.getState().setVoice({ level: 0 });

    const total = chunks.reduce((n, c) => n + c.length, 0);
    const merged = new Float32Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }
    const downsampled = downsample(merged, sampleRate, 16000);
    const wav = encodeWav(downsampled, 16000);

    let sum = 0;
    for (let i = 0; i < merged.length; i += 8) sum += merged[i] * merged[i];
    const rms = Math.sqrt(sum / Math.max(1, merged.length / 8));

    return {
      base64: bytesToBase64(wav),
      mime: 'audio/wav',
      durationMs: Math.round((total / sampleRate) * 1000),
      hasSpeech: rms > 0.01 && total > sampleRate * 0.25,
    };
  }

  abort(): void {
    this.running = false;
    this.chunks = [];
    try {
      this.processor?.disconnect();
      this.source?.disconnect();
      this.stream?.getTracks().forEach((t) => t.stop());
      void this.ctx?.close();
    } catch {
      /* yoksay */
    }
    this.processor = null;
    this.source = null;
    this.stream = null;
    this.ctx = null;
    useStore.getState().setVoice({ level: 0 });
  }

  isRunning(): boolean {
    return this.running;
  }
}

function downsample(buffer: Float32Array, from: number, to: number): Float32Array {
  if (to >= from) return buffer;
  const ratio = from / to;
  const length = Math.floor(buffer.length / ratio);
  const result = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (let j = start; j < end && j < buffer.length; j++) {
      sum += buffer[j];
      count++;
    }
    result[i] = count ? sum / count : 0;
  }
  return result;
}

function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/* ------------------------------------------------------------------ */
/* Motor                                                              */
/* ------------------------------------------------------------------ */

type TranscriptHandler = (text: string, meta: { voice: boolean }) => void;

class VoiceEngine {
  private recorder = new WavRecorder();
  private audio: HTMLAudioElement | null = null;
  private stopRequested = false;
  private autoStopTimer: number | null = null;
  private transcriptHandler: TranscriptHandler | null = null;

  onTranscript(cb: TranscriptHandler): void {
    this.transcriptHandler = cb;
  }

  /** Mikrofon izni + cihaz listesi */
  async requestPermission(): Promise<boolean> {
    try {
      const ok = await api.voice.askMicPermission();
      if (!ok) return false;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return true;
    } catch {
      return false;
    }
  }

  async devices(): Promise<MediaDeviceInfo[]> {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      return all.filter((d) => d.kind === 'audioinput');
    } catch {
      return [];
    }
  }

  isListening(): boolean {
    return this.recorder.isRunning();
  }

  async startListening(mode: 'push' | 'continuous' = 'push'): Promise<void> {
    const store = useStore.getState();
    if (this.recorder.isRunning()) return;
    if (store.voice.speaking) this.stopSpeaking();

    const granted = await this.requestPermission();
    if (!granted) {
      store.pushToast({ kind: 'error', title: 'Mikrofon izni yok', body: 'Sistem ayarlarından Falcon’a mikrofon erişimi verin.' });
      return;
    }
    try {
      const cfg = store.config;
      await this.recorder.start(cfg?.voice.micDeviceId || undefined);
      store.setVoice({ listening: true, transcribing: false, error: undefined, transcript: '', mode });
      store.setVoicePanelOpen(true);
      this.watchSilence();
    } catch (err) {
      store.setVoice({
        listening: false,
        error: err instanceof Error ? err.message : 'Mikrofon açılamadı',
      });
      store.pushToast({ kind: 'error', title: 'Mikrofon açılamadı', body: err instanceof Error ? err.message : String(err) });
    }
  }

  private watchSilence(): void {
    if (this.autoStopTimer) window.clearInterval(this.autoStopTimer);
    const cfg = useStore.getState().config;
    const threshold = cfg?.voice.vadThreshold ?? 0.035;
    const silenceMs = cfg?.voice.vadSilenceMs ?? 1100;
    const maxMs = 45_000;
    let lastLoud = Date.now();
    let hasSpeech = false;
    const started = Date.now();

    this.autoStopTimer = window.setInterval(() => {
      if (!this.recorder.isRunning()) {
        this.clearTimer();
        return;
      }
      const level = this.recorder.getLevel();
      if (level > threshold) {
        lastLoud = Date.now();
        hasSpeech = true;
      }
      const silent = Date.now() - lastLoud;
      if (hasSpeech && silent > silenceMs) {
        void this.finishListening();
        return;
      }
      if (!hasSpeech && Date.now() - started > 12_000) {
        void this.cancelListening(true);
        return;
      }
      if (Date.now() - started > maxMs) void this.finishListening();
    }, 80);
  }

  private clearTimer(): void {
    if (this.autoStopTimer) {
      window.clearInterval(this.autoStopTimer);
      this.autoStopTimer = null;
    }
  }

  async finishListening(): Promise<void> {
    const store = useStore.getState();
    if (!this.recorder.isRunning()) return;
    this.clearTimer();
    store.setVoice({ listening: false, transcribing: true });
    let result: RecorderResult | null = null;
    try {
      result = await this.recorder.stop();
    } catch {
      result = null;
    }
    if (!result || !result.hasSpeech || result.durationMs < 350) {
      store.setVoice({ transcribing: false, transcript: '' });
      if (store.voice.mode === 'continuous' && store.config?.voice.continuousListening) {
        setTimeout(() => void this.startListening('continuous'), 600);
      } else {
        store.setVoicePanelOpen(false);
      }
      return;
    }

    const hint = `Kullanıcı Falcon adlı Türkçe sesli asistana komut veriyor. Bilgisayar kontrolü, uygulama açma/kapatma, dosya işlemleri, gündem ve yapay zekâ konuları geçebilir.`;
    try {
      const { text } = await api.voice.transcribe(result.base64, result.mime, hint);
      const clean = text.trim();
      if (!clean) {
        store.setVoice({ transcribing: false });
        return;
      }
      const cfg = store.config;
      if (cfg?.voice.wakeWordEnabled) {
        const phrase = (cfg.voice.wakePhrase || 'Falcon').toLocaleLowerCase('tr-TR');
        const lower = clean.toLocaleLowerCase('tr-TR');
        const idx = lower.indexOf(phrase);
        if (idx === -1) {
          store.setVoice({ transcribing: false, transcript: clean });
          if (store.voice.mode === 'continuous') setTimeout(() => void this.startListening('continuous'), 400);
          return;
        }
        const stripped = clean.slice(0, idx) + clean.slice(idx + phrase.length);
        this.deliver(stripped.replace(/^[,\s.]+/, '').trim());
      } else {
        this.deliver(clean);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      store.setVoice({ transcribing: false, error: message });
      store.pushToast({ kind: 'error', title: 'Ses yazıya çevrilemedi', body: message });
      store.setVoicePanelOpen(false);
    }
  }

  private deliver(text: string): void {
    const store = useStore.getState();
    store.setVoice({ transcribing: false, transcript: text });
    if (text.length < 2) {
      store.setVoicePanelOpen(false);
      return;
    }
    this.transcriptHandler?.(text, { voice: true });
  }

  async cancelListening(closePanel = false): Promise<void> {
    this.clearTimer();
    if (this.recorder.isRunning()) this.recorder.abort();
    const store = useStore.getState();
    store.setVoice({ listening: false, transcribing: false, level: 0, transcript: '' });
    if (closePanel) store.setVoicePanelOpen(false);
  }

  /* ----------------------------- Konuşma ----------------------------- */

  async speak(text: string, opts: { force?: boolean } = {}): Promise<void> {
    const trimmed = text?.trim();
    if (!trimmed) return;
    const store = useStore.getState();
    const cfg = store.config;
    if (!cfg) return;
    if (!opts.force && !cfg.voice.autoSpeak && !store.voice.listening) {
      // Otomatik konuşma kapalıysa yalnızca sesli oturumlarda oku
      return;
    }
    this.stopSpeaking();
    this.stopRequested = false;
    store.setVoice({ speaking: true });

    if (cfg.voice.engine === 'system') {
      await this.speakSystem(trimmed);
      this.afterSpeak();
      return;
    }
    if (cfg.voice.engine === 'off') {
      store.setVoice({ speaking: false });
      return;
    }

    try {
      const result = await api.voice.speak(trimmed, cfg.voice.voice);
      if (this.stopRequested) return;
      await this.playBase64(result.audioBase64, result.mime);
    } catch (err) {
      if (!this.stopRequested) {
        // Sessizce sistem sesine düş; kullanıcıyı hatayla boğma
        console.warn('[falcon] Gemini sesi kullanılamadı, sistem sesi denenecek:', err);
        await this.speakSystem(trimmed);
      }
    } finally {
      this.afterSpeak();
    }
  }

  private afterSpeak(): void {
    const store = useStore.getState();
    store.setVoice({ speaking: false });
    const cfg = store.config;
    if (cfg?.voice.continuousListening && !this.stopRequested && !this.recorder.isRunning()) {
      setTimeout(() => void this.startListening('continuous'), 350);
    }
  }

  private async playBase64(base64: string, mime: string): Promise<void> {
    const src = `data:${mime || 'audio/wav'};base64,${base64}`;
    await new Promise<void>((resolve) => {
      const audio = new Audio(src);
      this.audio = audio;
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      audio.onpause = () => resolve();
      void audio.play().catch(() => resolve());
    });
    this.audio = null;
  }

  private speakSystem(text: string): Promise<void> {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) {
        resolve();
        return;
      }
      const cfg = useStore.getState().config;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'tr-TR';
      utterance.rate = cfg?.voice.rate ?? 1;
      const voices = window.speechSynthesis.getVoices();
      const preferred =
        (cfg?.voice.systemVoiceURI ? voices.find((v) => v.voiceURI === cfg.voice.systemVoiceURI) : undefined) ??
        voices.find((v) => v.lang?.toLowerCase().startsWith('tr')) ??
        voices[0];
      if (preferred) utterance.voice = preferred;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    });
  }

  stopSpeaking(): void {
    this.stopRequested = true;
    if (this.audio) {
      try {
        this.audio.pause();
        this.audio.src = '';
      } catch {
        /* yoksay */
      }
      this.audio = null;
    }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    useStore.getState().setVoice({ speaking: false });
  }

  async systemVoices(): Promise<SpeechSynthesisVoice[]> {
    if (!('speechSynthesis' in window)) return [];
    let voices = window.speechSynthesis.getVoices();
    if (!voices.length) {
      await new Promise((r) => setTimeout(r, 300));
      voices = window.speechSynthesis.getVoices();
    }
    return voices;
  }

  /** Gemini önizleme sesi için küçük bir örnek cümle */
  async preview(text = 'Merhaba, ben Falcon. Senin için buradayım.'): Promise<void> {
    await this.speak(text, { force: true });
  }
}

export const voiceEngine = new VoiceEngine();

// Tarayıcı önizlemesinde mikrofon izni istemini erkenden ısıt
if (typeof navigator !== 'undefined' && navigator.mediaDevices?.enumerateDevices) {
  void navigator.mediaDevices.enumerateDevices().catch(() => undefined);
}

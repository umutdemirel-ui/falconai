import { createHash } from 'node:crypto';
import { getApiKey, getConfig } from './config';
import { log } from './logger';
import { isRetiredModel } from './model-utils';
import { Lru } from './store';
import type { ModelInfo } from '../../shared/types';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/* ------------------------------------------------------------------ */
/* Tipler                                                              */
/* ------------------------------------------------------------------ */

export interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export interface GenerateOptions {
  model: string;
  contents: GeminiContent[];
  systemInstruction?: string;
  tools?: FunctionDeclaration[];
  /** Gemini'ın yerleşik Google Arama aracını kullan */
  googleSearch?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: 'text/plain' | 'application/json';
  responseSchema?: Record<string, unknown>;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Model bulunamazsa denenecek yedekler */
  fallbacks?: string[];
  /** Hangi amaçla kullanıldığı (model çözümlemede ipucu) */
  purpose?: ModelPurpose;
}

export type ModelPurpose = 'brain' | 'fast' | 'vision' | 'tts' | 'stt' | 'search';

export interface Usage {
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
}

export interface GenerateResult {
  text: string;
  functionCalls: { name: string; args: Record<string, unknown> }[];
  finishReason?: string;
  modelUsed: string;
  groundingSources: { title: string; uri: string }[];
  usage?: Usage;
  raw?: unknown;
}

export interface StreamChunk {
  textDelta?: string;
  thoughtDelta?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  finishReason?: string;
  modelUsed?: string;
  groundingSources?: { title: string; uri: string }[];
  usage?: Usage;
}

/* ------------------------------------------------------------------ */
/* Hatalar                                                             */
/* ------------------------------------------------------------------ */

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly model?: string,
    readonly retryable = false,
    readonly modelMissing = false,
    readonly userMessage?: string,
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

function describeError(status: number, body: string, model?: string): GeminiError {
  let code = '';
  let apiMessage = body.slice(0, 600);
  try {
    const parsed = JSON.parse(body) as { error?: { code?: number; message?: string; status?: string } };
    if (parsed.error) {
      code = parsed.error.status ?? '';
      apiMessage = parsed.error.message ?? apiMessage;
    }
  } catch {
    /* düz metin yanıt */
  }

  const base = `(${status}${code ? ` ${code}` : ''})`;
  if (status === 400) {
    if (/API key not valid|API_KEY_INVALID/i.test(body)) {
      return new GeminiError(
        `${base} ${apiMessage}`,
        status,
        'API_KEY_INVALID',
        model,
        false,
        false,
        'API anahtarı geçersiz. Ayarlar → API ve Modeller bölümüne Google AI Studio anahtarınızı yeniden girin.',
      );
    }
    return new GeminiError(
      `${base} ${apiMessage}`,
      status,
      'INVALID_ARGUMENT',
      model,
      false,
      false,
      `İstek Google tarafından reddedildi: ${apiMessage}`,
    );
  }
  if (status === 401 || status === 403) {
    return new GeminiError(
      `${base} ${apiMessage}`,
      status,
      'PERMISSION_DENIED',
      model,
      false,
      false,
      'Bu anahtarın bu modeli kullanma izni yok. Anahtarın Gemini API için etkinleştirildiğinden emin olun.',
    );
  }
  if (status === 404) {
    return new GeminiError(
      `${base} ${apiMessage}`,
      status,
      'MODEL_NOT_FOUND',
      model,
      false,
      true,
      `"${model}" modeli bulunamadı. Falcon otomatik olarak uygun modele geçmeyi deneyecek.`,
    );
  }
  if (status === 429) {
    return new GeminiError(
      `${base} ${apiMessage}`,
      status,
      'RATE_LIMITED',
      model,
      true,
      false,
      'Dakikalık/günlük istek sınırına ulaşıldı. Birkaç saniye sonra tekrar deneyin veya ayarlardan daha hafif bir model seçin.',
    );
  }
  if (status >= 500) {
    return new GeminiError(
      `${base} ${apiMessage}`,
      status,
      'SERVER_ERROR',
      model,
      true,
      false,
      'Google sunucuları şu anda yanıt veremiyor. Biraz sonra tekrar denenecek.',
    );
  }
  return new GeminiError(`${base} ${apiMessage}`, status, code || 'UNKNOWN', model);
}

/* ------------------------------------------------------------------ */
/* Model keşfi                                                         */
/* ------------------------------------------------------------------ */

export function stripModel(name: string): string {
  return name.replace(/^models\//, '');
}

interface ModelCache {
  models: ModelInfo[];
  fetchedAt: number;
}

let modelCache: ModelCache | null = null;

export async function listModels(force = false): Promise<ModelInfo[]> {
  if (!force && modelCache && Date.now() - modelCache.fetchedAt < 10 * 60 * 1000) {
    return modelCache.models;
  }
  const key = getApiKey();
  if (!key) throw new GeminiError('API anahtarı yok', 401, 'NO_API_KEY', undefined, false, false, 'Önce bir Google AI API anahtarı girin.');
  const res = await fetch(`${API_BASE}/models?pageSize=1000`, {
    headers: { 'x-goog-api-key': key },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw describeError(res.status, await res.text());
  const data = (await res.json()) as {
    models?: {
      name: string;
      displayName?: string;
      description?: string;
      inputTokenLimit?: number;
      outputTokenLimit?: number;
      supportedGenerationMethods?: string[];
    }[];
  };
  const models: ModelInfo[] = (data.models ?? []).map((m) => ({
    name: stripModel(m.name),
    displayName: m.displayName ?? stripModel(m.name),
    description: m.description ?? '',
    inputTokenLimit: m.inputTokenLimit ?? 0,
    outputTokenLimit: m.outputTokenLimit ?? 0,
    methods: m.supportedGenerationMethods ?? [],
  }));
  modelCache = { models, fetchedAt: Date.now() };
  return models;
}

export function clearModelCache(): void {
  modelCache = null;
}

function versionScore(name: string): number {
  const m = name.match(/(\d+(?:\.\d+)?)/g);
  if (!m) return 0;
  const nums = m.map(Number);
  // "gemini-3.8-flash" → 3.8 ; "gemini-2.5-flash-001" → 2.5
  return nums[0] + (nums[1] && nums[1] < 10 ? nums[1] / 100 : 0);
}

/** Amaç için en uygun modeli seçer (yapılandırılmış model mevcutsa ona dokunmaz). */
export function pickBestModel(purpose: ModelPurpose, models: ModelInfo[]): string | null {
  const usable = models.filter((m) => m.methods.some((x) => x.includes('generateContent')));
  if (!usable.length) return null;
  const score = (m: ModelInfo): number => {
    const n = m.name.toLowerCase();
    let s = versionScore(n) * 10;
    if (/tts/.test(n)) s += purpose === 'tts' ? 400 : -400;
    if (/live|audio-dialog|native-audio/.test(n)) s -= 300;
    if (/image|imagen|veo|embedding|aqa|robotics|computer-use|deep-research/.test(n)) s -= 500;
    if (/flash|lite|pro/.test(n)) s += 3;
    if (purpose === 'fast' && /lite/.test(n)) s += 25;
    if (purpose === 'fast' && /pro/.test(n)) s -= 10;
    if (purpose === 'brain' && /pro|argon/.test(n)) s += 6;
    if (/thinking/.test(n) && purpose !== 'brain') s -= 15;
    if (/preview|exp/.test(n)) s -= 4;
    if (/latest/.test(n)) s += 5;
    if (/0\d\d$/.test(n)) s -= 2; // sabit sürüm kopyaları (001)
    return s;
  };
  const sorted = [...usable].sort((a, b) => score(b) - score(a));
  return sorted[0]?.name ?? null;
}

/** Emekli model kontrolü (bkz. model-utils). */
export { RETIRED_MODEL } from './model-utils';

const FALLBACKS: Record<ModelPurpose, string[]> = {
  brain: ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-4-argon', 'gemini-3.5-flash-lite'],
  fast: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'],
  vision: ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'],
  tts: ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'],
  stt: ['gemini-3.8-flash', 'gemini-3.6-flash'],
  search: ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'],
};

/** Yapılandırılmış model + yedek zinciri */
export function modelChain(purpose: ModelPurpose, configured: string): string[] {
  const cfg = getConfig();
  const safe = isRetiredModel(configured) ? '' : configured;
  const chain = [safe, ...FALLBACKS[purpose]];
  const unique = [...new Set(chain.filter(Boolean))];
  if (!cfg.models.autoFallback) return unique.slice(0, 1);
  return unique;
}

/** Kullanıcıya gösterilecek en anlamlı hatayı seçer (404, gerçek nedeni gizlemesin). */
function betterError(current: GeminiError | null, next: GeminiError): GeminiError {
  if (!current) return next;
  if (current.modelMissing && !next.modelMissing) return next;
  return current;
}

/* ------------------------------------------------------------------ */
/* Temel istek                                                         */
/* ------------------------------------------------------------------ */

function requireKey(): string {
  const key = getApiKey();
  if (!key) {
    throw new GeminiError('API anahtarı yok', 401, 'NO_API_KEY', undefined, false, false,
      'Başlamak için Ayarlar → API ve Modeller bölümünden bir API anahtarı ekleyin (Google Gemini, OpenAI, Anthropic, NVIDIA veya Abacus).');
  }
  return key;
}

function buildBody(opts: GenerateOptions): Record<string, unknown> {
  const cfg = getConfig();
  const body: Record<string, unknown> = { contents: opts.contents };
  if (opts.systemInstruction) body.systemInstruction = { parts: [{ text: opts.systemInstruction }] };
  if (opts.tools?.length) {
    body.tools = [{ functionDeclarations: opts.tools }];
    body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
  }
  if (opts.googleSearch) {
    const tools = (body.tools as unknown[]) ?? [];
    body.tools = [...tools, { google_search: {} }];
  }
  const generationConfig: Record<string, unknown> = {};
  if (opts.temperature !== undefined) generationConfig.temperature = opts.temperature;
  if (opts.maxOutputTokens !== undefined) generationConfig.maxOutputTokens = opts.maxOutputTokens;
  if (opts.responseMimeType) generationConfig.responseMimeType = opts.responseMimeType;
  if (opts.responseSchema) generationConfig.responseSchema = opts.responseSchema;
  if (!opts.tools?.length && !opts.googleSearch && cfg.models.maxOutputTokens) {
    // güvenlik ağı
  }
  if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;
  return body;
}

async function rawRequest(
  method: 'generateContent' | 'streamGenerateContent',
  model: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
  timeoutMs = 120_000,
): Promise<Response> {
  const key = requireKey();
  const url =
    method === 'streamGenerateContent'
      ? `${API_BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`
      : `${API_BASE}/models/${encodeURIComponent(model)}:generateContent`;

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
    signal: combined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw describeError(res.status, text, model);
  }
  return res;
}

function extractGrounding(candidate: Record<string, unknown> | undefined): { title: string; uri: string }[] {
  const meta = candidate?.groundingMetadata as
    | { groundingChunks?: { web?: { uri?: string; title?: string } }[] }
    | undefined;
  const chunks = meta?.groundingChunks ?? [];
  const seen = new Set<string>();
  const out: { title: string; uri: string }[] = [];
  for (const c of chunks) {
    if (!c.web?.uri || seen.has(c.web.uri)) continue;
    seen.add(c.web.uri);
    out.push({ title: c.web.title ?? c.web.uri, uri: c.web.uri });
  }
  return out;
}

function parseUsage(data: Record<string, unknown> | undefined): Usage | undefined {
  const u = data?.usageMetadata as
    | { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
    | undefined;
  if (!u) return undefined;
  return {
    promptTokens: u.promptTokenCount ?? 0,
    candidatesTokens: u.candidatesTokenCount ?? 0,
    totalTokens: u.totalTokenCount ?? 0,
  };
}

interface CandidateParse {
  text: string;
  thought: string;
  functionCalls: { name: string; args: Record<string, unknown> }[];
  finishReason?: string;
  groundingSources: { title: string; uri: string }[];
}

export function parseCandidate(candidate: Record<string, unknown> | undefined): CandidateParse {
  const out: CandidateParse = { text: '', thought: '', functionCalls: [], groundingSources: [] };
  if (!candidate) return out;
  const content = candidate.content as { parts?: GeminiPart[] } | undefined;
  for (const part of content?.parts ?? []) {
    if (part.text) {
      if (part.thought) out.thought += part.text;
      else out.text += part.text;
    }
    if (part.functionCall?.name) {
      out.functionCalls.push({ name: part.functionCall.name, args: part.functionCall.args ?? {} });
    }
  }
  out.finishReason = (candidate.finishReason as string) ?? undefined;
  out.groundingSources = extractGrounding(candidate);
  return out;
}

/** Tek seferlik (akışsız) üretim */
export async function generate(opts: GenerateOptions): Promise<GenerateResult> {
  const cfg = getConfig();
  const chain = [...new Set([opts.model, ...(opts.fallbacks ?? modelChain(opts.purpose ?? 'brain', opts.model))])];
  let lastError: GeminiError | null = null;
  let bestError: GeminiError | null = null;

  for (const model of chain) {
    try {
      const res = await rawRequest(
        'generateContent',
        model,
        buildBody({
          ...opts,
          temperature: opts.temperature ?? cfg.models.temperature,
          maxOutputTokens: opts.maxOutputTokens ?? cfg.models.maxOutputTokens,
        }),
        opts.signal,
        opts.timeoutMs,
      );
      const data = (await res.json()) as {
        candidates?: Record<string, unknown>[];
        promptFeedback?: { blockReason?: string };
        usageMetadata?: Record<string, unknown>;
      };
      const candidate = data.candidates?.[0];
      const parsed = parseCandidate(candidate);
      if (data.promptFeedback?.blockReason) {
        throw new GeminiError(
          `İçerik filtresi: ${data.promptFeedback.blockReason}`,
          400,
          'SAFETY_BLOCKED',
          model,
          false,
          false,
          'Bu istek güvenlik filtresine takıldı. Farklı bir ifadeyle tekrar deneyin.',
        );
      }
      return {
        text: parsed.text,
        functionCalls: parsed.functionCalls,
        finishReason: parsed.finishReason,
        modelUsed: model,
        groundingSources: parsed.groundingSources,
        usage: parseUsage(data as Record<string, unknown>),
        raw: data,
      };
    } catch (err) {
      const ge = err instanceof GeminiError ? err : new GeminiError(String(err), 0, 'NETWORK', model);
      lastError = ge;
      bestError = betterError(bestError, ge);
      if (ge.modelMissing && cfg.models.autoFallback) {
        log.warn(`model bulunamadı, yedek deneniyor: ${model}`);
        continue;
      }
      if (ge.retryable) {
        log.warn(`model yanıt vermedi (${ge.code}), yedek deneniyor: ${model}`);
        await sleep(900);
        continue;
      }
      throw ge;
    }
  }
  throw bestError ?? lastError ?? new GeminiError('Model yanıt vermedi', 0, 'NO_MODEL');
}

/** Akışlı üretim — metin parçalarını olay olarak döndürür */
export async function* streamGenerate(opts: GenerateOptions): AsyncGenerator<StreamChunk> {
  const cfg = getConfig();
  const chain = [...new Set([opts.model, ...(opts.fallbacks ?? modelChain(opts.purpose ?? 'brain', opts.model))])];
  let lastError: GeminiError | null = null;
  let bestError: GeminiError | null = null;

  let emittedAny = false;
  for (const model of chain) {
    try {
      const res = await rawRequest(
        'streamGenerateContent',
        model,
        buildBody({
          ...opts,
          temperature: opts.temperature ?? cfg.models.temperature,
          maxOutputTokens: opts.maxOutputTokens ?? cfg.models.maxOutputTokens,
        }),
        opts.signal,
        opts.timeoutMs,
      );
      if (!res.body) throw new GeminiError('Yanıt gövdesi boş', 500, 'EMPTY_BODY', model);
      for await (const chunk of parseSse(res.body, model)) {
        if (chunk.textDelta) emittedAny = true;
        yield chunk;
      }
      return;
    } catch (err) {
      const ge = err instanceof GeminiError ? err : new GeminiError(String(err), 0, 'NETWORK', model);
      lastError = ge;
      bestError = betterError(bestError, ge);
      // Metin akmaya başladıysa yedek modele geçmek tekrar/çift yanıt üretir
      if (emittedAny) throw ge;
      if (ge.modelMissing) {
        log.warn(`model bulunamadı, yedek deneniyor: ${model}`);
      }
      if ((ge.modelMissing || ge.retryable) && cfg.models.autoFallback) {
        await sleep(ge.retryable ? 800 : 0);
        continue;
      }
      throw ge;
    }
  }
  throw bestError ?? lastError ?? new GeminiError('Model yanıt vermedi', 0, 'NO_MODEL');
}

async function* parseSse(body: ReadableStream<Uint8Array>, model: string): AsyncGenerator<StreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      for (const evt of events) {
        for (const line of evt.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          let parsed: { candidates?: Record<string, unknown>[]; usageMetadata?: Record<string, unknown> };
          try {
            parsed = JSON.parse(payload);
          } catch {
            continue;
          }
          const candidate = parsed.candidates?.[0];
          const c = parseCandidate(candidate);
          if (c.text) yield { textDelta: c.text, modelUsed: model };
          if (c.thought) yield { thoughtDelta: c.thought, modelUsed: model };
          for (const fc of c.functionCalls) yield { functionCall: fc, modelUsed: model };
          if (c.finishReason && c.finishReason !== 'FINISH_REASON_UNSPECIFIED') {
            yield {
              finishReason: c.finishReason,
              modelUsed: model,
              groundingSources: c.groundingSources,
              usage: parseUsage(parsed as Record<string, unknown>),
            };
          } else if (c.groundingSources.length) {
            yield { groundingSources: c.groundingSources, modelUsed: model };
          }
        }
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* yoksay */
    }
  }
}

/* ------------------------------------------------------------------ */
/* Ses: metinden sese (TTS)                                            */
/* ------------------------------------------------------------------ */

export interface TtsResult {
  /** RIFF/WAV base64 */
  audioBase64: string;
  mime: string;
  model: string;
}

const ttsCache = new Lru<string, TtsResult>(40);

function pcmToWav(pcm: Buffer, sampleRate = 24000, channels = 1): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Uzun metni cümle sınırlarından güvenli parçalara böler */
export function chunkForSpeech(text: string, maxChars = 700): string[] {
  const clean = text
    .replace(/```[\s\S]*?```/g, ' (kod bloğu ekranda) ')
    .replace(/[*_#`>]/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= maxChars) return clean ? [clean] : [];
  const sentences = clean.match(/[^.!?…]+[.!?…]+|\S[^.!?…]*$/g) ?? [clean];
  const chunks: string[] = [];
  let current = '';
  for (const s of sentences) {
    if ((current + s).length > maxChars && current) {
      chunks.push(current.trim());
      current = s;
    } else {
      current += s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.slice(0, 12);
}

function findAudioPayload(obj: unknown, depth = 0): { data: string; mime?: string } | null {
  if (!obj || typeof obj !== 'object' || depth > 8) return null;
  const rec = obj as Record<string, unknown>;
  if (typeof rec.data === 'string' && rec.data.length > 200) {
    const type = String(rec.type ?? rec.mime_type ?? rec.mimeType ?? '');
    if (/audio|wav|pcm|l16/i.test(type) || rec.data.startsWith('UklGR') || rec.data.startsWith('RIFF')) {
      return { data: rec.data, mime: type || undefined };
    }
  }
  for (const value of Object.values(rec)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findAudioPayload(item, depth + 1);
        if (found) return found;
      }
    } else if (value && typeof value === 'object') {
      const found = findAudioPayload(value, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Gemini TTS. Önce klasik generateContent (responseModalities: AUDIO) denenir;
 * başarısız olursa yeni Interactions API'sine düşer.
 */
export async function synthesizeSpeech(
  text: string,
  opts: { model: string; voice: string; style?: string; signal?: AbortSignal },
): Promise<TtsResult> {
  const key = requireKey();
  const input = text.trim();
  if (!input) throw new GeminiError('Seslendirilecek metin boş', 400, 'EMPTY_TEXT');
  const cacheKey = createHash('sha1').update(`${opts.model}|${opts.voice}|${opts.style ?? ''}|${input}`).digest('hex');
  const cached = ttsCache.get(cacheKey);
  if (cached) return cached;

  const chain = modelChain('tts', opts.model);
  let lastError: GeminiError | null = null;

  for (const model of chain) {
    // 1) Klasik generateContent yolu
    try {
      const res = await fetch(`${API_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        signal: opts.signal
          ? AbortSignal.any([opts.signal, AbortSignal.timeout(90_000)])
          : AbortSignal.timeout(90_000),
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: input }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: opts.voice || 'Kore' } },
            },
          },
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        const err = describeError(res.status, body, model);
        if (err.retryable || err.modelMissing) {
          lastError = err;
          continue;
        }
        lastError = err;
        break;
      }
      const data = (await res.json()) as Record<string, unknown>;
      const candidate = (data.candidates as Record<string, unknown>[] | undefined)?.[0];
      const parts = ((candidate?.content as { parts?: GeminiPart[] } | undefined)?.parts ?? []) as GeminiPart[];
      const inline = parts.find((p) => p.inlineData?.data)?.inlineData;
      if (inline?.data) {
        let buffer: Buffer = Buffer.from(inline.data, 'base64');
        const declared = inline.mimeType ?? '';
        const isWav = buffer.subarray(0, 4).toString('ascii') === 'RIFF';
        // Yalnızca ham PCM verisini WAV'a sar; mp3/ogg gibi hazır kapları bozmayalım.
        const looksPcm = !declared || /l16|pcm|raw/i.test(declared);
        let mime = 'audio/wav';
        if (!isWav && looksPcm) {
          buffer = pcmToWav(buffer, 24000, 1);
        } else if (!isWav) {
          mime = declared || 'audio/wav';
        }
        const result: TtsResult = {
          audioBase64: buffer.toString('base64'),
          mime,
          model,
        };
        ttsCache.set(cacheKey, result);
        return result;
      }
      lastError = new GeminiError('Ses verisi dönmedi', 500, 'NO_AUDIO', model, false, false,
        'Model ses üretemedi. Ayarlardan farklı bir ses modeli seçmeyi deneyin.');
    } catch (err) {
      const ge = err instanceof GeminiError ? err : new GeminiError(String(err), 0, 'NETWORK', model);
      lastError = ge;
      if (ge.retryable || ge.modelMissing) continue;
    }

    // 2) Interactions API yolu (yeni TTS biçimi)
    try {
      const res = await fetch(`${API_BASE}/interactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        signal: opts.signal
          ? AbortSignal.any([opts.signal, AbortSignal.timeout(90_000)])
          : AbortSignal.timeout(90_000),
        body: JSON.stringify({
          model,
          input: [
            {
              type: 'user_input',
              content: [
                {
                  type: 'text',
                  text: input,
                  annotations: opts.style ? [{ type: 'speech_metadata', style: opts.style }] : [],
                },
              ],
            },
          ],
          response_format: { type: 'audio', mime_type: 'audio/wav' },
          generation_config: { speech_config: [{ voice: opts.voice || 'Kore' }] },
        }),
      });
      if (!res.ok) {
        lastError = describeError(res.status, await res.text(), model);
        continue;
      }
      const data = (await res.json()) as Record<string, unknown>;
      const audio = findAudioPayload(data);
      if (!audio) {
        lastError = new GeminiError('Interactions yanıtında ses bulunamadı', 500, 'NO_AUDIO', model);
        continue;
      }
      let buffer: Buffer = Buffer.from(audio.data, 'base64');
      if (buffer.subarray(0, 4).toString('ascii') !== 'RIFF') buffer = pcmToWav(buffer, 24000, 1);
      const result: TtsResult = { audioBase64: buffer.toString('base64'), mime: 'audio/wav', model };
      ttsCache.set(cacheKey, result);
      return result;
    } catch (err) {
      lastError = err instanceof GeminiError ? err : new GeminiError(String(err), 0, 'NETWORK', model);
    }
  }

  throw lastError ?? new GeminiError('Ses sentezi başarısız', 500, 'TTS_FAILED');
}

/* ------------------------------------------------------------------ */
/* Ses: sesten metne (STT)                                             */
/* ------------------------------------------------------------------ */

export async function transcribe(
  audioBase64: string,
  mime: string,
  opts: { model: string; language?: string; signal?: AbortSignal; hint?: string },
): Promise<string> {
  const prompt = [
    'Aşağıdaki ses kaydını olduğu gibi yazıya dök.',
    'Kurallar:',
    '- Sadece konuşulan metni yaz, hiçbir açıklama, başlık veya tırnak ekleme.',
    '- Konuşma Türkçe ise Türkçe, başka bir dilde ise o dilde yaz.',
    '- Anlaşılmayan kısımlar için "…" kullan, uydurma.',
    opts.hint ? `- Bağlam: ${opts.hint}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const cleanup = (text: string) => text.trim().replace(/^["'“”]|["'“”]$/g, '');
  const request = (timeoutMs: number) =>
    generate({
      model: opts.model,
      purpose: 'stt',
      temperature: 0,
      maxOutputTokens: 2048,
      signal: opts.signal,
      timeoutMs,
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }, { inlineData: { mimeType: mime || 'audio/wav', data: audioBase64 } }],
        },
      ],
    });

  let lastError: unknown = null;
  // Uzun kayıtlarda yükleme yavaş olabilir: bir kez daha dene, sonra anlaşılır hata ver.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await request(attempt === 0 ? 120_000 : 90_000);
      return cleanup(res.text);
    } catch (err) {
      lastError = err;
      const detail = err instanceof Error ? err.message : String(err);
      const transient = /timeout|timed out|abort|network|fetch failed|ECONNRESET|ETIMEDOUT|socket/i.test(detail);
      if (!transient || attempt === 1) break;
      log.warn('ses yazıya dökülemedi, tekrar deneniyor', detail);
      await sleep(700);
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  const friendly = /timeout|timed out|abort|network|fetch failed|ECONNRESET|ETIMEDOUT|socket/i.test(detail)
    ? 'Ses yazıya dökülemedi: bağlantı zaman aşımına uğradı. İnternetini kontrol et, daha kısa konuş veya Ayarlar → Ses ve Konuşma bölümünde ses sağlayıcısını OpenAI (Whisper) yap.'
    : `Ses yazıya dökülemedi: ${detail}`;
  throw new GeminiError(friendly, 0, 'STT_FAILED', opts.model, false, false, friendly);
}

/* ------------------------------------------------------------------ */
/* Web araması (Google Search grounding)                               */
/* ------------------------------------------------------------------ */

export interface SearchAnswer {
  text: string;
  sources: { title: string; uri: string }[];
  model: string;
}

export async function searchWeb(query: string, opts?: { model?: string; signal?: AbortSignal }): Promise<SearchAnswer> {
  const cfg = getConfig();
  const model = opts?.model ?? cfg.models.search;
  const result = await generate({
    model,
    purpose: 'search',
    googleSearch: true,
    temperature: 0.4,
    maxOutputTokens: 4096,
    signal: opts?.signal,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `Bugünün tarihi: ${new Date().toLocaleDateString('tr-TR', { dateStyle: 'full' })}.\nAşağıdaki konuyu Google'da ara, en güncel bilgileri Türkçe özetle. Kaynak adlarını metin içinde belirtme; sonunda "Kaynaklar" başlığı açma. Kısa, net ve maddeli yaz.\n\nKonu: ${query}`,
          },
        ],
      },
    ],
  });
  return { text: result.text, sources: result.groundingSources, model: result.modelUsed };
}

/* ------------------------------------------------------------------ */
/* Bağlantı testi                                                      */
/* ------------------------------------------------------------------ */

export async function testConnection(): Promise<{
  ok: boolean;
  message: string;
  model?: string;
  latencyMs?: number;
  models?: ModelInfo[];
}> {
  const started = Date.now();
  try {
    const models = await listModels(true);
    const cfg = getConfig();
    const preferred =
      models.find((m) => m.name === cfg.models.brain) ??
      models.find((m) => /flash/.test(m.name)) ??
      models[0];
    if (!preferred) throw new Error('Kullanılabilir model bulunamadı');
    const res = await generate({
      model: preferred.name,
      purpose: 'fast',
      temperature: 0,
      maxOutputTokens: 64,
      contents: [{ role: 'user', parts: [{ text: 'Yalnızca "bağlantı tamam" yaz.' }] }],
    });
    return {
      ok: true,
      message: `Bağlantı başarılı. ${models.length} model bulundu, yanıt: "${res.text.slice(0, 60)}"`,
      model: res.modelUsed,
      latencyMs: Date.now() - started,
      models,
    };
  } catch (err) {
    const ge = err instanceof GeminiError ? err : null;
    return {
      ok: false,
      message: ge?.userMessage ?? (err instanceof Error ? err.message : String(err)),
      latencyMs: Date.now() - started,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

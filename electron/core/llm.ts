import {
  generate as geminiGenerate,
  streamGenerate as geminiStream,
  listModels as geminiListModels,
  type FunctionDeclaration,
  type GenerateOptions,
  type GenerateResult,
  type GeminiContent,
  type GeminiPart,
  type StreamChunk,
} from './gemini';
import { getConfig, providerKey } from './config';
import { providerSpec } from './provider-specs';
import { log } from './logger';
import type { ApiTestResult, ProviderId } from '../../shared/types';

export type { FunctionDeclaration, GeminiContent, GeminiPart, StreamChunk, GenerateResult };

/**
 * Sağlayıcıdan bağımsız sohbet katmanı.
 *
 * İç format Gemini'ninkidir (`contents` + `functionCall`); OpenAI uyumlu
 * sağlayıcılar (OpenAI, NVIDIA NIM, Abacus RouteLLM) ve Anthropic için
 * istek/yanıt dönüşümü burada yapılır. Böylece ajan döngüsü, araçlar ve
 * alt ajanlar sağlayıcıyı bilmeden çalışır.
 */

export interface ChatOptions extends Omit<GenerateOptions, 'model'> {
  model?: string;
  provider?: ProviderId;
  /** Google Arama (grounding) gerekiyorsa yalnızca Gemini kullanılır. */
  requireSearch?: boolean;
  /** Görsel girdi var; görsel destekleyen sağlayıcı seçilir. */
  requireVision?: boolean;
}

export type ChatResult = GenerateResult & { provider: ProviderId };
export type ChatChunk = StreamChunk & { provider?: ProviderId };

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status = 0,
    readonly code = 'NETWORK',
    readonly model?: string,
    readonly retryable = false,
    readonly modelMissing = false,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/* ------------------------------------------------------------------ */
/* Sağlayıcı seçimi                                                    */
/* ------------------------------------------------------------------ */

function candidates(opts: ChatOptions): ProviderId[] {
  if (opts.requireSearch) return providerKey('gemini') ? ['gemini'] : [];
  const cfg = getConfig();
  const primary = opts.provider ?? cfg.ai.primary;
  const list: ProviderId[] = [primary];
  if (cfg.ai.fallback) {
    const order: ProviderId[] = ['gemini', 'openai', 'anthropic', 'nvidia', 'abacus'];
    for (const id of order) if (id !== primary && !list.includes(id)) list.push(id);
  }
  return list.filter((id) => {
    if (!providerKey(id)) return false;
    if (opts.requireVision && !providerSpec(id).supportsVision) return false;
    return true;
  });
}

function modelChainFor(id: ProviderId, requested?: string): string[] {
  const spec = providerSpec(id);
  if (id === 'gemini') {
    // Gemini tarafında model zinciri kendi içinde yönetilir.
    return [requested || getConfig().models.brain];
  }
  const cfg = getConfig();
  const entry = cfg.ai.providers[id as Exclude<ProviderId, 'gemini'>];
  // Ajan `models.brain` (Gemini adı) gönderebilir; başka sağlayıcıya taşınmasın.
  const requestedClean = requested && !/^(models\/)?(gemini|gemma|imagen|veo)/i.test(requested.trim()) ? requested.trim() : '';
  const primary = entry?.model?.trim() || requestedClean || spec.defaultModel;
  return [...new Set([primary, ...spec.fallbackModels].filter(Boolean))];
}

function noProviderMessage(): string {
  return 'Hiçbir yapay zekâ sağlayıcısı yapılandırılmamış. Ayarlar → API ve Modeller bölümünden Google, OpenAI, Anthropic, NVIDIA veya Abacus anahtarlarından birini ekleyin.';
}

/* ------------------------------------------------------------------ */
/* Ortak yardımcılar                                                   */
/* ------------------------------------------------------------------ */

function timeoutSignal(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const t = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, t]) : t;
}

async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        for (const line of part.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            yield JSON.parse(data) as Record<string, unknown>;
          } catch {
            /* parça henüz tamamlanmadı */
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function errorFromResponse(status: number, body: string, model: string | undefined, provider: ProviderId): ProviderError {
  let message = body.slice(0, 500);
  let code = `HTTP_${status}`;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; code?: string; type?: string } };
    if (parsed.error?.message) message = parsed.error.message;
    code = parsed.error?.code ?? parsed.error?.type ?? code;
  } catch {
    /* düz metin */
  }
  const label = providerSpec(provider).label;
  if (status === 401 || status === 403) {
    return new ProviderError(
      `${label}: API anahtarı geçersiz veya yetkisiz (${message}). Ayarlar → API ve Modeller bölümünden anahtarı güncelleyin.`,
      status,
      'INVALID_KEY',
      model,
    );
  }
  if (status === 429) {
    return new ProviderError(`${label}: istek sınırı aşıldı (429). Biraz bekleyip tekrar deneyin.`, status, 'RATE_LIMIT', model, true);
  }
  if (status === 404 || /model.*(not found|does not exist|unsupported)/i.test(body)) {
    return new ProviderError(`${label}: model bulunamadı (${model ?? '—'}).`, status, 'MODEL_MISSING', model, false, true);
  }
  return new ProviderError(`${label}: ${status} — ${message}`, status, code, model, status >= 500);
}

/* ------------------------------------------------------------------ */
/* OpenAI uyumlu sağlayıcılar (OpenAI, NVIDIA NIM, Abacus)             */
/* ------------------------------------------------------------------ */

type OaiContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    >;

interface OaiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: OaiContent | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

function isVisionModel(id: ProviderId, model: string): boolean {
  if (id === 'nvidia') return /vl|vision|llama-3\.2-90b|nemotron.*vl/i.test(model);
  if (id === 'abacus') return true;
  return true;
}

function toOpenAiMessages(contents: GeminiContent[], system?: string): OaiMessage[] {
  const messages: OaiMessage[] = [];
  if (system) messages.push({ role: 'system', content: system });
  const pending: string[] = [];
  let callSeq = 0;

  for (const content of contents) {
    if (content.role === 'model') {
      const text = content.parts.map((p) => p.text ?? '').join('').trim();
      const calls = content.parts.filter((p) => p.functionCall);
      if (calls.length) {
        const toolCalls = calls.map((p) => {
          const id = `call_${++callSeq}`;
          pending.push(id);
          return {
            id,
            type: 'function' as const,
            function: { name: p.functionCall!.name, arguments: JSON.stringify(p.functionCall!.args ?? {}) },
          };
        });
        messages.push({ role: 'assistant', content: text || null, tool_calls: toolCalls });
      } else if (text) {
        messages.push({ role: 'assistant', content: text });
      }
      continue;
    }

    // user rolü: metin + görsel + araç sonuçları
    const toolParts = content.parts.filter((p) => p.functionResponse);
    if (toolParts.length) {
      for (const part of toolParts) {
        const id = pending.shift() ?? `call_${++callSeq}`;
        messages.push({
          role: 'tool',
          tool_call_id: id,
          content: JSON.stringify(part.functionResponse?.response ?? {}),
        });
      }
      const rest = content.parts.filter((p) => p.text).map((p) => p.text ?? '').join('').trim();
      if (rest) messages.push({ role: 'user', content: rest });
      continue;
    }

    const images = content.parts.filter((p) => p.inlineData?.mimeType?.startsWith('image/'));
    const text = content.parts
      .filter((p) => p.text || (p.inlineData && !p.inlineData.mimeType?.startsWith('image/')))
      .map((p) => p.text ?? '[ek dosya]')
      .join('\n')
      .trim();
    if (images.length) {
      const blocks: OaiContent = [
        ...(text ? [{ type: 'text' as const, text }] : []),
        ...images.map((p) => ({
          type: 'image_url' as const,
          image_url: { url: `data:${p.inlineData!.mimeType};base64,${p.inlineData!.data}` },
        })),
      ];
      messages.push({ role: 'user', content: blocks });
    } else if (text) {
      messages.push({ role: 'user', content: text });
    }
  }
  return messages;
}

function oaiTools(tools?: FunctionDeclaration[]): unknown[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters ?? { type: 'object', properties: {} } },
  }));
}

function oaiBody(opts: ChatOptions, model: string, stream: boolean, provider: ProviderId): Record<string, unknown> {
  const messages = toOpenAiMessages(opts.contents, opts.systemInstruction);
  const body: Record<string, unknown> = { model, messages, stream };
  const tools = oaiTools(opts.tools);
  if (tools) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  const reasoning = /^(gpt-5|gpt-6|o[1-9])/i.test(model);
  if (opts.temperature !== undefined && !(provider === 'openai' && reasoning)) body.temperature = opts.temperature;
  if (opts.maxOutputTokens) {
    if (provider === 'openai') body.max_completion_tokens = opts.maxOutputTokens;
    else body.max_tokens = opts.maxOutputTokens;
  }
  return body;
}

function baseUrlFor(id: ProviderId): string {
  const spec = providerSpec(id);
  const entry = id === 'gemini' ? null : getConfig().ai.providers[id as Exclude<ProviderId, 'gemini'>];
  return (entry?.baseUrl?.trim() || spec.baseUrl).replace(/\/+$/, '');
}

async function openAiRequest(
  provider: ProviderId,
  model: string,
  opts: ChatOptions,
  stream: boolean,
): Promise<Response> {
  const key = providerKey(provider);
  if (!key) throw new ProviderError('API anahtarı yok', 401, 'NO_KEY', model);
  const url = `${baseUrlFor(provider)}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      ...(provider === 'abacus' ? { 'x-api-key': key } : {}),
    },
    body: JSON.stringify(oaiBody({ ...opts, requireVision: opts.requireVision && isVisionModel(provider, model) }, model, stream, provider)),
    signal: timeoutSignal(opts.signal, opts.timeoutMs ?? 180_000),
  });
  if (!res.ok) throw errorFromResponse(res.status, await res.text(), model, provider);
  return res;
}

function parseOaiArgs(raw: string): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : { value: parsed };
  } catch {
    return { _raw: raw };
  }
}

async function openAiGenerate(provider: ProviderId, model: string, opts: ChatOptions): Promise<ChatResult> {
  const res = await openAiRequest(provider, model, opts, false);
  const data = (await res.json()) as {
    choices?: {
      message?: {
        content?: string | null;
        tool_calls?: { id: string; function: { name: string; arguments: string } }[];
      };
      finish_reason?: string;
    }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const choice = data.choices?.[0];
  const message = choice?.message;
  return {
    provider,
    text: (message?.content ?? '').trim(),
    functionCalls: (message?.tool_calls ?? []).map((c) => ({
      name: c.function.name,
      args: parseOaiArgs(c.function.arguments),
    })),
    finishReason: choice?.finish_reason ?? 'STOP',
    modelUsed: model,
    groundingSources: [],
    usage: data.usage
      ? {
          promptTokens: data.usage.prompt_tokens ?? 0,
          candidatesTokens: data.usage.completion_tokens ?? 0,
          totalTokens: data.usage.total_tokens ?? 0,
        }
      : undefined,
  };
}

async function* openAiStream(provider: ProviderId, model: string, opts: ChatOptions): AsyncGenerator<ChatChunk> {
  const res = await openAiRequest(provider, model, opts, true);
  if (!res.body) throw new ProviderError('Yanıt gövdesi boş', 500, 'EMPTY_BODY', model);
  const calls = new Map<number, { name: string; args: string }>();
  let finish = '';
  for await (const event of sseEvents(res.body)) {
    const choices = (event.choices as
      | {
          delta?: { content?: string | null; reasoning_content?: string; tool_calls?: { index: number; function?: { name?: string; arguments?: string } }[] };
          finish_reason?: string;
        }[]
      | undefined) ?? [];
    const choice = choices[0];
    if (!choice) continue;
    const delta = choice.delta;
    if (delta?.content) yield { textDelta: delta.content, provider };
    if (delta?.reasoning_content) yield { thoughtDelta: delta.reasoning_content, provider };
    for (const call of delta?.tool_calls ?? []) {
      const idx = call.index ?? 0;
      const current = calls.get(idx) ?? { name: '', args: '' };
      if (call.function?.name) current.name = call.function.name;
      if (call.function?.arguments) current.args += call.function.arguments;
      calls.set(idx, current);
    }
    if (choice.finish_reason) finish = choice.finish_reason;
  }
  for (const call of calls.values()) {
    if (!call.name) continue;
    yield { functionCall: { name: call.name, args: parseOaiArgs(call.args) }, provider };
  }
  yield { finishReason: finish || 'STOP', modelUsed: model, provider };
}

/* ------------------------------------------------------------------ */
/* Anthropic                                                           */
/* ------------------------------------------------------------------ */

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: Array<Record<string, unknown>>;
}

function toAnthropicMessages(contents: GeminiContent[]): AnthropicMessage[] {
  const messages: AnthropicMessage[] = [];
  const pending: string[] = [];
  let seq = 0;

  const push = (role: 'user' | 'assistant', blocks: Record<string, unknown>[]) => {
    if (!blocks.length) return;
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else messages.push({ role, content: blocks });
  };

  for (const content of contents) {
    if (content.role === 'model') {
      const blocks: Record<string, unknown>[] = [];
      const text = content.parts.map((p) => p.text ?? '').join('').trim();
      if (text) blocks.push({ type: 'text', text });
      for (const part of content.parts) {
        if (!part.functionCall) continue;
        const id = `toolu_${++seq}`;
        pending.push(id);
        blocks.push({ type: 'tool_use', id, name: part.functionCall.name, input: part.functionCall.args ?? {} });
      }
      push('assistant', blocks);
      continue;
    }
    const blocks: Record<string, unknown>[] = [];
    for (const part of content.parts) {
      if (part.functionResponse) {
        const id = pending.shift() ?? `toolu_${++seq}`;
        blocks.push({
          type: 'tool_result',
          tool_use_id: id,
          content: JSON.stringify(part.functionResponse.response ?? {}),
        });
        continue;
      }
      if (part.text) blocks.push({ type: 'text', text: part.text });
      if (part.inlineData?.mimeType?.startsWith('image/')) {
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: part.inlineData.mimeType, data: part.inlineData.data },
        });
      }
    }
    push('user', blocks);
  }
  return messages;
}

function anthropicBody(opts: ChatOptions, model: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: opts.maxOutputTokens ?? 8192,
    messages: toAnthropicMessages(opts.contents),
  };
  if (opts.systemInstruction) body.system = opts.systemInstruction;
  if (opts.temperature !== undefined) body.temperature = Math.min(1, Math.max(0, opts.temperature));
  if (opts.tools?.length) {
    body.tools = opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters ?? { type: 'object', properties: {} },
    }));
  }
  return body;
}

async function anthropicRequest(model: string, opts: ChatOptions, stream: boolean): Promise<Response> {
  const key = providerKey('anthropic');
  if (!key) throw new ProviderError('API anahtarı yok', 401, 'NO_KEY', model);
  const res = await fetch(`${baseUrlFor('anthropic')}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ ...anthropicBody(opts, model), stream }),
    signal: timeoutSignal(opts.signal, opts.timeoutMs ?? 180_000),
  });
  if (!res.ok) throw errorFromResponse(res.status, await res.text(), model, 'anthropic');
  return res;
}

async function anthropicGenerate(model: string, opts: ChatOptions): Promise<ChatResult> {
  const res = await anthropicRequest(model, opts, false);
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown> }>;
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const content = data.content ?? [];
  return {
    provider: 'anthropic',
    text: content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim(),
    functionCalls: content
      .filter((b) => b.type === 'tool_use' && b.name)
      .map((b) => ({ name: b.name as string, args: b.input ?? {} })),
    finishReason: data.stop_reason ?? 'STOP',
    modelUsed: model,
    groundingSources: [],
    usage: data.usage
      ? {
          promptTokens: data.usage.input_tokens ?? 0,
          candidatesTokens: data.usage.output_tokens ?? 0,
          totalTokens: (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0),
        }
      : undefined,
  };
}

async function* anthropicStream(model: string, opts: ChatOptions): AsyncGenerator<ChatChunk> {
  const res = await anthropicRequest(model, opts, true);
  if (!res.body) throw new ProviderError('Yanıt gövdesi boş', 500, 'EMPTY_BODY', model);
  const tools = new Map<number, { name: string; json: string }>();
  let stop = '';
  for await (const event of sseEvents(res.body)) {
    const type = String(event.type ?? '');
    if (type === 'content_block_start') {
      const index = Number(event.index ?? 0);
      const block = event.content_block as { type?: string; name?: string } | undefined;
      if (block?.type === 'tool_use') tools.set(index, { name: block.name ?? '', json: '' });
    } else if (type === 'content_block_delta') {
      const index = Number(event.index ?? 0);
      const delta = event.delta as { type?: string; text?: string; partial_json?: string } | undefined;
      if (delta?.type === 'text_delta' && delta.text) yield { textDelta: delta.text, provider: 'anthropic' };
      if (delta?.type === 'input_json_delta' && delta.partial_json) {
        const current = tools.get(index);
        if (current) current.json += delta.partial_json;
      }
    } else if (type === 'content_block_stop') {
      const index = Number(event.index ?? 0);
      const tool = tools.get(index);
      if (tool?.name) {
        yield { functionCall: { name: tool.name, args: parseOaiArgs(tool.json) }, provider: 'anthropic' };
        tools.delete(index);
      }
    } else if (type === 'message_delta') {
      const delta = event.delta as { stop_reason?: string } | undefined;
      if (delta?.stop_reason) stop = delta.stop_reason;
    } else if (type === 'error') {
      const err = event.error as { message?: string } | undefined;
      throw new ProviderError(err?.message ?? 'Anthropic akış hatası', 500, 'STREAM_ERROR', model);
    }
  }
  yield { finishReason: stop || 'STOP', modelUsed: model, provider: 'anthropic' };
}

/* ------------------------------------------------------------------ */
/* Yönlendirme                                                         */
/* ------------------------------------------------------------------ */

function isModelMissing(err: unknown): boolean {
  return err instanceof ProviderError && err.modelMissing;
}

function isRetryable(err: unknown): boolean {
  return err instanceof ProviderError && err.retryable;
}

export async function generateChat(opts: ChatOptions): Promise<ChatResult> {
  const list = candidates(opts);
  if (!list.length) throw new ProviderError(noProviderMessage(), 401, 'NO_PROVIDER');
  let lastError: unknown = null;

  for (const provider of list) {
    const chain = modelChainFor(provider, opts.model);
    for (const model of chain) {
      try {
        const result =
          provider === 'gemini'
            ? await geminiGenerate({ ...opts, model })
            : provider === 'anthropic'
              ? await anthropicGenerate(model, opts)
              : await openAiGenerate(provider, model, opts);
        return { ...result, provider };
      } catch (err) {
        lastError = err;
        log.warn(`sağlayıcı hatası (${provider}/${model})`, err instanceof Error ? err.message : err);
        const normalized = err instanceof Error ? err : new Error(String(err));
        const missing = isModelMissing(err);
        const retryable = isRetryable(err) || /model bulunamadı/i.test(normalized.message);
        if (missing) continue;
        if (retryable && provider === 'gemini') continue;
        // 401/403 veya ağ: sonraki sağlayıcıya geç
        break;
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new ProviderError('Hiçbir sağlayıcı yanıt vermedi. Anahtar ve internet bağlantısını kontrol edin.');
}

export async function* streamChat(opts: ChatOptions): AsyncGenerator<ChatChunk> {
  const list = candidates(opts);
  if (!list.length) throw new ProviderError(noProviderMessage(), 401, 'NO_PROVIDER');
  let lastError: unknown = null;

  for (const provider of list) {
    let emitted = false;
    const chain = modelChainFor(provider, opts.model);
    for (const model of chain) {
      try {
        const iterator =
          provider === 'gemini'
            ? geminiStream({ ...opts, model })
            : provider === 'anthropic'
              ? anthropicStream(model, opts)
              : openAiStream(provider, model, opts);
        for await (const chunk of iterator) {
          if (chunk.textDelta) emitted = true;
          yield { ...chunk, provider };
        }
        return;
      } catch (err) {
        lastError = err;
        log.warn(`akış hatası (${provider}/${model})`, err instanceof Error ? err.message : err);
        if (emitted) throw err;
        if (isModelMissing(err)) continue;
        break;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new ProviderError('Hiçbir sağlayıcı yanıt vermedi.');
}

/* ------------------------------------------------------------------ */
/* Model listesi ve bağlantı testi                                     */
/* ------------------------------------------------------------------ */

export async function listProviderModels(provider: ProviderId): Promise<string[]> {
  if (provider === 'gemini') {
    const models = await geminiListModels(true);
    return models.map((m) => m.name.replace(/^models\//, ''));
  }
  const key = providerKey(provider);
  if (!key) throw new ProviderError('Bu sağlayıcı için API anahtarı yok.', 401, 'NO_KEY');
  const base = baseUrlFor(provider);
  const headers: Record<string, string> =
    provider === 'anthropic'
      ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
      : { Authorization: `Bearer ${key}` };
  const res = await fetch(`${base}/models`, { headers, signal: timeoutSignal(undefined, 25_000) });
  if (!res.ok) throw errorFromResponse(res.status, await res.text(), undefined, provider);
  const data = (await res.json()) as { data?: { id?: string }[]; models?: { name?: string }[] };
  const ids = (data.data ?? []).map((m) => m.id ?? '').filter(Boolean);
  const alt = (data.models ?? []).map((m) => m.name ?? '').filter(Boolean);
  return [...new Set([...ids, ...alt])].sort();
}

export async function testProvider(provider: ProviderId): Promise<ApiTestResult> {
  const started = Date.now();
  try {
    const result = await generateChat({
      provider,
      contents: [{ role: 'user', parts: [{ text: 'Yalnızca "tamam" yaz.' }] }],
      maxOutputTokens: 32,
      temperature: 0,
      timeoutMs: 25_000,
    });
    return {
      ok: true,
      message: `${providerSpec(provider).label} bağlantısı çalışıyor (${result.modelUsed}).`,
      model: result.modelUsed,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - started,
    };
  }
}

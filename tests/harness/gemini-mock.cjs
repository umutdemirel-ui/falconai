/**
 * Gemini + OpenAI + Anthropic + NVIDIA + Abacus API taklidi — yerel HTTP sunucusu.
 * Ana süreçteki global fetch, sağlayıcı adresleri yerine buraya yönlendirilir:
 *   https://api.openai.com/v1/…          → /openai/v1/…
 *   https://api.anthropic.com/v1/…       → /anthropic/v1/…
 *   https://integrate.api.nvidia.com/v1/…→ /nvidia/v1/…
 *   https://routellm.abacus.ai/v1/…      → /abacus/v1/…
 *   https://generativelanguage.googleapis.com/… (öneksiz)
 */
const http = require('node:http');

const requests = [];

function pcmWavBase64() {
  // 0.2 sn 24kHz 16-bit sessiz PCM
  const samples = 4800;
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    pcm.writeInt16LE(Math.round(Math.sin((i / 24000) * 2 * Math.PI * 440) * 6000), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24);
  header.writeUInt32LE(48000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]).toString('base64');
}

const MODELS = [
  'gemini-3.8-flash',
  'gemini-3.8-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash-tts',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-embedding-001',
  'imagen-4.0-generate-001',
];

function sse(events) {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
}

function candidate(parts, extra = {}) {
  return { candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP', ...extra }] };
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    let json = {};
    try {
      json = body ? JSON.parse(body) : {};
    } catch {
      json = { raw: body };
    }
    let vendor = 'gemini';
    let route = req.url;
    const prefixed = req.url.match(/^\/(openai|anthropic|nvidia|abacus)(\/.*)$/);
    if (prefixed) {
      vendor = prefixed[1];
      route = prefixed[2].replace(/^\/v1/, '');
    }
    requests.push({ method: req.method, url: req.url, route, vendor, body: json, headers: req.headers, at: Date.now() });

    if (vendor !== 'gemini') {
      handleOther(vendor, route, req, res, json);
      return;
    }

    if (req.method === 'GET' && req.url.startsWith('/v1beta/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          models: MODELS.map((name) => ({
            name: `models/${name}`,
            displayName: name,
            description: 'test',
            inputTokenLimit: 1000000,
            outputTokenLimit: 65536,
            supportedGenerationMethods: ['generateContent'],
          })),
        }),
      );
      return;
    }

    if (req.url.includes(':streamGenerateContent')) {
      const contents = json.contents || [];
      const flattened = JSON.stringify(contents);
      const hasFunctionResponse = flattened.includes('functionResponse');
      res.writeHead(200, { 'content-type': 'text/event-stream' });

      // Test kancası: "#TOOLCALL:<base64 json>#" → istenen aracı çağır
      const hook = flattened.match(/#TOOLCALL:([A-Za-z0-9+/=]+)#/);
      if (!hasFunctionResponse && hook) {
        const spec = JSON.parse(Buffer.from(hook[1], 'base64').toString('utf8'));
        res.write(sse([candidate([{ functionCall: { name: spec.name, args: spec.args } }], { finishReason: 'STOP' })]));
        res.end();
        return;
      }

      const wantsTool = !hasFunctionResponse && !flattened.includes('YALNIZCA');
      if (wantsTool) {
        // 1. adım: araç çağrısı
        res.write(sse([candidate([{ functionCall: { name: 'system_info', args: {} } }], { finishReason: 'STOP' })]));
        res.end();
        return;
      }
      // 2. adım: metin akışı
      const text = 'Sistemin hazır. Bellek kullanımı normal görünüyor.';
      const parts = text.split(' ');
      for (const word of parts) {
        res.write(sse([{ candidates: [{ content: { role: 'model', parts: [{ text: word + ' ' }] } }] }]));
      }
      res.write(
        sse([
          {
            candidates: [
              {
                content: { role: 'model', parts: [{ text: '' }] },
                finishReason: 'STOP',
                groundingMetadata: {
                  groundingChunks: [{ web: { uri: 'https://example.com/haber', title: 'Örnek Kaynak' } }],
                },
              },
            ],
            usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, totalTokenCount: 150 },
          },
        ]),
      );
      res.end();
      return;
    }

    if (req.url.includes(':generateContent')) {
      const model = decodeURIComponent(req.url.split('/models/')[1].split(':')[0]);
      const cfg = json.generationConfig || {};

      // TTS isteği
      if (Array.isArray(cfg.responseModalities) && cfg.responseModalities.includes('AUDIO')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            candidates: [
              {
                content: {
                  role: 'model',
                  parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcmWavBase64().slice(0, 8000) } }],
                },
                finishReason: 'STOP',
              },
            ],
          }),
        );
        return;
      }

      const contents = JSON.stringify(json.contents || []);

      // STT: ses içeren istek
      if (contents.includes('inlineData') && contents.includes('audio')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(candidate([{ text: 'Chrome tarayıcısını aç ve gündemi özetle' }])));
        return;
      }

      // Gündem (JSON şemalı)
      if (cfg.responseMimeType === 'application/json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify(
            candidate(
              [
                {
                  text: JSON.stringify({
                    headline: 'Yapay zekâ yatırımları hızlandı',
                    items: [
                      { title: 'Yeni model duyuruldu', summary: 'Sektör liderleri yeni ajan modellerini tanıttı.', category: 'Teknoloji' },
                      { title: 'Faiz kararı açıklandı', summary: 'Merkez Bankası beklentiye uygun karar verdi.', category: 'Ekonomi' },
                    ],
                  }),
                },
              ],
              {
                groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.com/a', title: 'Kaynak A' } }] },
              },
            ),
          ),
        );
        return;
      }

      // Web araması / genel
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify(
          candidate([{ text: 'Bağlantı tamam. Örnek yanıt metni.' }], {
            groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.com/k', title: 'Kaynak K' } }] },
          }),
        ),
      );
      return;
    }

    // Interactions API (TTS yedeği)
    if (req.url === '/v1beta/interactions') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ steps: [{ type: 'model_output', content: [{ type: 'audio', mime_type: 'audio/wav', data: pcmWavBase64() }] }] }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 404, message: 'not found: ' + req.url, status: 'NOT_FOUND' } }));
  });
});


/* ------------------------------------------------------------------ */
/* OpenAI / NVIDIA / Abacus / Anthropic taklidi                        */
/* ------------------------------------------------------------------ */

function wavBytes() {
  return Buffer.from(pcmWavBase64(), 'base64');
}

function oaiText(text) {
  return { id: 'chatcmpl-test', object: 'chat.completion', model: 'test', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 90, completion_tokens: 20, total_tokens: 110 } };
}

function oaiToolCall(name, args, id = 'call_1') {
  return {
    id: 'chatcmpl-tool',
    object: 'chat.completion',
    model: 'test',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 90, completion_tokens: 12, total_tokens: 102 },
  };
}

function oaiSse(res, chunks, closeWith) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  if (closeWith) res.write(`data: ${JSON.stringify(closeWith)}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

function oaiStreamText(res, text) {
  const chunks = text.split(' ').map((word, index, all) => ({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { content: all[index + 1] === undefined ? word : `${word} ` }, finish_reason: null }],
  }));
  oaiSse(res, chunks, { id: 'chatcmpl-test', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
}

function oaiStreamTool(res, name, args, id = 'call_1') {
  oaiSse(
    res,
    [
      {
        id: 'chatcmpl-tool',
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: null }],
      },
    ],
    { id: 'chatcmpl-tool', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
  );
}

function anthropicSse(res, blocks) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
  send('message_start', { message: { id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-test', content: [], stop_reason: null, usage: { input_tokens: 80, output_tokens: 1 } } });
  blocks.forEach((block, index) => {
    if (block.type === 'text') {
      send('content_block_start', { index, content_block: { type: 'text', text: '' } });
      for (const word of block.text.split(' ')) send('content_block_delta', { index, delta: { type: 'text_delta', text: `${word} ` } });
      send('content_block_stop', { index });
    } else {
      send('content_block_start', { index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } });
      send('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
      send('content_block_stop', { index });
    }
  });
  send('message_delta', { delta: { stop_reason: blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 24 } });
  send('message_stop', {});
  res.end();
}

function anthropicJson(res, blocks, stop) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-test',
      content: blocks,
      stop_reason: stop,
      usage: { input_tokens: 80, output_tokens: 24 },
    }),
  );
}

/** Ortak: araç çağrısı mı, metin mi? */
function decide(json, flattened) {
  const hasToolResult = flattened.includes('"role":"tool"') || flattened.includes('tool_result');
  const hook = flattened.match(/#TOOLCALL:([A-Za-z0-9+/=]+)#/);
  if (!hasToolResult && hook) {
    const spec = JSON.parse(Buffer.from(hook[1], 'base64').toString('utf8'));
    return { kind: 'tool', name: spec.name, args: spec.args ?? {} };
  }
  // Yalnızca bağlantı testi istemi ("Yalnızca \"tamam\" yaz.") düz metin döner.
  const plain = /tamam["”']?\s*yaz/i.test(flattened) && !hasToolResult;
  if (plain) return { kind: 'text', text: 'tamam' };
  if (!hasToolResult) return { kind: 'tool', name: 'system_info', args: {} };
  return { kind: 'text', text: 'Sistemin hazır. Bellek kullanımı normal görünüyor.' };
}

function handleOther(vendor, route, req, res, json) {
  const isAnthropic = vendor === 'anthropic';
  const flat = JSON.stringify(isAnthropic ? json : json.messages ?? json);

  if (req.method === 'GET' && route === '/models') {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (isAnthropic) {
      res.end(
        JSON.stringify({
          data: [
            { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', created_at: '2026-09-01T00:00:00Z' },
            { id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5', created_at: '2026-06-01T00:00:00Z' },
            { id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5', created_at: '2026-09-01T00:00:00Z' },
          ],
          has_more: false,
        }),
      );
      return;
    }
    const ids =
      vendor === 'nvidia'
        ? ['meta/llama-3.3-70b-instruct', 'nvidia/nemotron-3-ultra-550b-a55b', 'openai/gpt-oss-120b']
        : vendor === 'abacus'
          ? ['route-llm', 'gpt-5.5', 'claude-sonnet-4-5-20250929']
          : ['gpt-5.6', 'gpt-5.5', 'gpt-5.4-mini'];
    res.end(JSON.stringify({ object: 'list', data: ids.map((id) => ({ id, object: 'model', owned_by: vendor })) }));
    return;
  }

  if (req.method === 'POST' && route === '/audio/speech') {
    const audio = wavBytes();
    res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': audio.length });
    res.end(audio);
    return;
  }

  if (req.method === 'POST' && route === '/audio/transcriptions') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ text: 'Chrome tarayıcısını aç ve gündemi özetle', language: 'tr' }));
    return;
  }

  if (req.method === 'POST' && route === '/messages') {
    if (!req.headers['x-api-key'] || !req.headers['anthropic-version']) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'x-api-key / anthropic-version eksik' } }));
      return;
    }
    const decision = decide(json, flat);
    if (process.env.MOCK_DEBUG) console.log('[mock] anthropic →', decision.kind, flat.includes('tamam'), flat.slice(0, 200));
    const blocks =
      decision.kind === 'tool'
        ? [{ type: 'tool_use', id: 'toolu_1', name: decision.name, input: decision.args }]
        : [{ type: 'text', text: decision.text }];
    if (json.stream) anthropicSse(res, blocks);
    else anthropicJson(res, blocks, decision.kind === 'tool' ? 'tool_use' : 'end_turn');
    return;
  }

  if (req.method === 'POST' && route === '/chat/completions') {
    if (!req.headers.authorization?.startsWith('Bearer ')) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Authorization: Bearer eksik', type: 'invalid_request_error', code: 'invalid_api_key' } }));
      return;
    }
    const decision = decide(json, flat);
    if (json.stream) {
      if (decision.kind === 'tool') oaiStreamTool(res, decision.name, decision.args);
      else oaiStreamText(res, decision.text);
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(decision.kind === 'tool' ? oaiToolCall(decision.name, decision.args) : oaiText(decision.text)));
    }
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { message: `not found: ${route}` } }));
}

module.exports = { server, requests, getPort: () => server.address().port };

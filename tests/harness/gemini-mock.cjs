/**
 * Gemini API taklidi — yerel HTTP sunucusu.
 * Ana süreçteki global fetch, generativelanguage.googleapis.com yerine buraya yönlendirilir.
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
    requests.push({ method: req.method, url: req.url, body: json, at: Date.now() });

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

module.exports = { server, requests, getPort: () => server.address().port };

import { getConfig } from '../core/config';
import { log } from '../core/logger';
import { uid } from '../core/store';
import { listDigests, saveDigest } from '../core/db';
import type { AgendaDigest, AgendaItem } from '../../shared/types';
import { generate } from '../core/gemini';

/**
 * Gündem takibi.
 * Google Arama destekli Gemini ile belirlenen konularda güncel haberleri
 * toplar, Türkçe özetler ve istenirse sesli olarak okur.
 */

const DIGEST_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'Günün en önemli gelişmesini anlatan tek cümlelik manşet' },
    items: {
      type: 'array',
      description: 'En fazla 7 gündem maddesi',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Kısa başlık' },
          summary: { type: 'string', description: '1-2 cümlelik açıklama' },
          category: { type: 'string', description: 'Kategori: Türkiye, Dünya, Teknoloji, Ekonomi, Spor, Bilim...' },
        },
        required: ['title', 'summary', 'category'],
      },
    },
  },
  required: ['headline', 'items'],
};

export async function buildDigest(opts: { topics?: string[]; hours?: number } = {}): Promise<AgendaDigest> {
  const cfg = getConfig();
  const topics = (opts.topics?.length ? opts.topics : cfg.agenda.topics).filter(Boolean);
  const hours = opts.hours ?? 24;
  const today = new Date().toLocaleDateString('tr-TR', { dateStyle: 'full' });

  const prompt = `Bugün ${today}. Kullanıcı Türkiye'de yaşıyor.
Şu konularda son ${hours} saat içindeki en önemli gelişmeleri Google Arama ile bul:
${topics.map((t) => `- ${t}`).join('\n')}

Kurallar:
- Sadece gerçekten güncel ve doğrulanabilir gelişmeleri seç.
- Türkçe, kısa ve tarafsız yaz.
- Her maddede somut bilgi ver (kim, ne, nerede); yorum katma.
- En önemli gelişmeyi manşet olarak yaz.
- En fazla 7 madde.`;

  const result = await generate({
    model: cfg.models.search,
    purpose: 'search',
    googleSearch: true,
    temperature: 0.3,
    maxOutputTokens: 4096,
    responseMimeType: 'application/json',
    responseSchema: DIGEST_SCHEMA,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  });

  let parsed: { headline?: string; items?: AgendaItem[] } = {};
  try {
    parsed = JSON.parse(result.text) as { headline?: string; items?: AgendaItem[] };
  } catch {
    parsed = { headline: result.text.slice(0, 200), items: [] };
  }

  const items = (parsed.items ?? []).slice(0, 7).map((item, i) => ({
    title: item.title ?? `Gelişme ${i + 1}`,
    summary: item.summary ?? '',
    category: item.category ?? 'Gündem',
    source: result.groundingSources[i] ?? result.groundingSources[0],
  }));

  const digest: AgendaDigest = {
    id: uid('ag'),
    createdAt: Date.now(),
    topics,
    headline: parsed.headline ?? 'Gündem özeti',
    items,
    spoken: false,
  };
  saveDigest(digest);
  log.info(`gündem özeti oluşturuldu: ${items.length} madde`);
  return digest;
}

export function latestDigest(): AgendaDigest | null {
  const all = listDigests();
  return all[0] ?? null;
}

/** Sesli okumak için gündem metni */
export function digestToSpeech(digest: AgendaDigest): string {
  const parts: string[] = [];
  const hour = new Date().getHours();
  const greeting = hour < 11 ? 'Günaydın' : hour < 18 ? 'İyi günler' : 'İyi akşamlar';
  parts.push(`${greeting}. Gündem özetin hazır.`);
  if (digest.headline) parts.push(`Öne çıkan başlık: ${digest.headline}.`);
  const top = digest.items.slice(0, 5);
  top.forEach((item, i) => {
    parts.push(`${i + 1}. ${item.title}. ${item.summary}`);
  });
  if (digest.items.length > top.length) {
    parts.push(`Toplam ${digest.items.length} gelişme var; ayrıntıları ekranda görebilirsin.`);
  }
  return parts.join(' ');
}

export function digestToText(digest: AgendaDigest): string {
  const date = new Date(digest.createdAt).toLocaleString('tr-TR', { dateStyle: 'long', timeStyle: 'short' });
  const lines = [
    `# Gündem — ${date}`,
    '',
    `**${digest.headline}**`,
    '',
    ...digest.items.map((item, i) => `${i + 1}. **${item.title}** _(${item.category})_\n   ${item.summary}`),
  ];
  return lines.join('\n');
}

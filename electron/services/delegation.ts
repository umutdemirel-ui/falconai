import { getConfig } from '../core/config';
import { log } from '../core/logger';
import { saveDelegation } from '../core/db';
import { streamGenerate, type FunctionDeclaration } from '../core/gemini';
import type { AgentName, DelegationRecord, ToolResult } from '../../shared/types';

/**
 * Alt ajanlar (çoklu ajan iş birliği).
 * Her ajanın kendi uzmanlık istemi ve kendi araç seti vardır. Falcon ana ajanı
 * gerektiğinde işi devreder, sonucu alır ve kullanıcıya tek bir yanıtta birleştirir.
 */

export interface DelegateDeps {
  executeTool: (name: string, args: Record<string, unknown>, ctx: { agent: AgentName; conversationId?: string; signal?: AbortSignal }) => Promise<ToolResult>;
  toolDefinitions: () => FunctionDeclaration[];
}

export interface SubAgentSpec {
  name: AgentName;
  emoji: string;
  tagline: string;
  systemPrompt: string;
  tools: string[];
  maxSteps: number;
}

const SHARED_RULES = `
Kurallar:
- Türkçe yanıt ver; kısa, net ve uygulanabilir ol.
- Sadece sana verilen araçları kullan. Gereksiz araç çağrısı yapma.
- Bir araç hata verirse hatayı kullanıcıya olduğu gibi dökme; çözüm üret veya durumu tek cümleyle açıkla.
- İşin bittiğinde sonucu doğrudan ve eksiksiz yaz. "Yapacağım" deme, yap.
- Şifre, API anahtarı gibi gizli bilgileri metne yazma.
- Uydurma bilgi verme; emin değilsen arama yap veya bunu belirt.
`;

export const SUB_AGENTS: Record<string, SubAgentSpec> = {
  Araştırmacı: {
    name: 'Araştırmacı',
    emoji: '🔎',
    tagline: 'Web araması, kaynaklı bilgi, gündem',
    tools: ['web_search', 'news_digest', 'read_file', 'list_directory', 'search_files', 'system_info', 'open_url'],
    maxSteps: 6,
    systemPrompt: `Sen Falcon'un araştırma uzmanısın. Google Arama destekli araçlarla güncel ve doğrulanabilir bilgi toplarsın.
- Birden fazla kaynağı karşılaştır, çelişki varsa belirt.
- Yanıtını maddeler hâlinde ver, en sonda kaynakları kısa listele.
- Türkiye bağlamını gözet; fiyat/tarih gibi bilgilerde güncelliği kontrol et.${SHARED_RULES}`,
  },
  Kodcu: {
    name: 'Kodcu',
    emoji: '⌨️',
    tagline: 'Kod yazma, hata ayıklama, dosya düzenleme',
    tools: ['read_file', 'write_file', 'append_file', 'list_directory', 'search_files', 'run_command', 'open_path', 'copy_path', 'make_directory'],
    maxSteps: 10,
    systemPrompt: `Sen Falcon'un yazılım uzmanısın. Kod yazar, hata ayıklar ve dosyaları düzenlersin.
- Önce mevcut dosyayı oku, sonra değiştir. Tahminle yazma.
- Tam ve çalışır kod ver; "..." gibi eksik bırakma.
- Değişiklikleri write_file ile kaydet. Komutu çalıştırarak doğrula.
- Yanıtında yaptığın değişikliklerin dosya yollarını belirt.${SHARED_RULES}`,
  },
  Analist: {
    name: 'Analist',
    emoji: '📊',
    tagline: 'Belge, tablo ve veri analizi',
    tools: ['read_file', 'analyze_document', 'list_directory', 'search_files', 'write_file', 'translate_file', 'capture_screen'],
    maxSteps: 8,
    systemPrompt: `Sen Falcon'un analiz uzmanısın. Belgeleri, tabloları ve verileri inceler, içgörü çıkarırsın.
- Belgeyi önce oku; taranmış/PDF ise analyze_document kullan.
- Sayısal verilerde hesaplama yaparken adımları göster.
- Özet + ana bulgular + öneri yapısında yaz.
- Uzun analizleri istenirse dosyaya kaydet.${SHARED_RULES}`,
  },
  Planlayıcı: {
    name: 'Planlayıcı',
    emoji: '🗺️',
    tagline: 'Plan, takvim, görev ve hatırlatıcı',
    tools: ['add_task', 'list_tasks', 'complete_task', 'add_reminder', 'list_reminders', 'create_project', 'list_projects', 'remember', 'recall', 'web_search', 'system_info'],
    maxSteps: 8,
    systemPrompt: `Sen Falcon'un planlama uzmanısın. Kullanıcının işlerini planlar, göreve ve hatırlatıcıya dönüştürürsün.
- Belirsiz tarihleri (yarın, cuma, akşam) bugünün tarihine göre somut ISO tarihe çevir; bugünün tarihini system_info ile öğren.
- Planı numaralı adımlar ve gerçekçi sürelerle ver.
- Somut görevleri listeye ekle, hatırlatıcı gerekiyorsa kur.${SHARED_RULES}`,
  },
};

function pickTools(spec: SubAgentSpec, all: FunctionDeclaration[]): FunctionDeclaration[] {
  const names = new Set(spec.tools);
  return all.filter((t) => names.has(t.name));
}

function agentName(input: string): AgentName {
  const key = Object.keys(SUB_AGENTS).find((k) => k.toLocaleLowerCase('tr-TR') === input.toLocaleLowerCase('tr-TR'));
  if (key) return SUB_AGENTS[key].name;
  const partial = Object.keys(SUB_AGENTS).find((k) => k.toLocaleLowerCase('tr-TR').includes(input.toLocaleLowerCase('tr-TR')));
  return (partial ? SUB_AGENTS[partial].name : 'Araştırmacı') as AgentName;
}

export async function delegate(
  agentInput: string,
  task: string,
  context: string,
  opts: { signal?: AbortSignal; conversationId?: string; deps: DelegateDeps },
): Promise<DelegationRecord> {
  const spec = SUB_AGENTS[agentName(agentInput)] ?? SUB_AGENTS.Araştırmacı;
  const cfg = getConfig();
  const started = Date.now();
  const tools = pickTools(spec, opts.deps.toolDefinitions());

  const contents: { role: 'user' | 'model'; parts: Record<string, unknown>[] }[] = [
    {
      role: 'user',
      parts: [
        {
          text: `${task}${context ? `\n\nEk bağlam:\n${context}` : ''}\n\nBugün: ${new Date().toLocaleString('tr-TR')}`,
        },
      ],
    },
  ];

  let finalText = '';
  let ok = true;

  try {
    for (let i = 0; i < spec.maxSteps; i++) {
      let text = '';
      const calls: { name: string; args: Record<string, unknown> }[] = [];
      let finish = '';

      for await (const chunk of streamGenerate({
        model: cfg.models.brain,
        purpose: 'brain',
        systemInstruction: spec.systemPrompt,
        tools,
        temperature: 0.5,
        maxOutputTokens: cfg.models.maxOutputTokens,
        contents,
        signal: opts.signal,
      })) {
        if (chunk.textDelta) text += chunk.textDelta;
        if (chunk.functionCall) calls.push(chunk.functionCall);
        if (chunk.finishReason) finish = chunk.finishReason;
      }

      finalText = text || finalText;

      if (!calls.length) break;

      contents.push({
        role: 'model',
        parts: [
          ...(text ? [{ text }] : []),
          ...calls.map((c) => ({ functionCall: { name: c.name, args: c.args } })),
        ],
      });

      const responseParts: Record<string, unknown>[] = [];
      for (const call of calls) {
        const result = await opts.deps.executeTool(call.name, call.args, {
          agent: spec.name,
          conversationId: opts.conversationId,
          signal: opts.signal,
        });
        responseParts.push({
          functionResponse: {
            name: call.name,
            response: result.ok
              ? { result: result.content ?? result.summary, summary: result.summary }
              : { error: result.summary },
          },
        });
      }
      contents.push({ role: 'user', parts: responseParts });

      if (finish === 'STOP' && !calls.length) break;
      if (i === spec.maxSteps - 1) {
        finalText += '\n\n(Adım sınırına ulaşıldı; sonuçlar yukarıda.)';
      }
    }
  } catch (err) {
    ok = false;
    finalText = `Alt ajan çalışırken hata oluştu: ${err instanceof Error ? err.message : String(err)}`;
    log.error(`delegasyon hatası (${spec.name})`, err);
  }

  const record: DelegationRecord = {
    id: `dlg-${Date.now().toString(36)}`,
    agent: spec.name,
    task,
    result: finalText.slice(0, 4000),
    ok,
    createdAt: started,
    durationMs: Date.now() - started,
    conversationId: opts.conversationId,
  };
  saveDelegation(record);
  return record;
}

export function listAgentSpecs(): { name: AgentName; emoji: string; tagline: string; tools: string[] }[] {
  return Object.values(SUB_AGENTS).map((s) => ({ name: s.name, emoji: s.emoji, tagline: s.tagline, tools: s.tools }));
}

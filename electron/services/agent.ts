import { getConfig } from '../core/config';
import { log } from '../core/logger';
import { uid } from '../core/store';
import { broadcast, emitState, emitToast } from '../core/bus';
import { type GeminiContent, type GeminiPart } from '../core/gemini';
import { generateChat, streamChat } from '../core/llm';
import {
  appendMessage,
  addFileRecord,
  getMessages,
  listConversations,
  listMemories,
  listProjects,
  listTasks,
  newConversation,
  renameConversation,
} from '../core/db';
import { executeTool, toolDefinitions, toolLabel, toolRisk } from './tools';
import { getSystemInfo } from './system';
import { extractPdfText, extractText, mimeFor, resolvePath } from './documents';
import { listAgentSpecs } from './delegation';
import { buildDigest, digestToSpeech } from './agenda';
import { anyProviderAvailable } from '../core/config';
import type {
  AgentName,
  AgentState,
  Attachment,
  ChatMessage,
  ChatRequest,
  Conversation,
  ToolCallInfo,
  ToolResult,
} from '../../shared/types';
import fs from 'node:fs';

/**
 * Falcon ajan çekirdeği.
 * Kullanıcı isteğini Gemini'ye iletir, modelin istediği araçları (uygulama açma,
 * dosya işlemleri, terminal, sistem kapatma...) çalıştırır, sonuçları modele geri
 * besler ve nihai yanıtı akış hâlinde arayüze gönderir.
 */

const MAX_TOOL_STEPS = 24;
const MAX_HISTORY = 26;

interface RunState {
  controller: AbortController;
  conversationId: string;
  startedAt: number;
}

const activeRuns = new Map<string, RunState>();
let globalStop = false;

export function stopAll(): void {
  globalStop = true;
  for (const [, run] of activeRuns) {
    try {
      run.controller.abort();
    } catch {
      /* yoksay */
    }
  }
  activeRuns.clear();
  emitState({ status: 'idle', stopped: true });
  emitToast('info', 'Acil durdurma', 'Falcon durduruldu. Yeni bir komut verebilirsiniz.');
}

export function clearGlobalStop(): void {
  globalStop = false;
}

export function isRunning(): boolean {
  return activeRuns.size > 0;
}

/* ------------------------------------------------------------------ */
/* Sistem istemi                                                       */
/* ------------------------------------------------------------------ */

async function buildSystemPrompt(opts: { voice?: boolean }): Promise<string> {
  const cfg = getConfig();
  const mems = listMemories().slice(0, 25);
  const tasks = listTasks().filter((t) => !t.done).slice(0, 12);
  const projects = listProjects().slice(0, 10);
  const agents = listAgentSpecs();
  let info: Awaited<ReturnType<typeof getSystemInfo>> | null = null;
  try {
    info = await getSystemInfo();
  } catch {
    info = null;
  }

  const now = new Date();
  const perm = cfg.permissions;
  const permLines = [
    `Dosya erişimi: ${perm.fileAccess ? 'açık' : 'kapalı'}`,
    `Uygulama denetimi: ${perm.appControl ? 'açık' : 'kapalı'}`,
    `Terminal: ${perm.terminal ? 'açık' : 'kapalı'}`,
    `Güç işlemleri: ${perm.power ? 'açık' : 'kapalı'}`,
    `Pano: ${perm.clipboard ? 'açık' : 'kapalı'}`,
    `Ağ: ${perm.network ? 'açık' : 'kapalı'}`,
    `Onay modu: ${perm.mode === 'full' ? 'tam yetki (onaysız)' : perm.mode === 'smart' ? 'akıllı (riskli işlemlerde onay)' : 'her işlemde onay'}`,
  ].join('\n');

  return `Senin adın Falcon. Kullanıcının bilgisayarında çalışan, tam yetkili kişisel yapay zekâ ajanısın. Kullanıcının adı: ${cfg.userName}.

## Kişiliğin
- Türkçe konuşan, sıcak, zeki ve kendinden emin bir asistansın. Samimi ama saygılısın; "efendim" gibi mesafeli hitaplar yerine doğal bir ton kullan.
- Konuşurken kısa ve net cümleler kur. Gereksiz özür, gereksiz açıklama ve "yapay zekâ olarak" kalıpları yok.
- İşi bitirirsin. Kullanıcı bir şey yapmanı istediğinde "yapabilirim" deme, yap.
- Yaptığın işlemin sonucunu tek cümleyle söyle, sonra gerekli ayrıntıyı ver.

## Yeteneklerin (araçların var, kullanmaktan çekinme)
Uygulama açma/kapatma, klavye ile yazma, tuş basma, kayıtlı hesapla otomatik giriş, dosya okuma/yazma/arama/taşıma/silme, PDF/DOCX analizi, belge çevirisi, ekran görüntüsü alıp analiz etme, ses seviyesi/parlaklık/tema, medya kontrolü, terminal komutları, web araması, gündem/haber özeti, görev ve hatırlatıcı yönetimi, hafıza, proje oluşturma, uzman alt ajanlara iş devretme, bilgisayarı kapatma/yeniden başlatma/kilitleme.

## Çalışma biçimin
1. Kullanıcının niyetini anla. Eksik bilgi varsa tek soruyla netleştir; gerekiyorsa makul bir varsayım yap ve sonuçta belirt.
2. Gereken araçları sırayla çağır. Aynı hatalı çağrıyı tekrar etme; en fazla iki kez dene.
3. Araç hatası alırsan alternatif yol dene (ör. farklı uygulama adı, list_apps ile arama).
4. Sonucu Türkçe, kısa ve anlaşılır biçimde raporla. Yaptığın dosya/klasör yollarını belirt.
5. Kullanıcı "kapat" derse "bilgisayarı kapat" kastediliyorsa system_power(action="shutdown") kullan; kapanmadan önce 30 saniye gecikme bırak ve bunu söyle. Uygulama kapatma için close_app kullan.
6. Gündem/haber istendiğinde news_digest kullan ve başlıkları kaynaklarıyla ver. "Benim için takip et" derse ilgili konuyu remember ile hafızaya yaz ve gerekiyorsa add_reminder ile hatırlatıcı kur.
7. Bir araç "bulunamadı" veya "desteklenmiyor" derse vazgeçme: list_apps, list_directory veya web_search ile alternatif yol bul.

## Güvenlik ve sınırlar
- API anahtarı, şifre gibi gizli bilgileri asla yanıtına yazma. Kayıtlı hesapları login_app ile kullan; kullanıcıdan şifre istemen gerekmez.
- Kullanıcı açıkça istemedikçe yıkıcı işlem yapma (silme, çöp boşaltma, format, disk işlemleri). İstediğinde yap ama sonucu net söyle.
- Silme işlemlerinde delete_path (çöp kutusu) kullan; kalıcı silme komutu (rm -rf, format) çalıştırma.
- Sistem klasörlerine (Windows, Program Files, /etc vb.) yazma.
- Kullanıcının izinleri kapalıysa aracı zorlamaya çalışma; hangi ayarın açılması gerektiğini söyle.
- Tehlikeli veya geri alınamaz bir işlem öncesi kullanıcıya tek cümleyle ne yapacağını söyle.

## Alt ajanlar (iş birliği)
Karmaşık görevlerde işi devret: ${agents.map((a) => `${a.name} (${a.tagline})`).join('; ')}. delegate_task aracını kullan. Sonuçları kullanıcıya tek bir tutarlı yanıtta birleştir.

## Ortam
Tarih/saat: ${now.toLocaleString('tr-TR', { dateStyle: 'full', timeStyle: 'short' })}
Platform: ${info ? `${info.platformLabel} (${info.osVersion}), ${info.arch}` : process.platform}
Makine: ${info?.hostname ?? 'bilinmiyor'} · Kullanıcı: ${info?.user ?? 'kullanıcı'}
Kullanıcı ev dizini: ${process.env.HOME ?? process.env.USERPROFILE ?? ''}
Ekran: ${info ? `${info.displays[0]?.width ?? 1920}x${info.displays[0]?.height ?? 1080}` : 'bilinmiyor'}
Pil: ${info?.battery ? `%${info.battery.percent}${info.battery.charging ? ' (şarjda)' : ''}` : 'yok'}
Masaüstü, Belgeler ve İndirilenler klasörlerine doğrudan erişimin var.

## İzin durumu
${permLines}

## Kullanıcı hakkında hatırladıkların
${mems.length ? mems.map((m) => `- ${m.text}`).join('\n') : '- (henüz kayıt yok)'}

## Açık görevler
${tasks.length ? tasks.map((t) => `- ${t.title}${t.priority === 'high' ? ' (acil)' : ''}${t.dueAt ? ` — ${new Date(t.dueAt).toLocaleDateString('tr-TR')}` : ''}`).join('\n') : '- yok'}

## Projeler
${projects.length ? projects.map((p) => `- ${p.name}: ${p.description}`).join('\n') : '- yok'}

${opts.voice ? '## Sesli yanıt modu\nKullanıcı seni dinliyor. Yanıtların konuşma diline uygun, en fazla 3-4 cümle olsun. Madde işareti, tablo ve uzun kod blokları kullanma; gerekliyse "ekranda gösteriyorum" de.' : '## Yazılı yanıt modu\nGerektiğinde madde işaretleri, başlıklar ve kod blokları kullan. Yanıtlar eksiksiz ama gereksiz uzatılmamış olsun.'}`;
}

/* ------------------------------------------------------------------ */
/* Yardımcılar                                                         */
/* ------------------------------------------------------------------ */

function makeMessage(partial: Partial<ChatMessage> & { conversationId: string; role: ChatMessage['role'] }): ChatMessage {
  return {
    id: partial.id ?? uid('msg-'),
    conversationId: partial.conversationId,
    role: partial.role,
    text: partial.text ?? '',
    createdAt: partial.createdAt ?? Date.now(),
    agent: partial.agent,
    attachments: partial.attachments,
    tool: partial.tool,
    error: partial.error,
    sources: partial.sources,
  };
}

function emitMessage(message: ChatMessage): void {
  broadcast({ type: 'message', message });
  appendMessage(message.conversationId, message);
}

function historyToContents(conversationId: string, incoming: ChatMessage): GeminiContent[] {
  // Geçmişteki mesajlar yalnızca metin olarak gönderilir (ekler tekrar yüklenmez).
  const stored = getMessages(conversationId)
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.id !== incoming.id)
    .slice(-MAX_HISTORY);

  const contents: GeminiContent[] = [];
  for (const m of stored) {
    const role = m.role === 'user' ? 'user' : 'model';
    const text = String(m.text ?? '').slice(0, 12000).trim();
    if (!text) continue;
    const attachmentNote =
      m.attachments?.length ? `\n[Ekler: ${m.attachments.map((a) => a.name).join(', ')}]` : '';
    contents.push({ role, parts: [{ text: text + attachmentNote }] });
  }

  // Şu anki kullanıcı mesajı: eklerle birlikte
  const parts: GeminiPart[] = [];
  // Ardışık aynı rollü içerikleri birleştir (Gemini için daha güvenli)
  const merged: GeminiContent[] = [];
  for (const content of contents) {
    const last = merged[merged.length - 1];
    if (last && last.role === content.role) last.parts.push(...content.parts);
    else merged.push({ role: content.role, parts: [...content.parts] });
  }
  contents.length = 0;
  contents.push(...merged);
  for (const att of incoming.attachments ?? []) {
    if (att.base64) parts.push({ inlineData: { mimeType: att.mime, data: att.base64 } });
    if (att.dataUrl?.startsWith('data:text/plain;base64,') && !att.base64) {
      const text = Buffer.from(att.dataUrl.split(',')[1], 'base64').toString('utf8');
      parts.push({ text: `--- EK DOSYA: ${att.name} ---\n${text.slice(0, 30000)}` });
    }
  }
  parts.push({ text: incoming.text || '(ek dosya)' });
  contents.push({ role: 'user', parts });
  return contents;
}

async function prepareAttachments(attachments: Attachment[] = []): Promise<Attachment[]> {
  const out: Attachment[] = [];
  for (const att of attachments) {
    if (att.base64) {
      out.push(att);
      continue;
    }
    if (!att.path) {
      out.push(att);
      continue;
    }
    try {
      const file = resolvePath(att.path);
      const stat = fs.statSync(file);
      const mime = att.mime || mimeFor(file);
      const enriched: Attachment = { ...att, path: file, size: stat.size, mime };
      if (mime.startsWith('image/') || mime === 'application/pdf' || mime.startsWith('audio/')) {
        if (stat.size <= 18 * 1024 * 1024) {
          enriched.base64 = fs.readFileSync(file).toString('base64');
        } else {
          enriched.dataUrl = undefined;
        }
      } else {
        const extracted = extractText(file, 30000);
        if (extracted.text) {
          enriched.dataUrl = `data:text/plain;base64,${Buffer.from(extracted.text, 'utf8').toString('base64')}`;
        }
        addFileRecord({ name: att.name, path: file, mime, size: stat.size });
      }
      out.push(enriched);
    } catch (err) {
      log.warn('ek dosya hazırlanamadı', att.path, err);
      out.push(att);
    }
  }
  return out;
}

async function suggestTitle(conversationId: string, userText: string, assistantText: string): Promise<void> {
  const cfg = getConfig();
  if (!anyProviderAvailable()) return;
  try {
    const res = await generateChat({
      model: cfg.models.fast,
      purpose: 'fast',
      temperature: 0.3,
      maxOutputTokens: 32,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Aşağıdaki sohbet için en fazla 4 kelimelik, Türkçe, açıklayıcı bir başlık yaz. Tırnak ve nokta kullanma, sadece başlığı yaz.\n\nKullanıcı: ${userText.slice(0, 500)}\nFalcon: ${assistantText.slice(0, 500)}`,
            },
          ],
        },
      ],
    });
    const title = res.text.trim().replace(/^["'“]|["'”]$/g, '').slice(0, 60);
    if (title) {
      renameConversation(conversationId, title);
      const conv = getMockConversation(conversationId);
      if (conv) broadcast({ type: 'conversation', conversation: conv });
    }
  } catch {
    /* başlık önemli değil */
  }
}

function getMockConversation(id: string): Conversation | null {
  return listConversations().find((c) => c.id === id) ?? null;
}

/* ------------------------------------------------------------------ */
/* Ana akış                                                            */
/* ------------------------------------------------------------------ */

export interface ChatOutcome {
  conversationId: string;
  assistantMessage: ChatMessage;
  spokenText: string;
}

export async function chat(request: ChatRequest): Promise<ChatOutcome> {
  clearGlobalStop();
  const cfg = getConfig();
  if (!anyProviderAvailable()) {
    throw new Error(
      'Hiçbir yapay zekâ anahtarı ayarlanmamış. Ayarlar → API ve Modeller bölümünden Google, OpenAI, Anthropic, NVIDIA veya Abacus anahtarı ekleyin.',
    );
  }

  let conversationId = request.conversationId;
  if (conversationId && activeRuns.has(conversationId)) {
    activeRuns.get(conversationId)?.controller.abort();
    activeRuns.delete(conversationId);
  }
  if (!conversationId) {
    conversationId = newConversation(request.text.slice(0, 40) || 'Yeni sohbet').id;
    const conv = getConversationById(conversationId);
    if (conv) broadcast({ type: 'conversation', conversation: conv });
  }

  const attachments = await prepareAttachments(request.attachments ?? []);
  const userMessage = makeMessage({
    conversationId,
    role: 'user',
    text: request.text,
    attachments,
  });
  emitMessage(userMessage);

  const controller = new AbortController();
  activeRuns.set(conversationId, { controller, conversationId, startedAt: Date.now() });
  emitState({ status: 'thinking', conversationId, stopped: false });

  const systemPrompt = await buildSystemPrompt({ voice: request.voice });
  const contents = historyToContents(conversationId, userMessage);
  // Son kullanıcı mesajı az önce eklendi; yinelenen kopyayı geçmişten ayıkla
  const deduped = [...contents];
  if (deduped.length >= 2) {
    const last = deduped[deduped.length - 1];
    const prev = deduped[deduped.length - 2];
    if (last.role === 'user' && prev.role === 'user' && JSON.stringify(last) === JSON.stringify(prev)) {
      deduped.pop();
    }
  }

  const assistantMessage: ChatMessage = makeMessage({
    conversationId,
    role: 'assistant',
    text: '',
    agent: (request.agent ?? 'Falcon') as AgentName,
  });
  broadcast({ type: 'message', message: assistantMessage });

  let finalText = '';
  const spokenParts: string[] = [];
  const toolResults: { name: string; result: ToolResult }[] = [];

  try {
    for (let step = 0; step < MAX_TOOL_STEPS; step++) {
      if (globalStop || controller.signal.aborted) break;

      let stepText = '';
      const calls: { name: string; args: Record<string, unknown> }[] = [];
      let finishReason = '';

      for await (const chunk of streamChat({
        model: cfg.models.brain,
        purpose: 'brain',
        systemInstruction: systemPrompt,
        tools: toolDefinitions(),
        temperature: cfg.models.temperature,
        maxOutputTokens: cfg.models.maxOutputTokens,
        contents: deduped,
        signal: controller.signal,
        timeoutMs: 180_000,
      })) {
        if (globalStop) break;
        if (chunk.textDelta) {
          stepText += chunk.textDelta;
          finalText += chunk.textDelta;
          broadcast({
            type: 'delta',
            messageId: assistantMessage.id,
            text: finalText,
            conversationId,
          });
        }
        if (chunk.functionCall) calls.push(chunk.functionCall);
        if (chunk.finishReason) finishReason = chunk.finishReason;
        if (chunk.groundingSources?.length) {
          assistantMessage.sources = chunk.groundingSources.slice(0, 8);
        }
      }

      if (globalStop) break;

      if (!calls.length) {
        // Nihai yanıt
        if (finishReason === 'MAX_TOKENS' && finalText.trim()) {
          finalText += '\n\n_(Yanıt uzunluk sınırına ulaştı. Devamını isterseniz "devam et" yazın.)_';
        }
        break;
      }

      // Araç çağrılarını modele geri besle
      deduped.push({
        role: 'model',
        parts: [
          ...(stepText ? [{ text: stepText }] : []),
          ...calls.map((c) => ({ functionCall: { name: c.name, args: c.args } })),
        ],
      });

      const responseParts: GeminiPart[] = [];
      for (const call of calls) {
        if (globalStop) break;
        const toolCall: ToolCallInfo = {
          id: uid('tool-'),
          name: call.name,
          label: toolLabel(call.name),
          args: call.args,
          status: 'running',
          risk: toolRisk(call.name),
          agent: (request.agent ?? 'Falcon') as AgentName,
          startedAt: Date.now(),
        };
        const toolMessage = makeMessage({
          conversationId,
          role: 'tool',
          text: '',
          tool: toolCall,
          agent: toolCall.agent,
        });
        emitMessage(toolMessage);
        emitState({ status: 'tool', activeTool: call.name, activeAgent: toolCall.agent, conversationId });

        const result = await executeTool(call.name, call.args, {
          agent: (request.agent ?? 'Falcon') as AgentName,
          conversationId,
          signal: controller.signal,
        });
        toolResults.push({ name: call.name, result });

        const finished: ChatMessage = {
          ...toolMessage,
          tool: {
            ...toolCall,
            status: result.ok ? 'ok' : 'error',
            output: (result.content ?? result.summary).slice(0, 4000),
            detail: result.summary,
            endedAt: Date.now(),
          },
          text: result.summary,
        };
        emitMessage(finished);

        // Gündem aracı özel olay yayınlar
        if (call.name === 'news_digest' && result.ok && result.data) {
          broadcast({ type: 'agenda', digest: result.data as never });
          const digest = result.data as { headline?: string; items?: unknown[] };
          if (digest.items?.length) {
            const speech = digestToSpeech(result.data as never);
            spokenParts.push(speech);
          }
        }

        responseParts.push({
          functionResponse: {
            name: call.name,
            response: result.ok
              ? { result: (result.content ?? result.summary).slice(0, 24000), summary: result.summary }
              : { error: result.summary },
          },
        });
      }

      deduped.push({ role: 'user', parts: responseParts });
      emitState({ status: 'thinking', conversationId, activeAgent: assistantMessage.agent });

      if (step === MAX_TOOL_STEPS - 1) {
        finalText += '\n\n_(Araç adım sınırına ulaşıldı. İşlemi sürdürmemi isterseniz devam edin.)_';
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const friendly = /abort/i.test(message)
      ? 'İşlem durduruldu.'
      : message;
    if (!globalStop) {
      assistantMessage.error = friendly;
      finalText = finalText
        ? `${finalText}\n\n⚠️ ${friendly}`
        : `⚠️ ${friendly}`;
      emitToast('error', 'Falcon hata verdi', friendly);
    }
    log.error('sohbet hatası', err);
  } finally {
    activeRuns.delete(conversationId);
    emitState({ status: globalStop ? 'idle' : 'idle', conversationId, stopped: globalStop });
  }

  if (!finalText.trim()) {
    if (globalStop) finalText = 'Durduruldu.';
    else if (toolResults.length) {
      finalText = toolResults.map((t) => `• ${t.result.summary}`).join('\n');
    } else {
      finalText = 'Yanıt üretilemedi. Lütfen tekrar deneyin.';
    }
  }

  const finalMessage: ChatMessage = {
    ...assistantMessage,
    text: finalText,
    spoken: false,
  };
  emitMessage(finalMessage);

  const userPart = request.text;
  if (userPart && getMessages(conversationId).filter((m) => m.role === 'user').length === 1) {
    void suggestTitle(conversationId, userPart, finalText);
  }

  // Sesli yanıt: istek sesli geldiyse ya da otomatik konuşma açıksa arayüze bildir
  let speakTextFinal = finalText.replace(/```[\s\S]*?```/g, ' (kod ekranda) ').replace(/[*_#>|]/g, '').trim();
  // Yazılı sohbette otomatik seslendirme uzun yanıtları kısaltır; sesli istekte tamamı okunur.
  if (!request.voice && speakTextFinal.length > 700) {
    const cut = speakTextFinal.slice(0, 700);
    const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    speakTextFinal = `${lastStop > 200 ? cut.slice(0, lastStop + 1) : cut} Devamını ekranda okuyabilirsin.`;
  }
  if ((request.voice || cfg.voice.autoSpeak) && speakTextFinal && !globalStop) {
    broadcast({ type: 'speak', text: speakTextFinal, messageId: finalMessage.id });
  }

  // Sesli yanıt metni: araç özetleri + modelin yanıtı
  const speakText =
    spokenParts.length > 0
      ? spokenParts.join(' ')
      : finalText.replace(/```[\s\S]*?```/g, ' (kod ekranda) ').replace(/[*_#>|]/g, '').trim();
  return {
    conversationId,
    assistantMessage: finalMessage,
    spokenText: speakText,
  };
}

/* ------------------------------------------------------------------ */
/* Proaktif görevler                                                   */
/* ------------------------------------------------------------------ */

export async function runAgenda(speak = true): Promise<{ digest: unknown; speech: string }> {
  const digest = await buildDigest();
  broadcast({ type: 'agenda', digest });
  const speech = digestToSpeech(digest);
  if (speak) broadcast({ type: 'speak', text: speech });
  return { digest, speech };
}

/** Kullanıcı arayüzden bir eylem çağırdığında (ör. "gündemi oku") */
export async function speakText(text: string): Promise<void> {
  broadcast({ type: 'speak', text });
}

export function getConversationById(id: string): Conversation | null {
  const msgs = getMessages(id);
  if (!msgs.length) return null;
  const first = msgs.find((m) => m.role === 'user');
  return {
    id,
    title: first ? String(first.text).slice(0, 48) : 'Sohbet',
    createdAt: Number(msgs[0].createdAt ?? Date.now()),
    updatedAt: Number(msgs[msgs.length - 1].createdAt ?? Date.now()),
    messageCount: msgs.length,
  };
}

export async function extractPdfForModel(file: string): Promise<string> {
  const buffer = fs.readFileSync(file);
  return extractPdfText(buffer).text;
}

export function currentAgentState(): AgentState {
  return { status: activeRuns.size ? 'thinking' : 'idle' };
}


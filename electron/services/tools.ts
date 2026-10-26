import fs from 'node:fs';
import path from 'node:path';
import { Notification, shell } from 'electron';
import { getConfig } from '../core/config';
import { log, audit } from '../core/logger';
import { uid } from '../core/store';
import {
  addFileRecord,
  addMemory,
  addReminder,
  addTask,
  createProject,
  listProjects,
  listMemories,
  listReminders,
  listTasks,
  toggleTask,
} from '../core/db';
import { assertCommandAllowed, assertPathAllowed, expandHome, isMac, isWindows, redact, requestConfirmation } from '../core/security';
import { documentsDir, downloadsDir, homeDir } from '../core/paths';
import { getCredential, listCredentials, saveCredential, deleteCredential } from '../core/vault';
import { generateChat, type FunctionDeclaration } from '../core/llm';
import {
  closeApp,
  listApps,
  openApp,
  runningProcesses,
} from './apps';
import {
  emptyTrash,
  mediaControl,
  openPath,
  openUrl,
  powerAction,
  readClipboard,
  setBrightness,
  setMuted,
  setVolume,
  showInFolder,
  takeScreenshot,
  toggleDarkMode,
  trashPath,
  writeClipboard,
  type MediaAction,
  type PowerAction,
} from './system';
import {
  appendTextFile,
  copyPath,
  defaultSaveDir,
  extractText,
  humanSize,
  isImage,
  makeDir,
  mimeFor,
  readBase64,
  readDirectory,
  resolvePath,
  safeFileName,
  searchFiles,
  statPath,
  writeTextFile,
} from './documents';
import { buildDigest, digestToText } from './agenda';
import { translateFile } from './translate';
import { delegate } from './delegation';
import type { AgentName, PermissionSettings, ToolResult, ToolRisk } from '../../shared/types';
import { run } from './system';

/* ------------------------------------------------------------------ */
/* Bağlam ve tanım tipleri                                             */
/* ------------------------------------------------------------------ */

export interface ToolContext {
  agent: AgentName;
  conversationId?: string;
  signal?: AbortSignal;
  /** Arayüze ara bilgi göndermek için */
  notify?: (text: string) => void;
}

interface ConfirmSpec {
  title: string;
  detail: string;
}

export interface FalconTool {
  name: string;
  label: string;
  description: string;
  risk: ToolRisk;
  capability: keyof PermissionSettings | 'core';
  icon: string;
  parameters: Record<string, unknown>;
  confirm?: (args: Record<string, unknown>) => ConfirmSpec | null;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : v == null ? fallback : String(v));
const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const bool = (v: unknown, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback);

function obj(props: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: 'object', properties: props, ...(required.length ? { required } : {}) };
}

const S = (description: string) => ({ type: 'string', description });
const N = (description: string) => ({ type: 'number', description });
const B = (description: string) => ({ type: 'boolean', description });

/* ------------------------------------------------------------------ */
/* Araç tanımları                                                      */
/* ------------------------------------------------------------------ */

const TOOLS: FalconTool[] = [
  /* -------------------------- Uygulamalar -------------------------- */
  {
    name: 'open_app',
    label: 'Uygulama aç',
    description:
      'Bilgisayarda bir uygulamayı veya web sitesini açar. Örn: "chrome", "spotify", "kod" (VS Code), "hesap makinesi", "youtube", "gmail". Tam yol da verilebilir.',
    risk: 'safe',
    capability: 'appControl',
    icon: 'app-window',
    parameters: obj({ app: S('Uygulama adı, takma adı, .exe adı, tam yol veya web sitesi'), args: S('Uygulamaya iletilecek isteğe bağlı argümanlar') }, ['app']),
    handler: async (a) => {
      const r = await openApp(str(a.app), str(a.args));
      return { ok: true, summary: `${r.opened} açıldı.`, data: r };
    },
  },
  {
    name: 'close_app',
    label: 'Uygulama kapat',
    description: 'Çalışan bir uygulamayı kapatır. Önce nazikçe kapatmayı dener, gerekirse süreci sonlandırır.',
    risk: 'moderate',
    capability: 'appControl',
    icon: 'x-circle',
    parameters: obj({ app: S('Kapatılacak uygulama: "chrome", "spotify", "notepad" gibi') }, ['app']),
    confirm: (a) => ({ title: 'Uygulama kapatılsın mı?', detail: `"${str(a.app)}" kapatılacak. Kaydedilmemiş veriler kaybolabilir.` }),
    handler: async (a) => {
      const msg = await closeApp(str(a.app));
      return { ok: true, summary: msg };
    },
  },
  {
    name: 'list_apps',
    label: 'Kurulu uygulamaları listele',
    description: 'Bilgisayarda kurulu uygulamaların listesini döndürür. Kullanıcı uygulama adını yanlış hatırlıyorsa buradan bulun.',
    risk: 'safe',
    capability: 'appControl',
    icon: 'grid',
    parameters: obj({ filter: S('İsteğe bağlı arama metni') }),
    handler: async (a) => {
      const apps = await listApps();
      const filter = str(a.filter).toLocaleLowerCase('tr-TR');
      const filtered = filter ? apps.filter((x) => x.name.toLocaleLowerCase('tr-TR').includes(filter)) : apps;
      return {
        ok: true,
        summary: `${filtered.length} uygulama bulundu.`,
        data: filtered.slice(0, 200),
        content: filtered.slice(0, 200).map((x) => x.name).join(', '),
      };
    },
  },
  {
    name: 'list_running_apps',
    label: 'Çalışan uygulamalar',
    description: 'Şu anda açık olan uygulamaları listeler. Kullanıcı "ne açık?" derse kullan.',
    risk: 'safe',
    capability: 'appControl',
    icon: 'activity',
    parameters: obj({}),
    handler: async () => {
      const procs = await runningProcesses();
      return {
        ok: true,
        summary: `${procs.length} uygulama açık.`,
        data: procs,
        content: procs.map((p) => p.name).join(', '),
      };
    },
  },
  {
    name: 'activate_window',
    label: 'Pencereyi öne getir',
    description: 'Açık bir uygulamanın penceresini öne getirir ve odaklar. Klavyeyle yazmadan önce kullan.',
    risk: 'safe',
    capability: 'appControl',
    icon: 'mouse-pointer-click',
    parameters: obj({ app: S('Uygulama adı veya pencere başlığı') }, ['app']),
    handler: async (a) => {
      const msg = await activateWindow(str(a.app));
      return { ok: true, summary: msg };
    },
  },
  {
    name: 'type_text',
    label: 'Klavyeden yaz',
    description:
      'Odaktaki pencereye metin yazar (pano + yapıştırma yöntemiyle, Türkçe karakterler dahil). Form doldurma, arama kutusuna yazma için kullan.',
    risk: 'moderate',
    capability: 'appControl',
    icon: 'keyboard',
    parameters: obj(
      {
        text: S('Yazılacak metin'),
        app: S('İsteğe bağlı: önce bu uygulamaya odaklan'),
        submit: B('Yazdıktan sonra Enter tuşuna basılsın mı?'),
        clear_first: B('Yazmadan önce Ctrl+A ile mevcut metin seçilsin mi?'),
      },
      ['text'],
    ),
    confirm: (a) => ({ title: 'Klavye ile yazılsın mı?', detail: `Yazılacak metin: "${str(a.text).slice(0, 160)}"` }),
    handler: async (a) => {
      if (str(a.app)) await activateWindow(str(a.app));
      const msg = await typeText(str(a.text), { submit: bool(a.submit), clearFirst: bool(a.clear_first) });
      return { ok: true, summary: msg };
    },
  },
  {
    name: 'press_keys',
    label: 'Tuşlara bas',
    description: 'Kısayol tuşlarına basar. Örn: "ctrl+s", "alt+f4", "enter", "win", "ctrl+shift+t".',
    risk: 'moderate',
    capability: 'appControl',
    icon: 'command',
    parameters: obj({ keys: S('Tuş kombinasyonu, örn: "ctrl+s"'), app: S('İsteğe bağlı: önce bu uygulamaya odaklan') }, ['keys']),
    handler: async (a) => {
      if (str(a.app)) await activateWindow(str(a.app));
      const msg = await pressKeys(str(a.keys));
      return { ok: true, summary: msg };
    },
  },
  {
    name: 'login_app',
    label: 'Uygulamaya giriş yap',
    description:
      'Kasada kayıtlı bir hesapla uygulamaya veya siteye otomatik giriş yapar. Şifre asla modele gösterilmez. Kullanıcı "giriş yap" derse ve hesap adı verirse kullan.',
    risk: 'dangerous',
    capability: 'appControl',
    icon: 'log-in',
    parameters: obj(
      {
        app: S('Uygulama adı veya site adresi (ör. "gmail", "spotify")'),
        account: S('Kasada kayıtlı hesap adı; boşsa uygulama adıyla aranır'),
        username: S('İsteğe bağlı kullanıcı adı (kasa boşsa ve kullanıcı verdiyse)'),
        password: S('İsteğe bağlı şifre (kasa boşsa ve kullanıcı açıkça verdiyse)'),
      },
      ['app'],
    ),
    confirm: (a) => ({ title: 'Otomatik giriş yapılsın mı?', detail: `"${str(a.app)}" için ${str(a.account) || 'kayıtlı hesapla'} otomatik giriş yapılacak.` }),
    handler: async (a) => {
      const app = str(a.app);
      const account = str(a.account) || app;
      let cred = getCredential(account);
      if (!cred && str(a.username) && str(a.password)) {
        saveCredential({ name: account, username: str(a.username), password: str(a.password), app });
        cred = getCredential(account);
      }
      if (!cred) {
        return {
          ok: false,
          summary: `"${account}" için kayıtlı hesap yok. Kullanıcıdan kullanıcı adı ve şifre isteyin; ardından save_credential aracıyla kasaya ekleyin.`,
        };
      }
      await openApp(app);
      await sleep(1800);
      await activateWindow(app);
      await typeText(cred.meta.username, { submit: false, clearFirst: true });
      await pressKeys('tab');
      await sleep(150);
      await typeText(cred.password, { submit: true, clearFirst: true });
      return {
        ok: true,
        summary: `${cred.meta.name} hesabıyla giriş denendi (kullanıcı adı: ${cred.meta.username}). Şifre kasada güvende.`,
      };
    },
  },
  {
    name: 'save_credential',
    label: 'Hesap bilgisini kasaya kaydet',
    description:
      'Kullanıcının verdiği kullanıcı adı/şifreyi şifreli kasaya kaydeder. Şifreyi asla yanıt olarak tekrar etme veya günlüğe yazma.',
    risk: 'moderate',
    capability: 'appControl',
    icon: 'key-round',
    parameters: obj(
      {
        name: S('Hesap adı, ör. "gmail" veya "spotify"'),
        username: S('Kullanıcı adı veya e-posta'),
        password: S('Şifre'),
        app: S('İlgili uygulama/site'),
      },
      ['name', 'username', 'password'],
    ),
    handler: async (a) => {
      const meta = saveCredential({
        name: str(a.name),
        username: str(a.username),
        password: str(a.password),
        app: str(a.app),
      });
      return { ok: true, summary: `${meta.name} hesabı kasaya kaydedildi. Şifre şifreli olarak saklanıyor.`, data: meta };
    },
  },
  {
    name: 'list_credentials',
    label: 'Kayıtlı hesaplar',
    description: 'Kasada kayıtlı hesapların adlarını ve kullanıcı adlarını listeler. Şifreler asla döndürülmez.',
    risk: 'safe',
    capability: 'appControl',
    icon: 'shield',
    parameters: obj({}),
    handler: async () => {
      const creds = listCredentials();
      return {
        ok: true,
        summary: `${creds.length} kayıtlı hesap var.`,
        data: creds,
        content: creds.map((c) => `${c.name} (${c.username})`).join(', ') || 'Kayıtlı hesap yok.',
      };
    },
  },
  {
    name: 'delete_credential',
    label: 'Hesabı sil',
    description: 'Kasadan kayıtlı bir hesabı siler.',
    risk: 'dangerous',
    capability: 'appControl',
    icon: 'trash-2',
    parameters: obj({ name: S('Silinecek hesap adı') }, ['name']),
    handler: async (a) => {
      const ok = deleteCredential(str(a.name));
      return { ok, summary: ok ? `${str(a.name)} kasadan silindi.` : `${str(a.name)} bulunamadı.` };
    },
  },

  /* --------------------------- Dosyalar ---------------------------- */
  {
    name: 'read_file',
    label: 'Dosya oku',
    description:
      'Bir dosyanın içeriğini okur. PDF, DOCX, TXT, MD, CSV, JSON ve kod dosyaları desteklenir. Metin içeriği döner.',
    risk: 'safe',
    capability: 'fileAccess',
    icon: 'file-text',
    parameters: obj({ path: S('Dosya yolu (tam yol veya ~/Belgeler/...)'), max_chars: N('Okunacak en fazla karakter (varsayılan 60000)') }, ['path']),
    handler: async (a) => {
      const file = assertPathAllowed(resolvePath(str(a.path)));
      if (!fs.existsSync(file)) return { ok: false, summary: `Dosya bulunamadı: ${file}` };
      const st = fs.statSync(file);
      if (st.isDirectory()) return { ok: false, summary: `${file} bir klasör. Klasör içeriği için list_directory kullan.` };
      const extracted = extractText(file, Math.min(num(a.max_chars, 60000), 120000));
      if (extracted.kind === 'binary' || !extracted.text) {
        return {
          ok: false,
          summary: `${file} metin olarak okunamadı (${humanSize(st.size)}). Görsel/PDF içinse analyze_document kullan.`,
        };
      }
      if (!addFileExists(file)) {
        addFileRecord({ name: path.basename(file), path: file, mime: mimeFor(file), size: st.size });
      }
      return {
        ok: true,
        summary: `${path.basename(file)} okundu (${humanSize(st.size)}${extracted.pages ? `, ${extracted.pages} sayfa` : ''}).`,
        data: { path: file, chars: extracted.text.length, truncated: extracted.truncated, kind: extracted.kind },
        content: extracted.text,
      };
    },
  },
  {
    name: 'write_file',
    label: 'Dosya yaz',
    description:
      'Yeni bir dosya oluşturur veya üzerine yazar. Metin, kod, markdown, CSV, JSON yazılabilir. Varsayılan konum Belgeler klasörü.',
    risk: 'moderate',
    capability: 'fileAccess',
    icon: 'file-plus',
    parameters: obj(
      {
        path: S('Dosya yolu. Göreli verilirse Belgeler klasörüne yazılır, ör. "rapor.md"'),
        content: S('Yazılacak tam içerik'),
        overwrite: B('Var olan dosyanın üzerine yazılsın mı? (varsayılan true)'),
      },
      ['path', 'content'],
    ),
    handler: async (a) => {
      const result = writeTextFile(str(a.path), str(a.content), { overwrite: a.overwrite === undefined ? true : bool(a.overwrite) });
      addFileRecord({ name: path.basename(result.file), path: result.file, mime: mimeFor(result.file), size: result.bytes });
      return { ok: true, summary: `Kaydedildi: ${result.file} (${humanSize(result.bytes)})`, data: result };
    },
  },
  {
    name: 'append_file',
    label: 'Dosyaya ekle',
    description: 'Var olan bir dosyanın sonuna metin ekler.',
    risk: 'moderate',
    capability: 'fileAccess',
    icon: 'file-diff',
    parameters: obj({ path: S('Dosya yolu'), content: S('Eklenecek içerik') }, ['path', 'content']),
    handler: async (a) => {
      const r = appendTextFile(str(a.path), str(a.content));
      return { ok: true, summary: `${r.file} dosyasına eklendi.` };
    },
  },
  {
    name: 'list_directory',
    label: 'Klasör listele',
    description: 'Bir klasörün içeriğini listeler. Boş bırakılırsa ev dizini listelenir.',
    risk: 'safe',
    capability: 'fileAccess',
    icon: 'folder-open',
    parameters: obj({ path: S('Klasör yolu') }),
    handler: async (a) => {
      const entries = readDirectory(str(a.path) || homeDir());
      return {
        ok: true,
        summary: `${entries.length} öğe listelendi.`,
        data: entries.slice(0, 100).map((e) => ({ ...e, sizeText: humanSize(e.size) })),
        content: entries
          .slice(0, 100)
          .map((e) => `${e.isDir ? '[K]' : '[D]'} ${e.name}${e.isDir ? '' : ` (${humanSize(e.size)})`}`)
          .join('\n'),
      };
    },
  },
  {
    name: 'search_files',
    label: 'Dosya ara',
    description: 'Bilgisayarda dosya adına göre arama yapar.',
    risk: 'safe',
    capability: 'fileAccess',
    icon: 'search',
    parameters: obj({ query: S('Dosya adında aranacak metin'), root: S('Arama kök klasörü (varsayılan ev dizini)') }, ['query']),
    handler: async (a) => {
      const results = searchFiles(str(a.query), str(a.root) || undefined);
      return {
        ok: true,
        summary: `${results.length} sonuç bulundu.`,
        data: results,
        content: results.map((r) => `${r.isDir ? '[K]' : '[D]'} ${r.path} (${humanSize(r.size)})`).join('\n') || 'Sonuç yok.',
      };
    },
  },
  {
    name: 'copy_path',
    label: 'Kopyala / taşı',
    description: 'Bir dosya veya klasörü kopyalar ya da taşır.',
    risk: 'moderate',
    capability: 'fileAccess',
    icon: 'copy',
    parameters: obj({ from: S('Kaynak yol'), to: S('Hedef yol'), move: B('true ise taşır, false ise kopyalar') }, ['from', 'to']),
    handler: async (a) => {
      const msg = copyPath(str(a.from), str(a.to), bool(a.move));
      return { ok: true, summary: msg };
    },
  },
  {
    name: 'make_directory',
    label: 'Klasör oluştur',
    description: 'Yeni bir klasör oluşturur (alt klasörler dahil).',
    risk: 'safe',
    capability: 'fileAccess',
    icon: 'folder-plus',
    parameters: obj({ path: S('Oluşturulacak klasör yolu') }, ['path']),
    handler: async (a) => ({ ok: true, summary: makeDir(str(a.path)) }),
  },
  {
    name: 'delete_path',
    label: 'Sil',
    description: 'Dosya veya klasörü çöp kutusuna taşır (kalıcı silmez).',
    risk: 'dangerous',
    capability: 'fileAccess',
    icon: 'trash-2',
    parameters: obj({ path: S('Silinecek dosya veya klasör yolu') }, ['path']),
    confirm: (a) => ({ title: 'Silinsin mi?', detail: `"${str(a.path)}" çöp kutusuna taşınacak.` }),
    handler: async (a) => {
      const target = assertPathAllowed(resolvePath(str(a.path)), { write: true });
      if (!fs.existsSync(target)) return { ok: false, summary: `Bulunamadı: ${target}` };
      const msg = await trashPath(target);
      return { ok: true, summary: msg };
    },
  },
  {
    name: 'open_path',
    label: 'Dosya/klasör aç',
    description: 'Bir dosyayı varsayılan uygulamasıyla veya bir klasörü dosya yöneticisinde açar.',
    risk: 'safe',
    capability: 'fileAccess',
    icon: 'folder',
    parameters: obj({ path: S('Açılacak yol'), reveal: B('true ise klasörde göster') }, ['path']),
    handler: async (a) => {
      const target = assertPathAllowed(resolvePath(str(a.path)));
      const msg = bool(a.reveal) ? await showInFolder(target) : await openPath(target);
      return { ok: true, summary: msg };
    },
  },
  {
    name: 'analyze_document',
    label: 'Belge analizi',
    description:
      'PDF, DOCX, metin, görsel veya tablo dosyasını yapay zekâ ile analiz eder: özetler, soruları yanıtlar, çevirir. Taranmış PDF ve görseller desteklenir.',
    risk: 'safe',
    capability: 'fileAccess',
    icon: 'file-search',
    parameters: obj(
      {
        path: S('Dosya yolu'),
        question: S('Belge hakkında soru veya görev, ör. "özetle", "ana fikirleri çıkar", "3. sayfadaki tabloyu açıkla"'),
      },
      ['path'],
    ),
    handler: async (a, ctx) => {
      const file = assertPathAllowed(resolvePath(str(a.path)));
      if (!fs.existsSync(file)) return { ok: false, summary: `Dosya bulunamadı: ${file}` };
      const cfg = getConfig();
      const question = str(a.question) || 'Bu belgeyi Türkçe, maddeli ve kısa biçimde özetle.';
      const st = fs.statSync(file);
      const mime = mimeFor(file);

      if (isImage(file) || mime === 'application/pdf' || mime.startsWith('audio/') || mime.startsWith('video/')) {
        const { data } = readBase64(file, 18);
        const res = await generateChat({
          model: cfg.models.vision,
          purpose: 'vision',
          requireVision: true,
          temperature: 0.3,
          maxOutputTokens: 4096,
          signal: ctx.signal,
          contents: [
            {
              role: 'user',
              parts: [
                { text: `${question}\n\nDosya: ${path.basename(file)} (${humanSize(st.size)})` },
                { inlineData: { mimeType: mime, data } },
              ],
            },
          ],
        });
        addFileRecord({ name: path.basename(file), path: file, mime, size: st.size });
        return { ok: true, summary: `${path.basename(file)} analiz edildi.`, content: res.text };
      }

      const extracted = extractText(file, 90000);
      if (!extracted.text) return { ok: false, summary: 'Belgeden metin çıkarılamadı. Görsel tabanlı olabilir; PDF için analiz yine de denenebilir.' };
      const res = await generateChat({
        model: cfg.models.brain,
        purpose: 'brain',
        temperature: 0.3,
        maxOutputTokens: 4096,
        signal: ctx.signal,
        contents: [
          {
            role: 'user',
            parts: [
              { text: `${question}\n\n--- BELGE: ${path.basename(file)} ---\n${extracted.text}` },
            ],
          },
        ],
      });
      addFileRecord({ name: path.basename(file), path: file, mime, size: st.size, summary: res.text.slice(0, 500) });
      return { ok: true, summary: `${path.basename(file)} analiz edildi.`, content: res.text };
    },
  },
  {
    name: 'translate_file',
    label: 'Dosya çevirisi',
    description: 'Bir metin/PDF/DOCX dosyasını başka bir dile çevirir ve yeni bir dosya olarak kaydeder.',
    risk: 'safe',
    capability: 'fileAccess',
    icon: 'languages',
    parameters: obj({ path: S('Kaynak dosya'), target_language: S('Hedef dil, ör. "İngilizce", "Almanca"'), output_path: S('İsteğe bağlı çıktı yolu') }, ['path', 'target_language']),
    handler: async (a, ctx) => {
      const r = await translateFile(str(a.path), str(a.target_language), str(a.output_path) || undefined, ctx.signal);
      return { ok: true, summary: r.summary, data: r };
    },
  },
  {
    name: 'save_note',
    label: 'Not kaydet',
    description: 'Bir notu Belgeler/Falcon Notları klasörüne Markdown dosyası olarak kaydeder.',
    risk: 'safe',
    capability: 'fileAccess',
    icon: 'notebook-pen',
    parameters: obj({ title: S('Not başlığı'), content: S('Not içeriği (Markdown olabilir)') }, ['title', 'content']),
    handler: async (a) => {
      const dir = path.join(documentsDir(), 'Falcon Notları');
      const name = safeFileName(str(a.title), '.md');
      const file = path.join(dir, name.endsWith('.md') ? name : `${name}.md`);
      const stamp = new Date().toLocaleString('tr-TR');
      const result = writeTextFile(file, `# ${str(a.title)}\n\n_${stamp}_\n\n${str(a.content)}\n`);
      addFileRecord({ name: path.basename(result.file), path: result.file, mime: 'text/markdown', size: result.bytes });
      return { ok: true, summary: `Not kaydedildi: ${result.file}`, data: result };
    },
  },

  /* ---------------------------- Sistem ----------------------------- */
  {
    name: 'system_info',
    label: 'Sistem bilgisi',
    description: 'Donanım, işletim sistemi, bellek, pil, disk ve ekran bilgilerini verir. Tarih/saat soruları için de kullan.',
    risk: 'safe',
    capability: 'core',
    icon: 'monitor',
    parameters: obj({}),
    handler: async () => {
      const info = await import('./system').then((m) => m.getSystemInfo());
      return {
        ok: true,
        summary: `${info.platformLabel} ${info.osVersion} · CPU %${Math.round(100 - info.memUsedPct)} boş bellek`,
        data: info,
        content: [
          `Tarih/saat: ${new Date().toLocaleString('tr-TR')}`,
          `Sistem: ${info.platformLabel} (${info.osVersion}), ${info.arch}`,
          `Kullanıcı: ${info.user} · Makine: ${info.hostname}`,
          `CPU: ${info.cpu} (${info.cores} çekirdek)`,
          `Bellek: ${info.totalMemGb} GB (kullanım %${info.memUsedPct})`,
          info.battery ? `Pil: %${info.battery.percent} ${info.battery.charging ? '(şarjda)' : ''}` : '',
          info.volumes.length ? `Diskler: ${info.volumes.map((v) => `${v.mount} ${v.freeGb}/${v.totalGb} GB boş`).join(', ')}` : '',
          `Çalışma süresi: ${Math.floor(info.uptimeSec / 3600)} saat`,
        ]
          .filter(Boolean)
          .join('\n'),
      };
    },
  },
  {
    name: 'system_power',
    label: 'Güç işlemleri',
    description:
      'Bilgisayarı kapatır, yeniden başlatır, uyutur, kilitler veya oturumu kapatır. Kullanıcı "bilgisayarı kapat" dediğinde action="shutdown" kullan. Varsayılan 30 saniye gecikme vardır ki kullanıcı iptal edebilsin.',
    risk: 'dangerous',
    capability: 'power',
    icon: 'power',
    parameters: obj(
      {
        action: { type: 'string', enum: ['shutdown', 'restart', 'sleep', 'lock', 'logout', 'cancel'], description: 'Yapılacak işlem' },
        delay_seconds: N('Kapatma/yeniden başlatma için gecikme (varsayılan 30)'),
      },
      ['action'],
    ),
    confirm: (a) => ({
      title: 'Güç işlemi onayı',
      detail: `${str(a.action)} işlemi uygulanacak${a.delay_seconds ? ` (${num(a.delay_seconds)} saniye gecikmeli)` : ''}.`,
    }),
    handler: async (a) => {
      const action = str(a.action) as PowerAction;
      const delay = num(a.delay_seconds, 30);
      const msg = await powerAction(action, delay);
      return { ok: true, summary: msg };
    },
  },
  {
    name: 'set_volume',
    label: 'Ses seviyesi',
    description: 'Sistem ses seviyesini yüzde olarak ayarlar.',
    risk: 'safe',
    capability: 'core',
    icon: 'volume-2',
    parameters: obj({ level: N('0-100 arası ses seviyesi') }, ['level']),
    handler: async (a) => ({ ok: true, summary: await setVolume(num(a.level, 50)) }),
  },
  {
    name: 'set_muted',
    label: 'Sesi kapat/aç',
    description: 'Sistemi sessize alır veya sesi geri açar.',
    risk: 'safe',
    capability: 'core',
    icon: 'volume-x',
    parameters: obj({ muted: B('true ise sessize al') }, ['muted']),
    handler: async (a) => ({ ok: true, summary: await setMuted(bool(a.muted)) }),
  },
  {
    name: 'media_control',
    label: 'Medya kontrolü',
    description: 'Müzik/video oynatma, duraklatma, sonraki/önceki parça.',
    risk: 'safe',
    capability: 'core',
    icon: 'play',
    parameters: obj({ action: { type: 'string', enum: ['play_pause', 'next', 'previous', 'stop', 'volume_up', 'volume_down'] } }, ['action']),
    handler: async (a) => ({ ok: true, summary: await mediaControl(str(a.action) as MediaAction) }),
  },
  {
    name: 'set_brightness',
    label: 'Parlaklık',
    description: 'Ekran parlaklığını yüzde olarak ayarlar (destekleyen cihazlarda).',
    risk: 'safe',
    capability: 'core',
    icon: 'sun',
    parameters: obj({ level: N('0-100 arası parlaklık') }, ['level']),
    handler: async (a) => ({ ok: true, summary: await setBrightness(num(a.level, 70)) }),
  },
  {
    name: 'toggle_dark_mode',
    label: 'Karanlık mod',
    description: 'Sistem görünümünü karanlık/aydınlık arasında değiştirir.',
    risk: 'safe',
    capability: 'core',
    icon: 'moon',
    parameters: obj({}),
    handler: async () => ({ ok: true, summary: await toggleDarkMode() }),
  },
  {
    name: 'empty_trash',
    label: 'Çöp kutusunu boşalt',
    description: 'Geri dönüşüm kutusunu/çöp kutusunu boşaltır.',
    risk: 'dangerous',
    capability: 'core',
    icon: 'trash',
    parameters: obj({}),
    confirm: () => ({ title: 'Çöp kutusu boşaltılsın mı?', detail: 'Bu işlem geri alınamaz.' }),
    handler: async () => ({ ok: true, summary: await emptyTrash() }),
  },
  {
    name: 'capture_screen',
    label: 'Ekran görüntüsü',
    description:
      'Ekran görüntüsü alır. question verilirse görüntüyü yapay zekâ ile analiz eder (ekranda ne olduğunu anlatır).',
    risk: 'moderate',
    capability: 'core',
    icon: 'monitor-dot',
    parameters: obj({ question: S('İsteğe bağlı: ekran görüntüsüyle ilgili soru') }),
    handler: async (a, ctx) => {
      const shot = await takeScreenshot();
      if (!str(a.question)) {
        return { ok: true, summary: `Ekran görüntüsü alındı: ${shot.file}`, data: { file: shot.file, width: shot.width, height: shot.height } };
      }
      const cfg = getConfig();
      const res = await generateChat({
        model: cfg.models.vision,
        purpose: 'vision',
        requireVision: true,
        temperature: 0.2,
        maxOutputTokens: 2048,
        signal: ctx.signal,
        contents: [
          {
            role: 'user',
            parts: [
              { text: `Bu ekran görüntüsüyle ilgili: ${str(a.question)}\nTürkçe, kısa ve net yanıtla.` },
              { inlineData: { mimeType: shot.mime, data: shot.base64 } },
            ],
          },
        ],
      });
      return { ok: true, summary: `Ekran analiz edildi: ${shot.file}`, content: res.text, data: { file: shot.file } };
    },
  },
  {
    name: 'read_clipboard',
    label: 'Panoyu oku',
    description: 'Panodaki metni okur.',
    risk: 'safe',
    capability: 'clipboard',
    icon: 'clipboard',
    parameters: obj({}),
    handler: async () => {
      const text = await readClipboard();
      return { ok: true, summary: text ? `Panoda ${text.length} karakter var.` : 'Pano boş.', content: text };
    },
  },
  {
    name: 'write_clipboard',
    label: 'Panoya yaz',
    description: 'Metni panoya kopyalar.',
    risk: 'safe',
    capability: 'clipboard',
    icon: 'clipboard-copy',
    parameters: obj({ text: S('Panoya kopyalanacak metin') }, ['text']),
    handler: async (a) => {
      await writeClipboard(str(a.text));
      return { ok: true, summary: `${str(a.text).length} karakter panoya kopyalandı.` };
    },
  },
  {
    name: 'open_url',
    label: 'Web sitesi aç',
    description: 'Varsayılan tarayıcıda bir web sitesi açar.',
    risk: 'safe',
    capability: 'network',
    icon: 'globe',
    parameters: obj({ url: S('Açılacak adres') }, ['url']),
    handler: async (a) => ({ ok: true, summary: await openUrl(str(a.url)) }),
  },
  {
    name: 'notify_user',
    label: 'Bildirim gönder',
    description: 'Masaüstü bildirimi gösterir.',
    risk: 'safe',
    capability: 'core',
    icon: 'bell',
    parameters: obj({ title: S('Başlık'), body: S('İçerik') }, ['title', 'body']),
    handler: async (a) => {
      if (Notification.isSupported()) {
        new Notification({ title: str(a.title, 'Falcon'), body: str(a.body), icon: undefined }).show();
      }
      return { ok: true, summary: 'Bildirim gönderildi.' };
    },
  },
  {
    name: 'run_command',
    label: 'Terminal komutu',
    description:
      'Bilgisayarda bir kabuk komutu çalıştırır ve çıktısını döndürür. Yazılım kurulumu, git işlemleri, dosya işlemleri, sistem bilgisi için kullan. Yıkıcı komutlar engellenir.',
    risk: 'dangerous',
    capability: 'terminal',
    icon: 'terminal',
    parameters: obj(
      {
        command: S('Çalıştırılacak komut (PowerShell/Windows veya sh/Linux-macOS)'),
        cwd: S('Komutun çalıştırılacağı klasör'),
        timeout_seconds: N('Zaman aşımı (varsayılan 60)'),
      },
      ['command'],
    ),
    confirm: (a) => ({ title: 'Terminal komutu çalıştırılsın mı?', detail: str(a.command).slice(0, 400) }),
    handler: async (a) => {
      const command = str(a.command);
      assertCommandAllowed(command);
      const cwd = str(a.cwd) ? assertPathAllowed(resolvePath(str(a.cwd))) : homeDir();
      const timeout = Math.min(Math.max(num(a.timeout_seconds, 60), 1), 600) * 1000;
      const result = isWindows()
        ? await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { timeout, cwd })
        : await run('/bin/sh', ['-c', command], { timeout, cwd, shell: false });
      const out = redact((result.stdout || '') + (result.stderr ? `\n[stderr]\n${result.stderr}` : '')).trim();
      return {
        ok: result.code === 0,
        summary: result.code === 0 ? `Komut tamamlandı (${cwd}).` : `Komut hata koduyla bitti: ${result.code}`,
        content: out.slice(0, 20000) || '(çıktı yok)',
        data: { code: result.code, cwd },
      };
    },
  },

  /* ------------------------- Bilgi ve hafıza ------------------------ */
  {
    name: 'web_search',
    label: 'Web araması',
    description: 'Google üzerinden güncel bilgi arar. Haber, fiyat, hava durumu, güncel olaylar için kullan.',
    risk: 'safe',
    capability: 'network',
    icon: 'search',
    parameters: obj({ query: S('Arama sorgusu') }, ['query']),
    handler: async (a, ctx) => {
      const { searchWeb } = await import('../core/gemini');
      const answer = await searchWeb(str(a.query), { signal: ctx.signal });
      return {
        ok: true,
        summary: `"${str(a.query)}" için ${answer.sources.length} kaynak bulundu.`,
        content: answer.text,
        data: { sources: answer.sources.slice(0, 8), model: answer.model },
      };
    },
  },
  {
    name: 'news_digest',
    label: 'Gündem özeti',
    description:
      'Belirtilen konularda son 24 saatteki önemli haberleri toplar ve Türkçe özetler. Kullanıcı "gündem", "haberler", "bugün ne oldu" derse kullan.',
    risk: 'safe',
    capability: 'network',
    icon: 'newspaper',
    parameters: obj({ topics: { type: 'array', items: { type: 'string' }, description: 'Konular; boşsa ayarlardaki konular kullanılır' } }),
    handler: async (a, ctx) => {
      const topics = Array.isArray(a.topics) ? (a.topics as string[]) : undefined;
      const digest = await buildDigest({ topics });
      void ctx;
      return {
        ok: true,
        summary: `Gündem özeti hazır: ${digest.items.length} gelişme.`,
        content: digestToText(digest),
        data: digest,
      };
    },
  },
  {
    name: 'remember',
    label: 'Hatırla (hafızaya kaydet)',
    description:
      'Kullanıcı hakkında kalıcı bilgi kaydeder: tercihler, isimler, alışkanlıklar, talimatlar. Kullanıcı "bunu hatırla" derse kullan.',
    risk: 'safe',
    capability: 'core',
    icon: 'brain',
    parameters: obj({ text: S('Hatırlanacak bilgi'), tags: { type: 'array', items: { type: 'string' }, description: 'Etiketler' } }, ['text']),
    handler: async (a) => {
      const entry = addMemory(str(a.text), Array.isArray(a.tags) ? (a.tags as string[]) : [], 'agent');
      return { ok: true, summary: 'Hafızaya kaydedildi.', data: entry };
    },
  },
  {
    name: 'recall',
    label: 'Hafızadan hatırla',
    description: 'Daha önce kaydedilen bilgileri arar.',
    risk: 'safe',
    capability: 'core',
    icon: 'archive',
    parameters: obj({ query: S('Aranacak kelime; boşsa tüm hafıza döner') }),
    handler: async (a) => {
      const q = str(a.query).toLocaleLowerCase('tr-TR');
      const all = listMemories();
      const hits = q
        ? all.filter((m) => m.text.toLocaleLowerCase('tr-TR').includes(q) || m.tags.some((t) => t.toLocaleLowerCase('tr-TR').includes(q)))
        : all;
      return {
        ok: true,
        summary: `${hits.length} hatıra bulundu.`,
        data: hits.slice(0, 40),
        content: hits.map((m) => `- ${m.text}`).join('\n') || 'Hafızada kayıt yok.',
      };
    },
  },
  {
    name: 'add_task',
    label: 'Görev ekle',
    description: 'Yapılacaklar listesine görev ekler.',
    risk: 'safe',
    capability: 'core',
    icon: 'list-todo',
    parameters: obj(
      {
        title: S('Görev başlığı'),
        detail: S('Ayrıntı'),
        priority: { type: 'string', enum: ['low', 'normal', 'high'] },
        due_at: S('İsteğe bağlı ISO tarih, ör. 2026-05-01T14:00:00'),
      },
      ['title'],
    ),
    handler: async (a) => {
      const task = addTask({
        title: str(a.title),
        detail: str(a.detail),
        priority: (str(a.priority, 'normal') as 'low' | 'normal' | 'high'),
        dueAt: str(a.due_at) ? Date.parse(str(a.due_at)) || undefined : undefined,
      });
      return { ok: true, summary: `Görev eklendi: ${task.title}`, data: task };
    },
  },
  {
    name: 'list_tasks',
    label: 'Görevleri listele',
    description: 'Yapılacaklar listesini döndürür.',
    risk: 'safe',
    capability: 'core',
    icon: 'list-checks',
    parameters: obj({}),
    handler: async () => {
      const items = listTasks();
      return {
        ok: true,
        summary: `${items.filter((t) => !t.done).length} açık görev var.`,
        data: items,
        content: items.map((t) => `- [${t.done ? 'x' : ' '}] ${t.title}${t.priority === 'high' ? ' (acil)' : ''}`).join('\n') || 'Görev yok.',
      };
    },
  },
  {
    name: 'complete_task',
    label: 'Görevi tamamla',
    description: 'Bir görevi tamamlandı olarak işaretler (başlığa göre bulur).',
    risk: 'safe',
    capability: 'core',
    icon: 'check-check',
    parameters: obj({ title: S('Görev başlığı veya bir kısmı') }, ['title']),
    handler: async (a) => {
      const q = str(a.title).toLocaleLowerCase('tr-TR');
      const found = listTasks().find((t) => t.title.toLocaleLowerCase('tr-TR').includes(q));
      if (!found) return { ok: false, summary: `"${str(a.title)}" ile eşleşen görev bulunamadı.` };
      toggleTask(found.id, true);
      return { ok: true, summary: `Tamamlandı: ${found.title}` };
    },
  },
  {
    name: 'add_reminder',
    label: 'Hatırlatıcı kur',
    description:
      'Belirli bir saatte hatırlatma kurar. daily_time verilirse her gün tekrarlar. Kullanıcı "bana ... hatırlat" derse kullan.',
    risk: 'safe',
    capability: 'core',
    icon: 'alarm-clock',
    parameters: obj(
      {
        text: S('Hatırlatma metni'),
        at: S('Bir kerelik ISO tarih/saat, ör. 2026-05-01T09:30'),
        daily_time: S('Her gün tekrar için saat, ör. "09:00"'),
      },
      ['text'],
    ),
    handler: async (a) => {
      const at = str(a.at) ? Date.parse(str(a.at)) : undefined;
      const reminder = addReminder({ text: str(a.text), at: at && !Number.isNaN(at) ? at : undefined, dailyAt: str(a.daily_time) || undefined });
      const when = reminder.at
        ? new Date(reminder.at).toLocaleString('tr-TR')
        : reminder.dailyAt
          ? `her gün ${reminder.dailyAt}`
          : 'hatırlatıcı kaydedildi';
      return { ok: true, summary: `Hatırlatıcı kuruldu (${when}): ${reminder.text}`, data: reminder };
    },
  },
  {
    name: 'list_reminders',
    label: 'Hatırlatıcıları listele',
    description: 'Kurulu hatırlatıcıları listeler.',
    risk: 'safe',
    capability: 'core',
    icon: 'bell-ring',
    parameters: obj({}),
    handler: async () => {
      const items = listReminders();
      return {
        ok: true,
        summary: `${items.length} hatırlatıcı var.`,
        data: items,
        content:
          items
            .map((r) => `- ${r.text} (${r.at ? new Date(r.at).toLocaleString('tr-TR') : `her gün ${r.dailyAt}`})`)
            .join('\n') || 'Hatırlatıcı yok.',
      };
    },
  },
  {
    name: 'create_project',
    label: 'Proje oluştur',
    description: 'Falcon içinde yeni bir proje/çalışma alanı oluşturur.',
    risk: 'safe',
    capability: 'core',
    icon: 'folder-kanban',
    parameters: obj({ name: S('Proje adı'), description: S('Açıklama') }, ['name']),
    handler: async (a) => {
      const project = createProject({ name: str(a.name), description: str(a.description) });
      return { ok: true, summary: `Proje oluşturuldu: ${project.name}`, data: project };
    },
  },
  {
    name: 'list_projects',
    label: 'Projeleri listele',
    description: 'Falcon projelerini listeler.',
    risk: 'safe',
    capability: 'core',
    icon: 'layout-grid',
    parameters: obj({}),
    handler: async () => {
      const items = listProjects();
      return { ok: true, summary: `${items.length} proje var.`, data: items, content: items.map((p) => `- ${p.name}: ${p.description}`).join('\n') };
    },
  },
  {
    name: 'delegate_task',
    label: 'Uzman ajana devret',
    description:
      'İşi uzman bir alt ajana devreder: "Arastirmaci" (web araştırması, kaynaklı bilgi), "Kodcu" (kod yazma, hata ayıklama), "Analist" (belge/veri analizi), "Planlayici" (plan, takvim, adım adım yol haritası). Karmaşık görevlerde kullan.',
    risk: 'safe',
    capability: 'core',
    icon: 'users',
    parameters: obj(
      {
        agent: { type: 'string', enum: ['Araştırmacı', 'Kodcu', 'Analist', 'Planlayıcı'], description: 'Alt ajan' },
        task: S('Alt ajana verilecek açık ve ayrıntılı görev'),
        context: S('İsteğe bağlı ek bağlam'),
      },
      ['agent', 'task'],
    ),
    handler: async (a, ctx) => {
      const record = await delegate(str(a.agent), str(a.task), str(a.context), {
        signal: ctx.signal,
        conversationId: ctx.conversationId,
        deps: { executeTool, toolDefinitions },
      });
      return { ok: record.ok, summary: `${record.agent} görevi tamamladı (${Math.round(record.durationMs / 1000)} sn).`, content: record.result };
    },
  },
];

/* ------------------------------------------------------------------ */
/* Yardımcılar                                                         */
/* ------------------------------------------------------------------ */

function addFileExists(_p: string): boolean {
  // Dosya kayıtları her okumada çoğalmasın; kayıt işlemi çağıran tarafta yapılır.
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/* ------------------------------------------------------------------ */
/* Pencere / klavye denetimi                                           */
/* ------------------------------------------------------------------ */

export async function activateWindow(target: string): Promise<string> {
  const name = target.trim();
  if (!name) throw new Error('Pencere adı boş.');
  if (isWindows()) {
    const script = `
$name = '${name.replace(/'/g, "''")}'
$wshell = New-Object -ComObject WScript.Shell
$p = Get-Process | Where-Object { $_.MainWindowTitle -ne "" -and ($_.MainWindowTitle -like "*$name*" -or $_.ProcessName -like "*$name*") } | Select-Object -First 1
if (-not $p) { "bulunamadi" } else { $wshell.AppActivate($p.Id) | Out-Null; "ok:" + $p.ProcessName }`;
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 15000 });
    if (/bulunamadi/.test(r.stdout)) throw new Error(`"${name}" penceresi bulunamadı. Önce uygulamayı açın.`);
    return `"${name}" penceresi öne getirildi.`;
  }
  if (isMac()) {
    const r = await run(
      '/usr/bin/osascript',
      ['-e', `tell application "System Events" to set frontmost of (first process whose name contains "${name}") to true`],
      { timeout: 15000 },
    );
    if (r.code !== 0) throw new Error(`"${name}" uygulaması bulunamadı veya odaklanamadı.`);
    return `"${name}" öne getirildi.`;
  }
  const r = await run('/bin/sh', ['-c', `wmctrl -a "${name}" 2>/dev/null || xdotool search --name "${name}" windowactivate 2>/dev/null`], { timeout: 10000 });
  if (r.code !== 0) throw new Error(`"${name}" penceresi bulunamadı (wmctrl/xdotool gerekli).`);
  return `"${name}" penceresi öne getirildi.`;
}

export async function typeText(text: string, opts: { submit?: boolean; clearFirst?: boolean } = {}): Promise<string> {
  await writeClipboard(text);
  await sleep(180);
  if (isWindows()) {
    const seq = `${opts.clearFirst ? '^a' : ''}^v${opts.submit ? '{ENTER}' : ''}`;
    const script = `Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds 120; [System.Windows.Forms.SendKeys]::SendWait('${seq}')`;
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 20000 });
    if (r.code !== 0) throw new Error(`Metin yazılamadı: ${r.stderr.slice(0, 200)}`);
    return `${text.length} karakter yazıldı (panodan yapıştırıldı).`;
  }
  if (isMac()) {
    const script = `${opts.clearFirst ? 'keystroke "a" using command down\n' : ''}keystroke "v" using command down\n${opts.submit ? 'key code 36\n' : ''}`;
    const r = await run('/usr/bin/osascript', ['-e', `tell application "System Events"\n${script}end tell`], { timeout: 15000 });
    if (r.code !== 0) throw new Error('Metin yazılamadı. Erişilebilirlik izni gerekebilir (Sistem Ayarları → Gizlilik → Erişilebilirlik).');
    return `${text.length} karakter yazıldı.`;
  }
  const r = await run('/bin/sh', ['-c', `xdotool key ${opts.clearFirst ? 'ctrl+a ' : ''}ctrl+v ${opts.submit ? 'Return' : ''}`], { timeout: 10000 });
  if (r.code !== 0) throw new Error('Metin yazılamadı (xdotool gerekli: sudo apt install xdotool).');
  return `${text.length} karakter yazıldı.`;
}

export async function pressKeys(keys: string): Promise<string> {
  const combo = keys.trim().toLowerCase();
  if (isWindows()) {
    const map: Record<string, string> = {
      enter: '{ENTER}', tab: '{TAB}', esc: '{ESC}', escape: '{ESC}', space: ' ', backspace: '{BACKSPACE}',
      delete: '{DELETE}', up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}', home: '{HOME}', end: '{END}',
      pageup: '{PGUP}', pagedown: '{PGDN}', f1: '{F1}', f2: '{F2}', f3: '{F3}', f4: '{F4}', f5: '{F5}', f6: '{F6}',
      f7: '{F7}', f8: '{F8}', f9: '{F9}', f10: '{F10}', f11: '{F11}', f12: '{F12}', win: '{LWIN}', printscreen: '{PRTSC}',
    };
    const parts = combo.split('+');
    const key = parts.pop() ?? '';
    const mods = parts.map((m) => (m === 'ctrl' || m === 'control' ? '^' : m === 'alt' ? '%' : m === 'shift' ? '+' : m === 'win' || m === 'meta' ? '' : '')).join('');
    const seq = `${mods}${map[key] ?? key}`;
    const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${seq}')`;
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 15000 });
    if (r.code !== 0) throw new Error(`Tuş gönderilemedi: ${r.stderr.slice(0, 200)}`);
    return `${keys} tuşlarına basıldı.`;
  }
  if (isMac()) {
    const map: Record<string, string> = { enter: 'return', esc: 'escape', ctrl: 'control', win: 'command', meta: 'command', alt: 'option' };
    const parts = combo.split('+').map((p) => map[p] ?? p);
    const key = parts.pop() ?? '';
    const using = parts.length ? ` using {${parts.map((p) => `${p} down`).join(', ')}}` : '';
    const r = await run('/usr/bin/osascript', ['-e', `tell application "System Events" to keystroke "${key}"${using}`], { timeout: 10000 });
    if (r.code !== 0) throw new Error('Tuş gönderilemedi (Erişilebilirlik izni gerekli).');
    return `${keys} tuşlarına basıldı.`;
  }
  const map: Record<string, string> = { enter: 'Return', esc: 'Escape', win: 'Super_L', meta: 'Super_L', ctrl: 'ctrl', alt: 'alt', shift: 'shift' };
  const parts = combo.split('+').map((p) => map[p] ?? p);
  const r = await run('/bin/sh', ['-c', `xdotool key ${parts.join('+')}`], { timeout: 10000 });
  if (r.code !== 0) throw new Error('Tuş gönderilemedi (xdotool gerekli).');
  return `${keys} tuşlarına basıldı.`;
}

/* ------------------------------------------------------------------ */
/* Çalıştırıcı                                                         */
/* ------------------------------------------------------------------ */

export function toolDefinitions(): FunctionDeclaration[] {
  return TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}

export function toolCatalog(): { name: string; label: string; description: string; risk: ToolRisk; icon: string; capability: string }[] {
  return TOOLS.map((t) => ({
    name: t.name,
    label: t.label,
    description: t.description,
    risk: t.risk,
    icon: t.icon,
    capability: t.capability,
  }));
}

export function getTool(name: string): FalconTool | undefined {
  return TOOLS.find((t) => t.name === name);
}

function capabilityError(tool: FalconTool): string {
  const cfg = getConfig();
  if (tool.capability === 'core') return '';
  const enabled = Boolean(cfg.permissions[tool.capability as keyof PermissionSettings]);
  if (enabled) return '';
  const labels: Record<string, string> = {
    fileAccess: 'Dosya erişimi',
    appControl: 'Uygulama denetimi',
    power: 'Güç işlemleri',
    terminal: 'Terminal',
    clipboard: 'Pano',
    network: 'Ağ erişimi',
    camera: 'Kamera',
    microphone: 'Mikrofon',
  };
  return `${labels[tool.capability] ?? tool.capability} izni kapalı. Ayarlar → İzinler ve Güvenlik bölümünden açabilirsiniz.`;
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const started = Date.now();
  const tool = getTool(name);
  if (!tool) {
    return { ok: false, summary: `Bilinmeyen araç: ${name}` };
  }

  const capErr = capabilityError(tool);
  if (capErr) {
    audit({ tool: name, args, outcome: 'denied', summary: capErr, agent: ctx.agent, durationMs: Date.now() - started });
    return { ok: false, summary: capErr };
  }

  const confirm = tool.confirm?.(args) ?? null;
  if (confirm) {
    const approved = await requestConfirmation(tool.name, confirm.title, confirm.detail, tool.risk, ctx.agent);
    if (!approved) {
      audit({ tool: name, args, outcome: 'denied', summary: 'Kullanıcı onay vermedi', agent: ctx.agent, durationMs: Date.now() - started });
      return { ok: false, summary: 'Kullanıcı bu işlemi onaylamadı; işlem yapılmadı. Kullanıcıya nedenini sor.' };
    }
  }

  try {
    log.info(`araç çalışıyor: ${name}`, JSON.stringify(args).slice(0, 400));
    const result = await tool.handler(args, ctx);
    audit({
      tool: name,
      args,
      outcome: result.ok ? 'ok' : 'error',
      summary: result.summary.slice(0, 300),
      agent: ctx.agent,
      durationMs: Date.now() - started,
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`araç hatası: ${name}`, message);
    audit({ tool: name, args, outcome: 'error', summary: message.slice(0, 300), agent: ctx.agent, durationMs: Date.now() - started });
    return { ok: false, summary: `Hata: ${message}` };
  }
}

export function toolLabel(name: string): string {
  return getTool(name)?.label ?? name;
}

export function toolRisk(name: string): ToolRisk {
  return getTool(name)?.risk ?? 'safe';
}

export function toolIcon(name: string): string {
  return getTool(name)?.icon ?? 'wrench';
}

/** Kullanıcı için araç sayısı / listesi */
export function toolCount(): number {
  return TOOLS.length;
}

export { uid, expandHome, statPath, defaultSaveDir, downloadsDir, shell };

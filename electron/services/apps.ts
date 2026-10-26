import fs from 'node:fs';
import path from 'node:path';
import { shell } from 'electron';
import { log } from '../core/logger';
import { isMac, isWindows } from '../core/security';
import { desktopDir, downloadsDir } from '../core/paths';
import type { AppInfo, RunningProcess } from '../../shared/types';
import { run } from './system';

/**
 * Uygulama denetimi: açma, kapatma, çalışanları listeleme.
 * Platforma özgü hızlı yollar (Start-Process, open -a, gtk-launch) ve
 * yaygın uygulamalar için Türkçe/İngilizce takma ad tablosu içerir.
 */

/** Yaygın uygulamalar: anahtar → { win, mac, linux } */
const KNOWN_APPS: Record<string, { aliases: string[]; win?: string; mac?: string; linux?: string[]; url?: string }> = {
  tarayici: {
    aliases: ['tarayıcı', 'browser', 'internet', 'web tarayıcı'],
    win: 'msedge.exe',
    mac: 'Safari',
    linux: ['xdg-open https://www.google.com', 'chromium', 'google-chrome', 'firefox'],
    url: 'https://www.google.com',
  },
  chrome: { aliases: ['google chrome', 'krom'], win: 'chrome.exe', mac: 'Google Chrome', linux: ['google-chrome', 'chromium'] },
  edge: { aliases: ['microsoft edge'], win: 'msedge.exe', mac: 'Microsoft Edge', linux: ['microsoft-edge'] },
  firefox: { aliases: ['mozila', 'mozillafirefox'], win: 'firefox.exe', mac: 'Firefox', linux: ['firefox'] },
  operagx: { aliases: ['opera', 'opera gx'], win: 'opera.exe', mac: 'Opera', linux: ['opera'] },
  brave: { aliases: [], win: 'brave.exe', mac: 'Brave Browser', linux: ['brave-browser'] },
  kod: {
    aliases: ['vscode', 'vs code', 'visual studio code', 'visual studio', 'kod editörü'],
    win: 'code.exe',
    mac: 'Visual Studio Code',
    linux: ['code', 'codium'],
  },
  cursor: { aliases: [], win: 'Cursor.exe', mac: 'Cursor', linux: ['cursor'] },
  terminal: {
    aliases: ['komut istemi', 'cmd', 'powershell', 'konsol', 'shell'],
    win: 'wt.exe',
    mac: 'Terminal',
    linux: ['gnome-terminal', 'konsole', 'xfce4-terminal', 'x-terminal-emulator'],
  },
  cmd: { aliases: ['komut satırı', 'command prompt'], win: 'cmd.exe' },
  powershell: { aliases: ['pwsh'], win: 'powershell.exe', mac: 'Terminal', linux: ['pwsh'] },
  dosya: {
    aliases: ['dosya yöneticisi', 'explorer', 'gezgin', 'file manager', 'finder'],
    win: 'explorer.exe',
    mac: 'Finder',
    linux: ['nautilus', 'dolphin', 'thunar', 'nemo'],
  },
  not: { aliases: ['notepad', 'not defteri', 'metin editörü'], win: 'notepad.exe', mac: 'TextEdit', linux: ['gedit', 'kate', 'mousepad'] },
  hesapla: { aliases: ['hesap makinesi', 'calculator', 'calc'], win: 'calc.exe', mac: 'Calculator', linux: ['gnome-calculator', 'kcalc'] },
  ayarlar: { aliases: ['settings', 'sistem ayarları'], win: 'ms-settings:', mac: 'System Settings', linux: ['gnome-control-center'] },
  spotify: { aliases: ['müzik', 'music'], win: 'spotify.exe', mac: 'Spotify', linux: ['spotify'] },
  discord: { aliases: ['diskor'], win: 'discord.exe', mac: 'Discord', linux: ['discord'] },
  whatsapp: { aliases: ['vat sap', 'vatsap'], win: 'WhatsApp.exe', mac: 'WhatsApp', linux: ['whatsapp-for-linux'] },
  telegram: { aliases: ['telgraf'], win: 'Telegram.exe', mac: 'Telegram', linux: ['telegram-desktop'] },
  steam: { aliases: ['oyun platformu'], win: 'steam.exe', mac: 'Steam', linux: ['steam'] },
  obs: { aliases: ['obs studio'], win: 'obs64.exe', mac: 'OBS', linux: ['obs'] },
  telegramweb: { aliases: [], url: 'https://web.telegram.org' },
  gmail: { aliases: ['eposta', 'e-posta', 'mail', 'posta'], url: 'https://mail.google.com' },
  youtube: { aliases: ['yutup'], url: 'https://www.youtube.com' },
  netflix: { aliases: [], url: 'https://www.netflix.com' },
  gemini: { aliases: ['yapay zeka', 'ai studio', 'aistudio'], url: 'https://aistudio.google.com' },
  github: { aliases: ['githup'], url: 'https://github.com' },
  gundem: {
    aliases: ['haberler', 'haber', 'news', 'gündem'],
    url: 'https://news.google.com/?hl=tr&gl=TR&ceid=TR:tr',
  },
  takvim: {
    aliases: ['calendar', 'google takvim'],
    win: 'outlookcal:',
    mac: 'Calendar',
    linux: ['gnome-calendar'],
    url: 'https://calendar.google.com',
  },
  word: { aliases: ['microsoft word'], win: 'winword.exe', mac: 'Microsoft Word' },
  excel: { aliases: ['microsoft excel', 'tablo'], win: 'excel.exe', mac: 'Microsoft Excel' },
  powerpoint: { aliases: ['sunum', 'power point', 'microsoft powerpoint'], win: 'powerpnt.exe', mac: 'Microsoft PowerPoint' },
  paint: { aliases: ['boya', 'çizim'], win: 'mspaint.exe', mac: 'Preview', linux: ['krita', 'gimp'] },
  fotograf: { aliases: ['fotoğraflar', 'resim görüntüleyici', 'photos'], win: 'ms-photos:', mac: 'Photos', linux: ['eog'] },
  ekranal: { aliases: ['ekran alıntısı', 'screenshot', 'snip'], win: 'ms-screenclip:', mac: 'Screenshot' },
  mail: { aliases: [], win: 'outlook.exe', mac: 'Mail' },
  zoom: { aliases: ['zom'], win: 'Zoom.exe', mac: 'zoom.us', linux: ['zoom'] },
  teams: { aliases: ['microsoft teams'], win: 'Teams.exe', mac: 'Microsoft Teams', linux: ['teams'] },
  vlc: { aliases: ['video oynatıcı', 'media player'], win: 'vlc.exe', mac: 'VLC', linux: ['vlc'] },
  blender: { aliases: [], win: 'blender.exe', mac: 'Blender', linux: ['blender'] },
  unity: { aliases: [], win: 'Unity.exe', mac: 'Unity', linux: ['unityhub'] },
  epic: { aliases: ['epic games'], win: 'EpicGamesLauncher.exe', mac: 'Epic Games Launcher' },
  minecraft: { aliases: ['mayın craft'], win: 'MinecraftLauncher.exe', mac: 'Minecraft' },
};

function normalize(input: string): string {
  return input
    .toLocaleLowerCase('tr-TR')
    .replace(/\.exe$/i, '')
    .replace(/[^a-z0-9ğüşıöç ]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function lookup(query: string): { key: string; def: (typeof KNOWN_APPS)[string] } | null {
  const q = normalize(query);
  if (!q) return null;
  for (const [key, def] of Object.entries(KNOWN_APPS)) {
    if (q === normalize(key) || def.aliases.some((a) => normalize(a) === q)) return { key, def };
  }
  // kısmi eşleşme
  for (const [key, def] of Object.entries(KNOWN_APPS)) {
    if (normalize(key).includes(q) || q.includes(normalize(key))) return { key, def };
    if (def.aliases.some((a) => normalize(a).includes(q))) return { key, def };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Uygulama listesi                                                    */
/* ------------------------------------------------------------------ */

interface CacheEntry {
  at: number;
  apps: AppInfo[];
}
let cache: CacheEntry | null = null;

async function scanWindows(): Promise<AppInfo[]> {
  const script = `
$paths = @(
  "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs",
  "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs",
  "$env:USERPROFILE\\Desktop",
  "$env:PUBLIC\\Desktop"
)
$items = foreach ($p in $paths) {
  if (Test-Path $p) {
    Get-ChildItem -Path $p -Recurse -Include *.lnk,*.url -ErrorAction SilentlyContinue | ForEach-Object {
      [pscustomobject]@{ name = $_.BaseName; path = $_.FullName }
    }
  }
}
$items | Sort-Object name -Unique | ConvertTo-Json -Compress`;
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 45000 });
  try {
    const parsed = JSON.parse(r.stdout.trim() || '[]');
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return (list as { name: string; path: string }[]).map((x) => ({ name: x.name, path: x.path }));
  } catch {
    return [];
  }
}

async function scanMac(): Promise<AppInfo[]> {
  const dirs = ['/Applications', '/System/Applications', '/Applications/Utilities', path.join(require('node:os').homedir(), 'Applications')];
  const out: AppInfo[] = [];
  for (const dir of dirs) {
    try {
      for (const entry of fs.readdirSync(dir)) {
        if (entry.endsWith('.app')) out.push({ name: entry.replace(/\.app$/, ''), path: path.join(dir, entry) });
      }
    } catch {
      /* erişilemez */
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function scanLinux(): Promise<AppInfo[]> {
  const dirs = [
    '/usr/share/applications',
    '/usr/local/share/applications',
    path.join(process.env.HOME ?? '', '.local/share/applications'),
    '/var/lib/flatpak/exports/share/applications',
    '/var/lib/snapd/desktop/applications',
  ];
  const out: AppInfo[] = [];
  const seen = new Set<string>();
  for (const dir of dirs) {
    try {
      for (const entry of fs.readdirSync(dir)) {
        if (!entry.endsWith('.desktop')) continue;
        const full = path.join(dir, entry);
        try {
          const raw = fs.readFileSync(full, 'utf8');
          const nameMatch = raw.match(/^Name=(.+)$/m);
          const noDisplay = /^NoDisplay=true$/m.test(raw);
          if (noDisplay) continue;
          const name = nameMatch?.[1]?.trim() ?? entry.replace(/\.desktop$/, '');
          if (seen.has(name)) continue;
          seen.add(name);
          out.push({ name, path: full, id: entry.replace(/\.desktop$/, '') });
        } catch {
          /* yoksay */
        }
      }
    } catch {
      /* klasör yok */
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listApps(force = false): Promise<AppInfo[]> {
  if (!force && cache && Date.now() - cache.at < 10 * 60 * 1000) return cache.apps;
  let apps: AppInfo[] = [];
  try {
    if (isWindows()) apps = await scanWindows();
    else if (isMac()) apps = await scanMac();
    else apps = await scanLinux();
  } catch (err) {
    log.warn('uygulama listesi alınamadı', err);
  }
  cache = { at: Date.now(), apps };
  return apps;
}

/* ------------------------------------------------------------------ */
/* Uygulama açma                                                       */
/* ------------------------------------------------------------------ */

export interface OpenAppResult {
  opened: string;
  method: string;
}

/** Windows'ta yaygın kurulum klasörlerinde çalıştırılabilir dosya arar. */
async function findWindowsExe(name: string): Promise<string | null> {
  if (!isWindows()) return null;
  const safeName = name.replace(/[^\p{L}\p{N} ._-]/gu, '').trim();
  if (!safeName) return null;
  const script = `
$name = '${safeName.replace(/'/g, "''")}'
$roots = @(
  "$env:ProgramFiles",
  "\${env:ProgramFiles(x86)}",
  "$env:LOCALAPPDATA\Programs",
  "$env:LOCALAPPDATA",
  "$env:APPDATA",
  "C:\Program Files\WindowsApps"
) | Where-Object { $_ -and (Test-Path $_) }
foreach ($root in $roots) {
  $hit = Get-ChildItem -Path $root -Filter "*.exe" -Recurse -Depth 3 -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "*$name*" } |
    Sort-Object Length -Descending |
    Select-Object -First 1
  if ($hit) { $hit.FullName; break }
}`;
  const r = await run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { timeout: 20000 },
  );
  const found = r.stdout.trim().split('\n').pop()?.trim();
  return found && found.toLowerCase().endsWith('.exe') ? found : null;
}

/** Yol benzeri girdi mi? (dosya/klasör açmak için) */
function looksLikePath(input: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(input) || input.startsWith('/') || input.startsWith('~') || /^\.{1,2}[\\/]/.test(input);
}

export async function openApp(query: string, args?: string): Promise<OpenAppResult> {
  const raw = query.trim();
  if (!raw) throw new Error('Açılacak uygulama belirtilmedi.');
  const argList = args ? args.split(/\s+/).filter(Boolean) : [];

  if (looksLikePath(raw)) {
    const err = await shell.openPath(raw);
    if (err) throw new Error(`Açılamadı: ${err}`);
    return { opened: raw, method: 'shell.openPath' };
  }

  // 1) Bilinen uygulama / web sitesi
  const known = lookup(raw);
  if (known) {
    const { def } = known;
    if (isWindows() && def.win) {
      // .exe ise shell.openPath değil Start-Process kullanılır
      const r = await run(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', `Start-Process '${def.win.replace(/'/g, "''")}' -ErrorAction Stop`],
        { timeout: 20000 },
      );
      if (r.code === 0) return { opened: def.win, method: 'Start-Process' };
    } else if (isMac() && def.mac) {
      const r = await run('/usr/bin/open', ['-a', def.mac, ...argList]);
      if (r.code === 0) return { opened: def.mac, method: 'open -a' };
    } else if (def.linux?.length) {
      for (const cmd of def.linux) {
        const r = await run('/bin/sh', ['-c', `nohup ${cmd} >/dev/null 2>&1 &`], { timeout: 8000 });
        if (r.code === 0) return { opened: cmd, method: 'sh' };
      }
    }
    if (def.url) {
      await shell.openExternal(def.url);
      return { opened: def.url, method: 'shell.openExternal' };
    }
  }

  // 2) Başlat menüsü / Spotlight / .desktop üzerinden ara
  const apps = await listApps();
  const q = normalize(raw);
  const match =
    apps.find((a) => normalize(a.name) === q) ??
    apps.find((a) => normalize(a.name).includes(q)) ??
    apps.find((a) => q.includes(normalize(a.name)));

  if (match?.path) {
    if (isWindows()) {
      const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process '${match.path.replace(/'/g, "''")}'`], { timeout: 20000 });
      if (r.code === 0) return { opened: match.name, method: 'kısayol' };
    } else if (isMac()) {
      const r = await run('/usr/bin/open', ['-a', match.path]);
      if (r.code === 0) return { opened: match.name, method: 'open -a' };
    } else if (match.id) {
      const r = await run('/bin/sh', ['-c', `nohup gtk-launch ${match.id} >/dev/null 2>&1 &`], { timeout: 8000 });
      if (r.code === 0) return { opened: match.name, method: 'gtk-launch' };
    }
  }

  // 3) Windows: Başlat menüsünde yoksa yaygın kurulum klasörlerinde exe ara
  if (isWindows()) {
    const exe = await findWindowsExe(raw);
    if (exe) {
      const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process '${exe.replace(/'/g, "''")}'`], { timeout: 20000 });
      if (r.code === 0) return { opened: exe, method: 'kurulum klasörü' };
    }
  }

  // 4) Doğrudan çalıştırmayı dene
  if (isWindows()) {
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process '${raw.replace(/'/g, "''")}' -ErrorAction Stop`], { timeout: 20000 });
    if (r.code === 0) return { opened: raw, method: 'Start-Process' };
  } else {
    const r = await run('/bin/sh', ['-c', `command -v ${JSON.stringify(raw)} >/dev/null 2>&1 && nohup ${JSON.stringify(raw)} >/dev/null 2>&1 &`], { timeout: 8000 });
    if (r.code === 0) return { opened: raw, method: 'PATH' };
  }

  // 5) Web adresi gibi görünüyorsa tarayıcıda aç
  if (/^[a-z0-9-]+(\.[a-z]{2,})+(\/\S*)?$/i.test(raw)) {
    await shell.openExternal(`https://${raw}`);
    return { opened: `https://${raw}`, method: 'tarayıcı' };
  }

  throw new Error(
    `"${raw}" uygulaması bulunamadı. Kurulu uygulamaları listelemek için "yüklü uygulamaları listele" diyebilirsiniz.`,
  );
}

/* ------------------------------------------------------------------ */
/* Uygulama kapatma                                                    */
/* ------------------------------------------------------------------ */

export async function closeApp(query: string): Promise<string> {
  const raw = query.trim();
  if (!raw) throw new Error('Kapatılacak uygulama belirtilmedi.');
  const known = lookup(raw);
  const candidates = new Set<string>();
  candidates.add(raw);
  candidates.add(raw.replace(/\.exe$/i, ''));
  if (known) {
    candidates.add(known.key);
    if (known.def.win) candidates.add(known.def.win.replace(/\.exe$/i, ''));
    if (known.def.mac) candidates.add(known.def.mac);
    for (const l of known.def.linux ?? []) candidates.add(l.split(' ')[0]);
  }
  const list = [...candidates].filter(Boolean);

  if (isWindows()) {
    const names = list.map((n) => `'${n.replace(/'/g, "''")}'`).join(',');
    const script = `
$names = @(${names})
$procs = Get-Process | Where-Object {
  $p = $_
  ($names | Where-Object { $p.ProcessName -like "*$_*" -or $_.ToLower() -eq $p.ProcessName.ToLower() }).Count -gt 0
}
if (-not $procs) { "bulunamadi" } else {
  $procs | Select-Object Id,ProcessName | ConvertTo-Json -Compress
  $procs | ForEach-Object { try { $_.CloseMainWindow() | Out-Null } catch {} }
  Start-Sleep -Milliseconds 900
  $procs | ForEach-Object { if (-not $_.HasExited) { try { $_.Kill() } catch {} } }
  "kapandi"
}`;
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 30000 });
    if (/bulunamadi/.test(r.stdout)) throw new Error(`"${raw}" şu anda çalışmıyor gibi görünüyor.`);
    if (/kapandi/.test(r.stdout)) return `"${raw}" kapatıldı.`;
    throw new Error(r.stderr.trim() || `"${raw}" kapatılamadı.`);
  }

  if (isMac()) {
    const script = `
set targetNames to {${list.map((n) => `"${n}"`).join(', ')}}
set killed to {}
tell application "System Events"
  repeat with p in (every process whose background only is false)
    set pname to name of p
    repeat with t in targetNames
      ignoring case
        if pname is equal to (t as text) or pname contains (t as text) then
          set end of killed to pname
          tell application pname to quit
        end if
      end ignoring
    end repeat
  end repeat
end tell
if (count of killed) is 0 then
  return "bulunamadi"
else
  return "kapandi: " & (killed as text)
end if`;
    const r = await run('/usr/bin/osascript', ['-e', script], { timeout: 20000 });
    if (/bulunamadi/.test(r.stdout)) throw new Error(`"${raw}" şu anda çalışmıyor gibi görünüyor.`);
    if (r.code === 0) return `"${raw}" kapatıldı.`;
    throw new Error(r.stderr.trim() || `"${raw}" kapatılamadı.`);
  }

  // Linux
  for (const n of list) {
    const safe = n.replace(/[^a-zA-Z0-9._-]/g, '');
    if (!safe) continue;
    const r = await run('/bin/sh', ['-c', `pkill -f -i "${safe}" >/dev/null 2>&1; sleep 0.4; pgrep -f -i "${safe}" >/dev/null 2>&1 && pkill -9 -f -i "${safe}" >/dev/null 2>&1; true`]);
    void r;
  }
  const running = await runningProcesses();
  const still = running.find((p) => list.some((n) => p.name.toLowerCase().includes(n.toLowerCase())));
  if (still) throw new Error(`"${raw}" kapatılamadı (${still.name}).`);
  return `"${raw}" kapatıldı.`;
}

/* ------------------------------------------------------------------ */
/* Çalışan uygulamalar                                                 */
/* ------------------------------------------------------------------ */

const HIDDEN_PROCESSES = new Set([
  'system',
  'system idle process',
  'svchost',
  'conhost',
  'dwm',
  'csrss',
  'smss',
  'wininit',
  'winlogon',
  'services',
  'lsass',
  'explorer',
  'taskhostw',
  'sihost',
  'ctfmon',
  'runtimebroker',
  'searchhost',
  'startmenuexperiencehost',
  'shellexperiencehost',
  'textinputhost',
  'applicationframehost',
  'widgetservice',
  'widgets',
  'lockapp',
  'securityhealthsystray',
  'electron',
  'falcon ai',
]);

export async function runningProcesses(): Promise<RunningProcess[]> {
  if (isWindows()) {
    const r = await run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-Process | Where-Object { $_.MainWindowTitle -ne "" } | Select-Object Id,ProcessName,MainWindowTitle | ConvertTo-Json -Compress`,
      ],
      { timeout: 25000 },
    );
    try {
      const parsed = JSON.parse(r.stdout.trim() || '[]');
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return (list as { Id: number; ProcessName: string; MainWindowTitle: string }[])
        .filter((p) => !HIDDEN_PROCESSES.has(p.ProcessName.toLowerCase()))
        .map((p) => ({ pid: p.Id, name: p.ProcessName }));
    } catch {
      return [];
    }
  }
  if (isMac()) {
    const r = await run('/bin/sh', ['-c', `osascript -e 'tell application "System Events" to get name of every process whose background only is false'`]);
    return r.stdout
      .split(',')
      .map((n) => n.trim())
      .filter((n) => n && !HIDDEN_PROCESSES.has(n.toLowerCase()))
      .map((n, i) => ({ pid: i + 1, name: n }));
  }
  const r = await run('ps', ['-eo', 'pid,comm', '--no-headers']);
  const seen = new Set<string>();
  const out: RunningProcess[] = [];
  for (const line of r.stdout.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!m) continue;
    const name = path.basename(m[2]).replace(/\s+/g, ' ');
    if (HIDDEN_PROCESSES.has(name.toLowerCase())) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ pid: Number(m[1]), name });
    if (out.length >= 80) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Ek kısayollar                                                       */
/* ------------------------------------------------------------------ */

export function shortcuts(): { name: string; path: string }[] {
  const dirs = [desktopDir(), downloadsDir()];
  const out: { name: string; path: string }[] = [];
  for (const dir of dirs) {
    try {
      for (const entry of fs.readdirSync(dir)) {
        if (/\.(lnk|url|desktop|app)$/i.test(entry) || !path.extname(entry)) {
          out.push({ name: path.basename(entry, path.extname(entry)), path: path.join(dir, entry) });
        }
      }
    } catch {
      /* yok */
    }
  }
  return out.slice(0, 60);
}

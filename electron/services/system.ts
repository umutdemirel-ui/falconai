import { app, clipboard, desktopCapturer, screen, shell } from 'electron';
import { exec, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { getConfig } from '../core/config';
import { log } from '../core/logger';
import { paths } from '../core/paths';
import { isMac, isWindows } from '../core/security';
import type { SystemInfo } from '../../shared/types';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export const isLinux = !isWindows() && !isMac();

/** Kabuk komutu çalıştır (kısa süreli sistem işlemleri için) */
export async function run(
  cmd: string,
  args: string[] = [],
  opts: { timeout?: number; shell?: boolean; cwd?: string } = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    if (opts.shell) {
      const { stdout, stderr } = await execAsync(cmd, {
        timeout: opts.timeout ?? 20000,
        cwd: opts.cwd,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
        shell: isWindows() ? 'powershell.exe' : '/bin/sh',
      });
      return { stdout, stderr, code: 0 };
    }
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: opts.timeout ?? 20000,
      cwd: opts.cwd,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number; message?: string; killed?: boolean };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message ?? String(err),
      code: typeof e.code === 'number' ? e.code : 1,
    };
  }
}

function ps(script: string, timeout = 20000): Promise<{ stdout: string; stderr: string; code: number }> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { timeout },
  );
}

function sh(script: string, timeout = 20000) {
  return run('/bin/sh', ['-c', script], { timeout });
}

/* ------------------------------------------------------------------ */
/* Sistem bilgisi                                                      */
/* ------------------------------------------------------------------ */

let systemInfoCache: { at: number; value: SystemInfo } | null = null;
const SYSTEM_INFO_TTL = 45_000;

export async function getSystemInfo(force = false): Promise<SystemInfo> {
  if (!force && systemInfoCache && Date.now() - systemInfoCache.at < SYSTEM_INFO_TTL) {
    return systemInfoCache.value;
  }
  const value = await collectSystemInfo();
  systemInfoCache = { at: Date.now(), value };
  return value;
}

async function collectSystemInfo(): Promise<SystemInfo> {
  const cpus = os.cpus();
  const total = os.totalmem();
  const free = os.freemem();
  let battery: SystemInfo['battery'] = null;
  try {
    const { powerMonitor } = await import('electron');
    battery = null; // Electron powerMonitor batarya detayı vermez; platforma özel okunur
    void powerMonitor;
  } catch {
    /* yoksay */
  }

  if (isWindows()) {
    const r = await ps('Get-CimInstance Win32_Battery | Select-Object -First 1 EstimatedChargeRemaining,BatteryStatus | ConvertTo-Json -Compress', 8000);
    try {
      const j = JSON.parse(r.stdout.trim() || '{}') as { EstimatedChargeRemaining?: number; BatteryStatus?: number };
      if (typeof j.EstimatedChargeRemaining === 'number') {
        battery = { percent: j.EstimatedChargeRemaining, charging: j.BatteryStatus === 2 };
      }
    } catch {
      /* batarya yok */
    }
  } else if (isMac()) {
    const r = await run('/usr/bin/pmset', ['-g', 'batt'], { timeout: 5000 });
    const m = r.stdout.match(/(\d+)%/);
    if (m) battery = { percent: Number(m[1]), charging: /AC Power/.test(r.stdout) };
  } else {
    try {
      const cap = fs.readFileSync('/sys/class/power_supply/BAT0/capacity', 'utf8').trim();
      const status = fs.readFileSync('/sys/class/power_supply/BAT0/status', 'utf8').trim();
      battery = { percent: Number(cap), charging: status === 'Charging' };
    } catch {
      battery = null;
    }
  }

  const volumes: SystemInfo['volumes'] = [];
  if (isWindows()) {
    const r = await ps(
      'Get-PSDrive -PSProvider FileSystem | Where-Object {$_.Used -ne $null} | Select-Object Name,Used,Free | ConvertTo-Json -Compress',
      10000,
    );
    try {
      const parsed = JSON.parse(r.stdout.trim() || '[]');
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const d of list as { Name: string; Used: number; Free: number }[]) {
        volumes.push({
          name: `${d.Name}:`,
          mount: `${d.Name}:\\`,
          totalGb: roundGb(d.Used + d.Free),
          freeGb: roundGb(d.Free),
        });
      }
    } catch {
      /* yoksay */
    }
  } else if (isLinux) {
    const r = await run('df', ['-kP']);
    for (const line of r.stdout.split('\n').slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 6 && (parts[5] === '/' || parts[5].startsWith('/mnt') || parts[5].startsWith('/media'))) {
        volumes.push({
          name: parts[0],
          mount: parts[5],
          totalGb: Math.round(Number(parts[1]) / 1024 / 1024),
          freeGb: Math.round(Number(parts[3]) / 1024 / 1024),
        });
      }
    }
  } else {
    const r = await run('df', ['-kP', '/']);
    const line = r.stdout.split('\n')[1];
    if (line) {
      const parts = line.trim().split(/\s+/);
      volumes.push({
        name: 'Macintosh HD',
        mount: '/',
        totalGb: Math.round(Number(parts[1]) / 1024 / 1024),
        freeGb: Math.round(Number(parts[3]) / 1024 / 1024),
      });
    }
  }

  const platformLabel = isWindows() ? 'Windows' : isMac() ? 'macOS' : 'Linux';
  return {
    platform: process.platform as SystemInfo['platform'],
    platformLabel,
    hostname: os.hostname(),
    user: os.userInfo().username,
    osVersion: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    cpu: cpus[0]?.model?.trim() ?? 'Bilinmiyor',
    cores: cpus.length,
    totalMemGb: roundGb(total),
    freeMemGb: roundGb(free),
    memUsedPct: Math.round(((total - free) / total) * 100),
    uptimeSec: Math.round(os.uptime()),
    appVersion: app.getVersion(),
    electron: process.versions.electron ?? '',
    node: process.versions.node,
    chrome: process.versions.chrome,
    battery,
    displays: screen.getAllDisplays().map((d) => ({
      width: d.size.width,
      height: d.size.height,
      primary: d.id === screen.getPrimaryDisplay().id,
      scaleFactor: d.scaleFactor,
    })),
    volumes,
  };
}

function roundGb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024 / 1024) * 10) / 10;
}

/* ------------------------------------------------------------------ */
/* Güç işlemleri                                                       */
/* ------------------------------------------------------------------ */

export type PowerAction = 'shutdown' | 'restart' | 'sleep' | 'lock' | 'logout' | 'cancel';

export async function powerAction(action: PowerAction, delaySeconds = 30): Promise<string> {
  const p = getConfig().permissions;
  if (!p.power) throw new Error('Güç işlemleri izni kapalı. Ayarlar → İzinler ve Güvenlik bölümünden açabilirsiniz.');

  if (isWindows()) {
    switch (action) {
      case 'shutdown':
        await run('shutdown.exe', ['/s', '/t', String(delaySeconds)]);
        return `Bilgisayar ${delaySeconds} saniye içinde kapanacak. İptal için "kapatmayı iptal et" deyin.`;
      case 'restart':
        await run('shutdown.exe', ['/r', '/t', String(delaySeconds)]);
        return `Bilgisayar ${delaySeconds} saniye içinde yeniden başlayacak.`;
      case 'cancel':
        await run('shutdown.exe', ['/a']);
        return 'Zamanlanmış kapatma/yeniden başlatma iptal edildi.';
      case 'sleep':
        await run('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']);
        return 'Bilgisayar uyku moduna alınıyor.';
      case 'lock':
        await run('rundll32.exe', ['user32.dll,LockWorkStation']);
        return 'Ekran kilitlendi.';
      case 'logout':
        await run('shutdown.exe', ['/l']);
        return 'Oturum kapatılıyor.';
    }
  }

  if (isMac()) {
    switch (action) {
      case 'shutdown':
        await run('/usr/bin/osascript', ['-e', `tell app "System Events" to shut down`]);
        return 'Bilgisayar kapatılıyor.';
      case 'restart':
        await run('/usr/bin/osascript', ['-e', `tell app "System Events" to restart`]);
        return 'Bilgisayar yeniden başlatılıyor.';
      case 'sleep':
        await run('/usr/bin/pmset', ['sleepnow']);
        return 'Bilgisayar uyku moduna alınıyor.';
      case 'lock':
        await run('/usr/bin/osascript', ['-e', `tell application "System Events" to keystroke "q" using {control down, command down}`]);
        return 'Ekran kilitlendi.';
      case 'logout':
        await run('/usr/bin/osascript', ['-e', `tell application "System Events" to log out`]);
        return 'Oturum kapatılıyor.';
      case 'cancel':
        return 'macOS üzerinde iptal edilecek zamanlanmış kapatma yok.';
    }
  }

  // Linux
  switch (action) {
    case 'shutdown':
      await run('/bin/sh', ['-c', `shutdown -h +${Math.max(1, Math.round(delaySeconds / 60))} 2>/dev/null || systemctl poweroff`]);
      return 'Bilgisayar kapatılıyor.';
    case 'restart':
      await run('/bin/sh', ['-c', `shutdown -r +${Math.max(1, Math.round(delaySeconds / 60))} 2>/dev/null || systemctl reboot`]);
      return 'Bilgisayar yeniden başlatılıyor.';
    case 'cancel':
      await run('/bin/sh', ['-c', 'shutdown -c']);
      return 'Zamanlanmış kapatma iptal edildi.';
    case 'sleep':
      await run('/bin/sh', ['-c', 'systemctl suspend']);
      return 'Bilgisayar uyku moduna alınıyor.';
    case 'lock':
      await run('/bin/sh', ['-c', 'loginctl lock-session']);
      return 'Ekran kilitlendi.';
    case 'logout':
      await run('/bin/sh', ['-c', 'loginctl terminate-user "$USER"']);
      return 'Oturum kapatılıyor.';
  }
  throw new Error(`Bilinmeyen güç işlemi: ${action}`);
}

/* ------------------------------------------------------------------ */
/* Ses seviyesi / medya / parlaklık                                    */
/* ------------------------------------------------------------------ */

export async function setVolume(percent: number): Promise<string> {
  const v = Math.max(0, Math.min(100, Math.round(percent)));
  if (isWindows()) {
    const script = `
$vol = ${v}
$obj = New-Object -ComObject WScript.Shell
1..50 | ForEach-Object { $obj.SendKeys([char]174) }
for ($i=0; $i -lt [math]::Round($vol/2); $i++) { $obj.SendKeys([char]175) }
"ok"`;
    await ps(script, 25000);
    return `Ses seviyesi %${v} olarak ayarlandı.`;
  }
  if (isMac()) {
    await run('/usr/bin/osascript', ['-e', `set volume output volume ${v}`]);
    return `Ses seviyesi %${v} olarak ayarlandı.`;
  }
  const results = await Promise.all([
    run('/bin/sh', ['-c', `pactl set-sink-volume @DEFAULT_SINK@ ${v}% 2>/dev/null`]),
    run('/bin/sh', ['-c', `amixer -q set Master ${v}% 2>/dev/null`]),
  ]);
  if (results.every((r) => r.code !== 0)) throw new Error('Ses seviyesi ayarlanamadı (pactl/amixer bulunamadı).');
  return `Ses seviyesi %${v} olarak ayarlandı.`;
}

export async function setMuted(muted: boolean): Promise<string> {
  if (isWindows()) {
    const script = `
$obj = New-Object -ComObject WScript.Shell
$obj.SendKeys([char]173)
"ok"`;
    await ps(script, 15000);
    return muted ? 'Ses kapatıldı.' : 'Ses açıldı.';
  }
  if (isMac()) {
    await run('/usr/bin/osascript', ['-e', `set volume ${muted ? 'with' : 'without'} output muted`]);
    return muted ? 'Ses kapatıldı.' : 'Ses açıldı.';
  }
  await sh(`pactl set-sink-mute @DEFAULT_SINK@ ${muted ? '1' : '0'} 2>/dev/null || amixer -q set Master ${muted ? 'mute' : 'unmute'}`);
  return muted ? 'Ses kapatıldı.' : 'Ses açıldı.';
}

export type MediaAction = 'play_pause' | 'next' | 'previous' | 'stop' | 'volume_up' | 'volume_down';

export async function mediaControl(action: MediaAction): Promise<string> {
  if (isWindows()) {
    const map: Record<MediaAction, number> = {
      play_pause: 179,
      next: 176,
      previous: 177,
      stop: 178,
      volume_up: 175,
      volume_down: 174,
    };
    await ps(`$o=New-Object -ComObject WScript.Shell; $o.SendKeys([char]${map[action]}); "ok"`, 15000);
    return `Medya komutu gönderildi: ${action}`;
  }
  if (isMac()) {
    const map: Record<MediaAction, string> = {
      play_pause: 'playpause',
      next: 'next track',
      previous: 'previous track',
      stop: 'stop',
      volume_up: 'volume_up',
      volume_down: 'volume_down',
    };
    await run('/usr/bin/osascript', ['-e', `tell application "System Events" to key code ${map[action] === 'playpause' ? 16 : 16}`]);
    return `Medya komutu gönderildi: ${action}`;
  }
  const map: Record<MediaAction, string> = {
    play_pause: 'play-pause',
    next: 'next',
    previous: 'previous',
    stop: 'stop',
    volume_up: 'raise',
    volume_down: 'lower',
  };
  const r = await sh(`playerctl ${map[action]} 2>/dev/null`);
  if (r.code !== 0) throw new Error('Medya denetimi için playerctl gerekli (sudo apt install playerctl).');
  return `Medya komutu gönderildi: ${action}`;
}

export async function setBrightness(percent: number): Promise<string> {
  const v = Math.max(0, Math.min(100, Math.round(percent)));
  if (isWindows()) {
    const script = `
$b = ${v}
try {
  $wmi = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods
  $wmi | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{Timeout=1; Brightness=$b}
  "ok"
} catch { "desteklenmiyor" }`;
    const r = await ps(script, 15000);
    if (/desteklenmiyor/.test(r.stdout)) throw new Error('Bu ekran parlaklık denetimini desteklemiyor.');
    return `Parlaklık %${v} olarak ayarlandı.`;
  }
  if (isMac()) {
    await run('/bin/sh', ['-c', `brightness ${(v / 100).toFixed(2)} 2>/dev/null || true`]);
    return `Parlaklık %${v} olarak ayarlandı (brightness aracı gerekebilir).`;
  }
  await sh(`brightnessctl set ${v}% 2>/dev/null`);
  return `Parlaklık %${v} olarak ayarlandı.`;
}

export async function toggleDarkMode(): Promise<string> {
  if (isWindows()) {
    const script = `
$p = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize"
$cur = (Get-ItemProperty -Path $p -Name AppsUseLightTheme).AppsUseLightTheme
$new = if ($cur -eq 1) { 0 } else { 1 }
Set-ItemProperty -Path $p -Name AppsUseLightTheme -Value $new
Set-ItemProperty -Path $p -Name SystemUsesLightTheme -Value $new
if ($new -eq 0) { "karanlık" } else { "aydınlık" }`;
    const r = await ps(script, 15000);
    return `Tema ${r.stdout.trim()} moda alındı.`;
  }
  if (isMac()) {
    await run('/usr/bin/osascript', ['-e', 'tell application "System Events" to tell appearance preferences to set dark mode to not dark mode']);
    return 'Sistem görünümü değiştirildi.';
  }
  await sh('gsettings set org.gnome.desktop.interface color-scheme "prefer-dark"');
  return 'Karanlık tema etkinleştirildi.';
}

export async function emptyTrash(): Promise<string> {
  if (isWindows()) {
    await ps('Clear-RecycleBin -Force -ErrorAction SilentlyContinue; "ok"', 30000);
    return 'Geri dönüşüm kutusu boşaltıldı.';
  }
  if (isMac()) {
    await run('/bin/sh', ['-c', 'rm -rf ~/.Trash/* 2>/dev/null || true']);
    return 'Çöp kutusu boşaltıldı.';
  }
  await sh('rm -rf ~/.local/share/Trash/files/* 2>/dev/null || true');
  return 'Çöp kutusu boşaltıldı.';
}

/* ------------------------------------------------------------------ */
/* Ekran görüntüsü                                                     */
/* ------------------------------------------------------------------ */

export interface ScreenshotResult {
  file: string;
  base64: string;
  mime: string;
  width: number;
  height: number;
}

export async function takeScreenshot(opts: { allDisplays?: boolean } = {}): Promise<ScreenshotResult> {
  if (isMac()) {
    const file = path.join(paths.screenshots(), `ekran-${Date.now()}.png`);
    const r = await run('/usr/sbin/screencapture', ['-x', file]);
    if (r.code === 0 && fs.existsSync(file)) {
      const dims = screen.getPrimaryDisplay().size;
      return { file, base64: fs.readFileSync(file).toString('base64'), mime: 'image/png', width: dims.width, height: dims.height };
    }
    log.warn('screencapture başarısız, Electron yoluna geçiliyor', r.stderr);
  }

  const primary = screen.getPrimaryDisplay();
  const width = Math.round(primary.size.width * primary.scaleFactor);
  const height = Math.round(primary.size.height * primary.scaleFactor);
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height },
  });
  if (!sources.length) throw new Error('Ekran kaynağı bulunamadı (ekran kaydı izni gerekli olabilir).');
  const img = opts.allDisplays ? sources[0] : sources[0];
  const file = path.join(paths.screenshots(), `ekran-${Date.now()}.png`);
  fs.writeFileSync(file, img.thumbnail.toPNG());
  const size = img.thumbnail.getSize();
  return { file, base64: img.thumbnail.toPNG().toString('base64'), mime: 'image/png', width: size.width, height: size.height };
}

/* ------------------------------------------------------------------ */
/* Pano                                                                */
/* ------------------------------------------------------------------ */

export async function readClipboard(): Promise<string> {
  return await clipboard.readText();
}

export async function writeClipboard(text: string): Promise<void> {
  await clipboard.writeText(text);
}

/* ------------------------------------------------------------------ */
/* URL / dosya açma                                                    */
/* ------------------------------------------------------------------ */

export async function openUrl(url: string): Promise<string> {
  const withProto = /^[a-z]+:\/\//i.test(url) ? url : `https://${url}`;
  if (!/^https?:\/\//i.test(withProto)) {
    throw new Error('Yalnızca http/https bağlantıları açılabilir.');
  }
  await shell.openExternal(withProto);
  return `Açıldı: ${withProto}`;
}

export async function openPath(target: string): Promise<string> {
  const err = await shell.openPath(target);
  if (err) throw new Error(`Açılamadı: ${err}`);
  return `Açıldı: ${target}`;
}

export async function showInFolder(target: string): Promise<string> {
  shell.showItemInFolder(target);
  return `Klasörde gösterildi: ${target}`;
}

export async function trashPath(target: string): Promise<string> {
  await shell.trashItem(target);
  return `Çöp kutusuna taşındı: ${target}`;
}

/* ------------------------------------------------------------------ */
/* Kullanıcı / makine bağlamı (ajan istemine girer)                     */
/* ------------------------------------------------------------------ */

export function greetingTime(): string {
  const h = new Date().getHours();
  if (h < 6) return 'İyi geceler';
  if (h < 12) return 'Günaydın';
  if (h < 18) return 'İyi günler';
  return 'İyi akşamlar';
}

export function machineSummary(): string {
  const info = os.userInfo();
  return `${isWindows() ? 'Windows' : isMac() ? 'macOS' : 'Linux'} · ${os.hostname()} · ${info.username}`;
}

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { BrowserWindow } from 'electron';
import { getConfig } from './config';
import { log } from './logger';
import { homeDir } from './paths';
import type { AgentName, PermissionSettings, ToolConfirmation, ToolRisk } from '../../shared/types';

/**
 * Güvenlik katmanı.
 * Kullanıcı "tam yetki" modunu seçse bile Falcon:
 *  - ev dizini dışına yazmaz (sistem klasörleri korumalıdır),
 *  - kritik sistem komutlarını engelleyen bir kara liste tutar,
 *  - silme / terminal / kapatma gibi yıkıcı işlemlerde (istenirse) onay sorar.
 */

const PROTECTED_PATHS_WIN = [
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData',
  'C:\\$Recycle.Bin',
  'C:\\System Volume Information',
];

const PROTECTED_PATHS_UNIX = ['/bin', '/boot', '/dev', '/etc', '/lib', '/lib64', '/proc', '/sbin', '/sys', '/usr', '/var', '/System', '/Library'];

export function isWindows(): boolean {
  return process.platform === 'win32';
}

export function isMac(): boolean {
  return process.platform === 'darwin';
}

export function permissions(): PermissionSettings {
  return getConfig().permissions;
}

/** Bir yolun izin verilen kökler içinde olup olmadığını denetler */
export function assertPathAllowed(target: string, opts: { write?: boolean } = {}): string {
  const cfg = getConfig();
  if (!cfg.permissions.fileAccess) {
    throw new Error('Dosya erişimi izni kapalı. Ayarlar → İzin Durumu bölümünden açabilirsiniz.');
  }
  const resolved = path.resolve(expandHome(target));
  const roots = cfg.permissions.allowedRoots.length
    ? cfg.permissions.allowedRoots.map((r) => path.resolve(expandHome(r)))
    : [homeDir()];

  // Sistem klasörleri her zaman korumalı
  const protectedList = isWindows() ? PROTECTED_PATHS_WIN : PROTECTED_PATHS_UNIX;
  for (const p of protectedList) {
    if (resolved === p || resolved.startsWith(p + path.sep)) {
      throw new Error(`Güvenlik: "${p}" sistem klasörüne erişim Falcon tarafından engellendi.`);
    }
  }

  const inside = roots.some((root) => resolved === root || resolved.startsWith(root + path.sep));
  if (!inside) {
    // Salt okunur erişimde ev dizini dışındaki okuma noktalarına izin ver (ör. /tmp)
    if (!opts.write) {
      const readAllowed = ['/tmp', '/var/tmp', os.tmpdir()];
      if (readAllowed.some((p) => resolved.startsWith(p))) return resolved;
      throw new Error(
        `Güvenlik: "${resolved}" izin verilen klasörlerin dışında. Ayarlar → İzinler bölümünden bu klasörü ekleyin.`,
      );
    }
    throw new Error(
      `Güvenlik: "${resolved}" izin verilen klasörlerin dışında. Ayarlar → İzinler bölümünden bu klasörü ekleyin.`,
    );
  }
  return resolved;
}

export function expandHome(p: string): string {
  if (!p) return homeDir();
  if (p === '~') return homeDir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(homeDir(), p.slice(2));
  if (p === '%USERPROFILE%') return homeDir();
  return p;
}

/** Komut kara listesi denetimi */
export function assertCommandAllowed(command: string): void {
  const cfg = getConfig();
  if (!cfg.permissions.terminal) {
    throw new Error('Terminal izni kapalı. Ayarlar → İzinler bölümünden açabilirsiniz.');
  }
  for (const pattern of cfg.permissions.blockedCommands) {
    try {
      if (new RegExp(pattern, 'i').test(command)) {
        throw new Error(`Güvenlik: "${pattern}" kalıbıyla eşleşen komut engellendi (yıkıcı işlem koruması).`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Güvenlik:')) throw err;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Onay mekanizması                                                    */
/* ------------------------------------------------------------------ */

interface PendingConfirmation {
  request: ToolConfirmation;
  resolve: (approved: boolean) => void;
  timer: NodeJS.Timeout;
}

const pending = new Map<string, PendingConfirmation>();

export function focusWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows();
  return windows.find((w) => !w.isDestroyed()) ?? null;
}

/**
 * Onay gerekip gerekmediğine karar verir.
 *  manual → her araç için, smart → yalnızca riskli araçlar, full → yalnızca ayarlarda
 *  açıkça istenen yıkıcı işlemler.
 */
export function needsConfirmation(tool: string, risk: ToolRisk): boolean {
  const cfg = getConfig();
  const p = cfg.permissions;
  if (risk === 'safe') return false;
  if (p.mode === 'manual') return true;
  if (p.mode === 'smart') return risk === 'dangerous' || risk === 'moderate';
  // full yetki
  if (tool === 'delete_path') return p.confirmDelete;
  if (tool === 'run_command') return p.confirmTerminal;
  if (tool === 'system_power') return p.confirmPower;
  return false;
}

export async function requestConfirmation(
  tool: string,
  title: string,
  detail: string,
  risk: ToolRisk,
  agent: AgentName,
  timeoutMs = 120_000,
): Promise<boolean> {
  if (!needsConfirmation(tool, risk)) return true;

  const win = focusWindow();
  if (!win) {
    log.warn('onay isteği: pencere yok, reddedildi', tool);
    return false;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();

  const id = `cfm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const request: ToolConfirmation = { id, title, detail, tool, risk, agent, createdAt: Date.now(), timeoutMs };

  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      win.webContents.send('falcon:confirm-resolved', { id, approved: false });
      resolve(false);
    }, timeoutMs);
    pending.set(id, { request, resolve, timer });
    win.webContents.send('falcon:confirm', request);
  });
}

export function resolveConfirmation(id: string, approved: boolean): void {
  const entry = pending.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(id);
  entry.resolve(approved);
}

export function rejectAllConfirmations(): void {
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer);
    entry.resolve(false);
    pending.delete(id);
  }
}

/** Komut çıktısından hassas bilgi sızmasını engelle (API anahtarı vb.) */
export function redact(text: string): string {
  return text.replace(/AIza[0-9A-Za-z_\-]{10,}/g, 'AIza•••••••');
}

export function ensureDirWritable(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.accessSync(dir, fs.constants.W_OK);
}

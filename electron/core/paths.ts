import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Falcon'un tüm yerel verisi kullanıcı profilinde tutulur:
 *   Windows: %APPDATA%\Falcon AI\falcon-data
 *   macOS:   ~/Library/Application Support/Falcon AI/falcon-data
 *   Linux:   ~/.config/Falcon AI/falcon-data
 */
export function dataDir(): string {
  const dir = path.join(app.getPath('userData'), 'falcon-data');
  ensureDir(dir);
  return dir;
}

export function subDir(...parts: string[]): string {
  const dir = path.join(dataDir(), ...parts);
  ensureDir(dir);
  return dir;
}

export function ensureDir(dir: string): void {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.error('[falcon] klasör oluşturulamadı:', dir, err);
  }
}

export const paths = {
  config: () => path.join(dataDir(), 'config.json'),
  chats: () => path.join(dataDir(), 'chats.json'),
  projects: () => path.join(dataDir(), 'projects.json'),
  tasks: () => path.join(dataDir(), 'tasks.json'),
  reminders: () => path.join(dataDir(), 'reminders.json'),
  memories: () => path.join(dataDir(), 'memories.json'),
  files: () => path.join(dataDir(), 'files.json'),
  agenda: () => path.join(dataDir(), 'agenda.json'),
  audit: () => path.join(dataDir(), 'audit.jsonl'),
  delegations: () => path.join(dataDir(), 'delegations.json'),
  window: () => path.join(dataDir(), 'window.json'),
  screenshots: () => subDir('screenshots'),
  exports: () => subDir('exports'),
  logs: () => subDir('logs'),
  tmp: () => subDir('tmp'),
};

export function homeDir(): string {
  return app.getPath('home') || os.homedir();
}

export function desktopDir(): string {
  try {
    return app.getPath('desktop');
  } catch {
    return path.join(homeDir(), 'Desktop');
  }
}

export function documentsDir(): string {
  try {
    return app.getPath('documents');
  } catch {
    return path.join(homeDir(), 'Documents');
  }
}

export function downloadsDir(): string {
  try {
    return app.getPath('downloads');
  } catch {
    return path.join(homeDir(), 'Downloads');
  }
}

/** Paketlenmiş uygulamada resources, geliştirmede proje kökü */
export function assetPath(file: string): string {
  if (app.isPackaged) return path.join(process.resourcesPath, file);
  return path.join(app.getAppPath(), 'assets', file);
}

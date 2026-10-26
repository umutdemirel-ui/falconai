import { BrowserWindow } from 'electron';
import type { AgentState, ChatEvent, Config } from '../../shared/types';

/**
 * Ana süreçten arayüze olay yayını.
 * Pencere yeniden yüklenirse otomatik olarak yeni pencereye bağlanır.
 */

let target: BrowserWindow | null = null;

export function attachBus(win: BrowserWindow): void {
  target = win;
}

export function broadcast(event: ChatEvent): void {
  const win = target && !target.isDestroyed() ? target : BrowserWindow.getAllWindows()[0];
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send('falcon:event', event);
  } catch {
    /* pencere kapanıyor olabilir */
  }
}

export function emitState(state: AgentState): void {
  broadcast({ type: 'state', state });
}

export function emitToast(kind: 'info' | 'success' | 'error', title: string, body?: string): void {
  broadcast({ type: 'toast', kind, title, body });
}

export function emitConfig(config: Config): void {
  broadcast({ type: 'config', config });
}

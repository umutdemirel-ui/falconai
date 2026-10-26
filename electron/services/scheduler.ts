import { Notification } from 'electron';
import { getConfig } from '../core/config';
import { log } from '../core/logger';
import { broadcast } from '../core/bus';
import { listReminders, saveDigest, updateReminder } from '../core/db';
import { buildDigest, digestToSpeech } from './agenda';
import { getApiKey } from '../core/config';

/**
 * Zamanlayıcı: hatırlatıcılar, günlük gündem özeti ve sabah brifingi.
 * Her 30 saniyede bir hafif kontrol yapar; ağır iş yalnızca zamanı gelince çalışır.
 */

let timer: NodeJS.Timeout | null = null;
let digestRunning = false;
const firedKeys = new Set<string>();

function notify(title: string, body: string, speakText?: string): void {
  try {
    if (Notification.isSupported()) {
      const n = new Notification({ title, body });
      n.on('click', () => broadcast({ type: 'toast', kind: 'info', title, body }));
      n.show();
    }
  } catch (err) {
    log.warn('bildirim gösterilemedi', err);
  }
  broadcast({ type: 'toast', kind: 'info', title, body });
  if (speakText) broadcast({ type: 'speak', text: speakText });
}

function checkReminders(): void {
  const now = Date.now();
  for (const reminder of listReminders()) {
    if (!reminder.enabled) continue;
    if (reminder.at) {
      const key = `once:${reminder.id}:${reminder.at}`;
      if (!firedKeys.has(key) && reminder.at <= now && now - reminder.at < 10 * 60 * 1000) {
        firedKeys.add(key);
        updateReminder(reminder.id, { enabled: false, lastFiredAt: now });
        notify('Falcon hatırlatıyor', reminder.text, reminder.text);
      }
      continue;
    }
    if (reminder.dailyAt) {
      const [h, m] = reminder.dailyAt.split(':').map(Number);
      if (!Number.isFinite(h) || !Number.isFinite(m)) continue;
      const target = new Date();
      target.setHours(h, m, 0, 0);
      const diff = now - target.getTime();
      const key = `daily:${reminder.id}:${new Date().toISOString().slice(0, 10)}:${reminder.dailyAt}`;
      // Son 5 dakika içinde zamanı geldiyse ve bugün ateşlenmediyse
      if (diff >= 0 && diff < 5 * 60 * 1000 && !firedKeys.has(key)) {
        firedKeys.add(key);
        updateReminder(reminder.id, { lastFiredAt: now });
        notify('Falcon hatırlatıyor', reminder.text, reminder.text);
      }
    }
  }
}

async function checkAgenda(): Promise<void> {
  const cfg = getConfig();
  if (!cfg.agenda.enabled || digestRunning) return;
  if (!getApiKey()) return;
  const [h, m] = cfg.agenda.time.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return;

  const now = new Date();
  const todayKey = `agenda:${now.toISOString().slice(0, 10)}:${cfg.agenda.time}`;
  if (firedKeys.has(todayKey)) return;

  const target = new Date();
  target.setHours(h, m, 0, 0);
  const diff = Date.now() - target.getTime();
  if (diff < 0 || diff > 15 * 60 * 1000) return;

  firedKeys.add(todayKey);
  digestRunning = true;
  try {
    log.info('günlük gündem özeti oluşturuluyor');
    const digest = await buildDigest({ topics: cfg.agenda.topics });
    saveDigest(digest);
    broadcast({ type: 'agenda', digest });
    const body =
      digest.headline ||
      (digest.items.length ? `${digest.items.length} yeni gelişme var.` : 'Gündem özetin hazır.');
    notify('Günlük gündem özetin hazır', body, cfg.agenda.speak ? digestToSpeech(digest) : undefined);
  } catch (err) {
    log.error('gündem özeti başarısız', err);
    broadcast({
      type: 'toast',
      kind: 'error',
      title: 'Gündem özeti alınamadı',
      body: err instanceof Error ? err.message : String(err),
    });
  } finally {
    digestRunning = false;
  }
}

function tick(): void {
  try {
    checkReminders();
    void checkAgenda();
  } catch (err) {
    log.error('zamanlayıcı hatası', err);
  }
}

export function startScheduler(): void {
  if (timer) return;
  timer = setInterval(tick, 30_000);
  setTimeout(tick, 8000);
  log.info('zamanlayıcı başladı');
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Kullanıcı elle gündem istediğinde */
export async function runAgendaNow(speak = true): Promise<void> {
  const cfg = getConfig();
  const digest = await buildDigest({ topics: cfg.agenda.topics });
  saveDigest(digest);
  broadcast({ type: 'agenda', digest });
  if (speak) broadcast({ type: 'speak', text: digestToSpeech(digest) });
}

export function scheduleTestReminder(seconds = 20): void {
  notify('Falcon testi', `${seconds} saniye sonra hatırlatma testi gelecek.`, 'Hatırlatma testi kuruldu.');
  setTimeout(() => notify('Falcon hatırlatıyor', 'Bu bir test hatırlatmasıdır.', 'Bu bir test hatırlatmasıdır.'), seconds * 1000);
}

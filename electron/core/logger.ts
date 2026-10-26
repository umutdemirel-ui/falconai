import fs from 'node:fs';
import path from 'node:path';
import { paths } from './paths';
import type { AuditEntry } from '../../shared/types';

/**
 * Basit, bağımlılıksız günlükleyici.
 * - Konsol: geliştirme sırasında okunabilir çıktı
 * - Dosya:  falcon-data/logs/falcon-YYYY-MM-DD.log
 * - Denetim: falcon-data/audit.jsonl (her araç çağrısı, KVKK/şeffaflık için)
 */

let logStream: fs.WriteStream | null = null;
let logDay = '';

function dayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function write(level: string, args: unknown[]): void {
  const line = args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack ?? ''}`;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');

  const stamp = new Date().toISOString();
  const prefix = `[${stamp}] [${level}]`;
  if (level === 'ERROR') console.error(prefix, line);
  else if (level === 'WARN') console.warn(prefix, line);
  else console.log(prefix, line);

  try {
    const day = dayKey();
    if (!logStream || logDay !== day) {
      logStream?.end();
      logDay = day;
      logStream = fs.createWriteStream(path.join(paths.logs(), `falcon-${day}.log`), { flags: 'a' });
    }
    logStream.write(`${prefix} ${line}\n`);
  } catch {
    /* günlük yazılamazsa sessizce devam et */
  }
}

export const log = {
  info: (...args: unknown[]) => write('INFO', args),
  warn: (...args: unknown[]) => write('WARN', args),
  error: (...args: unknown[]) => write('ERROR', args),
  debug: (...args: unknown[]) => {
    if (process.env.FALCON_DEBUG) write('DEBUG', args);
  },
};

/** Denetim kaydı: ajanın bilgisayarda ne yaptığının değiştirilemez izi */
export function audit(entry: Omit<AuditEntry, 'id' | 'at'> & { at?: number }): AuditEntry {
  const full: AuditEntry = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    at: entry.at ?? Date.now(),
    tool: entry.tool,
    args: entry.args,
    outcome: entry.outcome,
    summary: entry.summary,
    agent: entry.agent,
    durationMs: entry.durationMs,
  };
  try {
    fs.appendFileSync(paths.audit(), JSON.stringify(full) + '\n', 'utf8');
  } catch (err) {
    log.warn('denetim kaydı yazılamadı', err);
  }
  return full;
}

export function readAudit(limit = 300): AuditEntry[] {
  try {
    const raw = fs.readFileSync(paths.audit(), 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean).slice(-limit);
    return lines
      .map((l) => {
        try {
          return JSON.parse(l) as AuditEntry;
        } catch {
          return null;
        }
      })
      .filter((x): x is AuditEntry => Boolean(x))
      .reverse();
  } catch {
    return [];
  }
}

export function readRecentLogs(limit = 200): string {
  try {
    const dir = paths.logs();
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.log'))
      .sort()
      .slice(-2);
    const out: string[] = [];
    for (const f of files) {
      const content = fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n');
      out.push(...content.slice(-limit));
    }
    return out.slice(-limit).join('\n');
  } catch {
    return '';
  }
}

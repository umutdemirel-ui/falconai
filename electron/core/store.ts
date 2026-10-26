import fs from 'node:fs';
import path from 'node:path';
import { paths } from './paths';
import { log } from './logger';

/**
 * Atomik JSON koleksiyonu.
 * Yazma işlemi önce .tmp dosyasına yapılır, sonra rename edilir; böylece
 * elektrik kesintisi / çökme durumunda veri bozulmaz.
 */
export class JsonCollection<T> {
  private cache: T | null = null;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly file: () => string,
    private readonly fallback: () => T,
  ) {}

  read(): T {
    if (this.cache) return this.cache;
    try {
      const raw = fs.readFileSync(this.file(), 'utf8');
      this.cache = JSON.parse(raw) as T;
    } catch {
      this.cache = this.fallback();
    }
    return this.cache;
  }

  write(value: T): void {
    this.cache = value;
    this.scheduleSave();
  }

  update(mutator: (current: T) => T | void): T {
    const current = this.read();
    const next = mutator(current) ?? current;
    this.cache = next as T;
    this.scheduleSave();
    return next as T;
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 180);
  }

  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.cache === null) return;
    const target = this.file();
    const tmp = `${target}.tmp`;
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(this.cache, null, 2), 'utf8');
      fs.renameSync(tmp, target);
    } catch (err) {
      log.error('veri yazılamadı', target, err);
    }
  }
}

/** Benzersiz kimlik */
export function uid(prefix = ''): string {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}${Date.now().toString(36)}${rnd}`;
}

/** Basit LRU önbellek (ses ve arama sonuçları için) */
export class Lru<K, V> {
  private map = new Map<K, V>();
  constructor(private readonly limit = 64) {}
  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.limit) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
  clear(): void {
    this.map.clear();
  }
}

export function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function ensureFile(p: string, content: string): void {
  if (!fileExists(p)) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, 'utf8');
  }
}

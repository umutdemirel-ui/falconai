import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import { paths } from './paths';
import { log } from './logger';
import { DEFAULT_CONFIG, type Config } from '../../shared/types';

/**
 * Ayar yönetimi.
 * API anahtarı asla düz metin olarak diske yazılmaz: mümkünse işletim
 * sisteminin anahtar zinciriyle (safeStorage) şifrelenir.
 */

let config: Config | null = null;

function mergeConfig(base: Config, patch: Partial<Config>): Config {
  return {
    ...base,
    ...patch,
    general: { ...base.general, ...(patch.general ?? {}) },
    models: { ...base.models, ...(patch.models ?? {}) },
    voice: { ...base.voice, ...(patch.voice ?? {}) },
    permissions: {
      ...base.permissions,
      ...(patch.permissions ?? {}),
      allowedRoots: patch.permissions?.allowedRoots ?? base.permissions.allowedRoots,
      blockedCommands: patch.permissions?.blockedCommands ?? base.permissions.blockedCommands,
    },
    agenda: { ...base.agenda, ...(patch.agenda ?? {}) },
    updatedAt: Date.now(),
  };
}

export function loadConfig(): Config {
  if (config) return config;
  try {
    const raw = fs.readFileSync(paths.config(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<Config>;
    config = mergeConfig(structuredClone(DEFAULT_CONFIG), parsed);
  } catch {
    config = { ...structuredClone(DEFAULT_CONFIG), createdAt: Date.now(), updatedAt: Date.now() };
  }
  // Eski sürümlerden gelen ayarları tamamla
  const defaults = structuredClone(DEFAULT_CONFIG);
  config = mergeConfig(defaults, config);
  config.hasApiKey = Boolean(config.apiKeyEncrypted);
  return config;
}

export function saveConfig(): void {
  const cfg = loadConfig();
  cfg.updatedAt = Date.now();
  const target = paths.config();
  const tmp = `${target}.tmp`;
  fs.mkdirSync(paths.config().replace(/config\.json$/, ''), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmp, target);
}

export function getConfig(): Config {
  return loadConfig();
}

export function updateConfig(patch: Partial<Config>): Config {
  const current = loadConfig();
  config = mergeConfig(current, patch);
  config.hasApiKey = Boolean(config.apiKeyEncrypted);
  config.updatedAt = Date.now();
  saveConfig();
  return config;
}

/** Arayüze gönderilen güvenli kopya — anahtarın kendisi asla gönderilmez. */
export function publicConfig(): Config {
  const cfg = loadConfig();
  const key = getApiKey();
  return {
    ...cfg,
    apiKeyEncrypted: null,
    hasApiKey: Boolean(key),
  };
}

export function setApiKey(rawKey: string): Config {
  const key = rawKey.trim();
  if (!key) {
    config = { ...loadConfig(), apiKeyEncrypted: null, hasApiKey: false };
    saveConfig();
    return publicConfig();
  }
  if (!/^AIza[0-9A-Za-z_\-]{20,60}$/.test(key) && key.length < 20) {
    throw new Error(
      'API anahtarı geçersiz görünüyor. Google AI Studio (aistudio.google.com/apikey) üzerinden aldığınız "AIza..." ile başlayan anahtarı yapıştırın.',
    );
  }
  let stored: string;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      stored = `enc:${safeStorage.encryptString(key).toString('base64')}`;
    } else {
      stored = `b64:${Buffer.from(key, 'utf8').toString('base64')}`;
      log.warn('safeStorage kullanılamıyor; API anahtarı temel kodlama ile saklandı.');
    }
  } catch (err) {
    log.warn('API anahtarı şifrelenemedi', err);
    stored = `b64:${Buffer.from(key, 'utf8').toString('base64')}`;
  }
  config = { ...loadConfig(), apiKeyEncrypted: stored, hasApiKey: true };
  saveConfig();
  return publicConfig();
}

export function getApiKey(): string {
  const cfg = loadConfig();
  const stored = cfg.apiKeyEncrypted;
  if (!stored) return '';
  try {
    if (stored.startsWith('enc:')) {
      return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
    }
    if (stored.startsWith('b64:')) {
      return Buffer.from(stored.slice(4), 'base64').toString('utf8');
    }
    // Eski format: düz metin
    return stored;
  } catch (err) {
    log.error('API anahtarı çözülemedi', err);
    return '';
  }
}

export function maskedApiKey(): string {
  const key = getApiKey();
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}••••••••••••${key.slice(-4)}`;
}

export function userDataRoots(): string[] {
  const cfg = loadConfig();
  const roots = new Set<string>();
  for (const r of cfg.permissions.allowedRoots) if (r) roots.add(r);
  if (roots.size === 0) {
    roots.add(app.getPath('home'));
  }
  return [...roots];
}

/** Ayarları varsayılana döndürür; API anahtarı ve kullanıcı adı korunur. */
export function resetConfig(keepKey = true): Config {
  const current = loadConfig();
  const fresh = structuredClone(DEFAULT_CONFIG);
  fresh.createdAt = current.createdAt || Date.now();
  fresh.updatedAt = Date.now();
  fresh.userName = current.userName;
  fresh.onboardingDone = current.onboardingDone;
  if (keepKey) {
    fresh.apiKeyEncrypted = current.apiKeyEncrypted;
    fresh.hasApiKey = Boolean(current.apiKeyEncrypted);
  }
  config = fresh;
  saveConfig();
  return publicConfig();
}

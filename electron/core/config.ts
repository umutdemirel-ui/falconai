import { app } from 'electron';
import fs from 'node:fs';
import { paths } from './paths';
import { log } from './logger';
import { decryptSecret, encryptSecret, maskSecret } from './secrets';
import { PROVIDER_ORDER, providerSpec } from './provider-specs';
import { isRetiredModel } from './model-utils';
import {
  DEFAULT_CONFIG,
  type AiSettings,
  type Config,
  type ProviderId,
  type ProviderState,
} from '../../shared/types';

type KeyedProvider = Exclude<ProviderId, 'gemini'>;

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
    ai: mergeAi(base.ai, patch.ai),
    updatedAt: Date.now(),
  };
}

function mergeAi(base: AiSettings, patch?: Partial<AiSettings>): AiSettings {
  if (!patch) return base;
  return {
    ...base,
    ...patch,
    providers: {
      openai: { ...base.providers.openai, ...(patch.providers?.openai ?? {}) },
      anthropic: { ...base.providers.anthropic, ...(patch.providers?.anthropic ?? {}) },
      nvidia: { ...base.providers.nvidia, ...(patch.providers?.nvidia ?? {}) },
      abacus: { ...base.providers.abacus, ...(patch.providers?.abacus ?? {}) },
    },
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
  config.hasApiKey = anyProviderKey(config);
  healRetiredModels(config);
  return config;
}

const MODEL_KEYS = ['brain', 'fast', 'vision', 'tts', 'stt', 'search'] as const;

/**
 * API'den kaldırılmış (404 dönen) model adlarını varsayılana döndürür.
 * Eski ayar dosyaları yüzünden her istekte 404 zinciri yaşanmasın.
 */
function healRetiredModels(cfg: Config): void {
  const defaults = DEFAULT_CONFIG.models;
  const changed: string[] = [];
  for (const key of MODEL_KEYS) {
    if (isRetiredModel(cfg.models[key])) {
      changed.push(`${key}: ${cfg.models[key]} → ${defaults[key]}`);
      cfg.models[key] = defaults[key];
    }
  }
  if (!changed.length) return;
  log.warn('emekli model adları güncellendi', changed.join(' · '));
  try {
    fs.mkdirSync(paths.config().replace(/config\.json$/, ''), { recursive: true });
    fs.writeFileSync(paths.config(), JSON.stringify(cfg, null, 2), 'utf8');
  } catch (err) {
    log.warn('model düzeltmesi kaydedilemedi', err);
  }
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
  config.hasApiKey = anyProviderKey(config);
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
    hasApiKey: Boolean(key) || anyProviderKey(cfg),
    ai: {
      ...cfg.ai,
      providers: {
        openai: { ...cfg.ai.providers.openai, keyEncrypted: null },
        anthropic: { ...cfg.ai.providers.anthropic, keyEncrypted: null },
        nvidia: { ...cfg.ai.providers.nvidia, keyEncrypted: null },
        abacus: { ...cfg.ai.providers.abacus, keyEncrypted: null },
      },
    },
    providerStates: providerStates(cfg),
  };
}

/* ------------------------------------------------------------------ */
/* Sağlayıcı anahtarları                                              */
/* ------------------------------------------------------------------ */

function anyProviderKey(cfg: Config): boolean {
  if (cfg.apiKeyEncrypted) return true;
  return Object.values(cfg.ai.providers).some((p) => Boolean(p.keyEncrypted));
}

/** Gemini dışındaki sağlayıcılardan birine ait anahtar. */
export function providerKey(id: ProviderId): string {
  if (id === 'gemini') return getApiKey();
  const entry = getConfig().ai.providers[id as KeyedProvider];
  return entry ? decryptSecret(entry.keyEncrypted) : '';
}

export function hasProviderKey(id: ProviderId): boolean {
  return Boolean(providerKey(id));
}

export function anyProviderAvailable(): boolean {
  return PROVIDER_ORDER.some((id) => hasProviderKey(id));
}

export function providerStates(cfg: Config = loadConfig()): ProviderState[] {
  return PROVIDER_ORDER.map((id) => {
    const spec = providerSpec(id);
    const entry = id === 'gemini' ? null : cfg.ai.providers[id as KeyedProvider];
    const key = id === 'gemini' ? getApiKey() : decryptSecret(entry?.keyEncrypted);
    return {
      id,
      label: spec.label,
      kind: spec.kind,
      hasKey: Boolean(key),
      masked: maskSecret(key),
      model: entry?.model || (id === 'gemini' ? cfg.models.brain : spec.defaultModel),
      defaultModel: spec.defaultModel,
      baseUrl: entry?.baseUrl || spec.baseUrl,
      docsUrl: spec.docsUrl,
      keyHint: spec.keyHint,
      supportsVoice: spec.supportsVoice,
      supportsVision: spec.supportsVision,
      note: spec.note,
    };
  });
}

function validateKey(key: string): void {
  if (key.length < 10) {
    throw new Error('API anahtarı çok kısa görünüyor. Anahtarı eksiksiz yapıştırdığından emin ol.');
  }
  if (/\s/.test(key)) {
    throw new Error('API anahtarı boşluk içeriyor. Yapıştırırken fazladan karakter gelmiş olabilir.');
  }
}

/** Gemini anahtarı (eski adıyla tek anahtar) */
export function setApiKey(rawKey: string): Config {
  const key = rawKey.trim();
  if (!key) {
    config = { ...loadConfig(), apiKeyEncrypted: null };
    config.hasApiKey = anyProviderKey(config);
    saveConfig();
    return publicConfig();
  }
  validateKey(key);
  config = { ...loadConfig(), apiKeyEncrypted: encryptSecret(key) };
  config.hasApiKey = anyProviderKey(config);
  saveConfig();
  return publicConfig();
}

export function setProviderKey(id: ProviderId, rawKey: string): Config {
  if (id === 'gemini') return setApiKey(rawKey);
  const key = rawKey.trim();
  if (key) validateKey(key);
  const cfg = loadConfig();
  const entry = cfg.ai.providers[id as KeyedProvider];
  if (!entry) throw new Error(`Bilinmeyen sağlayıcı: ${id}`);
  entry.keyEncrypted = key ? encryptSecret(key) : null;
  if (!key) entry.model = '';
  config = { ...cfg, updatedAt: Date.now() };
  config.hasApiKey = anyProviderKey(config);
  saveConfig();
  return publicConfig();
}

/** Model adını kaydeder (boş = sağlayıcı varsayılanı). */
export function setProviderModel(id: ProviderId, model: string): Config {
  const cfg = loadConfig();
  const clean = model.trim();
  if (id === 'gemini') {
    cfg.models.brain = clean || DEFAULT_CONFIG.models.brain;
    config = { ...cfg, updatedAt: Date.now() };
    saveConfig();
    return publicConfig();
  }
  const entry = cfg.ai.providers[id as KeyedProvider];
  if (!entry) throw new Error(`Bilinmeyen sağlayıcı: ${id}`);
  entry.model = clean;
  config = { ...cfg, updatedAt: Date.now() };
  saveConfig();
  return publicConfig();
}

export function getApiKey(): string {
  return decryptSecret(loadConfig().apiKeyEncrypted);
}

export function maskedApiKey(): string {
  return maskSecret(getApiKey());
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
    fresh.ai = {
      ...fresh.ai,
      providers: structuredClone(current.ai.providers),
    };
    fresh.hasApiKey = anyProviderKey(fresh);
  }
  config = fresh;
  saveConfig();
  return publicConfig();
}

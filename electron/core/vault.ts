import { safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './paths';
import { log } from './logger';
import { uid } from './store';

/**
 * Kimlik bilgisi kasası.
 * Şifreler işletim sisteminin güvenli deposu (DPAPI / Keychain / libsecret)
 * ile şifrelenir. Model şifreyi asla görmez; yalnızca "hangi hesap" bilgisini görür.
 */

export interface CredentialMeta {
  id: string;
  name: string;
  username: string;
  app?: string;
  url?: string;
  createdAt: number;
  lastUsedAt?: number;
}

interface StoredCredential extends CredentialMeta {
  secretEnc: string;
}

interface VaultFile {
  entries: StoredCredential[];
}

function vaultPath(): string {
  return path.join(dataDir(), 'vault.json');
}

function read(): VaultFile {
  try {
    return JSON.parse(fs.readFileSync(vaultPath(), 'utf8')) as VaultFile;
  } catch {
    return { entries: [] };
  }
}

function write(data: VaultFile): void {
  const target = vaultPath();
  fs.writeFileSync(`${target}.tmp`, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(`${target}.tmp`, target);
}

function encrypt(secret: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return `enc:${safeStorage.encryptString(secret).toString('base64')}`;
  }
  log.warn('safeStorage yok; kimlik bilgisi temel kodlama ile saklandı');
  return `b64:${Buffer.from(secret, 'utf8').toString('base64')}`;
}

function decrypt(enc: string): string {
  try {
    if (enc.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(enc.slice(4), 'base64'));
    if (enc.startsWith('b64:')) return Buffer.from(enc.slice(4), 'base64').toString('utf8');
    return enc;
  } catch (err) {
    log.error('kimlik bilgisi çözülemedi', err);
    return '';
  }
}

export function listCredentials(): CredentialMeta[] {
  return read().entries.map(({ secretEnc: _secretEnc, ...meta }) => meta);
}

export function saveCredential(input: {
  name: string;
  username: string;
  password: string;
  app?: string;
  url?: string;
}): CredentialMeta {
  const data = read();
  const existing = data.entries.find((e) => e.name.toLocaleLowerCase('tr-TR') === input.name.toLocaleLowerCase('tr-TR'));
  const meta: StoredCredential = {
    id: existing?.id ?? uid('cred'),
    name: input.name,
    username: input.username,
    app: input.app,
    url: input.url,
    createdAt: existing?.createdAt ?? Date.now(),
    lastUsedAt: existing?.lastUsedAt,
    secretEnc: encrypt(input.password),
  };
  data.entries = [...data.entries.filter((e) => e.id !== meta.id), meta];
  write(data);
  const { secretEnc: _s, ...publicMeta } = meta;
  return publicMeta;
}

export function getCredential(name: string): { meta: CredentialMeta; password: string } | null {
  const data = read();
  const key = name.toLocaleLowerCase('tr-TR');
  const entry =
    data.entries.find((e) => e.name.toLocaleLowerCase('tr-TR') === key) ??
    data.entries.find((e) => e.name.toLocaleLowerCase('tr-TR').includes(key) || key.includes(e.name.toLocaleLowerCase('tr-TR')));
  if (!entry) return null;
  entry.lastUsedAt = Date.now();
  write(data);
  const { secretEnc, ...meta } = entry;
  return { meta, password: decrypt(secretEnc) };
}

export function deleteCredential(nameOrId: string): boolean {
  const data = read();
  const before = data.entries.length;
  data.entries = data.entries.filter(
    (e) => e.id !== nameOrId && e.name.toLocaleLowerCase('tr-TR') !== nameOrId.toLocaleLowerCase('tr-TR'),
  );
  write(data);
  return data.entries.length < before;
}

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { log } from '../core/logger';
import { assertPathAllowed, expandHome } from '../core/security';
import { documentsDir, downloadsDir, homeDir } from '../core/paths';

/**
 * Belge okuma/yazma.
 * PDF, DOCX, TXT, MD, CSV, JSON, HTML ve kod dosyaları desteklenir.
 * PDF metni kendi çıkarıcımızla alınır; taranmış PDF'ler için Gemini'ın
 * yerel PDF desteği kullanılır (araç katmanında).
 */

export const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.jsonl', '.xml', '.yaml', '.yml',
  '.html', '.htm', '.css', '.scss', '.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.kt',
  '.c', '.h', '.cpp', '.hpp', '.cs', '.go', '.rs', '.rb', '.php', '.sh', '.bat', '.ps1',
  '.sql', '.ini', '.cfg', '.conf', '.env', '.log', '.srt', '.tex', '.r', '.swift', '.dart',
]);

export const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.html': 'text/html',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm',
  '.mp4': 'video/mp4',
};

export function mimeFor(file: string): string {
  return MIME_BY_EXT[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

export function resolvePath(input: string): string {
  const expanded = expandHome(input.trim());
  if (path.isAbsolute(expanded)) return expanded;
  // Göreli yollar belgeler klasörüne göre çözümlenir
  return path.resolve(documentsDir(), expanded);
}

/* ------------------------------------------------------------------ */
/* Metin çıkarma                                                       */
/* ------------------------------------------------------------------ */

export interface ExtractResult {
  text: string;
  kind: 'text' | 'docx' | 'pdf' | 'binary';
  pages?: number;
  truncated: boolean;
}

function decodeMaybeTurkish(buffer: Buffer): string {
  const utf8 = buffer.toString('utf8');
  // UTF-8 geçersiz baytları U+FFFD üretir; bu durumda cp1254/win1252 denenir
  if (!utf8.includes('\uFFFD')) return utf8;
  try {
    return new TextDecoder('windows-1254').decode(buffer);
  } catch {
    return utf8;
  }
}

export function extractDocxText(buffer: Buffer): string {
  // DOCX = ZIP; word/document.xml içindeki <w:t> metinleri toplanır.
  const files = unzipEntries(buffer);
  const doc = files.find((f) => f.name === 'word/document.xml');
  if (!doc) return '';
  let xml = zlib.inflateRawSync(doc.data.subarray(doc.dataOffset)).toString('utf8');
  xml = xml
    .replace(/<w:p[ >]/g, '\n<w:p ')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n');
  const texts: string[] = [];
  const re = /<w:t[^>]*>([\s\S]*?)<\/w:t>|<\/w:p>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    if (m[0] === '</w:p>') texts.push('\n');
    else if (m[1]) texts.push(decodeXmlEntities(m[1]));
  }
  return texts.join('').replace(/\n{3,}/g, '\n\n').trim();
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

interface ZipEntry {
  name: string;
  data: Buffer;
  dataOffset: number;
  compressedSize: number;
  method: number;
}

/** Minimal ZIP okuyucu (DOCX/XLSX/EPUB için) */
function unzipEntries(buffer: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  // End of central directory kaydını geriye doğru ara
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66000); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return entries;
  const total = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let i = 0; i < total; i++) {
    if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLen + localExtraLen;
    entries.push({ name, data: buffer, dataOffset, compressedSize, method });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function extractPdfText(buffer: Buffer): { text: string; pages: number } {
  let stream = buffer.toString('latin1');
  const pages = (stream.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  const chunks: string[] = [];

  // 1) FlateDecode akışlarını aç ve metin operatörlerini ayıkla
  const re = /<<([\s\S]{0,800}?)>>\s*stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stream))) {
    const dict = m[1];
    const start = m.index + m[0].length;
    const end = stream.indexOf('endstream', start);
    if (end === -1) continue;
    let raw = Buffer.from(stream.slice(start, end), 'latin1');
    if (/FlateDecode/.test(dict)) {
      try {
        raw = zlib.inflateSync(raw);
      } catch {
        try {
          raw = zlib.inflateRawSync(raw);
        } catch {
          continue;
        }
      }
    }
    const content = raw.toString('latin1');
    if (!/(Tj|TJ)/.test(content)) continue;
    chunks.push(extractTextOps(content));
  }

  // 2) Sıkıştırılmamış akışlar için düz metin aramasının yedeği
  if (chunks.join(' ').trim().length < 40) {
    const plain = stream.match(/\((?:\\.|[^\\()])+\)\s*Tj/g) ?? [];
    chunks.push(plain.map((p) => decodePdfString(p.slice(1, p.lastIndexOf(')')))).join(' '));
  }

  let text = chunks.join('\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  // Karakter kodlaması düzeltmesi (bazı üreticiler WinAnsi kullanır)
  text = fixMojibake(text);
  return { text, pages: Math.max(pages, 1) };
}

function extractTextOps(content: string): string {
  const out: string[] = [];
  const ops = /\[((?:[^\][\\]|\\.)*)\]\s*TJ|\(((?:\\.|[^\\()])*)\)\s*Tj|\bTd\b|\bTD\b|\bT\*\b|\bET\b/g;
  let match: RegExpExecArray | null;
  while ((match = ops.exec(content))) {
    if (match[1] !== undefined) {
      // TJ dizisi: (metin) -250 (metin) ...
      const arr = match[1].match(/\((?:\\.|[^\\()])*\)|-?\d+/g) ?? [];
      let line = '';
      for (const token of arr) {
        if (token.startsWith('(')) line += decodePdfString(token.slice(1, -1));
        else if (Number(token) < -180) line += ' ';
      }
      out.push(line);
    } else if (match[2] !== undefined) {
      out.push(decodePdfString(match[2]));
    } else if (/^(Td|TD|T\*|ET)$/.test(match[0])) {
      out.push('\n');
    }
  }
  return out.join('').replace(/\n{2,}/g, '\n').trim();
}

function decodePdfString(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = raw[++i];
    switch (next) {
      case 'n': out += '\n'; break;
      case 'r': out += '\r'; break;
      case 't': out += '\t'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case '(': out += '('; break;
      case ')': out += ')'; break;
      case '\\': out += '\\'; break;
      default:
        if (/[0-7]/.test(next ?? '')) {
          let oct = next;
          while (oct.length < 3 && /[0-7]/.test(raw[i + 1] ?? '')) oct += raw[++i];
          out += String.fromCharCode(parseInt(oct, 8));
        } else out += next ?? '';
    }
  }
  return out;
}

function fixMojibake(s: string): string {
  if (!/Ã|Å|Ä/.test(s)) return s;
  try {
    // latin1 → utf8 geri dönüşümü
    const fixed = Buffer.from(s, 'latin1').toString('utf8');
    if (!fixed.includes('\uFFFD')) return fixed;
  } catch {
    /* yoksay */
  }
  return s;
}

export function extractText(file: string, maxChars = 120_000): ExtractResult {
  const ext = path.extname(file).toLowerCase();
  const stat = fs.statSync(file);
  if (stat.size > 60 * 1024 * 1024) throw new Error('Dosya çok büyük (60 MB üzeri).');

  if (ext === '.pdf') {
    const buffer = fs.readFileSync(file);
    const { text, pages } = extractPdfText(buffer);
    return { text: text.slice(0, maxChars), kind: 'pdf', pages, truncated: text.length > maxChars };
  }
  if (ext === '.docx') {
    const text = extractDocxText(fs.readFileSync(file));
    if (!text) throw new Error('DOCX içeriği okunamadı.');
    return { text: text.slice(0, maxChars), kind: 'docx', truncated: text.length > maxChars };
  }
  if (ext === '.doc') {
    throw new Error('Eski .doc biçimi desteklenmiyor; lütfen .docx olarak kaydedin.');
  }
  if (TEXT_EXTENSIONS.has(ext) || stat.size < 4 * 1024 * 1024) {
    const text = decodeMaybeTurkish(fs.readFileSync(file));
    const printable = text.replace(/[^\x09\x0A\x0D\x20-\x7E\p{L}\p{N}\p{P}\p{S}]/gu, '');
    if (printable.length / Math.max(text.length, 1) < 0.75) {
      return { text: '', kind: 'binary', truncated: false };
    }
    return { text: text.slice(0, maxChars), kind: 'text', truncated: text.length > maxChars };
  }
  return { text: '', kind: 'binary', truncated: false };
}

/* ------------------------------------------------------------------ */
/* Yazma / düzenleme                                                   */
/* ------------------------------------------------------------------ */

export interface WriteResult {
  file: string;
  bytes: number;
}

export function writeTextFile(target: string, content: string, opts: { overwrite?: boolean } = {}): WriteResult {
  const file = assertPathAllowed(resolvePath(target), { write: true });
  if (fs.existsSync(file) && opts.overwrite === false) {
    throw new Error(`Dosya zaten var: ${file}. Üzerine yazmak için overwrite=true kullanın.`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  return { file, bytes: Buffer.byteLength(content, 'utf8') };
}

export function appendTextFile(target: string, content: string): WriteResult {
  const file = assertPathAllowed(resolvePath(target), { write: true });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, content, 'utf8');
  return { file, bytes: Buffer.byteLength(content, 'utf8') };
}

export function copyPath(from: string, to: string, move = false): string {
  const src = assertPathAllowed(resolvePath(from));
  let dest = assertPathAllowed(resolvePath(to), { write: true });
  if (!fs.existsSync(src)) throw new Error(`Kaynak bulunamadı: ${src}`);
  // Hedef klasörse dosya adını koru
  if (fs.existsSync(dest) && fs.statSync(dest).isDirectory()) {
    dest = path.join(dest, path.basename(src));
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  if (move) fs.rmSync(src, { recursive: true, force: true });
  return `${move ? 'Taşındı' : 'Kopyalandı'}: ${src} → ${dest}`;
}

export function makeDir(target: string): string {
  const dir = assertPathAllowed(resolvePath(target), { write: true });
  fs.mkdirSync(dir, { recursive: true });
  return `Klasör oluşturuldu: ${dir}`;
}

export function readDirectory(target: string): { name: string; path: string; isDir: boolean; size: number; modified: number }[] {
  const dir = assertPathAllowed(resolvePath(target || homeDir()));
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => !d.name.startsWith('.') || d.name === '.env')
    .map((d) => {
      const full = path.join(dir, d.name);
      let size = 0;
      let modified = 0;
      try {
        const st = fs.statSync(full);
        size = st.size;
        modified = st.mtimeMs;
      } catch {
        /* yoksay */
      }
      return { name: d.name, path: full, isDir: d.isDirectory(), size, modified };
    })
    .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, 'tr'));
}

export function searchFiles(query: string, root?: string, limit = 40): { name: string; path: string; isDir: boolean; size: number }[] {
  const base = assertPathAllowed(resolvePath(root ?? homeDir()));
  const q = query.toLocaleLowerCase('tr-TR');
  const results: { name: string; path: string; isDir: boolean; size: number }[] = [];
  const skip = new Set(['node_modules', '.git', 'AppData', 'Library', '$Recycle.Bin', 'Windows', 'Program Files', 'Program Files (x86)', '.cache', 'venv', '.venv', '__pycache__', 'dist', 'build']);
  const stack: { dir: string; depth: number }[] = [{ dir: base, depth: 0 }];
  while (stack.length && results.length < limit) {
    const { dir, depth } = stack.pop()!;
    if (depth > 4) continue;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.env') continue;
      if (skip.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.name.toLocaleLowerCase('tr-TR').includes(q)) {
        let size = 0;
        try {
          size = fs.statSync(full).size;
        } catch {
          /* yoksay */
        }
        results.push({ name: e.name, path: full, isDir: e.isDirectory(), size });
      }
      if (e.isDirectory()) stack.push({ dir: full, depth: depth + 1 });
    }
  }
  return results;
}

export function statPath(target: string): { path: string; exists: boolean; isDir: boolean; size: number; modified: number; created: number } {
  const p = resolvePath(target);
  try {
    const st = fs.statSync(p);
    return { path: p, exists: true, isDir: st.isDirectory(), size: st.size, modified: st.mtimeMs, created: st.birthtimeMs };
  } catch {
    return { path: p, exists: false, isDir: false, size: 0, modified: 0, created: 0 };
  }
}

/** Güvenli dosya adı üret (Türkçe karakterleri korur) */
export function safeFileName(name: string, fallbackExt = '.txt'): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  const base = cleaned || `falcon-${Date.now()}`;
  return path.extname(base) ? base : `${base}${fallbackExt}`;
}

export function defaultSaveDir(): string {
  return documentsDir();
}

export function downloadsPath(): string {
  return downloadsDir();
}

/* ------------------------------------------------------------------ */
/* Görsel / medya                                                      */
/* ------------------------------------------------------------------ */

export function readBase64(file: string, limitMb = 18): { data: string; mime: string; size: number } {
  const buffer = fs.readFileSync(file);
  if (buffer.length > limitMb * 1024 * 1024) {
    throw new Error(`Dosya çok büyük (${Math.round(buffer.length / 1024 / 1024)} MB). En fazla ${limitMb} MB gönderilebilir.`);
  }
  return { data: buffer.toString('base64'), mime: mimeFor(file), size: buffer.length };
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function isImage(file: string): boolean {
  return /\.(png|jpe?g|webp|gif|bmp)$/i.test(file);
}

export function logDocumentRead(file: string, size: number, kind: string): void {
  log.info(`belge okundu: ${file} (${humanSize(size)}, ${kind})`);
}

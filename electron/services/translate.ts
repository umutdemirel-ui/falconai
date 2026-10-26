import path from 'node:path';
import { documentsDir } from '../core/paths';
import { getConfig } from '../core/config';
import { generate } from '../core/gemini';
import { extractText, resolvePath, safeFileName, writeTextFile, mimeFor } from './documents';
import { addFileRecord } from '../core/db';
import { assertPathAllowed } from '../core/security';

/**
 * Belge çevirisi. Metin parçalara bölünür, her parça ayrı ayrı çevrilir,
 * biçimlendirme (başlıklar, listeler, tablolar) korunmaya çalışılır.
 */

function splitIntoChunks(text: string, maxChars = 3500): string[] {
  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = '';
  for (const p of paragraphs) {
    if ((current + '\n\n' + p).length > maxChars && current) {
      chunks.push(current.trim());
      current = p;
    } else {
      current = current ? `${current}\n\n${p}` : p;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : [text];
}

export interface TranslateResult {
  summary: string;
  file: string;
  source: string;
  targetLanguage: string;
  chars: number;
}

export async function translateFile(
  sourcePath: string,
  targetLanguage: string,
  outputPath?: string,
  signal?: AbortSignal,
): Promise<TranslateResult> {
  const cfg = getConfig();
  const file = assertPathAllowed(resolvePath(sourcePath));
  const extracted = extractText(file, 200_000);
  if (!extracted.text.trim()) throw new Error('Çevrilecek metin bulunamadı. Taranmış belgeler için önce analyze_document kullanın.');

  const chunks = splitIntoChunks(extracted.text);
  const translated: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const res = await generate({
      model: cfg.models.fast,
      purpose: 'fast',
      temperature: 0.2,
      maxOutputTokens: 8192,
      signal,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Aşağıdaki metni ${targetLanguage} diline çevir.
Kurallar:
- Markdown biçimlendirmesini, başlıkları, listeleri ve tabloları koru.
- Kişi ve marka adlarını olduğu gibi bırak.
- Sadece çeviriyi yaz; açıklama ekleme.
- Parça ${i + 1}/${chunks.length}.

--- METİN ---
${chunks[i]}`,
            },
          ],
        },
      ],
    });
    translated.push(res.text.trim());
  }

  const target =
    outputPath?.trim()
      ? resolvePath(outputPath)
      : path.join(
          documentsDir(),
          'Falcon Çeviriler',
          safeFileName(`${path.basename(file, path.extname(file))} — ${targetLanguage}`, '.md'),
        );
  const header = `> ${path.basename(file)} → ${targetLanguage} çevirisi · ${new Date().toLocaleString('tr-TR')}\n\n`;
  const result = writeTextFile(target, header + translated.join('\n\n'));
  addFileRecord({ name: path.basename(result.file), path: result.file, mime: mimeFor(result.file), size: result.bytes });

  return {
    summary: `${path.basename(file)} dosyası ${targetLanguage} diline çevrildi: ${result.file}`,
    file: result.file,
    source: file,
    targetLanguage,
    chars: extracted.text.length,
  };
}

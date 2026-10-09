import fs from 'node:fs/promises';
import path from 'node:path';
import { OfficeParser } from 'officeparser';
import { isMediaFile } from './transcribe.js';
import { IMAGE_EXTENSIONS } from './ocr.js';

// Formatos lidos pelo officeparser (Word, Excel, PowerPoint, LibreOffice, PDF, RTF, EPUB).
const OFFICE_EXTENSIONS = new Set([
  '.docx', '.pptx', '.xlsx', '.odt', '.odp', '.ods', '.odg', '.pdf', '.rtf', '.epub',
]);

// Formatos de texto puro, lidos diretamente como UTF-8.
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.xml', '.yml', '.yaml', '.log', '.ini',
  '.conf', '.cfg', '.sql', '.sh', '.bat', '.ps1', '.js', '.ts', '.py', '.java', '.cs', '.php',
  '.rb', '.go', '.css', '.env', '.properties', '.eml',
]);

const HTML_EXTENSIONS = new Set(['.html', '.htm']);

// Limite de texto guardado por documento (evita indexar dumps gigantes).
const MAX_TEXT_CHARS = 2_000_000;

function htmlToText(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

/**
 * Lê um arquivo de texto em UTF-8 ou, se não for UTF-8 válido, em ISO-8859-1 (comum em arquivos EDI
 * e exportações de sistemas antigos), para os acentos saírem certos.
 */
async function readTextFile(filePath) {
  const buf = await fs.readFile(filePath);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('latin1').decode(buf);
  }
}

/**
 * Arquivos sem extensão conhecida (EDI como OCOREN, NOTFIS, CONEMB, DOCCOB, arquivos .rem/.ret de
 * bancos, exportações): se o começo do arquivo for texto (sem bytes binários), ele é lido como texto.
 */
async function looksLikeText(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(65536), 0, 65536, 0);
    if (!bytesRead) return false;
    const sample = buffer.subarray(0, bytesRead);
    let control = 0;
    for (const byte of sample) {
      if (byte === 0) return false;
      if (byte < 9 || (byte > 13 && byte < 32) || byte === 127) control++;
    }
    return control / bytesRead < 0.01;
  } finally {
    await handle.close();
  }
}

function normalize(text) {
  const clean = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  return clean.length > MAX_TEXT_CHARS ? clean.slice(0, MAX_TEXT_CHARS) : clean;
}

/**
 * Extrai o texto de um arquivo para que ele seja pesquisável e lido pela Active AI.
 * Imagens (prints de tela, fotos de documentos) têm o texto lido por OCR, quando `ocr` é informado.
 * Retorna { text, status } onde status é 'ok', 'empty', 'unsupported' ou 'error'.
 */
export async function extractText(filePath, originalName, { ocr } = {}) {
  const ext = path.extname(originalName || filePath).toLowerCase();
  try {
    let text;
    if (TEXT_EXTENSIONS.has(ext)) {
      text = await readTextFile(filePath);
    } else if (HTML_EXTENSIONS.has(ext)) {
      text = htmlToText(await readTextFile(filePath));
    } else if (OFFICE_EXTENSIONS.has(ext)) {
      const ast = await OfficeParser.parseOffice(filePath);
      const { value } = await ast.to('text', {
        includeImages: false,
        textConfig: { preserveLayout: false },
      });
      text = value;
    } else if (IMAGE_EXTENSIONS.has(ext)) {
      if (!ocr?.enabled) return { text: '', status: 'unsupported' };
      text = await ocr.recognize(filePath);
    } else if (isMediaFile(originalName || filePath)) {
      // Vídeos e áudios: o conteúdo vem da transcrição, feita depois em segundo plano.
      return { text: '', status: 'media' };
    } else if (await looksLikeText(filePath)) {
      text = await readTextFile(filePath);
    } else {
      return { text: '', status: 'unsupported' };
    }
    const normalized = normalize(text);
    return { text: normalized, status: normalized ? 'ok' : 'empty' };
  } catch (err) {
    console.warn(`[extract] Falha ao ler "${originalName}": ${err.message}`);
    return { text: '', status: 'error' };
  }
}

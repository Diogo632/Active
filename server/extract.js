import fs from 'node:fs/promises';
import path from 'node:path';
import { OfficeParser } from 'officeparser';

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

function normalize(text) {
  const clean = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  return clean.length > MAX_TEXT_CHARS ? clean.slice(0, MAX_TEXT_CHARS) : clean;
}

/**
 * Extrai o texto de um arquivo para que ele seja pesquisável e lido pelo Active IA.
 * Retorna { text, status } onde status é 'ok', 'empty', 'unsupported' ou 'error'.
 */
export async function extractText(filePath, originalName) {
  const ext = path.extname(originalName || filePath).toLowerCase();
  try {
    let text;
    if (TEXT_EXTENSIONS.has(ext)) {
      text = await fs.readFile(filePath, 'utf8');
    } else if (HTML_EXTENSIONS.has(ext)) {
      text = htmlToText(await fs.readFile(filePath, 'utf8'));
    } else if (OFFICE_EXTENSIONS.has(ext)) {
      const ast = await OfficeParser.parseOffice(filePath);
      const { value } = await ast.to('text', {
        includeImages: false,
        textConfig: { preserveLayout: false },
      });
      text = value;
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

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

/**
 * Leitura do texto de imagens (OCR) no próprio servidor, com o Tesseract (tesseract.js).
 * Prints de tela com mensagens de erro, telas de sistema e documentos fotografados viram texto
 * pesquisável, que a Active AI lê pelo MCP. Português e inglês; os dados dos idiomas vêm dos
 * pacotes @tesseract.js-data (instalados pelo npm), então não há download na hora de usar.
 */

export const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff']);
const LANGS = ['por', 'eng'];
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

const require = createRequire(import.meta.url);

/** Copia os dados dos idiomas para uma pasta única (o Tesseract procura todos no mesmo lugar). */
function prepareLangs(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const lang of LANGS) {
    const target = path.join(dir, `${lang}.traineddata.gz`);
    if (fs.existsSync(target)) continue;
    const pkg = path.dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`));
    fs.copyFileSync(path.join(pkg, '4.0.0_best_int', `${lang}.traineddata.gz`), target);
  }
  return dir;
}

export function createOcr({ enabled = true, cacheDir, log = console } = {}) {
  let workerPromise = null;
  let failure = null;

  async function worker() {
    workerPromise ||= (async () => {
      const { createWorker } = await import('tesseract.js');
      const langPath = prepareLangs(cacheDir);
      log.log('[ocr] Carregando o leitor de texto de imagens (português e inglês)…');
      return createWorker(LANGS, 1, { langPath, cacheMethod: 'none', gzip: true });
    })().catch((err) => {
      workerPromise = null;
      throw err;
    });
    return workerPromise;
  }

  return {
    get enabled() {
      return enabled && !failure;
    },
    /** Texto lido da imagem ('' se não houver texto legível). */
    async recognize(filePath) {
      if (!enabled || failure) return '';
      if (fs.statSync(filePath).size > MAX_IMAGE_BYTES) return '';
      try {
        const started = Date.now();
        const { data } = await (await worker()).recognize(filePath);
        const text = String(data.text || '')
          .replace(/[ \t]+\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        log.log(`[ocr] ${path.basename(filePath)}: ${text.length} caracteres (confiança ${Math.round(data.confidence || 0)}%, ${Date.now() - started} ms)`);
        // Pouca confiança e quase nenhum texto: provavelmente uma foto sem texto, não um print.
        return (data.confidence || 0) < 30 && text.length < 20 ? '' : text;
      } catch (err) {
        if (/Cannot find (package|module)|ERR_MODULE_NOT_FOUND/.test(`${err.message}${err.code}`)) {
          failure = err.message;
          log.error('[ocr] Desligado: o tesseract.js não está instalado. Rode npm ci.');
          return '';
        }
        log.error('[ocr] Falha ao ler a imagem:', err.message);
        return '';
      }
    },
    async close() {
      if (workerPromise) await (await workerPromise).terminate().catch(() => {});
      workerPromise = null;
    },
  };
}

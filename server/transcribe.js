import { spawn } from 'node:child_process';
import path from 'node:path';

// Extensões tratadas como vídeo/áudio (a transcrição vira o conteúdo pesquisável do item).
const MEDIA_EXTENSIONS = new Set([
  '.mp4', '.mov', '.mkv', '.webm', '.avi', '.wmv', '.m4v', '.mpg', '.mpeg',
  '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.flac', '.wma',
]);

const SEGMENT_SECONDS = 300; // o áudio é processado em partes de 5 minutos
const PARAGRAPH_SECONDS = 30; // trechos agrupados em parágrafos de ~30 s

export function isMediaFile(fileName, mimeType = '') {
  return /^(video|audio)\//.test(mimeType) || MEDIA_EXTENSIONS.has(path.extname(fileName || '').toLowerCase());
}

/** 754.2 → "00:12:34" */
export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
}

/** Junta trechos {start, end, text} em parágrafos com marcação de tempo: "[00:12:34] texto". */
export function formatTranscript(chunks) {
  const lines = [];
  let current = null;
  for (const c of chunks) {
    const text = String(c.text || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (current && c.start - current.start < PARAGRAPH_SECONDS) {
      current.text += ` ${text}`;
    } else {
      if (current) lines.push(current);
      current = { start: c.start, text };
    }
  }
  if (current) lines.push(current);
  return lines.map((l) => `[${formatTime(l.start)}] ${l.text}`).join('\n');
}

/** Lê legendas .vtt/.srt (como as do Teams, Meet e Zoom) e devolve trechos {start, text}. */
export function parseSubtitles(raw) {
  const toSeconds = (t) => {
    const parts = t.replace(',', '.').split(':').map(Number);
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  };
  const chunks = [];
  const blocks = String(raw).replace(/\r/g, '').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() && !/^WEBVTT/.test(l) && !/^NOTE\b/.test(l));
    const timeIndex = lines.findIndex((l) => /-->/.test(l));
    if (timeIndex < 0) continue;
    const start = toSeconds(lines[timeIndex].split('-->')[0].trim().split(' ')[0]);
    // Remove marcações como <v Fulano> e tags de estilo, mantendo o nome de quem fala.
    const text = lines
      .slice(timeIndex + 1)
      .join(' ')
      .replace(/<v\s+([^>]+)>/g, '$1: ')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (text) chunks.push({ start, text });
  }
  return chunks;
}

/**
 * Lê texto com marcações de tempo, como a transcrição copiada do YouTube ("Mostrar transcrição"):
 * "0:05" numa linha e o texto na seguinte, ou "0:05 texto" / "[00:00:05] texto" na mesma linha.
 */
export function parseTimestampedText(raw) {
  const toSeconds = (t) => t.split(':').map(Number).reduce((acc, n) => acc * 60 + n, 0);
  const chunks = [];
  let current = null;
  for (const line of String(raw || '').replace(/\r/g, '').split('\n')) {
    const text = line.trim();
    // O painel de transcrição do YouTube, ao copiar, às vezes inclui o horário por extenso ("1 minuto e 5 segundos").
    if (!text || /^(\d+\s+(horas?|minutos?|segundos?|hours?|minutes?|seconds?)[,\s]*(e|and)?\s*)+$/i.test(text)) continue;
    const alone = text.match(/^[[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})[\])]?$/);
    const inline = text.match(/^[[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})[\])]?\s*[-–—:]?\s+(.+)$/);
    if (alone) {
      current = { start: toSeconds(alone[1]), text: '' };
      chunks.push(current);
    } else if (inline) {
      current = { start: toSeconds(inline[1]), text: inline[2] };
      chunks.push(current);
    } else if (current) {
      current.text += ` ${text}`;
    } else {
      return [];
    }
  }
  const valid = chunks.filter((c) => c.text.trim());
  return valid.length >= 2 ? valid : [];
}

/** Converte uma transcrição enviada pelo usuário (.vtt, .srt, texto do YouTube ou texto livre) para o formato da plataforma. */
export function normalizeTranscript(raw, fileName = '') {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.vtt' || ext === '.srt' || /-->/.test(raw)) {
    const chunks = parseSubtitles(raw);
    if (chunks.length) return formatTranscript(chunks);
  }
  const timed = parseTimestampedText(raw);
  if (timed.length) return formatTranscript(timed);
  return String(raw || '').replace(/\r\n/g, '\n').trim();
}

async function ffmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const mod = await import('@ffmpeg-installer/ffmpeg');
    return (mod.default || mod).path;
  } catch {
    return 'ffmpeg';
  }
}

function run(bin, args, { collectStdout = false } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args);
    const out = [];
    let err = '';
    proc.stdout.on('data', (d) => collectStdout && out.push(d));
    proc.stderr.on('data', (d) => (err += d.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => resolve({ code, stdout: Buffer.concat(out), stderr: err }));
  });
}

/** Duração do arquivo em segundos (lida da saída do ffmpeg). */
export async function probeDuration(file) {
  const { stderr } = await run(await ffmpegPath(), ['-hide_banner', '-i', file]);
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) throw new Error('Não foi possível ler a duração do arquivo (formato não suportado?).');
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Extrai um trecho do áudio como PCM mono 16 kHz (o formato que o Whisper espera). */
export async function readAudioSegment(file, start, length) {
  const { code, stdout, stderr } = await run(
    await ffmpegPath(),
    ['-hide_banner', '-loglevel', 'error', '-ss', String(start), '-t', String(length), '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1'],
    { collectStdout: true },
  );
  if (code !== 0) throw new Error(`Falha ao extrair o áudio: ${stderr.trim().slice(0, 300)}`);
  return new Float32Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 4));
}

/** Motor padrão: Whisper rodando localmente (transformers.js), sem enviar o áudio para fora. */
export function createWhisperEngine({ model, dtype, language = 'portuguese' }) {
  let pipelinePromise = null;
  const load = async () => {
    const { pipeline } = await import('@huggingface/transformers');
    console.log(`[transcrição] Carregando o modelo ${model} (na primeira vez ele é baixado; pode levar alguns minutos)…`);
    return pipeline('automatic-speech-recognition', model, { dtype });
  };
  return async function transcribe(samples) {
    pipelinePromise ||= load().catch((err) => {
      pipelinePromise = null;
      throw err;
    });
    const transcriber = await pipelinePromise;
    const out = await transcriber(samples, {
      language,
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
    });
    return (out.chunks || [{ timestamp: [0, 0], text: out.text }]).map((c) => ({
      start: c.timestamp?.[0] ?? 0,
      end: c.timestamp?.[1] ?? c.timestamp?.[0] ?? 0,
      text: c.text,
    }));
  };
}

const PASTE_HELP =
  'No YouTube, abra “…mais” na descrição do vídeo → “Mostrar transcrição”, copie o texto e cole em “Colar transcrição”.';
const YOUTUBE_FAILURES = {
  sem_legendas: `Este vídeo não tem legendas no YouTube. ${PASTE_HELP}`,
  bloqueado:
    'O YouTube bloqueou a leitura das legendas a partir deste servidor (ele pede login para “confirmar que não é um robô”, o que é comum em servidores de nuvem como o Codespace; no servidor da Active tende a funcionar). ' +
    `Por enquanto, cole a transcrição: ${PASTE_HELP}`,
  erro: `Não foi possível baixar as legendas do YouTube agora. Tente “Buscar legendas de novo” ou cole a transcrição: ${PASTE_HELP}`,
};

/**
 * Fila de transcrição: processa um vídeo/áudio por vez, em segundo plano, em partes de 5 minutos,
 * atualizando o progresso no banco. A transcrição vira o conteúdo pesquisável do item.
 * Vídeos do YouTube usam as legendas do próprio YouTube; sem legendas, o áudio é baixado com o yt-dlp
 * (se instalado) e transcrito pelo Whisper.
 * `onDone(id)` é chamado quando uma transcrição termina (usado para gerar os capítulos).
 */
export function createTranscriptionQueue({ repo, uploadsDir, engine, enabled = true, youtube = null, onDone = () => {} }) {
  const queue = [];
  let running = false;

  /** Transcreve um arquivo de áudio/vídeo local com o motor (Whisper), em partes. */
  async function transcribeFile(id, file, label) {
    const duration = await probeDuration(file);
    repo.setMedia(id, { duration });
    console.log(`[transcrição] Iniciando ${label} (${formatTime(duration)})`);
    const chunks = [];
    for (let start = 0; start < duration; start += SEGMENT_SECONDS) {
      const length = Math.min(SEGMENT_SECONDS, duration - start);
      const samples = await readAudioSegment(file, start, length);
      if (samples.length) {
        for (const c of await engine(samples)) chunks.push({ ...c, start: c.start + start, end: c.end + start });
      }
      const progress = Math.min(99, ((start + length) / duration) * 100);
      repo.setMedia(id, { progress });
      console.log(`[transcrição] ${label}: ${Math.round(progress)}%`);
    }
    return formatTranscript(chunks);
  }

  async function processYouTube(item, label) {
    const videoId = item.source_url?.match(/[?&]v=([\w-]{11})/)?.[1];
    if (!videoId || !youtube) throw new Error('Link do YouTube inválido.');
    console.log(`[transcrição] Buscando as legendas do YouTube de ${label}`);
    const { chunks, duration, failure = 'erro', attempts } = await youtube.transcript(videoId).catch((err) => {
      console.error(`[transcrição] Falha ao ler as legendas de ${label}:`, err.message);
      return { chunks: [], duration: null, failure: 'erro' };
    });
    if (!chunks.length && attempts) console.log(`[transcrição] Legendas de ${label} não lidas (${failure}): ${attempts}`);
    if (duration) repo.setMedia(item.id, { duration });
    if (chunks.length) {
      repo.setTranscript(item.id, formatTranscript(chunks), 'legendas');
      console.log(`[transcrição] Legendas do YouTube salvas para ${label}`);
      return true;
    }
    // Sem legendas: tenta baixar o áudio (yt-dlp) e transcrever com o Whisper.
    const message = YOUTUBE_FAILURES[failure] || YOUTUBE_FAILURES.erro;
    if (!enabled) throw new Error(message);
    const audio = await youtube.downloadAudio?.(videoId);
    if (!audio) throw new Error(message);
    try {
      repo.setTranscript(item.id, await transcribeFile(item.id, audio.file, label), 'concluida');
      return true;
    } finally {
      await audio.cleanup();
    }
  }

  async function processItem(id) {
    const item = repo.getItem(id, { full: true });
    if (!item || (item.kind !== 'file' && item.kind !== 'youtube')) return;
    const label = `#${id} "${item.title}"`;
    try {
      repo.setMedia(id, { status: 'processando', progress: 0, error: null });
      if (item.kind === 'youtube') {
        await processYouTube(item, label);
      } else {
        const text = await transcribeFile(id, path.join(uploadsDir, item.stored_name), label);
        repo.setTranscript(id, text, 'concluida');
      }
      console.log(`[transcrição] Concluída ${label}`);
      try {
        onDone(id);
      } catch (err) {
        console.error('[transcrição] Erro após concluir:', err.message);
      }
    } catch (err) {
      console.error(`[transcrição] Erro em ${label}:`, err.message);
      const missing = /Cannot find (package|module).*transformers|ERR_MODULE_NOT_FOUND/.test(err.message + err.code);
      repo.setMedia(id, {
        status: 'erro',
        error: missing
          ? 'O motor de transcrição não está instalado no servidor. Envie a transcrição manualmente (.vtt, .srt ou .txt).'
          : err.message,
      });
    }
  }

  async function work() {
    if (running) return;
    running = true;
    while (queue.length) await processItem(queue.shift());
    running = false;
  }

  return {
    enabled,
    enqueue(id) {
      // Vídeos do YouTube com legendas não dependem do motor de transcrição.
      const isYouTube = repo.getItem(id)?.kind === 'youtube';
      if (!enabled && !isYouTube) {
        repo.setMedia(id, { status: 'indisponivel', progress: 0 });
        return;
      }
      if (!queue.includes(id)) queue.push(id);
      repo.setMedia(id, { status: 'pendente', progress: 0, error: null });
      work();
    },
    /** Retoma transcrições interrompidas (por exemplo, se o servidor reiniciou no meio). */
    resume() {
      for (const id of repo.pendingTranscriptions()) {
        if (!enabled && repo.getItem(id)?.kind !== 'youtube') continue;
        if (!queue.includes(id)) queue.push(id);
      }
      work();
    },
    idle: () => !running && !queue.length,
  };
}

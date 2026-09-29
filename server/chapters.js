import { formatTime } from './transcribe.js';

// A mensagem para o agente precisa caber no limite do GPTMaker (~4.000 caracteres).
const MAX_PROMPT_CHARS = 3_400;

/** Conversa de uma pergunta só com a Active AI (qualquer motor) e devolve o texto da resposta. */
export async function askAssistant(ai, prompt, { sessionId, signal } = {}) {
  let text = '';
  let error = null;
  await ai.chat({
    history: [{ role: 'user', content: prompt }],
    sessionId,
    mode: 'livre',
    signal,
    emit: (event) => {
      if (event.type === 'text') text += event.text;
      else if (event.type === 'error') error = event.message;
    },
  });
  if (error) throw new Error(error);
  return text.trim();
}

/** Pedido de resumo e capítulos. Transcrições curtas vão junto; as longas o agente lê pelo MCP. */
export function buildChaptersPrompt(item, transcript) {
  const head = [
    '[Tarefa automática da Base de Conhecimento — não é uma pergunta de usuário]',
    `Crie um resumo e um índice de capítulos do vídeo “${item.title}” (documento #${item.id}${item.duration ? `, duração ${formatTime(item.duration)}` : ''}).`,
  ];
  const format = [
    'Responda somente neste formato, sem nada antes ou depois:',
    'RESUMO: <de 2 a 4 frases sobre o que o vídeo ensina>',
    'CAPITULOS:',
    '[hh:mm:ss] <assunto em poucas palavras>',
    'Use de 3 a 12 capítulos, em ordem, com os horários da transcrição (onde cada assunto começa). Não invente assuntos que não estão na transcrição.',
  ];
  const base = [...head, '', ...format].join('\n');
  const room = MAX_PROMPT_CHARS - base.length - 40;
  if (transcript.length <= room) return [...head, '', 'Transcrição:', transcript, '', ...format].join('\n');
  return [
    ...head,
    `Leia a transcrição completa com a ferramenta ler_documento da Base de Conhecimento (id ${item.id}). Ela tem ${transcript.length} caracteres: continue lendo com "inicio" até o fim antes de responder.`,
    '',
    ...format,
  ].join('\n');
}

/** Lê "RESUMO: …" e as linhas "[hh:mm:ss] assunto" da resposta do agente. */
export function parseChapters(text, duration = null) {
  const raw = String(text || '').replace(/\r/g, '');
  const toSeconds = (t) => t.split(':').map(Number).reduce((acc, n) => acc * 60 + n, 0);
  const summary = (raw.match(/RESUMO\s*:\s*([\s\S]*?)(?:\n\s*\**\s*CAP[IÍ]TULOS|$)/i)?.[1] || '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const seen = new Set();
  const chapters = [];
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*(?:[-*•]|\d+[.)])?\s*\**\s*[[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})[\])]?\**\s*[-–—:·|]?\s*(.+?)\s*$/);
    if (!m) continue;
    const start = toSeconds(m[1]);
    const title = m[2].replace(/\*\*/g, '').replace(/^[-–—:·|\s]+/, '').trim();
    if (!title || seen.has(start) || (duration && start > duration + 5)) continue;
    seen.add(start);
    chapters.push({ start, title: title.slice(0, 120) });
  }
  chapters.sort((a, b) => a.start - b.start);
  return { summary: summary.slice(0, 1500), chapters: chapters.slice(0, 20) };
}

/**
 * Fila que gera, com a Active AI, o resumo e os capítulos dos vídeos depois da transcrição.
 * Um vídeo por vez; o resultado aparece na tela do vídeo e é lido pelo agente no MCP.
 */
export function createChaptersQueue({ repo, ai, enabled = true, log = console }) {
  const queue = [];
  let running = false;

  async function processItem(id) {
    const item = repo.getItem(id, { full: true });
    if (!item) return;
    const transcript = item.text || '';
    if (!transcript.trim()) return;
    const label = `#${id} "${item.title}"`;
    try {
      repo.setChapters(id, { status: 'gerando', error: null });
      log.log(`[capítulos] Pedindo à Active AI o resumo e os capítulos de ${label}`);
      const reply = await askAssistant(ai, buildChaptersPrompt(item, transcript), { sessionId: `kb-capitulos-${id}-${Date.now().toString(36)}` });
      const { summary, chapters } = parseChapters(reply, item.duration);
      if (!chapters.length) {
        throw new Error(
          'A Active AI não devolveu os capítulos no formato esperado. Confira se o agente tem o MCP da Base de Conhecimento conectado e tente de novo.',
        );
      }
      repo.setChapters(id, { status: 'ok', summary, chapters, error: null });
      log.log(`[capítulos] ${label}: ${chapters.length} capítulo(s)`);
    } catch (err) {
      log.error(`[capítulos] Erro em ${label}:`, err.message);
      repo.setChapters(id, { status: 'erro', error: err.message });
    }
  }

  async function work() {
    if (running) return;
    running = true;
    while (queue.length) await processItem(queue.shift());
    running = false;
  }

  return {
    get available() {
      return enabled && ai.configured;
    },
    enqueue(id) {
      if (!enabled) return;
      if (!ai.configured) {
        repo.setChapters(id, { status: 'indisponivel', error: null });
        return;
      }
      if (!queue.includes(id)) queue.push(id);
      repo.setChapters(id, { status: 'pendente', error: null });
      work();
    },
    idle: () => !running && !queue.length,
  };
}

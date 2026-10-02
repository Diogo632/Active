import crypto from 'node:crypto';

/**
 * Busca semântica: cada documento é dividido em trechos e cada trecho vira um vetor de significado
 * (embedding), calculado no próprio servidor pelo modelo multilingual-e5 (transformers.js).
 * A pergunta também vira um vetor, e os trechos mais próximos são os mais parecidos em significado,
 * mesmo sem palavras em comum ("cliente não consegue tirar nota" ≈ "erro na emissão de NF-e").
 */

/** Divide o texto em trechos de ~`size` caracteres, cortando em quebras de linha ou espaços, com sobreposição. */
export function chunkText(text, { size = 900, overlap = 150, max = 400 } = {}) {
  const clean = String(text || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const chunks = [];
  let start = 0;
  while (start < clean.length && chunks.length < max) {
    let end = Math.min(clean.length, start + size);
    if (end < clean.length) {
      const window = clean.slice(start + Math.floor(size * 0.6), end);
      const cut = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('. '), window.lastIndexOf(' '));
      if (cut > 0) end = start + Math.floor(size * 0.6) + cut + 1;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks.filter(Boolean);
}

/** Motor padrão: multilingual-e5 (entende português), vetores normalizados de 384 dimensões. */
export function createE5Embedder({ model = 'Xenova/multilingual-e5-small', dtype = 'q8' } = {}) {
  let extractorPromise = null;
  const load = async () => {
    const { pipeline } = await import('@huggingface/transformers');
    console.log(`[busca semântica] Carregando o modelo ${model} (na primeira vez ele é baixado; pode levar alguns minutos)…`);
    return pipeline('feature-extraction', model, { dtype });
  };
  async function embed(texts, kind = 'passage') {
    extractorPromise ||= load().catch((err) => {
      extractorPromise = null;
      throw err;
    });
    const extractor = await extractorPromise;
    const prefix = kind === 'query' ? 'query: ' : 'passage: ';
    const out = [];
    for (let i = 0; i < texts.length; i += 16) {
      const batch = texts.slice(i, i + 16).map((t) => prefix + t);
      const tensor = await extractor(batch, { pooling: 'mean', normalize: true });
      for (const row of tensor.tolist()) out.push(Float32Array.from(row));
    }
    return out;
  }
  embed.model = model;
  return embed;
}

const toBlob = (vec) => Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
const fromBlob = (buf) => new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

/**
 * Índice semântico: guarda os trechos e vetores no banco (item_chunks) e uma cópia em memória para
 * a busca. A indexação roda em segundo plano, um documento por vez; documentos sem mudança são pulados.
 */
export function createSemanticIndex({ db, repo, embedder, enabled = true, minScore = 0.8, log = console }) {
  const modelName = embedder?.model || 'modelo';
  const memory = new Map(); // item_id -> [{ idx, text, vec }]
  const queue = [];
  let running = false;
  let failure = null;

  // Carrega os vetores já calculados.
  if (enabled) {
    for (const row of db.prepare('SELECT item_id, idx, text, embedding FROM item_chunks ORDER BY item_id, idx').all()) {
      if (!memory.has(row.item_id)) memory.set(row.item_id, []);
      memory.get(row.item_id).push({ idx: row.idx, text: row.text, vec: fromBlob(row.embedding) });
    }
  }

  const contentOf = (item) =>
    [
      item.title,
      item.summary,
      item.tags?.join(', '),
      item.kind === 'article' ? item.content : item.text,
      item.ai_summary,
      (item.chapters || []).map((c) => c.title).join('\n'),
    ]
      .filter(Boolean)
      .join('\n');

  const hashOf = (item) => crypto.createHash('sha1').update(`${modelName}\n${contentOf(item)}`).digest('hex');

  function remove(id) {
    memory.delete(id);
    db.prepare('DELETE FROM item_chunks WHERE item_id = ?').run(id);
  }

  async function indexItem(id) {
    const item = repo.getItem(id, { full: true });
    if (!item || item.temporary) return remove(id);
    const hash = hashOf(item);
    if (item.embedding_hash === hash && memory.has(id)) return;
    const body = [item.summary, item.kind === 'article' ? item.content : item.text, item.ai_summary].filter(Boolean).join('\n\n');
    const pieces = chunkText(body);
    // O título vai em todos os trechos: dá contexto a cada pedaço do documento.
    const passages = (pieces.length ? pieces : ['']).map((p) => `${item.title}${item.tags?.length ? ` (${item.tags.join(', ')})` : ''}\n${p}`.trim());
    const vectors = await embedder(passages, 'passage');
    db.transaction(() => {
      db.prepare('DELETE FROM item_chunks WHERE item_id = ?').run(id);
      const insert = db.prepare('INSERT INTO item_chunks (item_id, idx, text, embedding) VALUES (?, ?, ?, ?)');
      passages.forEach((text, idx) => insert.run(id, idx, text, toBlob(vectors[idx])));
      db.prepare('UPDATE items SET embedding_hash = ? WHERE id = ?').run(hash, id);
    })();
    memory.set(id, passages.map((text, idx) => ({ idx, text, vec: vectors[idx] })));
  }

  async function work() {
    if (running) return;
    running = true;
    let done = 0;
    while (queue.length && !failure) {
      const id = queue.shift();
      try {
        await indexItem(id);
        done++;
      } catch (err) {
        // Motor indisponível (módulo não instalado, modelo não baixou): para de tentar até reiniciar.
        failure = err.message;
        log.error(`[busca semântica] Desligada: ${err.message}. A busca continua por palavras.`);
      }
    }
    if (done && !failure) log.log(`[busca semântica] ${memory.size} documento(s) indexado(s).`);
    running = false;
  }

  const index = {
    get ready() {
      return enabled && !failure && memory.size > 0;
    },
    enqueue(id) {
      if (!enabled || failure) return;
      if (!queue.includes(id)) queue.push(id);
      work();
    },
    /** Indexa o que ainda não tem vetores ou mudou (chamado ao iniciar). */
    resume() {
      if (!enabled) return;
      for (const { id } of db.prepare('SELECT id FROM items WHERE temporary = 0 ORDER BY id').all()) if (!queue.includes(id)) queue.push(id);
      // Remove vetores de documentos que não existem mais.
      for (const id of memory.keys()) if (!repo.getItem(id)) remove(id);
      work();
    },
    /** Documentos mais parecidos em significado: [{ id, score, text }], do mais para o menos parecido. */
    async search(query, { limit = 20 } = {}) {
      if (!index.ready || !String(query || '').trim()) return [];
      const [q] = await embedder([query], 'query');
      const best = [];
      for (const [id, chunks] of memory) {
        let top = null;
        for (const c of chunks) {
          const score = dot(q, c.vec);
          if (!top || score > top.score) top = { id, score, text: c.text };
        }
        if (top && top.score >= minScore) best.push(top);
      }
      best.sort((a, b) => b.score - a.score);
      return best.slice(0, limit);
    },
    status: () => ({ enabled, ready: index.ready, model: modelName, indexed: memory.size, pending: queue.length, error: failure }),
    idle: () => !running && !queue.length,
  };
  return index;
}

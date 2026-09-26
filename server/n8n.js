import { sanitizeHistory } from './ai.js';

// Palavras comuns que não ajudam a encontrar documentos.
const STOPWORDS = new Set(`
a o as os um uma uns umas de do da dos das no na nos nas em por para pra pro com sem sob sobre
e ou mas que se como qual quais quando onde porque porquê quem cujo isso isto esse essa este esta
aquele aquela eu tu ele ela nós vós eles elas me te lhe nos vos meu minha seu sua nosso nossa
ao aos às pelo pela pelos pelas até após entre também já não sim muito mais menos
é são foi ser estar está estão tem têm ter há faço fazer faz pode posso podemos consigo preciso
algum alguma alguns algumas todo toda todos todas outro outra outros outras mesmo mesma
temos existe existem sei saber quero gostaria favor ajuda ajudar me explique explica diga
`.split(/\s+/).filter(Boolean));

const DEFAULTS = {
  maxDocuments: 5,
  // Tamanho máximo da mensagem enviada ao agente. O GPTMaker só enxerga ~4.000 caracteres por
  // mensagem; o conteúdo completo dos documentos o agente lê pelo MCP (ferramenta ler_documento).
  maxPromptChars: 3_500,
  chunkChars: 400,
  timeoutMs: 120_000,
  // true: a mensagem enviada ao workflow já leva os documentos da base junto com a pergunta.
  // false: envia só a pergunta (use quando o workflow consulta a base sozinho pela API de integração).
  includeContext: true,
};

/** Extrai palavras-chave de uma pergunta em linguagem natural. */
export function keywords(text) {
  const words = String(text || '')
    .toLowerCase()
    .match(/[\p{L}\p{N}_]+/gu);
  if (!words) return [];
  return [...new Set(words.filter((w) => (w.length > 2 || /\d/.test(w)) && !STOPWORDS.has(w)))].slice(0, 12);
}

const normalize = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Escolhe os trechos de um texto que mais mencionam as palavras-chave, até `budget` caracteres. */
export function bestExcerpts(text, terms, budget, chunkChars = DEFAULTS.chunkChars) {
  if (!text) return '';
  if (text.length <= budget) return text;
  const normTerms = terms.map(normalize);
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkChars) {
    const chunk = text.slice(i, i + chunkChars);
    const norm = normalize(chunk);
    const score = normTerms.reduce((n, t) => n + (norm.split(t).length - 1), 0);
    chunks.push({ i, chunk, score });
  }
  const picked = [...chunks]
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, Math.max(1, Math.floor(budget / chunkChars)))
    .sort((a, b) => a.i - b.i);
  return picked.map((c) => (c.i > 0 ? '[…] ' : '') + c.chunk.trim()).join('\n');
}

/** Lê a resposta do n8n aceitando os formatos mais comuns (JSON do GPTMaker, do nó "Respond to Webhook" ou texto puro). */
export function extractReply(body) {
  if (body == null) return '';
  if (typeof body === 'string') return body.trim();
  if (Array.isArray(body)) return body.map(extractReply).filter(Boolean).join('\n\n');
  for (const key of ['resposta', 'output', 'response', 'message', 'text', 'answer', 'reply', 'content']) {
    const value = body[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object') {
      const nested = extractReply(value);
      if (nested) return nested;
    }
  }
  if (body.json) return extractReply(body.json);
  if (body.data) return extractReply(body.data);
  return '';
}

/** Opções de resposta (botões) enviadas pelo workflow em um campo próprio, se houver. */
export function extractOptions(body) {
  if (!body || typeof body !== 'object') return [];
  if (Array.isArray(body)) return body.flatMap(extractOptions);
  for (const key of ['options', 'opcoes', 'opções', 'buttons', 'botoes', 'quick_replies', 'quickReplies', 'sugestoes', 'suggestions']) {
    if (Array.isArray(body[key])) {
      return body[key]
        .map((o) => (typeof o === 'string' ? o : o?.label || o?.text || o?.title || o?.value || ''))
        .map((o) => String(o).trim())
        .filter(Boolean)
        .slice(0, 8);
    }
  }
  for (const key of ['json', 'data', 'output', 'response']) {
    if (body[key] && typeof body[key] === 'object') {
      const nested = extractOptions(body[key]);
      if (nested.length) return nested;
    }
  }
  return [];
}


/**
 * Mensagem enxuta para o agente: pergunta + referências curtas aos documentos (id, título, trecho).
 * Cabe no limite do GPTMaker; o conteúdo completo o agente lê pelo MCP da Base de Conhecimento.
 */
export function buildPrompt({ question, documents, contextItem, maxChars = DEFAULTS.maxPromptChars }) {
  const header = [
    '[Consulta feita pela Base de Conhecimento do Suporte]',
    'Para ler o conteúdo completo de um documento, use a ferramenta ler_documento (MCP da Base de Conhecimento) com o id indicado; para procurar outros, use buscar_documentos.',
    'Cite os documentos usados como [Título](#/item/ID). Se a base não tiver a resposta, use seu conhecimento e deixe isso claro.',
    contextItem ? `Documento aberto na tela: #${contextItem.id} “${contextItem.title}” — é a ele que “este documento” se refere.` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const tail = `\n\nPergunta: ${question}`;

  let budget = maxChars - header.length - tail.length - 40;
  const lines = [];
  for (const d of documents) {
    const meta = `- #${d.id} [${d.titulo}](${d.link}) · ${d.categoria}${d.parcial ? ` · ${d.total_caracteres} caracteres (leia com ler_documento)` : ''}`;
    if (budget < meta.length + 1) break;
    budget -= meta.length + 1;
    let line = meta;
    const excerpt = (d.conteudo || '').replace(/\s+/g, ' ').trim();
    // Divide o espaço restante entre os documentos que ainda faltam.
    const room = Math.min(excerpt.length, Math.floor(budget / Math.max(documents.length - lines.length, 1)) - 6);
    if (room > 60) {
      line += `\n  “${excerpt.slice(0, room)}${room < excerpt.length ? '…' : ''}”`;
      budget -= room + 6;
    }
    lines.push(line);
  }
  const docs = lines.length ? `\n\nDocumentos da base relacionados:\n${lines.join('\n')}` : '';
  return `${header}${docs}${tail}`;
}

/**
 * Active AI via webhook do n8n (por exemplo, um fluxo que chama um agente do GPTMaker).
 * A plataforma pesquisa a base, monta o contexto com os trechos relevantes e envia tudo ao webhook.
 */
export function createN8nActiveIA({ repo, webhookUrl, token, options = {} }) {
  const cfg = { ...DEFAULTS, ...options };

  function retrieve(question, contextItemId) {
    const terms = keywords(question);
    const found = terms.length ? repo.search(terms.join(' '), { limit: cfg.maxDocuments }) : [];
    const ids = [...new Set([contextItemId, ...found.map((f) => f.id)].filter(Boolean))].slice(0, cfg.maxDocuments);
    const items = ids.map((id) => repo.getItem(id, { full: true })).filter(Boolean);

    // Só trechos curtos: o conteúdo completo o agente lê pelo MCP.
    const budget = Math.floor(cfg.maxPromptChars / Math.max(items.length, 1));
    return items.map((item) => {
      const body = (item.kind === 'article' ? item.content : item.text) || '';
      const conteudo = bestExcerpts(body, terms, budget, cfg.chunkChars);
      return {
        id: item.id,
        titulo: item.title,
        tipo: item.kind === 'article' ? 'texto' : `arquivo ${item.file_name || ''}`.trim(),
        categoria: item.category_name || 'Sem categoria',
        tags: item.tags,
        resumo: item.summary || '',
        link: `#/item/${item.id}`,
        conteudo,
        parcial: conteudo.length < body.length,
        total_caracteres: body.length,
        kind: item.kind,
      };
    });
  }

  /**
   * mode 'livre': conversa livre — envia só a pergunta; o agente usa a base própria (RAG do GPTMaker)
   *               e, se configurado, o MCP desta plataforma.
   * mode 'base':  a plataforma pesquisa a base e envia os documentos encontrados junto com a pergunta
   *               (usado na resposta da busca e quando há um documento em foco).
   */
  async function chat({ history, contextItemId, sessionId, mode = 'base', emit, signal }) {
    if (!webhookUrl) {
      emit({ type: 'error', message: 'A Active AI ainda não foi configurada. Defina N8N_WEBHOOK_URL no arquivo .env do servidor.' });
      return;
    }
    const messages = sanitizeHistory(history);
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'user') {
      emit({ type: 'error', message: 'Envie uma pergunta para a Active AI.' });
      return;
    }

    const contextItem = contextItemId ? repo.getItem(contextItemId) : null;
    // Com um documento em foco, a mensagem leva a referência a ele (id e título) para o agente ler pelo MCP.
    const useBase = cfg.includeContext && (mode === 'base' || Boolean(contextItem));
    let documents = [];
    let prompt = last.content;
    if (useBase) {
      emit({ type: 'status', label: 'Pesquisando documentos na base' });
      // Perguntas curtas de continuação ("e o passo 3?") usam também a pergunta anterior na busca.
      const previousUser = messages.filter((m) => m.role === 'user').slice(-2, -1)[0]?.content || '';
      documents = retrieve(`${last.content} ${keywords(last.content).length < 3 ? previousUser : ''}`, contextItem?.id);
      prompt = buildPrompt({ question: last.content, documents, contextItem, maxChars: cfg.maxPromptChars });
    }
    const message = prompt;

    emit({ type: 'status', label: 'Consultando a Active AI' });
    const timeout = AbortSignal.timeout(cfg.timeoutMs);
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/plain',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        // Os mesmos dados vão em vários nomes de campo para funcionar com workflows já existentes,
        // como o Chat Trigger do n8n (action/chatInput/sessionId) ou webhooks próprios (message, mensagem…).
        body: JSON.stringify({
          action: 'sendMessage',
          sessionId: sessionId || 'base-conhecimento',
          contextId: sessionId || 'base-conhecimento',
          chatInput: message,
          message,
          mensagem: message,
          text: message,
          origem: 'base-de-conhecimento',
          pergunta: last.content,
          // Campo lido pelo workflow da Active AI (GPT Maker — Texto: { contextId, prompt }).
          prompt: message,
          historico: messages.slice(0, -1),
          documento_aberto: contextItem ? { id: contextItem.id, titulo: contextItem.title } : null,
          documentos: documents.map(({ kind, ...d }) => d),
        }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      const raw = await res.text();
      if (!res.ok) {
        console.error(`[active-ai/n8n] HTTP ${res.status}: ${raw.slice(0, 500)}`);
        emit({ type: 'error', message: `O fluxo do n8n retornou erro ${res.status}. Verifique se o workflow está ativo.` });
        return;
      }
      let body = raw;
      try {
        body = JSON.parse(raw);
      } catch {
        /* resposta em texto puro */
      }
      const reply = extractReply(body);
      if (!reply) {
        console.error('[active-ai/n8n] Resposta sem texto reconhecível:', raw.slice(0, 500));
        emit({ type: 'error', message: 'O n8n respondeu, mas sem texto. Confira o nó "Respond to Webhook" do fluxo.' });
        return;
      }
      emit({ type: 'text', text: reply });
      const options = extractOptions(body);
      if (options.length) emit({ type: 'options', items: options });
      if (documents.length) {
        emit({ type: 'sources', items: documents.map((d) => ({ id: d.id, title: d.titulo, kind: d.kind, read: true })) });
      }
    } catch (err) {
      if (signal?.aborted) return;
      console.error('[active-ai/n8n] Erro:', err);
      emit({
        type: 'error',
        message:
          err.name === 'TimeoutError'
            ? 'A Active AI demorou demais para responder. Tente novamente.'
            : 'Não foi possível conectar ao n8n. Verifique N8N_WEBHOOK_URL e se o servidor tem acesso a ele.',
      });
    }
  }

  return { configured: Boolean(webhookUrl), model: 'n8n', provider: 'n8n', chat };
}

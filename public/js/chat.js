import { api } from './api.js';
import { esc, icon, renderMarkdown, storage, hydrateIcons } from './util.js';

const STORAGE_KEY = 'kb-ia-conversation';
const SESSION_KEY = 'kb-ia-session';

const newSessionId = () =>
  `kb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const SUGGESTIONS = [
  'Como emito um CT-e no ActiveTrans?',
  'Quais documentos temos sobre o processo de um cliente?',
  'Como validar um arquivo EDI?',
  'O que você sabe fazer?',
];

const DOC_SUGGESTIONS = [
  'Resuma este documento em tópicos.',
  'Quais são os passos principais descritos aqui?',
  'Existe algum outro documento na base relacionado a este?',
];

/** Estado único da conversa, compartilhado pelo painel lateral e pela página do Active IA. */
const state = {
  messages: storage.get(STORAGE_KEY, []).filter((m) => m && m.content),
  // Identifica a conversa no n8n/GPTMaker, que guarda o histórico por sessão.
  sessionId: storage.get(SESSION_KEY) || newSessionId(),
  context: null, // { id, title } do documento aberto
  streaming: false,
  controller: null,
  configured: true,
};

const listeners = new Set();
let frame = 0;
function notify() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    listeners.forEach((fn) => fn());
  });
}

function persist() {
  storage.set(SESSION_KEY, state.sessionId);
  storage.set(
    STORAGE_KEY,
    state.messages.slice(-40).map(({ role, content, sources }) => ({ role, content, sources })),
  );
}

export const chat = {
  state,

  setConfigured(value) {
    state.configured = value;
    notify();
  },

  setContext(item) {
    state.context = item ? { id: item.id, title: item.title } : null;
    notify();
  },

  reset() {
    state.controller?.abort();
    state.messages = [];
    state.sessionId = newSessionId();
    persist();
    notify();
  },

  /** Abre no chat uma conversa iniciada pela resposta da busca, mantendo a mesma sessão no agente. */
  continueWith({ question, answer, sources = [], sessionId }) {
    state.controller?.abort();
    state.messages = [
      { role: 'user', content: question },
      { role: 'assistant', content: answer, sources },
    ];
    state.sessionId = sessionId || newSessionId();
    persist();
    notify();
  },

  stop() {
    state.controller?.abort();
  },

  async send(text) {
    const content = text.trim();
    if (!content || state.streaming) return;

    state.messages.push({ role: 'user', content });
    const reply = { role: 'assistant', content: '', status: [], sources: [], error: null, pending: true };
    state.messages.push(reply);
    state.streaming = true;
    state.controller = new AbortController();
    notify();

    const history = state.messages
      .filter((m) => m !== reply && !m.error)
      .map(({ role, content: c }) => ({ role, content: c }));

    try {
      await api.chat({
        messages: history,
        contextItemId: state.context?.id,
        sessionId: state.sessionId,
        // Conversa livre: o agente usa o conhecimento próprio (RAG do GPTMaker) e o MCP da base.
        mode: 'livre',
        signal: state.controller.signal,
        onEvent(event) {
          switch (event.type) {
            case 'text':
              reply.content += event.text;
              reply.status.forEach((s) => (s.done = true));
              break;
            case 'status':
              reply.status.forEach((s) => (s.done = true));
              reply.status.push({ label: event.label, done: false });
              break;
            case 'sources':
              reply.sources = event.items;
              break;
            case 'error':
              reply.error = event.message;
              break;
          }
          notify();
        },
      });
    } catch (err) {
      if (err.name !== 'AbortError') reply.error = err.message || 'Falha ao falar com o Active IA.';
    }

    reply.content = reply.content.trim();
    reply.pending = false;
    reply.status.forEach((s) => (s.done = true));
    if (!reply.content && !reply.error) {
      if (state.controller.signal.aborted) reply.content = '_Resposta interrompida._';
      else reply.error = 'O Active IA não retornou uma resposta.';
    }
    state.streaming = false;
    state.controller = null;
    persist();
    notify();
  },
};

function renderMessage(msg) {
  if (msg.role === 'user') {
    return `<div class="msg msg-user"><div class="bubble">${esc(msg.content)}</div></div>`;
  }
  const status = msg.status?.length
    ? `<div class="ia-status">${msg.status
        .map((s) => `<div>${s.done ? icon('check') : '<span class="spinner"></span>'}<span>${esc(s.label)}</span></div>`)
        .join('')}</div>`
    : '';
  const body = msg.content
    ? `<div class="prose">${renderMarkdown(msg.content)}</div>`
    : msg.pending && !msg.status?.some((s) => !s.done)
      ? '<div class="typing"><span></span><span></span><span></span></div>'
      : '';
  const error = msg.error ? `<div class="msg-error">${esc(msg.error)}</div>` : '';
  const sources = msg.sources?.length
    ? `<div class="ia-sources"><span>Documentos consultados:</span>${msg.sources
        .map((s) => `<a href="#/item/${s.id}" title="${esc(s.title)}">${icon(s.kind === 'article' ? 'article' : 'file')}<span>${esc(s.title)}</span></a>`)
        .join('')}</div>`
    : '';
  return `
    <div class="msg msg-ai">
      <div class="ia-avatar">AI</div>
      <div class="bubble">${status}${body}${error}${sources}</div>
    </div>`;
}

/**
 * Monta a interface do chat dentro de `container`.
 * variant: 'drawer' (painel lateral) ou 'page' (página inteira).
 * Retorna uma função que desmonta o componente.
 */
export function mountChat(container, { variant = 'drawer', onClose, onExpand } = {}) {
  container.innerHTML = `
    <section class="ia">
      <header class="ia-header">
        <div class="ia-avatar">AI</div>
        <div class="spacer">
          <h2>Active IA</h2>
          <small>Assistente interna — processos e sistemas</small>
        </div>
        <button class="icon-btn" data-action="reset" type="button" title="Nova conversa">${icon('refresh')}</button>
        ${variant === 'drawer' ? `<button class="icon-btn" data-action="expand" type="button" title="Abrir em tela cheia">${icon('expand')}</button>` : ''}
        ${variant === 'drawer' ? `<button class="icon-btn" data-action="close" type="button" title="Fechar">${icon('close')}</button>` : ''}
      </header>
      <div class="ia-context" hidden></div>
      <div class="ia-unconfigured" hidden>O Active IA ainda não foi configurado no servidor (defina <code>N8N_WEBHOOK_URL</code> no arquivo <code>.env</code>).</div>
      <div class="ia-messages" aria-live="polite"></div>
      <div class="ia-composer">
        <form>
          <textarea rows="1" placeholder="Pergunte qualquer coisa ao Active IA…" aria-label="Mensagem para o Active IA"></textarea>
          <button class="send" type="submit" title="Enviar">${icon('send')}</button>
        </form>
        <div class="hint">O Active IA pode cometer erros. Confirme informações críticas nos documentos citados.</div>
      </div>
    </section>`;

  const messagesEl = container.querySelector('.ia-messages');
  const contextEl = container.querySelector('.ia-context');
  const unconfiguredEl = container.querySelector('.ia-unconfigured');
  const form = container.querySelector('form');
  const textarea = container.querySelector('textarea');
  const sendBtn = container.querySelector('.send');

  const autosize = () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  };

  function render() {
    const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;

    if (state.context) {
      contextEl.hidden = false;
      contextEl.innerHTML = `${icon('file')}<span>Documento em foco: <strong>${esc(state.context.title)}</strong></span>
        <button type="button" data-action="clear-context" title="Remover o documento do contexto">${icon('close')}</button>`;
    } else contextEl.hidden = true;
    unconfiguredEl.hidden = state.configured;

    if (!state.messages.length) {
      const suggestions = state.context ? DOC_SUGGESTIONS : SUGGESTIONS;
      messagesEl.innerHTML = `
        <div class="ia-welcome">
          <div class="ia-avatar">AI</div>
          <h3>Olá! Eu sou o Active IA.</h3>
          <p>Pergunte o que quiser sobre processos, sistemas e clientes da Active. Respondo com o meu conhecimento e consulto a Base de Conhecimento quando preciso.</p>
          <div class="suggestions">${suggestions.map((s) => `<button type="button" data-suggestion="${esc(s)}">${esc(s)}</button>`).join('')}</div>
        </div>`;
    } else {
      messagesEl.innerHTML = state.messages.map(renderMessage).join('');
    }

    sendBtn.innerHTML = state.streaming ? icon('stop') : icon('send');
    sendBtn.title = state.streaming ? 'Parar resposta' : 'Enviar';
    if (nearBottom || state.streaming) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (state.streaming) return chat.stop();
    const text = textarea.value;
    if (!text.trim()) return;
    textarea.value = '';
    autosize();
    chat.send(text);
  });

  textarea.addEventListener('input', autosize);
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  container.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action], [data-suggestion], a[href^="#/"]');
    if (!target) return;
    if (target.dataset.suggestion) chat.send(target.dataset.suggestion);
    else if (target.dataset.action === 'reset') chat.reset();
    else if (target.dataset.action === 'close') onClose?.();
    else if (target.dataset.action === 'expand') onExpand?.();
    else if (target.dataset.action === 'clear-context') chat.setContext(null);
    else if (target.matches('a[href^="#/"]') && variant === 'drawer' && window.innerWidth < 860) onClose?.();
  });

  listeners.add(render);
  render();
  hydrateIcons(container);

  return {
    focus: () => textarea.focus(),
    unmount: () => listeners.delete(render),
  };
}

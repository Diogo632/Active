import { api } from './api.js';
import { chat } from './chat.js';
import { esc, icon, renderMarkdown, hydrateIcons } from './util.js';

// Respostas já geradas nesta visita, para não chamar o agente de novo ao voltar à mesma busca.
const cache = new Map();

const newSession = () => `kb-busca-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Cartão "Resposta do Active IA" exibido no topo dos resultados de uma busca.
 * A plataforma pesquisa a base e envia os documentos encontrados ao agente junto com a pergunta.
 */
export function mountAnswer(container, question) {
  const key = question.trim().toLowerCase();
  let state = cache.get(key);
  let controller = null;

  const render = () => {
    const { status, text, sources, error, done } = state;
    container.innerHTML = `
      <section class="answer-card">
        <header>
          <div class="ia-avatar">AI</div>
          <strong>Resposta do Active IA</strong>
          ${done ? '' : `<span class="answer-status"><span class="spinner"></span>${esc(status || 'Pensando…')}</span>`}
        </header>
        ${error ? `<div class="msg-error">${esc(error)}</div>` : ''}
        ${text ? `<div class="prose answer-body">${renderMarkdown(text)}</div>` : done || error ? '' : '<div class="answer-skeleton"><span></span><span></span><span></span></div>'}
        ${
          sources.length
            ? `<div class="ia-sources"><span>Baseado em:</span>${sources
                .map((s) => `<a href="#/item/${s.id}" title="${esc(s.title)}">${icon(s.kind === 'article' ? 'article' : 'file')}<span>${esc(s.title)}</span></a>`)
                .join('')}</div>`
            : ''
        }
        ${
          done && text
            ? `<footer><button class="btn btn-sm" type="button" data-continue>${icon('chat')}Continuar a conversa</button>
               <span class="muted small">Confira as informações importantes nos documentos citados.</span></footer>`
            : ''
        }
      </section>`;
    hydrateIcons(container);
  };

  container.addEventListener('click', (e) => {
    if (!e.target.closest('[data-continue]')) return;
    chat.continueWith({ question, answer: state.text, sources: state.sources, sessionId: state.sessionId });
    document.dispatchEvent(new CustomEvent('open-ia'));
  });

  if (state) {
    render();
  } else {
    state = { status: 'Pesquisando na base', text: '', sources: [], error: null, done: false, sessionId: newSession() };
    cache.set(key, state);
    render();
    controller = new AbortController();
    api
      .chat({
        messages: [{ role: 'user', content: question }],
        sessionId: state.sessionId,
        mode: 'base',
        signal: controller.signal,
        onEvent(event) {
          if (event.type === 'status') state.status = event.label;
          else if (event.type === 'text') state.text += event.text;
          else if (event.type === 'sources') state.sources = event.items;
          else if (event.type === 'error') state.error = event.message;
          render();
        },
      })
      .catch((err) => {
        if (err.name !== 'AbortError') state.error = err.message;
      })
      .finally(() => {
        state.text = state.text.trim();
        state.done = true;
        // Uma resposta interrompida (usuário saiu da página) não fica no cache.
        if (controller?.signal.aborted && !state.text) cache.delete(key);
        if (!state.text && !state.error && !controller?.signal.aborted) state.error = 'O Active IA não retornou uma resposta.';
        render();
      });
  }

  return () => controller?.abort();
}

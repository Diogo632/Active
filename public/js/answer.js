import { api } from './api.js';
import { chat } from './chat.js';
import { esc, icon, renderMarkdown, hydrateIcons, analysisToggle, analysisPanel } from './util.js';
import { parseOptions, normalizeOptions } from './options.js';
import { fadeUp, popIn, revealProse, pulse } from './motion.js';
import { answerActionsHtml, voteAnswer } from './feedback.js';

// Respostas já geradas nesta visita, para não chamar o agente de novo ao voltar à mesma busca.
const cache = new Map();

const newSession = () => `kb-busca-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Cartão "Resposta da Active AI" exibido no topo dos resultados de uma busca.
 * A plataforma pesquisa a base e envia os documentos encontrados ao agente junto com a pergunta.
 */
export function mountAnswer(container, question) {
  const key = question.trim().toLowerCase();
  let state = cache.get(key);
  let controller = null;

  let animated = false;
  const render = () => {
    const { status, text, sources, error, done, options = [] } = state;
    container.innerHTML = `
      <section class="answer-card">
        <header>
          <div class="ia-avatar">AI</div>
          <strong>Resposta da Active AI</strong>
          ${done && state.analysis ? analysisToggle(Boolean(state.showAnalysis)) : ''}
          ${done ? '' : `<span class="answer-status"><span class="spinner"></span>${esc(status || 'Pensando…')}</span>`}
        </header>
        ${done && state.analysis && state.showAnalysis ? analysisPanel(state.analysis) : ''}
        ${error ? `<div class="msg-error">${esc(error)}</div>` : ''}
        ${text ? `<div class="prose answer-body">${renderMarkdown(text)}</div>` : done || error ? '' : '<div class="answer-skeleton"><span></span><span></span><span></span></div>'}
        ${
          done && options.length
            ? `<div class="ia-options" role="group" aria-label="Opções de resposta">${options
                .map((o) => `<button type="button" class="ia-option" data-option="${esc(o)}">${esc(o)}</button>`)
                .join('')}</div>`
            : ''
        }
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
               ${answerActionsHtml({ vote: state.vote, content: text })}</footer>
               <p class="muted small answer-note">Confira as informações importantes nos documentos citados.</p>`
            : ''
        }
      </section>`;
    hydrateIcons(container);
    const card = container.querySelector('.answer-card');
    if (!animated) {
      fadeUp([card], { y: 10, duration: 380 });
      animated = true;
    }
    if (done && text && !state.revealed) {
      revealProse(card.querySelector('.answer-body'));
      popIn(card.querySelectorAll('.ia-option'), { delay: 200, stagger: 70 });
      popIn(card.querySelectorAll('.ia-sources a, footer > *'), { delay: 300, stagger: 50 });
      state.revealed = true;
    }
  };

  container.addEventListener('click', async (e) => {
    if (e.target.closest('[data-analysis-toggle]')) {
      state.showAnalysis = !state.showAnalysis;
      return render();
    }
    const vote = e.target.closest('[data-vote]');
    if (vote) {
      if (state.vote) return;
      pulse(vote);
      if (await voteAnswer({ question, answer: state.text, helpful: vote.dataset.vote === 'up' })) {
        state.vote = vote.dataset.vote;
        render();
      }
      return;
    }
    const option = e.target.closest('[data-option]');
    if (!option && !e.target.closest('[data-continue]')) return;
    if (option) pulse(option);
    // Continua no chat, na mesma sessão do agente; ao escolher uma opção, ela já é enviada.
    chat.continueWith({ question, answer: state.text, sources: state.sources, options: state.options, analysis: state.analysis, sessionId: state.sessionId });
    document.dispatchEvent(new CustomEvent('open-ia'));
    if (option) setTimeout(() => chat.send(option.dataset.option), 160);
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
          else if (event.type === 'options') state.options = normalizeOptions(event.items);
          else if (event.type === 'analysis') state.analysis = event.text;
          else if (event.type === 'error') state.error = event.message;
          render();
        },
      })
      .catch((err) => {
        if (err.name !== 'AbortError') state.error = err.message;
      })
      .finally(() => {
        const parsed = parseOptions(state.text);
        state.text = parsed.text;
        state.options = normalizeOptions([...(state.options || []), ...parsed.options]);
        state.done = true;
        // Uma resposta interrompida (usuário saiu da página) não fica no cache.
        if (controller?.signal.aborted && !state.text) cache.delete(key);
        if (!state.text && !state.error && !controller?.signal.aborted) state.error = 'A Active AI não retornou uma resposta.';
        render();
      });
  }

  return () => controller?.abort();
}

import { api } from './api.js';
import { icon, esc, promptDialog, toast } from './util.js';
import { draftFromAnswer, openDraft } from './templates.js';

/** Botões "Ajudou? 👍 👎" e "Salvar como documento" de uma resposta da Active AI. */
export function answerActionsHtml({ vote = null } = {}) {
  const btn = (value, name, label) =>
    `<button type="button" class="vote${vote === value ? ' chosen' : ''}" data-vote="${value}" title="${label}" aria-label="${label}"${vote ? ' disabled' : ''}>${icon(name)}</button>`;
  return `
    <div class="answer-actions">
      ${vote ? `<span class="muted small">${vote === 'up' ? 'Obrigado!' : 'Obrigado, vamos melhorar.'}</span>` : '<span class="muted small">Ajudou?</span>'}
      ${btn('up', 'thumbsUp', 'Ajudou')}${btn('down', 'thumbsDown', 'Não ajudou')}
      <button type="button" class="btn btn-sm" data-save-doc title="Transformar esta resposta em um texto da base">${icon('save')}Salvar como documento</button>
    </div>`;
}

/**
 * Registra a avaliação de uma resposta. Em "não ajudou", pede um comentário opcional;
 * a pergunta entra no relatório de lacunas.
 */
export async function voteAnswer({ question, answer, helpful }) {
  let comment = '';
  if (!helpful) {
    comment =
      (await promptDialog({
        title: 'O que faltou nesta resposta?',
        message: 'Opcional. A pergunta vai para o relatório de lacunas, para o time escrever o documento que falta.',
        placeholder: 'Ex.: a resposta não fala da tela nova de emissão…',
        confirmLabel: 'Enviar',
        skipLabel: 'Pular',
      })) || '';
  }
  try {
    await api.feedback({ target: 'resposta', helpful, question, answer, comment });
    toast(helpful ? 'Obrigado pela avaliação!' : 'Obrigado! A pergunta foi para o relatório de lacunas.');
    return true;
  } catch (err) {
    toast(err.message, 'error');
    return false;
  }
}

/** Abre o editor com a resposta já no modelo Problema → Causa → Solução. */
export function saveAnswerAsDocument({ question, answer }) {
  openDraft(draftFromAnswer({ question, answer }));
}

/** Bloco "Este documento ajudou?" da página de um documento. */
export function mountDocFeedback(container, item) {
  const key = `kb-voto-doc-${item.id}`;
  let voted = null;
  try {
    voted = localStorage.getItem(key);
  } catch {
    /* sem armazenamento local */
  }
  let counts = { ...(item.feedback || { up: 0, down: 0 }) };

  const render = () => {
    const total = counts.up + counts.down;
    container.innerHTML = `
      <div class="card card-pad doc-feedback">
        <strong>${voted ? 'Obrigado pela avaliação!' : 'Este documento ajudou?'}</strong>
        <div class="row">
          <button type="button" class="vote${voted === 'up' ? ' chosen' : ''}" data-vote="up" title="Ajudou"${voted ? ' disabled' : ''}>${icon('thumbsUp')}<span>Sim</span></button>
          <button type="button" class="vote${voted === 'down' ? ' chosen' : ''}" data-vote="down" title="Não ajudou"${voted ? ' disabled' : ''}>${icon('thumbsDown')}<span>Não</span></button>
        </div>
        ${total ? `<span class="muted small">${esc(`${counts.up} de ${total} ${total === 1 ? 'pessoa achou' : 'pessoas acharam'} útil`)}</span>` : ''}
      </div>`;
  };

  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-vote]');
    if (!btn || voted) return;
    const helpful = btn.dataset.vote === 'up';
    let comment = '';
    if (!helpful) {
      comment =
        (await promptDialog({
          title: 'O que faltou ou está errado?',
          message: 'Opcional, mas ajuda quem mantém o documento.',
          placeholder: 'Ex.: o passo 3 mudou na versão nova do sistema…',
          confirmLabel: 'Enviar',
          skipLabel: 'Pular',
        })) || '';
    }
    try {
      await api.feedback({ target: 'documento', item_id: item.id, helpful, comment });
      voted = btn.dataset.vote;
      counts = { ...counts, [voted]: counts[voted] + 1 };
      try {
        localStorage.setItem(key, voted);
      } catch {
        /* sem armazenamento local */
      }
      render();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  render();
}

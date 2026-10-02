import { api } from './api.js';
import { icon, esc, promptDialog, toast } from './util.js';

// Só respostas longas (explicações, procedimentos) recebem "Ajudou?"; saudações e perguntas curtas não.
const LONG_ANSWER_CHARS = 300;
export const isLongAnswer = (text) => String(text || '').trim().length >= LONG_ANSWER_CHARS;

/**
 * Aviso de fonte da resposta: "geral" quando o agente usou a base própria do GPT Maker (a plataforma não
 * tinha a resposta); "sem_citacao" quando a resposta é longa e não cita nenhum documento da plataforma.
 */
export function originNoticeHtml(origin) {
  if (origin === 'geral') {
    return `<div class="origin-notice origin-general">${icon('alert')}<div><strong>Resposta da base geral do GPT Maker</strong>
      <span>Não foi encontrada na Base de Conhecimento da plataforma. Confira antes de seguir; a pergunta foi registrada nas lacunas.</span></div></div>`;
  }
  if (origin === 'sem_citacao') {
    return `<div class="origin-notice">${icon('alert')}<div><strong>Sem documentos da plataforma</strong>
      <span>Esta resposta não cita nenhum documento da Base de Conhecimento. Confira antes de usar.</span></div></div>`;
  }
  return '';
}

/** Botões "Ajudou? 👍 👎" de uma resposta longa da Active AI (vazio para respostas curtas). */
export function answerActionsHtml({ vote = null, content = '' } = {}) {
  if (!isLongAnswer(content)) return '';
  const btn = (value, name, label) =>
    `<button type="button" class="vote${vote === value ? ' chosen' : ''}" data-vote="${value}" title="${label}" aria-label="${label}"${vote ? ' disabled' : ''}>${icon(name)}</button>`;
  return `
    <div class="answer-actions">
      ${vote ? `<span class="muted small">${vote === 'up' ? 'Obrigado!' : 'Obrigado, vamos melhorar.'}</span>` : '<span class="muted small">Ajudou?</span>'}
      ${btn('up', 'thumbsUp', 'Ajudou')}${btn('down', 'thumbsDown', 'Não ajudou')}
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

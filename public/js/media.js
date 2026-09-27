import { api } from './api.js';
import { esc, icon, hydrateIcons, toast } from './util.js';
import { fadeUp } from './motion.js';

const MEDIA_EXT = /\.(mp4|mov|mkv|webm|avi|wmv|m4v|mpg|mpeg|mp3|wav|m4a|aac|ogg|oga|opus|flac|wma)$/i;
const PLAYABLE = /^(video\/(mp4|webm|ogg)|audio\/(mpeg|mp3|wav|x-wav|ogg|webm|mp4|aac|x-m4a|flac))$/;

export const isMediaItem = (item) =>
  item.kind === 'file' && (/^(video|audio)\//.test(item.mime_type || '') || MEDIA_EXT.test(item.file_name || ''));

const toSeconds = (t) => t.split(':').map(Number).reduce((a, n) => a * 60 + n, 0);

export function formatDuration(seconds) {
  if (!seconds) return '';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
}

/** Selo curto da situação da transcrição, usado nas listas. */
export function transcriptBadge(item) {
  switch (item.media_status) {
    case 'processando':
      return `<span class="badge badge-warn">Transcrevendo ${item.media_progress || 0}%</span>`;
    case 'pendente':
      return '<span class="badge badge-warn">Na fila para transcrição</span>';
    case 'erro':
      return '<span class="badge badge-danger">Transcrição com erro</span>';
    case 'concluida':
    case 'manual':
      return '<span class="badge badge-article">Transcrito</span>';
    default:
      return '';
  }
}

/** Player do vídeo/áudio (quando o navegador consegue tocar o formato). */
export function mediaPlayer(item) {
  const url = `/api/items/${item.id}/file`;
  const mime = item.mime_type || '';
  if (!PLAYABLE.test(mime)) {
    return `<div class="card card-pad muted small">${icon('video')} Este formato (${esc(item.file_name.split('.').pop().toUpperCase())}) não toca direto no navegador. Use “Baixar” para assistir. A transcrição continua disponível abaixo.</div>`;
  }
  const tag = mime.startsWith('audio/') ? 'audio' : 'video';
  return `<div class="card card-pad media-card"><${tag} id="media-player" src="${url}" controls preload="metadata"></${tag}></div>`;
}

/**
 * Painel da transcrição: situação, progresso, envio de transcrição pronta e, quando pronta,
 * o texto com marcações de tempo clicáveis que levam o vídeo até aquele ponto.
 */
export function mountTranscript(container, initialItem, { transcriptionEnabled = true } = {}) {
  let item = initialItem;
  let lines = [];
  let filter = '';
  let timer = 0;
  let stopped = false;

  const player = () => document.getElementById('media-player');

  function parse(text) {
    return String(text || '')
      .split('\n')
      .map((l) => l.match(/^\[(\d{2}:\d{2}:\d{2})\]\s*(.*)$/))
      .filter(Boolean)
      .map((m) => ({ time: m[1], seconds: toSeconds(m[1]), text: m[2] }));
  }

  function statusBlock() {
    const retry = transcriptionEnabled
      ? `<button class="btn btn-sm" type="button" data-action="retranscribe">${icon('refresh')}Transcrever novamente</button>`
      : '';
    switch (item.media_status) {
      case 'pendente':
        return `<div class="transcript-status"><span class="spinner"></span> Na fila para transcrição. Você pode sair desta página; ela continua em segundo plano.</div>`;
      case 'processando':
        return `<div class="transcript-status">
            <div class="row"><span class="spinner"></span><strong>Transcrevendo… ${item.media_progress || 0}%</strong></div>
            <div class="progress"><div style="width:${item.media_progress || 0}%"></div></div>
            <p class="muted small">Vídeos longos podem levar alguns minutos. Pode sair desta página; a transcrição continua em segundo plano.</p>
          </div>`;
      case 'erro':
        return `<div class="msg-error">Não foi possível transcrever: ${esc(item.media_error || 'erro desconhecido')}</div><div class="row">${retry}</div>`;
      case 'indisponivel':
        return '<p class="muted">A transcrição automática está desligada neste servidor. Envie a transcrição pronta (por exemplo, o arquivo .vtt gerado pelo Teams, Meet ou Zoom).</p>';
      default:
        return '';
    }
  }

  function render() {
    const done = ['concluida', 'manual'].includes(item.media_status);
    const visible = filter ? lines.filter((l) => l.text.toLowerCase().includes(filter)) : lines;
    container.innerHTML = `
      <section class="card card-pad transcript">
        <header class="transcript-head">
          <h2>${icon('article')} Transcrição</h2>
          ${item.duration ? `<span class="muted small">Duração ${esc(formatDuration(item.duration))}</span>` : ''}
          <span class="spacer"></span>
          <label class="btn btn-sm" title="Arquivos .vtt/.srt do Teams, Meet ou Zoom, ou texto (.txt, .docx)">
            ${icon('upload')}Enviar transcrição<input type="file" accept=".vtt,.srt,.txt,.docx,.md" hidden data-action="upload" />
          </label>
          ${done && transcriptionEnabled ? `<button class="btn btn-sm" type="button" data-action="retranscribe" title="Gerar a transcrição automática de novo">${icon('refresh')}</button>` : ''}
        </header>
        ${statusBlock()}
        ${
          done
            ? `<p class="muted small">${item.media_status === 'manual' ? 'Transcrição enviada manualmente.' : 'Transcrição automática.'} A Active AI usa este texto para responder sobre o vídeo. Clique no horário para ir até o trecho.</p>
               <input class="input transcript-filter" type="search" placeholder="Buscar na transcrição…" value="${esc(filter)}" />
               <div class="transcript-lines">${
                 visible.length
                   ? visible
                       .map(
                         (l) =>
                           `<div class="transcript-line" data-seconds="${l.seconds}"><button type="button" class="time" data-seek="${l.seconds}">${l.time}</button><span>${esc(l.text)}</span></div>`,
                       )
                       .join('')
                   : `<p class="muted">${lines.length ? 'Nenhum trecho com esse termo.' : 'A transcrição está vazia.'}</p>`
               }</div>`
            : ''
        }
      </section>`;
    hydrateIcons(container);
  }

  async function reload() {
    item = await api.item(item.id, { full: true });
    lines = parse(item.text_full ?? item.text_preview);
    render();
    const active = ['pendente', 'processando'].includes(item.media_status);
    clearTimeout(timer);
    if (active && !stopped) timer = setTimeout(reload, 3000);
    return item;
  }

  container.addEventListener('click', async (e) => {
    const seek = e.target.closest('[data-seek]');
    if (seek && player()) {
      player().currentTime = Number(seek.dataset.seek);
      player().play?.();
      player().scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (e.target.closest('[data-action="retranscribe"]')) {
      try {
        await api.retranscribe(item.id);
        toast('Transcrição colocada na fila.');
        reload();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

  container.addEventListener('change', async (e) => {
    const input = e.target.closest('[data-action="upload"]');
    if (!input?.files[0]) return;
    const fd = new FormData();
    fd.append('file', input.files[0]);
    try {
      await api.upload(`/api/items/${item.id}/transcript`, fd, null, 'PUT');
      toast('Transcrição salva. A Active AI já pode usar este conteúdo.');
      await reload();
      fadeUp(container.querySelectorAll('.transcript-line'), { y: 6, stagger: 15, max: 20 });
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  container.addEventListener('input', (e) => {
    if (!e.target.matches('.transcript-filter')) return;
    filter = e.target.value.trim().toLowerCase();
    const pos = e.target.selectionStart;
    render();
    const input = container.querySelector('.transcript-filter');
    input.focus();
    input.setSelectionRange(pos, pos);
  });

  // Destaca o trecho que está tocando.
  const onTime = () => {
    const t = player()?.currentTime ?? 0;
    let current = null;
    container.querySelectorAll('.transcript-line').forEach((el) => {
      el.classList.remove('playing');
      if (Number(el.dataset.seconds) <= t) current = el;
    });
    current?.classList.add('playing');
  };
  player()?.addEventListener('timeupdate', onTime);

  reload();
  return () => {
    stopped = true;
    clearTimeout(timer);
    player()?.removeEventListener('timeupdate', onTime);
  };
}

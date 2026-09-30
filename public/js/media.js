import { api } from './api.js';
import { esc, icon, hydrateIcons, toast, promptDialog } from './util.js';
import { fadeUp } from './motion.js';

const MEDIA_EXT = /\.(mp4|mov|mkv|webm|avi|wmv|m4v|mpg|mpeg|mp3|wav|m4a|aac|ogg|oga|opus|flac|wma)$/i;
const PLAYABLE = /^(video\/(mp4|webm|ogg)|audio\/(mpeg|mp3|wav|x-wav|ogg|webm|mp4|aac|x-m4a|flac))$/;
const READY = ['concluida', 'manual', 'legendas'];
const WORKING = ['pendente', 'processando'];
const CHAPTERS_WORKING = ['pendente', 'gerando'];

export const isMediaItem = (item) =>
  item.kind === 'youtube' ||
  (item.kind === 'file' && (/^(video|audio)\//.test(item.mime_type || '') || MEDIA_EXT.test(item.file_name || '')));

export const youtubeId = (item) => item.source_url?.match(/[?&]v=([\w-]{11})/)?.[1] || null;

const toSeconds = (t) => t.split(':').map(Number).reduce((a, n) => a * 60 + n, 0);
export const clock = (seconds) => {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
  return `${h ? `${h}:` : ''}${mm}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Ícone de vídeo/áudio para as listas: quadradinho do tamanho dos ícones dos textos, com a duração
 * embaixo. Vermelho no YouTube, verde nos vídeos enviados.
 */
export function mediaTile(item, { size = 'md' } = {}) {
  const name = item.kind === 'youtube' ? 'youtube' : /^audio\//.test(item.mime_type || '') ? 'audio' : 'video';
  const duration = item.duration && size !== 'sm' ? `<span class="tile-duration">${clock(item.duration)}</span>` : '';
  return `<span class="media-tile tile-${size}${item.kind === 'youtube' ? ' is-youtube' : ''}${duration ? ' has-duration' : ''}"
    title="${item.duration ? `Duração ${clock(item.duration)}` : ''}">${icon(name)}${duration}</span>`;
}

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
      return '<span class="badge badge-danger">Sem transcrição</span>';
    case 'concluida':
    case 'manual':
    case 'legendas':
      return '<span class="badge badge-article">Transcrito</span>';
    default:
      return '';
  }
}

/** Player do vídeo/áudio: YouTube incorporado ou o arquivo enviado (quando o navegador toca o formato). */
export function mediaPlayer(item) {
  if (item.kind === 'youtube') {
    const id = youtubeId(item);
    const src = `https://www.youtube-nocookie.com/embed/${id}?enablejsapi=1&rel=0&origin=${encodeURIComponent(location.origin)}`;
    return `<div class="card media-card media-youtube"><iframe id="media-player" data-youtube="${esc(id)}" src="${src}" title="${esc(item.title)}"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
  }
  const url = `/api/items/${item.id}/file`;
  const mime = item.mime_type || '';
  if (!PLAYABLE.test(mime)) {
    return `<div class="card card-pad muted small">${icon('video')} Este formato (${esc(item.file_name.split('.').pop().toUpperCase())}) não toca direto no navegador. Use “Baixar” para assistir. A transcrição continua disponível abaixo.</div>`;
  }
  const tag = mime.startsWith('audio/') ? 'audio' : 'video';
  return `<div class="card card-pad media-card"><${tag} id="media-player" src="${url}" controls preload="metadata"></${tag}></div>`;
}

/**
 * Controle do player da página: pular para um horário e acompanhar o tempo atual.
 * Para o YouTube usa a API de mensagens do player incorporado (postMessage), sem scripts externos.
 */
function playerController() {
  const el = document.getElementById('media-player');
  if (!el) return { seek() {}, onTime: () => () => {} };

  if (el.tagName !== 'IFRAME') {
    return {
      seek(seconds) {
        el.currentTime = seconds;
        el.play?.();
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      },
      onTime(cb) {
        const handler = () => cb(el.currentTime);
        el.addEventListener('timeupdate', handler);
        return () => el.removeEventListener('timeupdate', handler);
      },
    };
  }

  const send = (message) => el.contentWindow?.postMessage(JSON.stringify(message), '*');
  const listen = () => send({ event: 'listening', id: 'kb-player', channel: 'widget' });
  el.addEventListener('load', listen);
  return {
    seek(seconds) {
      send({ event: 'command', func: 'seekTo', args: [seconds, true] });
      send({ event: 'command', func: 'playVideo', args: [] });
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
    onTime(cb) {
      const handler = (e) => {
        // Só mensagens do próprio player do YouTube desta página.
        if (e.source !== el.contentWindow || !/^https:\/\/www\.youtube(-nocookie)?\.com$/.test(e.origin)) return;
        let data;
        try {
          data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        } catch {
          return;
        }
        const time = data?.info?.currentTime;
        if (typeof time === 'number') cb(time);
      };
      window.addEventListener('message', handler);
      listen();
      return () => {
        window.removeEventListener('message', handler);
        el.removeEventListener('load', listen);
      };
    },
  };
}

/**
 * Painel da transcrição: situação, progresso, envio/colagem de transcrição pronta, resumo e
 * capítulos da Active AI e o texto com marcações de tempo clicáveis que levam o vídeo até o trecho.
 */
export function mountTranscript(container, initialItem, { transcriptionEnabled = true, chaptersEnabled = true } = {}) {
  let item = initialItem;
  let lines = [];
  let filter = '';
  let timer = 0;
  let stopped = false;
  const player = playerController();

  function parse(text) {
    return String(text || '')
      .split('\n')
      .map((l) => l.match(/^\[(\d{2}:\d{2}:\d{2})\]\s*(.*)$/))
      .filter(Boolean)
      .map((m) => ({ time: m[1], seconds: toSeconds(m[1]), text: m[2] }));
  }

  const canRetranscribe = () => transcriptionEnabled || item.kind === 'youtube';

  function statusBlock() {
    const retry = canRetranscribe()
      ? `<button class="btn btn-sm" type="button" data-action="retranscribe">${icon('refresh')}${item.kind === 'youtube' ? 'Buscar legendas de novo' : 'Transcrever novamente'}</button>`
      : '';
    switch (item.media_status) {
      case 'pendente':
        return `<div class="transcript-status"><div class="row"><span class="spinner"></span> Na fila para transcrição. Você pode sair desta página; ela continua em segundo plano.</div></div>`;
      case 'processando':
        return `<div class="transcript-status">
            <div class="row"><span class="spinner"></span><strong>${item.kind === 'youtube' ? 'Buscando as legendas do YouTube…' : `Transcrevendo… ${item.media_progress || 0}%`}</strong></div>
            ${item.kind === 'youtube' ? '' : `<div class="progress"><div style="width:${item.media_progress || 0}%"></div></div>
            <p class="muted small">Vídeos longos podem levar alguns minutos. Pode sair desta página; a transcrição continua em segundo plano.</p>`}
          </div>`;
      case 'erro':
        return `<div class="msg-error">${item.kind === 'youtube' ? '' : 'Não foi possível transcrever: '}${esc(item.media_error || 'erro desconhecido')}</div>
          <div class="row"><button class="btn btn-sm btn-primary" type="button" data-action="paste">${icon('edit')}Colar transcrição</button>${retry}</div>`;
      case 'indisponivel':
        return '<p class="muted">A transcrição automática está desligada neste servidor. Envie a transcrição pronta (por exemplo, o arquivo .vtt gerado pelo Teams, Meet ou Zoom) ou cole o texto.</p>';
      default:
        return '';
    }
  }

  function chaptersBlock() {
    const status = item.chapters_status;
    const regenerate = chaptersEnabled
      ? `<button class="btn btn-sm" type="button" data-action="chapters" title="Pedir de novo à Active AI">${icon('refresh')}${status === 'ok' ? '' : 'Tentar de novo'}</button>`
      : '';
    if (CHAPTERS_WORKING.includes(status)) {
      return `<div class="chapters"><div class="row muted"><span class="spinner"></span> A Active AI está criando o resumo e os capítulos do vídeo…</div></div>`;
    }
    if (status === 'erro') {
      return `<div class="chapters"><div class="msg-error">Não foi possível gerar os capítulos: ${esc(item.chapters_error || 'erro desconhecido')}</div><div class="row">${regenerate}</div></div>`;
    }
    if (status === 'ok' && item.chapters?.length) {
      return `<div class="chapters">
          <div class="chapters-head"><strong>${icon('sparkles')} Resumo e capítulos</strong><span class="muted small">gerados pela Active AI</span><span class="spacer"></span>${regenerate}</div>
          ${item.ai_summary ? `<p class="chapters-summary">${esc(item.ai_summary)}</p>` : ''}
          <ol class="chapter-list">${item.chapters
            .map((c) => `<li><button type="button" class="chapter" data-seek="${c.start}" data-chapter="${c.start}"><span class="time">${clock(c.start)}</span><span>${esc(c.title)}</span></button></li>`)
            .join('')}</ol>
        </div>`;
    }
    return chaptersEnabled
      ? `<div class="chapters chapters-empty"><button class="btn btn-sm btn-ia" type="button" data-action="chapters">${icon('sparkles')}Gerar resumo e capítulos com a Active AI</button></div>`
      : '';
  }

  function render() {
    const done = READY.includes(item.media_status);
    const visible = filter ? lines.filter((l) => l.text.toLowerCase().includes(filter)) : lines;
    const origin =
      item.media_status === 'manual' ? 'Transcrição enviada manualmente.' : item.media_status === 'legendas' ? 'Legendas do YouTube.' : 'Transcrição automática.';
    container.innerHTML = `
      <section class="card card-pad transcript">
        <header class="transcript-head">
          <h2>${icon('article')} Transcrição</h2>
          ${item.duration ? `<span class="muted small">Duração ${esc(formatDuration(item.duration))}</span>` : ''}
          <span class="spacer"></span>
          <button class="btn btn-sm" type="button" data-action="paste" title="Colar o texto da transcrição (por exemplo, copiado do YouTube em “Mostrar transcrição”)">${icon('edit')}Colar</button>
          <label class="btn btn-sm" title="Arquivos .vtt/.srt do Teams, Meet ou Zoom, ou texto (.txt, .docx)">
            ${icon('upload')}Enviar<input type="file" accept=".vtt,.srt,.txt,.docx,.md" hidden data-action="upload" />
          </label>
          ${done && canRetranscribe() ? `<button class="btn btn-sm" type="button" data-action="retranscribe" title="${item.kind === 'youtube' ? 'Buscar as legendas do YouTube de novo' : 'Gerar a transcrição automática de novo'}">${icon('refresh')}</button>` : ''}
        </header>
        ${statusBlock()}
        ${done ? chaptersBlock() : ''}
        ${
          done
            ? `<p class="muted small">${origin} A Active AI usa este texto para responder sobre o vídeo. Clique no horário para ir até o trecho.</p>
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
    const active = WORKING.includes(item.media_status) || CHAPTERS_WORKING.includes(item.chapters_status);
    clearTimeout(timer);
    if (active && !stopped) timer = setTimeout(reload, 3000);
    return item;
  }

  async function saveText(text) {
    await api.saveTranscriptText(item.id, text);
    toast('Transcrição salva. A Active AI já pode usar este conteúdo.');
    await reload();
    fadeUp(container.querySelectorAll('.transcript-line'), { y: 6, stagger: 15, max: 20 });
  }

  container.addEventListener('click', async (e) => {
    const seek = e.target.closest('[data-seek]');
    if (seek) {
      player.seek(Number(seek.dataset.seek));
      return;
    }
    const action = e.target.closest('[data-action]')?.dataset.action;
    try {
      if (action === 'retranscribe') {
        await api.retranscribe(item.id);
        toast(item.kind === 'youtube' ? 'Buscando as legendas de novo.' : 'Transcrição colocada na fila.');
        reload();
      } else if (action === 'chapters') {
        await api.regenerateChapters(item.id);
        toast('A Active AI vai criar o resumo e os capítulos.');
        reload();
      } else if (action === 'paste') {
        const text = await promptDialog({
          title: 'Colar transcrição',
          message:
            item.kind === 'youtube'
              ? 'No YouTube, abra “…mais” na descrição do vídeo → “Mostrar transcrição”, selecione todo o texto, copie e cole aqui. Os horários são mantidos.'
              : 'Cole o texto da transcrição. Linhas com horário (0:05, 00:01:30) viram trechos clicáveis.',
          placeholder: '0:00\nBom dia, pessoal…\n0:05\nHoje vamos ver…',
          confirmLabel: 'Salvar transcrição',
        });
        if (text) await saveText(text);
      }
    } catch (err) {
      toast(err.message, 'error');
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

  // Destaca o trecho e o capítulo que estão tocando.
  const highlight = (selector, attr, t) => {
    let current = null;
    container.querySelectorAll(selector).forEach((el) => {
      el.classList.remove('playing');
      if (Number(el.dataset[attr]) <= t) current = el;
    });
    current?.classList.add('playing');
  };
  const stopTime = player.onTime((t) => {
    highlight('.transcript-line', 'seconds', t);
    highlight('.chapter', 'chapter', t);
  });

  reload();
  return () => {
    stopped = true;
    clearTimeout(timer);
    stopTime();
  };
}

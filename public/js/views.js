import { api } from './api.js';
import { chat, mountChat } from './chat.js';
import { mountAnswer } from './answer.js';
import { isMediaItem, mediaPlayer, mountTranscript, transcriptBadge, formatDuration, mediaTile } from './media.js';
import { mountDocFeedback } from './feedback.js';
import { TEMPLATES, takeDraft, draftFromGap, openDraft } from './templates.js';
import { fadeUp } from './motion.js';
import {
  esc, icon, hydrateIcons, formatDate, relativeDate, formatBytes, fileIcon, fileTypeLabel,
  renderMarkdown, toast, confirmDialog, storage, CATEGORY_ICONS,
} from './util.js';

/** Estado compartilhado entre as telas (categorias ficam em cache para formulários e menu). */
export const shared = {
  categories: [],
  aiConfigured: false,
  transcriptionEnabled: true,
  chaptersEnabled: true,
  reviewMonthsDefault: 6,
  async refreshCategories() {
    shared.categories = await api.categories();
    document.dispatchEvent(new CustomEvent('categories-changed'));
    return shared.categories;
  },
};

/** "2026-03-01" → "01/03/2026" */
const dateBr = (isoDate) => String(isoDate || '').split('-').reverse().join('/');

const loading = (text = 'Carregando…') => `<div class="loading"><span class="spinner"></span>${esc(text)}</div>`;

// ---------- Esqueletos de carregamento (blocos no formato do conteúdo que vai aparecer) ----------
const sk = (cls = '', width) => `<span class="sk ${cls}"${width ? ` style="width:${width}"` : ''}></span>`;
const skDocItems = (n = 5) =>
  Array.from(
    { length: n },
    (_, i) => `<div class="card doc-item sk-card">${sk('sk-icon')}<div class="sk-stack">${sk('sk-title', `${55 - (i % 3) * 10}%`)}${sk('sk-sm', '35%')}${sk('sk-sm', `${85 - (i % 2) * 20}%`)}</div></div>`,
  ).join('');
const SKELETONS = {
  home: () => `<div class="home sk-screen"><div class="home-hero">${sk('sk-h1 sk-center', '55%')}${sk('sk-search sk-center')}</div>
      <div class="home-list sk-stack sk-gap">${sk('sk-sm', '30%')}${Array.from({ length: 5 }, () => `<div class="sk-row">${sk('sk-icon sk-icon-sm')}<div class="sk-stack">${sk('', '60%')}${sk('sk-sm', '35%')}</div></div>`).join('')}</div></div>`,
  list: () => `<div class="sk-screen">${sk('sk-sm', '18%')}<div class="doc-list">${skDocItems()}</div></div>`,
  doc: () => `<div class="sk-screen">${sk('sk-sm', '14%')}${sk('sk-h1', '55%')}<div class="sk-row">${sk('sk-chip')}${sk('sk-chip')}</div>
      <div class="sk-row sk-actions">${sk('sk-btn')}${sk('sk-btn')}${sk('sk-btn')}</div>
      <div class="doc-layout"><div class="card card-pad sk-stack sk-gap">${sk('sk-title', '40%')}${Array.from({ length: 7 }, (_, i) => sk('', `${95 - (i % 4) * 12}%`)).join('')}</div>
      <aside class="card card-pad sk-stack sk-gap">${Array.from({ length: 5 }, () => sk('sk-sm', '80%')).join('')}</aside></div></div>`,
  form: () => `<div class="sk-screen">${sk('sk-h1', '30%')}${sk('sk-sm', '55%')}${sk('sk-input sk-input-lg')}
      <div class="form-grid">${Array.from({ length: 4 }, () => `<div class="sk-stack">${sk('sk-sm', '30%')}${sk('sk-input')}</div>`).join('')}</div>${sk('sk-editor')}</div>`,
  report: () => `<div class="sk-screen">${sk('sk-h1', '35%')}${sk('sk-sm', '60%')}
      <div class="stat-grid">${Array.from({ length: 4 }, () => `<div class="card stat">${sk('sk-sm', '60%')}${sk('sk-h1', '30%')}</div>`).join('')}</div>
      <div class="sk-row">${sk('sk-chip')}${sk('sk-chip')}${sk('sk-chip')}</div><div class="doc-list">${skDocItems(4)}</div></div>`,
};
const skeleton = (kind) => SKELETONS[kind]();

function categoryOptions(selected, { includeAll = false, includeNone = true } = {}) {
  const opts = [];
  if (includeAll) opts.push(`<option value="">Todas as categorias</option>`);
  if (includeNone) opts.push(`<option value="${includeAll ? 'none' : ''}"${selected === 'none' ? ' selected' : ''}>Sem categoria</option>`);
  for (const c of shared.categories) {
    opts.push(`<option value="${c.id}"${String(selected) === String(c.id) ? ' selected' : ''}>${esc(c.name)}</option>`);
  }
  return opts.join('');
}

function snippetHtml(snippet) {
  // O servidor marca os termos encontrados com [[ ]]; o restante é escapado.
  return esc(snippet).replace(/\[\[/g, '<mark>').replace(/\]\]/g, '</mark>');
}

function docItem(item) {
  const iconName = fileIcon(item);
  const meta = [
    `<span class="badge ${item.kind === 'article' ? 'badge-article' : 'badge-file'}">${esc(fileTypeLabel(item))}</span>`,
    item.category_name ? `<span>${esc(item.category_name)}</span>` : '',
    `<span>Atualizado ${esc(relativeDate(item.updated_at))}</span>`,
    item.size ? `<span>${formatBytes(item.size)}</span>` : '',
    transcriptBadge(item),
    item.by_meaning ? `<span class="badge badge-meaning" title="Encontrado pelo significado: o documento fala do assunto, mesmo sem as mesmas palavras">≈ significado</span>` : '',
    item.review_overdue ? `<span class="badge badge-warn" title="Revisão vencida desde ${esc(dateBr(item.review_due))}">${icon('clock')}Revisar</span>` : '',
    ...item.tags.slice(0, 4).map((t) => `<span class="tag">${esc(t)}</span>`),
  ].filter(Boolean);
  const snippet = item.snippet?.trim() || item.summary;
  return `
    <a class="card doc-item" href="#/item/${item.id}">
      ${isMediaItem(item) ? mediaTile(item) : `<div class="doc-icon ${item.kind}">${icon(iconName)}</div>`}
      <div class="doc-body">
        <div class="doc-title">${esc(item.title)}</div>
        <div class="doc-meta">${meta.join('')}</div>
        ${snippet ? `<div class="doc-snippet">${item.snippet ? snippetHtml(snippet) : esc(snippet)}</div>` : ''}
      </div>
    </a>`;
}

function emptyState(iconName, title, text, action = '') {
  return `<div class="card empty-state">${icon(iconName)}<h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`;
}

function openIa(prompt) {
  document.dispatchEvent(new CustomEvent('open-ia', { detail: { prompt } }));
}

// ======================================================================
// Início
// ======================================================================
export async function homeView(view) {
  view.innerHTML = skeleton('home');
  const [popular, recent] = await Promise.all([api.items({ limit: 5, sort: 'views' }), api.items({ limit: 5 })]);
  const empty = !recent.items.length;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  // Uma lista só, com abas; a aba escolhida fica lembrada neste navegador.
  const lists = { recentes: recent.items, acessados: popular.items };
  let tab = storage.get('kb-inicio-aba', 'recentes');
  if (!lists[tab]) tab = 'recentes';

  const quickList = (items) =>
    items
      .map(
        (i) => `
        <a class="quick-item" href="#/item/${i.id}">
          ${isMediaItem(i) ? mediaTile(i, { size: 'sm' }) : `<span class="quick-icon ${i.kind}">${icon(fileIcon(i))}</span>`}
          <span class="quick-text"><strong>${esc(i.title)}</strong><small>${esc(i.category_name || 'Sem categoria')} · ${esc(i.duration ? formatDuration(i.duration) : relativeDate(i.updated_at))}</small></span>
        </a>`,
      )
      .join('');

  view.innerHTML = `
    <section class="home">
      <div class="home-hero">
        <h1>${greeting}! O que você precisa encontrar?</h1>
        <form class="home-search" id="home-search" role="search">
          ${icon('search')}
          <input name="q" placeholder="Busque um processo, cliente, erro ou sistema…" autocomplete="off" aria-label="Buscar na base" autofocus />
          <button class="btn btn-primary" type="submit">Buscar</button>
        </form>
      </div>
      ${
        empty
          ? emptyState(
              'library',
              'A base ainda está vazia',
              'Comece escrevendo um texto ou enviando documentos (PDF, Word, Excel, PowerPoint, imagens, vídeos de treinamento e qualquer outro tipo).',
              '<div class="row needs-editor" style="justify-content:center"><a class="btn btn-primary" href="#/new">Escrever texto</a><a class="btn" href="#/upload">Enviar arquivos</a></div>',
            )
          : `<section class="home-list">
              <div class="home-tabs" role="tablist">
                <button type="button" role="tab" data-tab="recentes" class="${tab === 'recentes' ? 'active' : ''}">Recentes</button>
                <button type="button" role="tab" data-tab="acessados" class="${tab === 'acessados' ? 'active' : ''}">Mais acessados</button>
                <a class="small home-all" href="#/docs">Ver todos →</a>
              </div>
              <div class="quick-list" id="home-quick">${quickList(lists[tab])}</div>
            </section>`
      }
    </section>`;

  view.querySelector('.home-tabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (!btn || btn.dataset.tab === tab) return;
    tab = btn.dataset.tab;
    storage.set('kb-inicio-aba', tab);
    view.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b === btn));
    const list = view.querySelector('#home-quick');
    list.innerHTML = quickList(lists[tab]);
    hydrateIcons(list);
    fadeUp(list.querySelectorAll('.quick-item'), { y: 6, stagger: 35 });
  });

  const form = view.querySelector('#home-search');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = form.q.value.trim();
    if (!q) return form.q.focus();
    location.hash = `#/docs?q=${encodeURIComponent(q)}`;
  });
  form.q.focus({ preventScroll: true });
}

// ======================================================================
// Lista / pesquisa de documentos
// ======================================================================
export async function docsView(view, { query }) {
  const q = query.get('q') || '';
  const category = query.get('category') || '';
  const kind = query.get('kind') || '';
  const tag = query.get('tag') || '';
  const cat = shared.categories.find((c) => String(c.id) === category);

  const title = q ? `Resultados para “${q}”` : tag ? `Tag: ${tag}` : cat ? cat.name : category === 'none' ? 'Sem categoria' : 'Todos os documentos';

  view.innerHTML = `
    <div class="page-header">
      <div>
        <h1>${esc(title)}</h1>
        ${q ? '' : `<p>${cat?.description ? esc(cat.description) : 'Textos e arquivos da base de conhecimento do Suporte.'}</p>`}
      </div>
      ${
        q
          ? ''
          : `<div class="row needs-editor">
        <a class="btn" href="#/upload${category ? `?category=${category}` : ''}">${icon('upload')}Enviar arquivos</a>
        <a class="btn btn-primary" href="#/new${category ? `?category=${category}` : ''}">${icon('pen')}Escrever texto</a>
      </div>`
      }
    </div>
    <form class="filters" id="filters">
      <input class="input search-input" name="q" type="search" placeholder="Pesquisar por palavras-chave…" value="${esc(q)}" />
      <select class="select" name="category" style="width:auto">${categoryOptions(category, { includeAll: true })}</select>
      <select class="select" name="kind" style="width:auto">
        <option value="">Textos e arquivos</option>
        <option value="article"${kind === 'article' ? ' selected' : ''}>Somente textos</option>
        <option value="file"${kind === 'file' ? ' selected' : ''}>Somente arquivos</option>
        <option value="youtube"${kind === 'youtube' ? ' selected' : ''}>Somente vídeos do YouTube</option>
      </select>
      ${tag ? `<input type="hidden" name="tag" value="${esc(tag)}" />` : ''}
      <button class="btn btn-primary" type="submit">${icon('search')}Filtrar</button>
    </form>
    <div id="answer"></div>
    <div id="results">${skeleton('list')}</div>`;

  // Na busca, a Active AI responde no topo usando os documentos encontrados.
  const stopAnswer = q && shared.aiConfigured ? mountAnswer(view.querySelector('#answer'), q) : null;

  const form = view.querySelector('#filters');
  const go = () => {
    const params = new URLSearchParams();
    for (const [k, v] of new FormData(form)) if (v) params.set(k, v);
    location.hash = `#/docs${params.toString() ? `?${params}` : ''}`;
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    go();
  });
  form.querySelectorAll('select').forEach((s) => s.addEventListener('change', go));

  // registrar: a busca feita pela pessoa sem resultado entra no relatório de lacunas.
  const data = await api.items({ q, category, kind, tag, limit: 100, registrar: q ? 1 : undefined });
  const results = view.querySelector('#results');
  if (!data.items.length) {
    results.innerHTML = q
      ? emptyState('search', 'Nada encontrado', `Nenhum documento corresponde a “${q}”. A Active AI pode ajudar a procurar com outras palavras.`, `<button class="btn btn-ia" id="ask-ia">${icon('sparkles')}Perguntar à Active AI</button>`)
      : emptyState('library', 'Nenhum documento aqui', 'Envie arquivos ou escreva um texto para começar.');
    results.querySelector('#ask-ia')?.addEventListener('click', () => openIa(`Estou procurando informações sobre: ${q}`));
    hydrateIcons(results);
    return stopAnswer;
  }
  results.innerHTML = `
    <p class="muted small">${data.total} documento(s)</p>
    <div class="doc-list">${data.items.map(docItem).join('')}</div>`;
  return stopAnswer;
}

// ======================================================================
// Documento
// ======================================================================
function filePreview(item) {
  const url = `/api/items/${item.id}/file`;
  const mime = item.mime_type || '';
  if (/^image\/(png|jpeg|gif|webp)$/.test(mime)) return `<div class="file-preview"><img src="${url}" alt="${esc(item.title)}" /></div>`;
  if (mime === 'application/pdf') return `<div class="file-preview"><iframe src="${url}" title="${esc(item.title)}"></iframe></div>`;
  if (/^video\/(mp4|webm|ogg)$/.test(mime)) return `<div class="file-preview"><video src="${url}" controls></video></div>`;
  if (mime.startsWith('audio/')) return `<div class="file-preview" style="padding:16px"><audio src="${url}" controls></audio></div>`;
  return '';
}

export async function itemView(view, { params }) {
  view.innerHTML = skeleton('doc');
  const item = await api.item(params.id, { view: true });

  const media = isMediaItem(item);
  const isYouTube = item.kind === 'youtube';
  const preview = item.kind === 'file' && !media ? filePreview(item) : '';
  const reviewBanner = item.review_overdue
    ? `<div class="review-banner">${icon('clock')}
        <div><strong>Revisão vencida desde ${esc(dateBr(item.review_due))}</strong>
        <span>Este documento está há mais de ${item.review_months} ${item.review_months === 1 ? 'mês' : 'meses'} sem atualização e pode ter informação antiga. A Active AI avisa isso ao usar este conteúdo.</span></div>
        <div class="row needs-editor"><button class="btn btn-sm btn-primary" type="button" id="mark-reviewed">${icon('check')}Continua válido</button><a class="btn btn-sm" href="#/edit/${item.id}">${icon('edit')}Atualizar</a></div>
      </div>`
    : '';
  const extractNote = {
    unsupported: 'O conteúdo deste tipo de arquivo não pode ser lido automaticamente. A Active AI conhece apenas o título, a descrição e as tags.',
    error: 'Não foi possível ler o conteúdo deste arquivo. A Active AI conhece apenas o título, a descrição e as tags.',
    empty: 'Nenhum texto foi encontrado neste arquivo (pode ser um documento digitalizado).',
  }[item.extract_status];

  let body;
  if (media) {
    body = `${mediaPlayer(item)}<div id="transcript"></div>`;
  } else if (item.kind === 'article') {
    body = `<article class="card card-pad prose">${item.content.trim() ? renderMarkdown(item.content) : '<p class="muted">Este texto está vazio.</p>'}</article>`;
  } else {
    const text = item.text_preview
      ? `<details class="card card-pad extracted-box"${preview ? '' : ' open'}>
           <summary>Conteúdo do arquivo (texto lido pela Active AI)</summary>
           <pre class="extracted">${esc(item.text_preview)}${item.text_length > item.text_preview.length ? '\n\n[…]' : ''}</pre>
         </details>`
      : '';
    body = `
      ${preview ? `<div class="card card-pad">${preview}</div>` : ''}
      ${text}
      ${!preview && !text ? emptyState(fileIcon(item), item.file_name, 'Este arquivo não pode ser visualizado aqui. Use o botão “Baixar” para abri-lo.') : ''}
      ${extractNote ? `<p class="muted small">${icon('alert')} ${esc(extractNote)}</p>` : ''}`;
  }

  // Arquivo anexado numa conversa com a Active AI: fica guardado só por um tempo, fora da base.
  const tempBanner = item.temporary
    ? `<div class="temp-banner">${icon('paperclip')}
        <div><strong>Anexo de uma conversa com a Active AI</strong>
        <span>Este arquivo não aparece nas listas nem na busca e será apagado em ${esc(formatDate(item.expires_at, true))}. Se ele for útil para a equipe, mantenha na base.</span></div>
        <button class="btn btn-sm btn-primary needs-editor" type="button" id="keep">${icon('check')}Manter na base</button>
      </div>`
    : '';
  body = `${tempBanner}${reviewBanner}${body}${item.temporary ? '' : '<div id="doc-feedback"></div>'}`;

  view.innerHTML = `
    <a href="${item.category_id ? `#/docs?category=${item.category_id}` : '#/docs'}" class="small">${icon('back')} ${esc(item.category_name || 'Todos os documentos')}</a>
    <header class="doc-header">
      <h1>${esc(item.title)}</h1>
      <div class="row">
        <span class="badge ${item.kind === 'article' ? 'badge-article' : 'badge-file'}">${esc(fileTypeLabel(item))}</span>
        ${item.tags.map((t) => `<a class="tag" href="#/docs?tag=${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}
      </div>
      ${item.summary ? `<p class="muted" style="margin:12px 0 0">${esc(item.summary)}</p>` : ''}
    </header>
    <div class="doc-actions">
      <button class="btn btn-ia" id="ask">${icon('sparkles')}Perguntar à Active AI</button>
      <a class="btn needs-editor" href="#/edit/${item.id}">${icon('edit')}Editar${item.kind !== 'article' ? ' informações' : ''}</a>
      ${item.kind === 'file' ? `<a class="btn" href="/api/items/${item.id}/file?download">${icon('download')}Baixar</a>` : ''}
      ${item.kind === 'file' ? `<label class="btn needs-editor">${icon('upload')}Nova versão<input type="file" id="replace" hidden /></label>` : ''}
      ${isYouTube ? `<a class="btn" href="${esc(item.source_url)}" target="_blank" rel="noopener">${icon('youtube')}Abrir no YouTube</a>` : ''}
      ${item.versions_count ? `<button class="btn" id="history" type="button">${icon('history')}Histórico (${item.versions_count})</button>` : ''}
      <button class="btn btn-danger needs-editor" id="delete">${icon('trash')}Excluir</button>
    </div>
    <div class="doc-layout">
      <div style="display:flex;flex-direction:column;gap:16px;min-width:0">${body}</div>
      <aside class="doc-side">
        <div class="card card-pad ask-card">
          <strong>Dúvidas sobre este ${media ? 'vídeo' : 'documento'}?</strong>
          <p>${media ? 'A Active AI lê a transcrição e pode resumir o treinamento, explicar trechos e dizer em que momento cada assunto aparece.' : 'A Active AI pode resumir, explicar ou encontrar documentos relacionados.'}</p>
          <button class="btn btn-sm" id="ask-summary">${icon('sparkles')}Resumir com a Active AI</button>
        </div>
        <div class="card card-pad">
          <dl>
            <dt>Categoria</dt><dd>${esc(item.category_name || 'Sem categoria')}</dd>
            ${item.author ? `<dt>Autor</dt><dd>${esc(item.author)}</dd>` : ''}
            ${item.updated_by && item.updated_by !== item.author ? `<dt>Atualizado por</dt><dd>${esc(item.updated_by)}</dd>` : ''}
            ${item.file_name ? `<dt>Arquivo</dt><dd>${esc(item.file_name)}</dd>` : ''}
            ${item.duration ? `<dt>Duração</dt><dd>${esc(formatDuration(item.duration))}</dd>` : ''}
            ${isYouTube ? `<dt>Vídeo</dt><dd><a href="${esc(item.source_url)}" target="_blank" rel="noopener">YouTube</a></dd>` : ''}
            <dt>Revisão</dt><dd>${
              item.review_months
                ? `a cada ${item.review_months} ${item.review_months === 1 ? 'mês' : 'meses'}<br><span class="${item.review_overdue ? 'text-warn' : 'muted'}">${item.review_overdue ? 'vencida em' : 'próxima em'} ${esc(dateBr(item.review_due))}</span>`
                : '<span class="muted">sem revisão periódica</span>'
            }</dd>
            ${item.size != null ? `<dt>Tamanho</dt><dd>${formatBytes(item.size)}</dd>` : ''}
            <dt>Criado</dt><dd>${formatDate(item.created_at, true)}</dd>
            <dt>Atualizado</dt><dd>${formatDate(item.updated_at, true)}</dd>
            <dt>ID</dt><dd>#${item.id}</dd>
          </dl>
        </div>
      </aside>
    </div>`;

  // O documento só entra em foco no chat quando a pessoa pergunta sobre ele; fora isso, a conversa é livre.
  const askAbout = (prompt) => {
    chat.setContext(item);
    openIa(prompt);
  };
  view.querySelector('#ask').addEventListener('click', () => askAbout());
  view.querySelector('#ask-summary').addEventListener('click', () => askAbout(
      media
        ? 'Resuma este treinamento em tópicos, com os horários em que cada assunto é tratado.'
        : 'Resuma este documento em tópicos, destacando os pontos mais importantes.',
    ));

  if (!item.temporary) mountDocFeedback(view.querySelector('#doc-feedback'), item);

  view.querySelector('#keep')?.addEventListener('click', async () => {
    try {
      await api.keepItem(item.id);
      await shared.refreshCategories();
      toast('Arquivo mantido na base. Edite as informações para dar título, categoria e tags.');
      location.hash = `#/edit/${item.id}`;
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  view.querySelector('#mark-reviewed')?.addEventListener('click', async () => {
    try {
      await api.markReviewed(item.id);
      toast('Revisão registrada. Obrigado!');
      itemView(view, { params });
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  view.querySelector('#history')?.addEventListener('click', () => showHistory(item, () => itemView(view, { params })));

  view.querySelector('#delete').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Excluir documento?',
      message: `“${item.title}” será removido da base permanentemente.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteItem(item.id);
      await shared.refreshCategories();
      toast('Documento excluído.');
      location.hash = '#/docs';
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  view.querySelector('#replace')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    toast('Enviando nova versão…');
    try {
      await api.upload(`/api/items/${item.id}/file`, fd, null, 'PUT');
      toast('Arquivo atualizado.');
      itemView(view, { params });
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  const stopTranscript = media
    ? mountTranscript(view.querySelector('#transcript'), item, {
        transcriptionEnabled: shared.transcriptionEnabled,
        chaptersEnabled: shared.chaptersEnabled,
      })
    : null;

  return () => {
    stopTranscript?.();
    chat.setContext(null);
  };
}

/** Histórico de versões de um texto, com visualização e opção de restaurar. */
async function showHistory(item, onRestored) {
  const versions = await api.versions(item.id);
  const dialog = document.createElement('dialog');
  dialog.className = 'history-dialog';
  dialog.innerHTML = `
    <div class="dialog-body">
      <header class="row"><h3>${icon('history')} Histórico de “${esc(item.title)}”</h3><span class="spacer"></span>
        <button class="icon-btn" type="button" data-close title="Fechar">${icon('close')}</button></header>
      <div class="history">
        <ul class="history-list">
          <li><button type="button" class="active" data-current><strong>Versão atual</strong><small>${esc(formatDate(item.updated_at, true))}${item.author ? ` · ${esc(item.author)}` : ''}</small></button></li>
          ${versions
            .map(
              (v) => `<li><button type="button" data-version="${v.id}"><strong>${esc(formatDate(v.saved_at, true))}</strong><small>${esc(v.author || 'Sem autor')}${v.title !== item.title ? ` · “${esc(v.title)}”` : ''}</small></button></li>`,
            )
            .join('')}
        </ul>
        <div class="history-preview">
          <p class="muted">Escolha uma versão à esquerda para ver como o texto estava. Ao restaurar, a versão atual também fica guardada no histórico.</p>
        </div>
      </div>
    </div>`;
  document.body.appendChild(dialog);
  const preview = dialog.querySelector('.history-preview');
  dialog.addEventListener('click', async (e) => {
    if (e.target === dialog || e.target.closest('[data-close]')) return dialog.close();
    const current = e.target.closest('[data-current]');
    const pick = e.target.closest('[data-version]');
    if (current) {
      dialog.querySelectorAll('.history-list button').forEach((b) => b.classList.toggle('active', b === current));
      preview.innerHTML = '<p class="muted">Esta é a versão publicada agora.</p>';
      return;
    }
    if (pick) {
      dialog.querySelectorAll('.history-list button').forEach((b) => b.classList.toggle('active', b === pick));
      preview.innerHTML = loading();
      const version = await api.version(item.id, pick.dataset.version);
      preview.innerHTML = `
        <div class="row history-preview-head"><strong>${esc(version.title)}</strong><span class="spacer"></span>
          <button class="btn btn-sm btn-primary needs-editor" type="button" data-restore="${version.id}">${icon('history')}Restaurar esta versão</button></div>
        <article class="prose">${version.content.trim() ? renderMarkdown(version.content) : '<p class="muted">Texto vazio.</p>'}</article>`;
      hydrateIcons(preview);
      return;
    }
    const restore = e.target.closest('[data-restore]');
    if (restore) {
      const ok = await confirmDialog({
        title: 'Restaurar esta versão?',
        message: 'O texto volta a ficar como nesta versão. A versão atual continua guardada no histórico.',
        confirmLabel: 'Restaurar',
      });
      if (!ok) return;
      try {
        await api.restoreVersion(item.id, restore.dataset.restore, storage.get('kb-author', '') || undefined);
        toast('Versão restaurada.');
        dialog.close();
        onRestored();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
}

// ======================================================================
// Editor de textos (novo / editar)
// ======================================================================
const TOOLBAR = [
  { label: 'B', title: 'Negrito (Ctrl+B)', wrap: ['**', '**'], key: 'b' },
  { label: '<em>I</em>', title: 'Itálico (Ctrl+I)', wrap: ['_', '_'], key: 'i' },
  { label: 'S̶', title: 'Tachado', wrap: ['~~', '~~'] },
  'sep',
  { label: 'H2', title: 'Título', line: '## ' },
  { label: 'H3', title: 'Subtítulo', line: '### ' },
  'sep',
  { label: '•', title: 'Lista', line: '- ' },
  { label: '1.', title: 'Lista numerada', line: '1. ' },
  { label: '☑', title: 'Lista de verificação', line: '- [ ] ' },
  { label: '❝', title: 'Citação / destaque', line: '> ' },
  'sep',
  { label: '&lt;/&gt;', title: 'Código', wrap: ['`', '`'], block: ['```\n', '\n```'] },
  { label: '🔗', title: 'Link (Ctrl+K)', link: true, key: 'k' },
  { label: '▦', title: 'Tabela', insert: '\n| Coluna 1 | Coluna 2 |\n| --- | --- |\n| Valor | Valor |\n' },
  { label: '―', title: 'Linha divisória', insert: '\n---\n' },
];

function applyTool(textarea, tool) {
  const { selectionStart: start, selectionEnd: end, value } = textarea;
  const selected = value.slice(start, end);
  let text;
  let cursorStart;
  let cursorEnd;

  if (tool.insert) {
    text = tool.insert;
    cursorStart = cursorEnd = start + text.length;
  } else if (tool.link) {
    const label = selected || 'texto do link';
    text = `[${label}](https://)`;
    cursorStart = start + label.length + 3;
    cursorEnd = cursorStart + 8;
  } else if (tool.line) {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const block = value.slice(lineStart, end);
    const lines = block.split('\n').map((l, i) => (tool.line === '1. ' ? `${i + 1}. ` : tool.line) + l);
    textarea.setRangeText(lines.join('\n'), lineStart, end, 'end');
    textarea.dispatchEvent(new Event('input'));
    textarea.focus();
    return;
  } else {
    const [before, after] = tool.block && selected.includes('\n') ? tool.block : tool.wrap;
    text = before + selected + after;
    cursorStart = start + before.length;
    cursorEnd = cursorStart + selected.length;
  }
  textarea.setRangeText(text, start, end, 'end');
  textarea.setSelectionRange(cursorStart, cursorEnd);
  textarea.dispatchEvent(new Event('input'));
  textarea.focus();
}

export async function editorView(view, { params, query }) {
  const editing = Boolean(params.id);
  view.innerHTML = skeleton('form');
  const item = editing ? await api.item(params.id) : null;
  const isFile = Boolean(item) && item.kind !== 'article';
  const author = storage.get('kb-author', '');
  const categoryId = item ? item.category_id ?? '' : query.get('category') || '';
  // Rascunho vindo de uma resposta da Active AI ou de uma lacuna do relatório.
  const draft = !editing && query.get('rascunho') ? takeDraft() : null;
  const reviewMonths = item ? item.review_months ?? '' : shared.reviewMonthsDefault || '';
  const reviewOptions = [
    ['', 'Sem revisão periódica'],
    [3, '3 meses'],
    [6, '6 meses'],
    [12, '12 meses'],
    [24, '24 meses'],
  ];
  if (reviewMonths && !reviewOptions.some(([v]) => v === reviewMonths)) reviewOptions.push([reviewMonths, `${reviewMonths} meses`]);

  view.innerHTML = `
    <div class="page-header">
      <div>
        <h1>${editing ? (isFile ? 'Editar informações do arquivo' : 'Editar texto') : 'Novo texto'}</h1>
        <p>${
          isFile
            ? esc(item.file_name || item.source_url || '')
            : draft?.lacuna
              ? `Escrevendo o documento que falta para: “${esc(draft.lacuna)}”. Ao publicar, a lacuna sai do relatório.`
              : draft
                ? 'Rascunho criado a partir de uma resposta da Active AI. Revise e complete antes de publicar.'
                : 'Escreva procedimentos, soluções, comunicados ou qualquer conteúdo para a base. O texto usa Markdown.'
        }</p>
      </div>
    </div>
    <form class="form" id="editor-form">
      <input class="input input-title" name="title" placeholder="Título" required value="${esc(item?.title || draft?.title || '')}" />
      <div class="form-grid">
        <div class="field">
          <label for="f-category">Categoria</label>
          <select class="select" id="f-category" name="category_id">${categoryOptions(categoryId === null ? '' : categoryId)}</select>
        </div>
        <div class="field">
          <label for="f-tags">Tags</label>
          <input class="input" id="f-tags" name="tags" placeholder="Ex.: impressora, fiscal, windows" value="${esc(item?.tags.join(', ') || draft?.tags || '')}" />
          <span class="hint">Separe as tags por vírgula.</span>
        </div>
        <div class="field">
          <label for="f-summary">Descrição curta</label>
          <input class="input" id="f-summary" name="summary" placeholder="Resumo em uma frase (opcional)" value="${esc(item?.summary || '')}" />
        </div>
        <div class="field manual-author">
          <label for="f-author">Autor</label>
          <input class="input" id="f-author" name="author" placeholder="Seu nome" value="${esc(item ? item.author : author)}" />
        </div>
        <div class="field">
          <label for="f-review">Revisar a cada</label>
          <select class="select" id="f-review" name="review_months">${reviewOptions
            .map(([v, label]) => `<option value="${v}"${String(v) === String(reviewMonths) ? ' selected' : ''}>${label}</option>`)
            .join('')}</select>
          <span class="hint">Passado esse tempo sem atualização, o documento avisa que precisa de revisão.</span>
        </div>
      </div>
      ${
        isFile || editing
          ? ''
          : `<div class="template-picker" role="group" aria-label="Modelo de texto">
          <span class="muted small">Modelo:</span>
          <button type="button" class="chip${draft?.template ? '' : ' active'}" data-template="">Em branco</button>
          ${TEMPLATES.map((t) => `<button type="button" class="chip${draft?.template === t.id ? ' active' : ''}" data-template="${t.id}" title="${esc(t.hint)}">${esc(t.name)}</button>`).join('')}
        </div>`
      }
      ${
        isFile
          ? ''
          : `<div class="editor">
        <div class="editor-toolbar">
          ${TOOLBAR.map((t, i) => (t === 'sep' ? '<span class="sep"></span>' : `<button type="button" data-tool="${i}" title="${esc(t.title)}">${t.label}</button>`)).join('')}
          <div class="editor-tabs">
            <button type="button" data-mode="write" class="active">Escrever</button>
            <button type="button" data-mode="split">Dividir</button>
            <button type="button" data-mode="preview">Visualizar</button>
          </div>
        </div>
        <div class="editor-body">
          <textarea name="content" placeholder="Escreva aqui… Use a barra acima para formatar títulos, listas, tabelas e links.">${esc(item?.content || draft?.content || '')}</textarea>
          <div class="preview prose" hidden></div>
        </div>
      </div>`
      }
      <div class="form-actions">
        <a class="btn" href="${editing ? `#/item/${item.id}` : '#/'}">Cancelar</a>
        <button class="btn btn-primary" type="submit">${icon('check')}${editing ? 'Salvar alterações' : 'Publicar texto'}</button>
      </div>
    </form>`;

  const form = view.querySelector('#editor-form');
  const textarea = form.querySelector('textarea');
  const preview = form.querySelector('.preview');
  const body = form.querySelector('.editor-body');
  let dirty = Boolean(draft);
  let mode = 'write';

  // Modelos de texto: preenchem o editor com a estrutura padrão do Suporte.
  form.querySelector('.template-picker')?.addEventListener('click', async (e) => {
    const chip = e.target.closest('[data-template]');
    if (!chip) return;
    const template = TEMPLATES.find((t) => t.id === chip.dataset.template);
    const current = textarea.value.trim();
    const untouched = !current || TEMPLATES.some((t) => t.content.trim() === current);
    if (!untouched) {
      const ok = await confirmDialog({
        title: 'Trocar pelo modelo?',
        message: 'O texto que você já escreveu será substituído pela estrutura do modelo.',
        confirmLabel: 'Usar o modelo',
      });
      if (!ok) return;
    }
    textarea.value = template?.content || '';
    form.querySelectorAll('[data-template]').forEach((c) => c.classList.toggle('active', c === chip));
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
    textarea.setSelectionRange(0, 0);
  });

  const updatePreview = () => {
    if (mode !== 'write') preview.innerHTML = renderMarkdown(textarea.value) || '<p class="muted">Nada para visualizar.</p>';
  };

  form.addEventListener('input', () => {
    dirty = true;
    updatePreview();
  });

  form.querySelectorAll('[data-tool]').forEach((btn) =>
    btn.addEventListener('click', () => applyTool(textarea, TOOLBAR[btn.dataset.tool])),
  );

  form.querySelectorAll('[data-mode]').forEach((btn) =>
    btn.addEventListener('click', () => {
      mode = btn.dataset.mode;
      form.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b === btn));
      body.classList.toggle('split', mode === 'split');
      textarea.hidden = mode === 'preview';
      preview.hidden = mode === 'write';
      updatePreview();
    }),
  );

  textarea?.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const tool = TOOLBAR.find((t) => t.key === e.key.toLowerCase());
    if (tool) {
      e.preventDefault();
      applyTool(textarea, tool);
    } else if (e.key.toLowerCase() === 's') {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  const beforeUnload = (e) => {
    if (dirty) e.preventDefault();
  };
  window.addEventListener('beforeunload', beforeUnload);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    storage.set('kb-author', data.author || '');
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    try {
      const saved = editing ? await api.updateItem(item.id, data) : await api.createArticle(data);
      dirty = false;
      if (draft?.lacuna) await api.resolveGap(draft.lacuna, saved.id).catch(() => {});
      await shared.refreshCategories();
      toast(editing ? 'Alterações salvas.' : draft?.lacuna ? 'Texto publicado. A lacuna saiu do relatório.' : 'Texto publicado na base.');
      location.hash = `#/item/${saved.id}`;
    } catch (err) {
      toast(err.message, 'error');
      submit.disabled = false;
    }
  });

  form.title.focus({ preventScroll: true });
  return () => window.removeEventListener('beforeunload', beforeUnload);
}

// ======================================================================
// Envio de arquivos
// ======================================================================
export async function uploadView(view, { query }) {
  let files = [];
  view.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Enviar arquivos</h1>
        <p>Qualquer tipo de arquivo pode ser incluído. PDF, Word, Excel, PowerPoint, LibreOffice, textos, HTML e imagens têm o conteúdo lido para pesquisa e para a Active AI. Vídeos e áudios (treinamentos, reuniões) são transcritos automaticamente, e a Active AI conversa com base na transcrição.</p>
      </div>
    </div>
    <form class="form" id="upload-form">
      <div class="card card-pad youtube-add">
        <div class="youtube-add-head">${icon('youtube')}<div><strong>Vídeo do YouTube</strong>
          <span class="muted small">A equipe assiste pela plataforma, e a Active AI lê a transcrição (legendas do vídeo).</span></div></div>
        <div class="youtube-row">
          <input class="input" id="yt-url" type="url" inputmode="url" placeholder="Cole o link do vídeo — https://www.youtube.com/watch?v=…" />
          <button class="btn btn-primary" type="button" id="yt-add">${icon('plus')}Adicionar vídeo</button>
        </div>
      </div>
      <div class="or-divider"><span>ou envie arquivos</span></div>
      <label class="dropzone" id="dropzone">
        ${icon('upload')}
        <h3>Arraste arquivos para cá</h3>
        <p class="muted">ou clique para selecionar — vários arquivos de uma vez</p>
        <input type="file" multiple hidden id="file-input" />
      </label>
      <div class="file-list" id="file-list"></div>
      <div class="form-grid">
        <div class="field" id="title-field" hidden>
          <label for="u-title">Título</label>
          <input class="input" id="u-title" name="title" placeholder="Usa o nome do arquivo se ficar vazio" />
        </div>
        <div class="field">
          <label for="u-category">Categoria</label>
          <select class="select" id="u-category" name="category_id">${categoryOptions(query.get('category') || '')}</select>
        </div>
        <div class="field">
          <label for="u-tags">Tags</label>
          <input class="input" id="u-tags" name="tags" placeholder="Ex.: manual, ERP, fiscal" />
          <span class="hint">Aplicadas a todos os arquivos deste envio.</span>
        </div>
        <div class="field">
          <label for="u-summary">Descrição</label>
          <input class="input" id="u-summary" name="summary" placeholder="Do que se trata (opcional)" />
        </div>
        <div class="field manual-author">
          <label for="u-author">Enviado por</label>
          <input class="input" id="u-author" name="author" placeholder="Seu nome" value="${esc(storage.get('kb-author', ''))}" />
        </div>
      </div>
      <div class="progress" hidden><div></div></div>
      <div class="form-actions">
        <a class="btn" href="#/">Cancelar</a>
        <button class="btn btn-primary" type="submit" disabled>${icon('upload')}Enviar para a base</button>
      </div>
    </form>`;

  const form = view.querySelector('#upload-form');
  const dropzone = view.querySelector('#dropzone');
  const input = view.querySelector('#file-input');
  const list = view.querySelector('#file-list');
  const submit = form.querySelector('[type=submit]');
  const progress = form.querySelector('.progress');

  const renderFiles = () => {
    list.innerHTML = files
      .map(
        (f, i) => `
      <div class="file-row">
        ${icon(fileIcon({ kind: 'file', mime_type: f.type, file_name: f.name }))}
        <span class="name" title="${esc(f.name)}">${esc(f.name)}</span>
        <span class="muted small">${formatBytes(f.size)}</span>
        <button class="icon-btn" type="button" data-remove="${i}" title="Remover">${icon('close')}</button>
      </div>`,
      )
      .join('');
    submit.disabled = !files.length;
    view.querySelector('#title-field').hidden = files.length !== 1;
  };

  const addFiles = (list) => {
    files = files.concat([...list]);
    renderFiles();
  };

  input.addEventListener('change', () => {
    addFiles(input.files);
    input.value = '';
  });

  // Vídeo do YouTube: usa a categoria, tags, descrição e autor preenchidos abaixo.
  const ytUrl = view.querySelector('#yt-url');
  const ytAdd = view.querySelector('#yt-add');
  const addYouTube = async () => {
    if (!ytUrl.value.trim()) return ytUrl.focus();
    ytAdd.disabled = true;
    ytAdd.innerHTML = '<span class="spinner"></span> Adicionando…';
    try {
      storage.set('kb-author', form.author.value);
      const item = await api.addYouTube({
        url: ytUrl.value.trim(),
        category_id: form.category_id.value,
        tags: form.tags.value,
        summary: form.summary.value,
        author: form.author.value,
      });
      await shared.refreshCategories();
      toast('Vídeo adicionado. A transcrição está sendo preparada.');
      location.hash = `#/item/${item.id}`;
    } catch (err) {
      toast(err.message, 'error');
      if (err.data?.item) location.hash = `#/item/${err.data.item.id}`;
      ytAdd.disabled = false;
      ytAdd.innerHTML = `${icon('plus')}Adicionar vídeo`;
    }
  };
  ytAdd.addEventListener('click', addYouTube);
  ytUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addYouTube();
    }
  });
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    files.splice(Number(btn.dataset.remove), 1);
    renderFiles();
  });
  ['dragenter', 'dragover'].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.add('drag');
    }),
  );
  ['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, () => dropzone.classList.remove('drag')));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    addFiles(e.dataTransfer.files);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!files.length) return;
    const fd = new FormData();
    for (const [k, v] of new FormData(form)) fd.append(k, v);
    files.forEach((f) => fd.append('files', f, f.name));
    storage.set('kb-author', form.author.value);
    submit.disabled = true;
    progress.hidden = false;
    const bar = progress.firstElementChild;
    try {
      const created = await api.upload('/api/files', fd, (p) => {
        bar.style.width = `${Math.round(p * 100)}%`;
        if (p >= 1) submit.innerHTML = '<span class="spinner"></span> Lendo o conteúdo dos arquivos…';
      });
      await shared.refreshCategories();
      const unread = created.filter((c) => c.extract_status !== 'ok').length;
      toast(`${created.length} arquivo(s) adicionado(s) à base.${unread ? ` ${unread} sem texto legível.` : ''}`);
      location.hash = created.length === 1 ? `#/item/${created[0].id}` : `#/docs${form.category_id.value ? `?category=${form.category_id.value}` : ''}`;
    } catch (err) {
      toast(err.message, 'error');
      submit.disabled = false;
      submit.innerHTML = `${icon('upload')}Enviar para a base`;
      progress.hidden = true;
    }
  });
}

// ======================================================================
// Categorias
// ======================================================================
export async function categoriesView(view) {
  const render = () => {
    const cats = shared.categories;
    view.innerHTML = `
      <div class="page-header">
        <div><h1>Categorias</h1><p>Organize os documentos do Suporte por assunto.</p></div>
        <button class="btn btn-primary needs-editor" id="new-cat">${icon('plus')}Nova categoria</button>
      </div>
      ${
        cats.length
          ? `<div class="card"><table class="cat-table">
          <thead><tr><th>Categoria</th><th class="hide-sm">Descrição</th><th>Docs</th><th></th></tr></thead>
          <tbody>${cats
            .map(
              (c) => `
            <tr>
              <td><a href="#/docs?category=${c.id}" class="row" style="gap:8px">${icon(c.icon)}<strong>${esc(c.name)}</strong></a></td>
              <td class="hide-sm muted">${esc(c.description)}</td>
              <td>${c.item_count}</td>
              <td class="needs-editor" style="text-align:right;white-space:nowrap">
                <button class="icon-btn" data-edit="${c.id}" title="Editar">${icon('edit')}</button>
                <button class="icon-btn" data-delete="${c.id}" title="Excluir">${icon('trash')}</button>
              </td>
            </tr>`,
            )
            .join('')}</tbody></table></div>`
          : emptyState('folder', 'Nenhuma categoria', 'Crie a primeira categoria, por exemplo “Procedimentos”, “Manuais” ou “Erros conhecidos”.')
      }`;
  };

  const edit = (category) => {
    const dialog = document.createElement('dialog');
    let chosen = category?.icon || 'folder';
    dialog.innerHTML = `
      <form method="dialog" class="dialog-body form">
        <h3>${category ? 'Editar categoria' : 'Nova categoria'}</h3>
        <div class="field"><label>Nome</label><input class="input" name="name" required value="${esc(category?.name || '')}" /></div>
        <div class="field"><label>Descrição</label><input class="input" name="description" value="${esc(category?.description || '')}" /></div>
        <div class="field"><label>Ícone</label><div class="row" id="icons">${CATEGORY_ICONS.map(
          (n) => `<button type="button" class="icon-btn" data-icon-name="${n}" style="border-color:${n === chosen ? 'var(--brand-primary)' : 'var(--border)'}">${icon(n)}</button>`,
        ).join('')}</div></div>
        <div class="form-actions">
          <button class="btn" value="cancel" formnovalidate>Cancelar</button>
          <button class="btn btn-primary" value="ok">Salvar</button>
        </div>
      </form>`;
    document.body.appendChild(dialog);
    dialog.querySelector('#icons').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-icon-name]');
      if (!btn) return;
      chosen = btn.dataset.iconName;
      dialog.querySelectorAll('[data-icon-name]').forEach((b) => (b.style.borderColor = b === btn ? 'var(--brand-primary)' : 'var(--border)'));
    });
    const form = dialog.querySelector('form');
    form.addEventListener('submit', async (e) => {
      if (e.submitter?.value !== 'ok') return;
      e.preventDefault();
      const data = { name: form.name.value, description: form.description.value, icon: chosen };
      try {
        if (category) await api.updateCategory(category.id, data);
        else await api.createCategory(data);
        await shared.refreshCategories();
        dialog.close();
        render();
        toast('Categoria salva.');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    dialog.addEventListener('close', () => dialog.remove());
    dialog.showModal();
  };

  view.addEventListener('click', async (e) => {
    if (e.target.closest('#new-cat')) return edit(null);
    const editBtn = e.target.closest('[data-edit]');
    if (editBtn) return edit(shared.categories.find((c) => String(c.id) === editBtn.dataset.edit));
    const delBtn = e.target.closest('[data-delete]');
    if (delBtn) {
      const cat = shared.categories.find((c) => String(c.id) === delBtn.dataset.delete);
      const ok = await confirmDialog({
        title: 'Excluir categoria?',
        message: `“${cat.name}” será excluída. Os ${cat.item_count} documento(s) dela continuam na base, sem categoria.`,
        confirmLabel: 'Excluir',
        danger: true,
      });
      if (!ok) return;
      try {
        await api.deleteCategory(cat.id);
        await shared.refreshCategories();
        render();
        toast('Categoria excluída.');
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

  await shared.refreshCategories();
  render();
}

// ======================================================================
// Active AI em tela cheia
// ======================================================================
export async function iaView(view) {
  view.innerHTML = '<div class="ia-page"></div>';
  const instance = mountChat(view.querySelector('.ia-page'), { variant: 'page' });
  instance.focus();
  return () => instance.unmount();
}

// ======================================================================
// Relatório: lacunas, documentos para revisar e avaliações
// ======================================================================
const GAP_SOURCES = {
  busca: { label: 'Busca sem resultado', icon: 'search' },
  ia: { label: 'Active AI não encontrou', icon: 'sparkles' },
  agente: { label: 'Registrada pelo agente (MCP)', icon: 'network' },
  avaliacao: { label: 'Resposta avaliada 👎', icon: 'thumbsDown' },
};

const percent = ({ up, down }) => (up + down ? `${Math.round((up / (up + down)) * 100)}%` : '—');

export async function reportView(view, { query }) {
  const tab = ['lacunas', 'revisar', 'avaliacoes'].includes(query.get('aba')) ? query.get('aba') : 'lacunas';
  const showResolved = query.get('resolvidas') === '1';
  view.innerHTML = skeleton('report');
  const data = await api.report({ resolved: showResolved });
  const open = showResolved ? null : data.gaps.length;
  document.dispatchEvent(new CustomEvent('report-changed'));

  const link = (params) => `#/relatorio?${new URLSearchParams(params)}`;
  const gapRow = (g) => `
    <div class="card gap-row" data-gap="${esc(g.query)}">
      <div class="gap-main">
        <strong>${esc(g.query)}</strong>
        <div class="gap-meta">
          <span class="badge badge-file">${g.count} ${g.count === 1 ? 'vez' : 'vezes'}</span>
          ${g.sources.map((s) => `<span class="gap-source">${icon(GAP_SOURCES[s]?.icon || 'alert')}${esc(GAP_SOURCES[s]?.label || s)}</span>`).join('')}
          <span class="muted small">${showResolved ? `resolvida ${esc(relativeDate(g.resolved_at))}` : `última ${esc(relativeDate(g.last_at))}`}</span>
          ${showResolved && g.resolved_item_id ? `<a class="small" href="#/item/${g.resolved_item_id}">ver documento →</a>` : ''}
        </div>
        ${
          g.details.length
            ? `<details class="gap-details"><summary>Detalhes (${g.details.length})</summary><ul>${g.details
                .map((d) => `<li><span class="muted small">${esc(GAP_SOURCES[d.source]?.label || d.source)} · ${esc(relativeDate(d.created_at))}</span><br>${esc(d.detail)}</li>`)
                .join('')}</ul></details>`
            : ''
        }
      </div>
      <div class="gap-actions needs-editor">
        ${
          showResolved
            ? `<button class="btn btn-sm" type="button" data-reopen>${icon('refresh')}Reabrir</button>`
            : `<button class="btn btn-sm btn-primary" type="button" data-write>${icon('pen')}Escrever documento</button>
               <button class="btn btn-sm" type="button" data-resolve title="Já existe documento ou não precisa">${icon('check')}Resolver</button>`
        }
      </div>
    </div>`;

  const tabs = {
    lacunas: () => `
      <div class="row report-toolbar">
        <p class="muted small spacer">Perguntas que a base não respondeu, das mais frequentes para as menos. Escreva o documento que falta: ao publicar, a lacuna sai daqui.</p>
        <div class="segmented">
          <a href="${link({ aba: 'lacunas' })}" class="${showResolved ? '' : 'active'}">Abertas</a>
          <a href="${link({ aba: 'lacunas', resolvidas: 1 })}" class="${showResolved ? 'active' : ''}">Resolvidas</a>
        </div>
      </div>
      ${
        data.gaps.length
          ? `<div class="gap-list">${data.gaps.map(gapRow).join('')}</div>`
          : emptyState('check', showResolved ? 'Nenhuma lacuna resolvida ainda' : 'Nenhuma lacuna aberta', showResolved ? 'As lacunas resolvidas aparecem aqui.' : 'Tudo o que foi procurado foi encontrado. As buscas sem resultado e as perguntas que a Active AI não souber responder aparecem aqui.')
      }`,
    revisar: () =>
      data.review.length
        ? `<p class="muted small">Documentos que passaram do prazo de revisão sem atualização. Confira se continuam valendo — a Active AI avisa quem pergunta que eles podem estar desatualizados.</p>
           <div class="doc-list">${data.review
             .map(
               (i) => `<div class="review-row">${docItem(i)}<div class="review-actions needs-editor">
                 <button class="btn btn-sm btn-primary" type="button" data-reviewed="${i.id}">${icon('check')}Continua válido</button>
                 <a class="btn btn-sm" href="#/edit/${i.id}">${icon('edit')}Atualizar</a></div></div>`,
             )
             .join('')}</div>`
        : emptyState('clock', 'Nada para revisar', 'Todos os documentos estão dentro do prazo de revisão.'),
    avaliacoes: () => {
      const { docs, answers } = data.feedback;
      return `
        <section class="report-section">
          <h2>Documentos com avaliações negativas</h2>
          ${
            docs.length
              ? `<div class="card"><table class="cat-table feedback-table"><thead><tr><th>Documento</th><th>${icon('thumbsUp')}</th><th>${icon('thumbsDown')}</th><th class="hide-sm">Comentários</th></tr></thead>
                 <tbody>${docs
                   .map(
                     (d) => `<tr><td><a href="#/item/${d.id}"><strong>${esc(d.title)}</strong></a></td><td>${d.up}</td><td>${d.down}</td>
                       <td class="hide-sm">${d.comments.length ? `<ul class="comments">${d.comments.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : '<span class="muted">—</span>'}</td></tr>`,
                   )
                   .join('')}</tbody></table></div>`
              : '<p class="muted">Nenhum documento recebeu avaliação negativa.</p>'
          }
        </section>
        <section class="report-section">
          <h2>Respostas da Active AI que não ajudaram</h2>
          ${
            answers.length
              ? `<div class="gap-list">${answers
                  .map(
                    (a) => `<div class="card gap-row" data-gap="${esc(a.question)}">
                      <div class="gap-main">
                        <strong>${esc(a.question || '(pergunta não registrada)')}</strong>
                        <div class="gap-meta"><span class="muted small">${a.user_name ? `${esc(a.user_name)} · ` : ''}${esc(relativeDate(a.created_at))}</span></div>
                        ${a.comment ? `<p class="feedback-comment">“${esc(a.comment)}”</p>` : ''}
                        <details class="gap-details"><summary>Ver a resposta</summary><div class="prose">${renderMarkdown(a.answer)}</div></details>
                      </div>
                      <div class="gap-actions needs-editor">${a.question ? `<button class="btn btn-sm btn-primary" type="button" data-write>${icon('pen')}Escrever documento</button>` : ''}</div>
                    </div>`,
                  )
                  .join('')}</div>`
              : '<p class="muted">Nenhuma resposta foi avaliada como “não ajudou”.</p>'
          }
        </section>`;
    },
  };

  const totals = data.feedback.totals;
  view.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Relatório da base</h1>
        <p>O que falta escrever, o que precisa de revisão e o que a equipe achou dos documentos e das respostas da Active AI.</p>
      </div>
    </div>
    <div class="stat-grid">
      <a class="card stat" href="${link({ aba: 'lacunas' })}"><span>${icon('search')}Lacunas abertas</span><strong>${open ?? '…'}</strong></a>
      <a class="card stat" href="${link({ aba: 'revisar' })}"><span>${icon('clock')}Para revisar</span><strong>${data.review.length}</strong></a>
      <a class="card stat" href="${link({ aba: 'avaliacoes' })}"><span>${icon('thumbsUp')}Documentos úteis</span><strong>${percent(totals.documento)}</strong><small>${totals.documento.up + totals.documento.down} avaliações</small></a>
      <a class="card stat" href="${link({ aba: 'avaliacoes' })}"><span>${icon('sparkles')}Respostas úteis</span><strong>${percent(totals.resposta)}</strong><small>${totals.resposta.up + totals.resposta.down} avaliações</small></a>
    </div>
    <nav class="tabs" aria-label="Seções do relatório">
      <a href="${link({ aba: 'lacunas' })}" class="${tab === 'lacunas' ? 'active' : ''}">Lacunas</a>
      <a href="${link({ aba: 'revisar' })}" class="${tab === 'revisar' ? 'active' : ''}">Para revisar${data.review.length ? ` <span class="count">${data.review.length}</span>` : ''}</a>
      <a href="${link({ aba: 'avaliacoes' })}" class="${tab === 'avaliacoes' ? 'active' : ''}">Avaliações</a>
    </nav>
    <div id="report-body">${tabs[tab]()}</div>`;

  const rerender = () => reportView(view, { query }).then(() => hydrateIcons(view));
  view.querySelector('#report-body').addEventListener('click', async (e) => {
    const row = e.target.closest('[data-gap]');
    const question = row?.dataset.gap;
    try {
      if (e.target.closest('[data-write]')) {
        openDraft(draftFromGap(question));
      } else if (e.target.closest('[data-resolve]')) {
        await api.resolveGap(question);
        toast('Lacuna marcada como resolvida.');
        rerender();
      } else if (e.target.closest('[data-reopen]')) {
        await api.reopenGap(question);
        toast('Lacuna reaberta.');
        rerender();
      } else if (e.target.closest('[data-reviewed]')) {
        await api.markReviewed(e.target.closest('[data-reviewed]').dataset.reviewed);
        toast('Revisão registrada.');
        rerender();
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  fadeUp(view.querySelectorAll('.stat'), { y: 8, stagger: 50 });
}

// ======================================================================
// Glossário da Active: termos, siglas e sinônimos (ampliam a busca e explicam os termos à Active AI)
// ======================================================================
export async function glossaryView(view) {
  view.innerHTML = skeleton('list');
  let terms = await api.glossary();
  let filter = '';

  const matches = (t) => {
    const q = filter.trim().toLowerCase();
    return !q || [t.term, ...t.synonyms, t.description].some((s) => String(s).toLowerCase().includes(q));
  };
  const renderList = () => {
    const list = terms.filter(matches);
    view.querySelector('#gloss-body').innerHTML = list.length
      ? `<div class="card"><table class="cat-table gloss-table">
          <thead><tr><th>Termo</th><th>Sinônimos e siglas</th><th class="hide-sm">O que significa</th><th class="needs-editor"></th></tr></thead>
          <tbody>${list
            .map(
              (t) => `<tr>
                <td><strong>${esc(t.term)}</strong></td>
                <td>${t.synonyms.length ? t.synonyms.map((s) => `<span class="tag">${esc(s)}</span>`).join(' ') : '<span class="muted">—</span>'}</td>
                <td class="hide-sm muted">${esc(t.description) || '—'}</td>
                <td class="needs-editor" style="text-align:right;white-space:nowrap">
                  <button class="icon-btn" data-edit="${t.id}" title="Editar">${icon('edit')}</button>
                  <button class="icon-btn" data-delete="${t.id}" title="Excluir">${icon('trash')}</button>
                </td>
              </tr>`,
            )
            .join('')}</tbody></table></div>`
      : terms.length
        ? `<p class="muted">Nenhum termo com “${esc(filter)}”.</p>`
        : emptyState('book', 'O glossário está vazio', 'Cadastre os termos que a equipe usa no dia a dia — por exemplo “CT-e”, com os sinônimos “conhecimento de transporte” e “CTe”. A busca passa a achar documentos pelos sinônimos e a Active AI entende os termos internos.');
    hydrateIcons(view.querySelector('#gloss-body'));
  };

  view.innerHTML = `
    <div class="page-header">
      <div><h1>Glossário</h1><p>Termos, siglas e sinônimos da Active. Quem pesquisar por um sinônimo encontra os documentos que usam o termo, e a Active AI recebe a explicação dos termos citados na pergunta.</p></div>
      <button class="btn btn-primary needs-editor" id="new-term">${icon('plus')}Novo termo</button>
    </div>
    <div class="filters"><input class="input search-input" id="gloss-filter" type="search" placeholder="Filtrar termos…" /></div>
    <div id="gloss-body"></div>`;
  renderList();

  const edit = (term) => {
    const dialog = document.createElement('dialog');
    dialog.innerHTML = `
      <form method="dialog" class="dialog-body form">
        <h3>${term ? 'Editar termo' : 'Novo termo'}</h3>
        <div class="field"><label>Termo</label><input class="input" name="term" required maxlength="120" placeholder="Ex.: CT-e" value="${esc(term?.term || '')}" /></div>
        <div class="field"><label>Sinônimos e siglas</label><input class="input" name="synonyms" placeholder="Separados por vírgula. Ex.: CTe, conhecimento de transporte" value="${esc(term?.synonyms.join(', ') || '')}" /></div>
        <div class="field"><label>O que significa</label><textarea class="textarea" name="description" rows="3" maxlength="1000" placeholder="Explicação curta (opcional), usada pela Active AI">${esc(term?.description || '')}</textarea></div>
        <div class="form-actions">
          <button class="btn" value="cancel" formnovalidate>Cancelar</button>
          <button class="btn btn-primary" value="ok">Salvar</button>
        </div>
      </form>`;
    document.body.appendChild(dialog);
    const form = dialog.querySelector('form');
    form.addEventListener('submit', async (e) => {
      if (e.submitter?.value !== 'ok') return;
      e.preventDefault();
      const data = { term: form.term.value, synonyms: form.synonyms.value, description: form.description.value };
      try {
        if (term) await api.updateTerm(term.id, data);
        else await api.createTerm(data);
        terms = await api.glossary();
        dialog.close();
        renderList();
        toast('Termo salvo.');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    dialog.addEventListener('close', () => dialog.remove());
    dialog.showModal();
  };

  view.querySelector('#gloss-filter').addEventListener('input', (e) => {
    filter = e.target.value;
    renderList();
  });
  view.addEventListener('click', async (e) => {
    if (e.target.closest('#new-term')) return edit(null);
    const editBtn = e.target.closest('[data-edit]');
    if (editBtn) return edit(terms.find((t) => String(t.id) === editBtn.dataset.edit));
    const delBtn = e.target.closest('[data-delete]');
    if (!delBtn) return;
    const term = terms.find((t) => String(t.id) === delBtn.dataset.delete);
    const ok = await confirmDialog({ title: 'Excluir termo?', message: `“${term.term}” sai do glossário.`, confirmLabel: 'Excluir', danger: true });
    if (!ok) return;
    try {
      await api.deleteTerm(term.id);
      terms = terms.filter((t) => t.id !== term.id);
      renderList();
      toast('Termo excluído.');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// ======================================================================
// Pessoas e perfis (somente administradores; só existe com o login individual ligado)
// ======================================================================
const ROLE_INFO = {
  admin: { label: 'Administrador', text: 'edita e gerencia as pessoas' },
  editor: { label: 'Editor', text: 'cria e edita documentos' },
  leitor: { label: 'Só consulta', text: 'pesquisa e conversa com a Active AI' },
};

/** Mostra a senha provisória uma única vez, com botão de copiar, para o administrador repassar. */
function showPassword({ title, user, password }) {
  const dialog = document.createElement('dialog');
  dialog.innerHTML = `
    <form method="dialog" class="dialog-body form">
      <h3>${esc(title)}</h3>
      <p class="muted">Envie para <strong>${esc(user.name)}</strong> por um canal seguro (Teams, pessoalmente). No primeiro login, a plataforma pede para a pessoa criar a própria senha.</p>
      <div class="temp-password">
        <div><span class="muted small">E-mail</span><code>${esc(user.email)}</code></div>
        <div><span class="muted small">Senha provisória</span><code id="temp-pass">${esc(password)}</code></div>
      </div>
      <p class="muted small">${icon('alert')} Esta senha não aparece de novo. Se ela se perder, gere outra em “Nova senha”.</p>
      <div class="form-actions">
        <button class="btn" type="button" id="copy-pass">${icon('copy')}Copiar acesso</button>
        <button class="btn btn-primary" value="ok">Pronto</button>
      </div>
    </form>`;
  document.body.appendChild(dialog);
  hydrateIcons(dialog);
  dialog.querySelector('#copy-pass').addEventListener('click', async () => {
    const text = `Base de Conhecimento Active\nEndereço: ${location.origin}\nE-mail: ${user.email}\nSenha provisória: ${password}\n(no primeiro acesso você cria a sua senha)`;
    try {
      await navigator.clipboard.writeText(text);
      toast('Acesso copiado.');
    } catch {
      toast('Não foi possível copiar. Selecione o texto e copie.', 'error');
    }
  });
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
}

export async function usersView(view) {
  if (!shared.authEnabled) {
    view.innerHTML = emptyState('users', 'Login desligado', 'A plataforma está rodando com LOGIN=off. Remova essa opção do .env para cada pessoa entrar com o próprio e-mail e senha.');
    return;
  }
  if (shared.user?.role !== 'admin') {
    view.innerHTML = emptyState('shield', 'Somente administradores', 'Peça a um administrador para criar contas ou mudar perfis.');
    return;
  }
  view.innerHTML = skeleton('list');
  let users = await api.users();

  const render = () => {
    view.innerHTML = `
      <div class="page-header">
        <div><h1>Pessoas</h1><p>Contas de acesso à plataforma. Cada pessoa entra com o próprio e-mail e senha.</p></div>
        <button class="btn btn-primary" id="new-user" type="button">${icon('plus')}Nova pessoa</button>
      </div>
      <div class="role-legend">${Object.values(ROLE_INFO).map((r) => `<span><strong>${r.label}</strong> — ${r.text}</span>`).join('')}</div>
      <div class="card"><table class="cat-table users-table">
        <thead><tr><th>Pessoa</th><th>Perfil</th><th class="hide-sm">Último acesso</th><th>Acesso</th><th></th></tr></thead>
        <tbody>${users
          .map((u) => {
            const me = u.id === shared.user.id;
            return `<tr class="${u.active ? '' : 'user-inactive'}" data-user="${u.id}">
              <td><strong>${esc(u.name || u.email)}</strong>${me ? ' <span class="badge badge-file">você</span>' : ''}${u.must_change_password ? ' <span class="badge badge-warn" title="Ainda não criou a própria senha">senha provisória</span>' : ''}<br><span class="muted small">${esc(u.email)}</span></td>
              <td><select class="select select-sm" data-role${me ? ' disabled title="Você não pode mudar o seu próprio perfil"' : ''}>${Object.entries(ROLE_INFO)
                .map(([value, r]) => `<option value="${value}"${u.role === value ? ' selected' : ''}>${r.label}</option>`)
                .join('')}</select></td>
              <td class="hide-sm muted small">${u.last_login_at ? esc(relativeDate(u.last_login_at)) : 'nunca entrou'}</td>
              <td><label class="switch"${me ? ' title="Você não pode bloquear o seu próprio acesso"' : ''}><input type="checkbox" data-active${u.active ? ' checked' : ''}${me ? ' disabled' : ''} /><span>${u.active ? 'Liberado' : 'Bloqueado'}</span></label></td>
              <td style="text-align:right;white-space:nowrap">${
                me
                  ? `<a class="icon-btn" href="/trocar-senha" title="Trocar a minha senha">${icon('key')}</a>`
                  : `<button class="icon-btn" type="button" data-edit title="Editar nome e e-mail">${icon('edit')}</button>
                     <button class="icon-btn" type="button" data-reset title="Gerar nova senha provisória">${icon('key')}</button>
                     <button class="icon-btn" type="button" data-remove title="Excluir conta">${icon('trash')}</button>`
              }</td>
            </tr>`;
          })
          .join('')}</tbody></table></div>`;
    hydrateIcons(view);
  };

  const form = (user) => {
    const dialog = document.createElement('dialog');
    dialog.innerHTML = `
      <form method="dialog" class="dialog-body form">
        <h3>${user ? 'Editar pessoa' : 'Nova pessoa'}</h3>
        <div class="field"><label>Nome</label><input class="input" name="name" required maxlength="120" autocomplete="off" value="${esc(user?.name || '')}" /></div>
        <div class="field"><label>E-mail</label><input class="input" name="email" type="email" required autocomplete="off" placeholder="nome@activecorp.com.br" value="${esc(user?.email || '')}" /></div>
        ${
          user
            ? ''
            : `<div class="field"><label>Perfil</label><select class="select" name="role">${Object.entries(ROLE_INFO)
                .map(([value, r]) => `<option value="${value}"${value === 'editor' ? ' selected' : ''}>${r.label} — ${r.text}</option>`)
                .join('')}</select></div>
               <p class="muted small">A plataforma gera uma senha provisória para você repassar. No primeiro login, a pessoa cria a própria senha.</p>`
        }
        <div class="form-actions">
          <button class="btn" value="cancel" formnovalidate>Cancelar</button>
          <button class="btn btn-primary" value="ok">${user ? 'Salvar' : 'Criar conta'}</button>
        </div>
      </form>`;
    document.body.appendChild(dialog);
    const f = dialog.querySelector('form');
    f.addEventListener('submit', async (e) => {
      if (e.submitter?.value !== 'ok') return;
      e.preventDefault();
      try {
        if (user) {
          const updated = await api.updateUser(user.id, { name: f.name.value, email: f.email.value });
          users = users.map((u) => (u.id === user.id ? updated : u));
          dialog.close();
          toast('Dados salvos.');
        } else {
          const created = await api.createUser({ name: f.name.value, email: f.email.value, role: f.role.value });
          users = await api.users();
          dialog.close();
          showPassword({ title: 'Conta criada', user: created.user, password: created.password });
        }
        render();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    dialog.addEventListener('close', () => dialog.remove());
    dialog.showModal();
  };

  view.addEventListener('click', async (e) => {
    if (e.target.closest('#new-user')) return form(null);
    const row = e.target.closest('[data-user]');
    if (!row) return;
    const user = users.find((u) => u.id === Number(row.dataset.user));
    try {
      if (e.target.closest('[data-edit]')) return form(user);
      if (e.target.closest('[data-reset]')) {
        const ok = await confirmDialog({
          title: 'Gerar nova senha provisória?',
          message: `A senha atual de ${user.name} deixa de valer e a pessoa é desconectada. Ela vai criar uma senha nova no próximo login.`,
          confirmLabel: 'Gerar senha',
        });
        if (!ok) return;
        const { password } = await api.resetPassword(user.id);
        users = await api.users();
        render();
        showPassword({ title: 'Nova senha provisória', user, password });
      } else if (e.target.closest('[data-remove]')) {
        const ok = await confirmDialog({
          title: 'Excluir conta?',
          message: `${user.name} perde o acesso. Os documentos que a pessoa escreveu continuam na base. Para só suspender o acesso, use “Bloqueado”.`,
          confirmLabel: 'Excluir',
          danger: true,
        });
        if (!ok) return;
        await api.deleteUser(user.id);
        users = users.filter((u) => u.id !== user.id);
        render();
        toast('Conta excluída.');
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  view.addEventListener('change', async (e) => {
    const row = e.target.closest('[data-user]');
    if (!row) return;
    const id = Number(row.dataset.user);
    const data = e.target.matches('[data-role]') ? { role: e.target.value } : { active: e.target.checked };
    try {
      const updated = await api.updateUser(id, data);
      users = users.map((u) => (u.id === id ? updated : u));
      toast(data.role ? `Perfil alterado para “${ROLE_INFO[updated.role].label}”.` : updated.active ? 'Acesso liberado.' : 'Acesso bloqueado. A pessoa foi desconectada.');
    } catch (err) {
      toast(err.message, 'error');
    }
    render();
  });
  render();
}

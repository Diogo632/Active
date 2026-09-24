import { api } from './api.js';
import { chat, mountChat } from './chat.js';
import { mountAnswer } from './answer.js';
import {
  esc, icon, hydrateIcons, formatDate, relativeDate, formatBytes, fileIcon, fileTypeLabel,
  renderMarkdown, toast, confirmDialog, storage, CATEGORY_ICONS,
} from './util.js';

/** Estado compartilhado entre as telas (categorias ficam em cache para formulários e menu). */
export const shared = {
  categories: [],
  aiConfigured: false,
  async refreshCategories() {
    shared.categories = await api.categories();
    document.dispatchEvent(new CustomEvent('categories-changed'));
    return shared.categories;
  },
};

const loading = (text = 'Carregando…') => `<div class="loading"><span class="spinner"></span>${esc(text)}</div>`;

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
    ...item.tags.slice(0, 4).map((t) => `<span class="tag">${esc(t)}</span>`),
  ].filter(Boolean);
  const snippet = item.snippet?.trim() || item.summary;
  return `
    <a class="card doc-item" href="#/item/${item.id}">
      <div class="doc-icon ${item.kind}">${icon(iconName)}</div>
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
  view.innerHTML = loading();
  const [popular, recent] = await Promise.all([api.items({ limit: 6, sort: 'views' }), api.items({ limit: 6 })]);
  const cats = shared.categories;
  const empty = !recent.items.length;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

  const quickList = (items) =>
    items
      .map(
        (i) => `
        <a class="quick-item" href="#/item/${i.id}">
          <span class="quick-icon ${i.kind}">${icon(fileIcon(i))}</span>
          <span class="quick-text"><strong>${esc(i.title)}</strong><small>${esc(i.category_name || 'Sem categoria')} · ${esc(relativeDate(i.updated_at))}</small></span>
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
        <p class="home-hint">O Active IA responde junto com os resultados<span class="kbd-hint"> · <kbd>Ctrl</kbd> <kbd>K</kbd> busca de qualquer tela</span></p>
        ${
          cats.length
            ? `<nav class="chips" aria-label="Categorias">${cats
                .map((c) => `<a class="chip" href="#/docs?category=${c.id}">${icon(c.icon)}${esc(c.name)}<span>${c.item_count}</span></a>`)
                .join('')}</nav>`
            : ''
        }
      </div>
      ${
        empty
          ? emptyState(
              'library',
              'A base ainda está vazia',
              'Comece escrevendo um texto ou enviando documentos (PDF, Word, Excel, PowerPoint, imagens e qualquer outro tipo).',
              '<div class="row" style="justify-content:center"><a class="btn btn-primary" href="#/new">Escrever texto</a><a class="btn" href="#/upload">Enviar arquivos</a></div>',
            )
          : `<div class="home-columns">
              <section><h2>Mais acessados</h2><div class="quick-list">${quickList(popular.items)}</div></section>
              <section><h2>Atualizados recentemente</h2><div class="quick-list">${quickList(recent.items)}</div><a class="small" href="#/docs">Ver todos os documentos →</a></section>
            </div>`
      }
    </section>`;

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
          : `<div class="row">
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
      </select>
      ${tag ? `<input type="hidden" name="tag" value="${esc(tag)}" />` : ''}
      <button class="btn btn-primary" type="submit">${icon('search')}Filtrar</button>
    </form>
    <div id="answer"></div>
    <div id="results">${loading()}</div>`;

  // Na busca, o Active IA responde no topo usando os documentos encontrados.
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

  const data = await api.items({ q, category, kind, tag, limit: 100 });
  const results = view.querySelector('#results');
  if (!data.items.length) {
    results.innerHTML = q
      ? emptyState('search', 'Nada encontrado', `Nenhum documento corresponde a “${q}”. O Active IA pode ajudar a procurar com outras palavras.`, `<button class="btn btn-ia" id="ask-ia">${icon('sparkles')}Perguntar ao Active IA</button>`)
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
  view.innerHTML = loading();
  const item = await api.item(params.id, { view: true });

  const preview = item.kind === 'file' ? filePreview(item) : '';
  const extractNote = {
    unsupported: 'O conteúdo deste tipo de arquivo não pode ser lido automaticamente. O Active IA conhece apenas o título, a descrição e as tags.',
    error: 'Não foi possível ler o conteúdo deste arquivo. O Active IA conhece apenas o título, a descrição e as tags.',
    empty: 'Nenhum texto foi encontrado neste arquivo (pode ser um documento digitalizado).',
  }[item.extract_status];

  let body;
  if (item.kind === 'article') {
    body = `<article class="card card-pad prose">${item.content.trim() ? renderMarkdown(item.content) : '<p class="muted">Este texto está vazio.</p>'}</article>`;
  } else {
    const text = item.text_preview
      ? `<details class="card card-pad extracted-box"${preview ? '' : ' open'}>
           <summary>Conteúdo do arquivo (texto lido pelo Active IA)</summary>
           <pre class="extracted">${esc(item.text_preview)}${item.text_length > item.text_preview.length ? '\n\n[…]' : ''}</pre>
         </details>`
      : '';
    body = `
      ${preview ? `<div class="card card-pad">${preview}</div>` : ''}
      ${text}
      ${!preview && !text ? emptyState(fileIcon(item), item.file_name, 'Este arquivo não pode ser visualizado aqui. Use o botão “Baixar” para abri-lo.') : ''}
      ${extractNote ? `<p class="muted small">${icon('alert')} ${esc(extractNote)}</p>` : ''}`;
  }

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
      <button class="btn btn-ia" id="ask">${icon('sparkles')}Perguntar ao Active IA</button>
      <a class="btn" href="#/edit/${item.id}">${icon('edit')}Editar${item.kind === 'file' ? ' informações' : ''}</a>
      ${item.kind === 'file' ? `<a class="btn" href="/api/items/${item.id}/file?download">${icon('download')}Baixar</a>` : ''}
      ${item.kind === 'file' ? `<label class="btn">${icon('upload')}Nova versão<input type="file" id="replace" hidden /></label>` : ''}
      <button class="btn btn-danger" id="delete">${icon('trash')}Excluir</button>
    </div>
    <div class="doc-layout">
      <div style="display:flex;flex-direction:column;gap:16px;min-width:0">${body}</div>
      <aside class="doc-side">
        <div class="card card-pad ask-card">
          <strong>Dúvidas sobre este documento?</strong>
          <p>O Active IA pode resumir, explicar ou encontrar documentos relacionados.</p>
          <button class="btn btn-sm" id="ask-summary">${icon('sparkles')}Resumir com o Active IA</button>
        </div>
        <div class="card card-pad">
          <dl>
            <dt>Categoria</dt><dd>${esc(item.category_name || 'Sem categoria')}</dd>
            ${item.author ? `<dt>Autor</dt><dd>${esc(item.author)}</dd>` : ''}
            ${item.file_name ? `<dt>Arquivo</dt><dd>${esc(item.file_name)}</dd>` : ''}
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
  view.querySelector('#ask-summary').addEventListener('click', () => askAbout('Resuma este documento em tópicos, destacando os pontos mais importantes.'));

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

  return () => chat.setContext(null);
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
  view.innerHTML = loading();
  const item = editing ? await api.item(params.id) : null;
  const isFile = item?.kind === 'file';
  const author = storage.get('kb-author', '');
  const categoryId = item ? item.category_id ?? '' : query.get('category') || '';

  view.innerHTML = `
    <div class="page-header">
      <div>
        <h1>${editing ? (isFile ? 'Editar informações do arquivo' : 'Editar texto') : 'Novo texto'}</h1>
        <p>${isFile ? esc(item.file_name) : 'Escreva procedimentos, soluções, comunicados ou qualquer conteúdo para a base. O texto usa Markdown.'}</p>
      </div>
    </div>
    <form class="form" id="editor-form">
      <input class="input input-title" name="title" placeholder="Título" required value="${esc(item?.title || '')}" />
      <div class="form-grid">
        <div class="field">
          <label for="f-category">Categoria</label>
          <select class="select" id="f-category" name="category_id">${categoryOptions(categoryId === null ? '' : categoryId)}</select>
        </div>
        <div class="field">
          <label for="f-tags">Tags</label>
          <input class="input" id="f-tags" name="tags" placeholder="Ex.: impressora, fiscal, windows" value="${esc(item?.tags.join(', ') || '')}" />
          <span class="hint">Separe as tags por vírgula.</span>
        </div>
        <div class="field">
          <label for="f-summary">Descrição curta</label>
          <input class="input" id="f-summary" name="summary" placeholder="Resumo em uma frase (opcional)" value="${esc(item?.summary || '')}" />
        </div>
        <div class="field">
          <label for="f-author">Autor</label>
          <input class="input" id="f-author" name="author" placeholder="Seu nome" value="${esc(item ? item.author : author)}" />
        </div>
      </div>
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
          <textarea name="content" placeholder="Escreva aqui… Use a barra acima para formatar títulos, listas, tabelas e links.">${esc(item?.content || '')}</textarea>
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
  let dirty = false;
  let mode = 'write';

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
      await shared.refreshCategories();
      toast(editing ? 'Alterações salvas.' : 'Texto publicado na base.');
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
        <p>Qualquer tipo de arquivo pode ser incluído. PDF, Word, Excel, PowerPoint, LibreOffice, textos, HTML e imagens têm o conteúdo lido para pesquisa e para o Active IA.</p>
      </div>
    </div>
    <form class="form" id="upload-form">
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
        <div class="field">
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
        <button class="btn btn-primary" id="new-cat">${icon('plus')}Nova categoria</button>
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
              <td style="text-align:right;white-space:nowrap">
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
// Active IA em tela cheia
// ======================================================================
export async function iaView(view) {
  view.innerHTML = '<div class="ia-page"></div>';
  const instance = mountChat(view.querySelector('.ia-page'), { variant: 'page' });
  instance.focus();
  return () => instance.unmount();
}

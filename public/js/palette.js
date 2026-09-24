import { api } from './api.js';
import { esc, icon, fileIcon, hydrateIcons } from './util.js';

/**
 * Busca rápida (Ctrl+K ou "/"): resultados enquanto digita, navegação pelo teclado
 * e atalho para ver a resposta do Active IA com todos os resultados.
 */
export function setupPalette() {
  const overlay = document.createElement('div');
  overlay.className = 'palette-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="palette" role="dialog" aria-label="Busca rápida">
      <div class="palette-input">
        ${icon('search')}
        <input type="search" placeholder="Busque um documento ou faça uma pergunta…" autocomplete="off" aria-label="Busca rápida" />
        <kbd>Esc</kbd>
      </div>
      <div class="palette-results" role="listbox"></div>
    </div>`;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('input');
  const list = overlay.querySelector('.palette-results');
  let options = [];
  let active = 0;
  let timer = 0;
  let requestId = 0;

  const askOption = (q) => ({
    href: `#/docs?q=${encodeURIComponent(q)}`,
    html: `<span class="quick-icon ai">AI</span><span class="quick-text"><strong>Buscar “${esc(q)}”</strong><small>Ver todos os resultados com a resposta do Active IA</small></span>`,
  });

  function render() {
    list.innerHTML = options.length
      ? options
          .map((o, i) => `<a class="palette-option${i === active ? ' active' : ''}" href="${o.href}" role="option" data-index="${i}">${o.html}</a>`)
          .join('')
      : `<div class="palette-empty">Digite para buscar em toda a base.</div>`;
    hydrateIcons(list);
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }

  async function search() {
    const q = input.value.trim();
    const id = ++requestId;
    if (!q) {
      options = [];
      return render();
    }
    const data = await api.items({ q, limit: 7 }).catch(() => ({ items: [] }));
    if (id !== requestId) return;
    options = [
      ...data.items.map((i) => ({
        href: `#/item/${i.id}`,
        html: `<span class="quick-icon ${i.kind}">${icon(fileIcon(i))}</span><span class="quick-text"><strong>${esc(i.title)}</strong><small>${esc(i.category_name || 'Sem categoria')}</small></span>`,
      })),
      askOption(q),
    ];
    active = 0;
    render();
  }

  function open() {
    overlay.hidden = false;
    input.value = '';
    options = [];
    render();
    input.focus();
  }

  function close() {
    overlay.hidden = true;
  }

  function go(option) {
    if (!option) return;
    close();
    location.hash = option.href;
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(search, 120);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!options.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const q = input.value.trim();
      if (options.length) go(options[active]);
      else if (q) go(askOption(q));
    }
  });

  list.addEventListener('click', (e) => {
    const el = e.target.closest('[data-index]');
    if (!el) return;
    e.preventDefault();
    go(options[Number(el.dataset.index)]);
  });

  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      overlay.hidden ? open() : close();
    } else if (e.key === '/' && !typing && overlay.hidden) {
      e.preventDefault();
      open();
    } else if (e.key === 'Escape' && !overlay.hidden) {
      close();
    }
  });

  return { open, close };
}

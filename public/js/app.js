import { api } from './api.js';
import { setupPalette } from './palette.js';
import { pageEnter, setupRipples, popIn } from './motion.js';
import { chat, mountChat } from './chat.js';
import { esc, icon, hydrateIcons, toast } from './util.js';
import {
  shared, homeView, docsView, itemView, editorView, uploadView, categoriesView, iaView,
} from './views.js';

const routes = [
  { pattern: /^\/?$/, view: homeView, nav: 'home' },
  { pattern: /^\/docs$/, view: docsView, nav: 'docs' },
  { pattern: /^\/item\/(?<id>\d+)$/, view: itemView },
  { pattern: /^\/new$/, view: editorView },
  { pattern: /^\/edit\/(?<id>\d+)$/, view: editorView },
  { pattern: /^\/upload$/, view: uploadView },
  { pattern: /^\/categories$/, view: categoriesView },
  { pattern: /^\/ia$/, view: iaView, nav: 'ia' },
];

const viewEl = document.getElementById('view');
const sidebar = document.getElementById('sidebar');
const drawer = document.getElementById('ia-drawer');
const scrim = document.getElementById('scrim');
let cleanup = null;
let renderId = 0;

// ---------- Menu de categorias ----------
function renderNavCategories() {
  const el = document.getElementById('nav-categories');
  const current = new URLSearchParams(location.hash.split('?')[1] || '').get('category');
  el.innerHTML = shared.categories.length
    ? shared.categories
        .map(
          (c) => `<a href="#/docs?category=${c.id}" class="${String(c.id) === current ? 'active' : ''}">
            ${icon(c.icon)}<span>${esc(c.name)}</span><span class="count">${c.item_count}</span></a>`,
        )
        .join('')
    : '<div class="empty">Nenhuma categoria</div>';
}
document.addEventListener('categories-changed', renderNavCategories);

// ---------- Roteador ----------
async function router() {
  const id = ++renderId;
  const [path, search = ''] = location.hash.replace(/^#/, '').split('?');
  const query = new URLSearchParams(search);
  const route = routes.find((r) => r.pattern.test(path || '/'));

  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  sidebar.classList.remove('open');

  document.querySelectorAll('[data-nav]').forEach((a) => {
    const active = route?.nav === a.dataset.nav && !(route.nav === 'docs' && query.get('category'));
    a.classList.toggle('active', active);
  });
  renderNavCategories();


  // Na página do Active IA o painel lateral fica redundante.
  if (route?.nav === 'ia') closeDrawer();
  document.getElementById('open-ia').hidden = route?.nav === 'ia';

  if (!route) {
    viewEl.innerHTML = '<div class="card empty-state"><h3>Página não encontrada</h3><p><a href="#/">Voltar ao início</a></p></div>';
    return;
  }

  try {
    const params = path.match(route.pattern).groups || {};
    const result = await route.view(viewEl, { params, query });
    if (id !== renderId) {
      if (typeof result === 'function') result();
      return;
    }
    cleanup = result;
  } catch (err) {
    if (id !== renderId) return;
    viewEl.innerHTML = `<div class="card empty-state"><h3>Não foi possível carregar</h3><p>${esc(err.message)}</p><p><a href="#/">Voltar ao início</a></p></div>`;
  }
  hydrateIcons(viewEl);
  window.scrollTo(0, 0);
  pageEnter(viewEl);
}

// ---------- Painel lateral do Active IA ----------
const drawerChat = mountChat(document.getElementById('ia-drawer-inner'), {
  variant: 'drawer',
  onClose: closeDrawer,
  onExpand: () => {
    closeDrawer();
    location.hash = '#/ia';
  },
});

function openDrawer(prompt) {
  if (location.hash.startsWith('#/ia')) {
    if (prompt) chat.send(prompt);
    return;
  }
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  scrim.classList.add('show');
  if (prompt) chat.send(prompt);
  setTimeout(() => drawerChat.focus(), 200);
}

function closeDrawer() {
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  scrim.classList.remove('show');
}

document.getElementById('open-ia').addEventListener('click', () => openDrawer());
document.addEventListener('open-ia', (e) => openDrawer(e.detail?.prompt));
scrim.addEventListener('click', () => {
  closeDrawer();
  sidebar.classList.remove('open');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && drawer.classList.contains('open')) closeDrawer();
});

// ---------- Barra superior ----------
const palette = setupPalette();
document.getElementById('topbar-search').addEventListener('click', () => palette.open());

document.getElementById('menu-btn').addEventListener('click', () => {
  sidebar.classList.toggle('open');
  scrim.classList.toggle('show', sidebar.classList.contains('open'));
});

// ---------- Tema claro/escuro ----------
const themeBtn = document.getElementById('theme-toggle');
function currentTheme() {
  // O tema escuro é o padrão, igual ao Active AI.
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}
function renderThemeButton() {
  const dark = currentTheme() === 'dark';
  themeBtn.innerHTML = `${icon(dark ? 'sun' : 'moon')}<span>${dark ? 'Tema claro' : 'Tema escuro'}</span>`;
}
themeBtn.addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('kb-theme', next);
  } catch {
    /* sem armazenamento local */
  }
  renderThemeButton();
  // Troca de tema com uma transição suave de cores e o ícone girando.
  document.documentElement.classList.add('theme-transition');
  setTimeout(() => document.documentElement.classList.remove('theme-transition'), 450);
  themeBtn.querySelector('svg')?.animate([{ transform: 'rotate(-90deg) scale(.6)', opacity: 0 }, { transform: 'none', opacity: 1 }], {
    duration: 420,
    easing: 'cubic-bezier(.34, 1.56, .64, 1)',
  });
});

// ---------- Inicialização ----------
async function init() {
  hydrateIcons(document);
  setupRipples();
  renderThemeButton();
  try {
    await shared.refreshCategories();
    const stats = await api.stats();
    chat.setConfigured(stats.ai.configured);
    shared.aiConfigured = stats.ai.configured;
  } catch (err) {
    toast(`Falha ao conectar ao servidor: ${err.message}`, 'error');
  }
  window.addEventListener('hashchange', router);
  await router();
  popIn(document.querySelectorAll('.nav a, .nav-actions .btn, .nav-categories a'), { stagger: 30 });
}

init();

import { api } from './api.js';
import { setupPalette } from './palette.js';
import { pageEnter, setupRipples, popIn } from './motion.js';
import { chat, mountChat } from './chat.js';
import { esc, icon, hydrateIcons, toast, storage, copyText } from './util.js';
import {
  shared, homeView, docsView, itemView, editorView, uploadView, categoriesView, iaView, reportView,
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
  { pattern: /^\/relatorio$/, view: reportView, nav: 'report' },
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
          (c) => `<a href="#/docs?category=${c.id}" class="${String(c.id) === current ? 'active' : ''}" title="${esc(c.name)}">
            ${icon(c.icon)}<span class="label">${esc(c.name)}</span><span class="count">${c.item_count}</span></a>`,
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


  // Na página da Active AI o painel lateral fica redundante (o fixado volta ao sair dela).
  onIaPage = route?.nav === 'ia';
  if (onIaPage) closeDrawer({ keepPinned: true });
  else if (pinned && canPin()) openDrawer();
  syncFab();

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

// ---------- Painel lateral da Active AI ----------
// Fixado: fica aberto ao lado do conteúdo enquanto a pessoa usa o resto da plataforma
// (só em telas largas; nas menores ele volta a abrir por cima).
const fab = document.getElementById('open-ia');
const PIN_MIN_WIDTH = 1100;
const canPin = () => window.innerWidth >= PIN_MIN_WIDTH;
let pinned = storage.get('kb-ia-fixado', false);
let onIaPage = false;

const drawerChat = mountChat(document.getElementById('ia-drawer-inner'), {
  variant: 'drawer',
  onClose: () => closeDrawer(),
  onPin: () => setPinned(!pinned),
  onExpand: () => {
    closeDrawer({ keepPinned: true });
    location.hash = '#/ia';
  },
});

function syncFab() {
  fab.hidden = onIaPage || drawer.classList.contains('open');
}

function applyPinnedLayout() {
  const docked = pinned && canPin() && drawer.classList.contains('open');
  document.body.classList.toggle('ia-pinned', docked);
  drawer.classList.toggle('pinned', pinned);
  scrim.classList.toggle('show', drawer.classList.contains('open') && !docked);
}

function setPinned(value) {
  pinned = value;
  storage.set('kb-ia-fixado', pinned);
  if (pinned) openDrawer();
  applyPinnedLayout();
  toast(pinned ? 'Active AI fixada ao lado. Ela continua aberta enquanto você navega.' : 'Active AI desafixada.');
}

function openDrawer(prompt) {
  if (location.hash.startsWith('#/ia')) {
    if (prompt) chat.send(prompt);
    return;
  }
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  applyPinnedLayout();
  syncFab();
  if (prompt) chat.send(prompt);
  setTimeout(() => drawerChat.focus(), 200);
}

function closeDrawer({ keepPinned = false } = {}) {
  // Fechar pelo X também desafixa; ir para a página da Active AI mantém a preferência.
  if (!keepPinned && pinned) {
    pinned = false;
    storage.set('kb-ia-fixado', false);
  }
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  applyPinnedLayout();
  syncFab();
}

fab.addEventListener('click', () => openDrawer());
document.addEventListener('open-ia', (e) => openDrawer(e.detail?.prompt));
scrim.addEventListener('click', () => {
  if (drawer.classList.contains('open')) closeDrawer({ keepPinned: true });
  sidebar.classList.remove('open');
  scrim.classList.remove('show');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && drawer.classList.contains('open') && !document.body.classList.contains('ia-pinned')) {
    closeDrawer({ keepPinned: true });
  }
});
window.addEventListener('resize', () => {
  applyPinnedLayout();
  applySidebar();
});

// ---------- Menu lateral recolhível ----------
// Recolhido, mostra só os ícones. Sem preferência salva, recolhe sozinho em telas menores.
const MOBILE_MAX = 860;
function applySidebar() {
  const saved = storage.get('kb-menu-recolhido', null);
  const collapsed = window.innerWidth > MOBILE_MAX && (saved ?? window.innerWidth < 1280);
  document.body.classList.toggle('sidebar-collapsed', collapsed);
}
applySidebar();

// ---------- Botão "Copiar" dos blocos de código ----------
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy-code]');
  if (!btn) return;
  const text = btn.closest('.code-block')?.querySelector('pre')?.innerText ?? '';
  const ok = await copyText(text.replace(/\n$/, ''));
  const label = btn.querySelector('span');
  btn.classList.toggle('copied', ok);
  label.textContent = ok ? 'Copiado!' : 'Não foi possível copiar';
  setTimeout(() => {
    btn.classList.remove('copied');
    label.textContent = 'Copiar';
  }, 1600);
});


// ---------- Barra superior ----------
const palette = setupPalette();
document.getElementById('topbar-search').addEventListener('click', () => palette.open());

document.getElementById('menu-btn').addEventListener('click', () => {
  // No celular abre o menu por cima; em telas maiores recolhe/expande.
  if (window.innerWidth <= MOBILE_MAX) {
    sidebar.classList.toggle('open');
    scrim.classList.toggle('show', sidebar.classList.contains('open'));
    return;
  }
  const collapsed = !document.body.classList.contains('sidebar-collapsed');
  storage.set('kb-menu-recolhido', collapsed);
  applySidebar();
});

// ---------- Tema claro/escuro ----------
const themeBtn = document.getElementById('theme-toggle');
function currentTheme() {
  // O tema escuro é o padrão, igual à Active AI.
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}
function renderThemeButton() {
  const dark = currentTheme() === 'dark';
  themeBtn.innerHTML = `${icon(dark ? 'sun' : 'moon')}<span class="label">${dark ? 'Tema claro' : 'Tema escuro'}</span>`;
  themeBtn.title = dark ? 'Tema claro' : 'Tema escuro';
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

// ---------- Contador do relatório (lacunas abertas + documentos para revisar) ----------
async function refreshReportBadge(stats) {
  try {
    const s = stats || (await api.stats());
    const badge = document.getElementById('nav-report-count');
    const n = (s.gaps_open || 0) + (s.review_due || 0);
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.hidden = !n;
    badge.title = `${s.gaps_open || 0} lacuna(s) aberta(s) · ${s.review_due || 0} documento(s) para revisar`;
  } catch {
    /* contador é só informativo */
  }
}
document.addEventListener('report-changed', () => refreshReportBadge());

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
    shared.transcriptionEnabled = stats.transcription?.enabled !== false;
    shared.chaptersEnabled = stats.chapters?.enabled !== false;
    shared.reviewMonthsDefault = stats.review_months_default ?? 6;
    refreshReportBadge(stats);
  } catch (err) {
    toast(`Falha ao conectar ao servidor: ${err.message}`, 'error');
  }
  window.addEventListener('hashchange', router);
  await router();
  popIn(document.querySelectorAll('.nav a, .nav-actions .btn, .nav-categories a'), { stagger: 30 });
}

init();

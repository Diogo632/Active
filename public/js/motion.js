// Animações da plataforma com a Web Animations API (element.animate).
// Tudo respeita a preferência do sistema "reduzir movimento".

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const EASE_OUT = 'cubic-bezier(.2, .8, .2, 1)';
const EASE_SPRING = 'cubic-bezier(.34, 1.56, .64, 1)';

function run(el, keyframes, options) {
  if (!el || reduced() || typeof el.animate !== 'function') return null;
  return el.animate(keyframes, { fill: 'backwards', easing: EASE_OUT, ...options });
}

/** Entrada suave (sobe e aparece) de uma lista de elementos, em sequência. */
export function fadeUp(elements, { y = 12, duration = 420, stagger = 45, delay = 0, max = 24 } = {}) {
  [...elements].forEach((el, i) => {
    run(el, [{ opacity: 0, transform: `translateY(${y}px)` }, { opacity: 1, transform: 'none' }], {
      duration,
      delay: delay + Math.min(i, max) * stagger,
    });
  });
}

/** Surgimento com leve "salto" (para botões, chips e avatares). */
export function popIn(elements, { stagger = 60, delay = 0, duration = 420 } = {}) {
  [...elements].forEach((el, i) => {
    run(
      el,
      [
        { opacity: 0, transform: 'translateY(8px) scale(.92)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration, delay: delay + i * stagger, easing: EASE_SPRING },
    );
  });
}

/** Entrada de uma tela inteira: título, cartões e itens de lista em cascata. */
export function pageEnter(view) {
  run(view, [{ opacity: 0 }, { opacity: 1 }], { duration: 220 });
  const blocks = view.querySelectorAll(
    '.page-header, .home-hero > *, .filters, .doc-header, .doc-actions, .dropzone, .form > *, .editor, .home-columns section, .cat-table tbody tr, .empty-state, .doc-layout > *',
  );
  fadeUp(blocks, { stagger: 50, max: 10 });
  const items = view.querySelectorAll('.doc-item, .quick-item, .category-card, .stat');
  fadeUp(items, { y: 10, stagger: 35, delay: 120, max: 14 });
  popIn(view.querySelectorAll('.chip'), { stagger: 35, delay: 160 });
}

/** Revela o conteúdo de uma resposta do Active IA bloco a bloco (parágrafos, listas, tabelas). */
export function revealProse(container) {
  if (!container) return;
  const blocks = container.querySelectorAll(':scope > *');
  fadeUp(blocks, { y: 8, duration: 380, stagger: 70, max: 12 });
  const items = container.querySelectorAll(':scope > ul > li, :scope > ol > li');
  fadeUp(items, { y: 6, duration: 320, stagger: 45, delay: 80, max: 12 });
}

/** Mensagem nova no chat. */
export function messageIn(el, fromRight = false) {
  run(
    el,
    [
      { opacity: 0, transform: `translate(${fromRight ? 14 : -10}px, 6px) scale(.98)` },
      { opacity: 1, transform: 'none' },
    ],
    { duration: 360 },
  );
}

/** Abertura de diálogos e da busca rápida. */
export function dialogIn(panel, backdrop) {
  run(backdrop, [{ opacity: 0 }, { opacity: 1 }], { duration: 180 });
  run(panel, [{ opacity: 0, transform: 'translateY(-8px) scale(.97)' }, { opacity: 1, transform: 'none' }], {
    duration: 260,
    easing: EASE_SPRING,
  });
}

/** Aviso (toast) entrando de baixo. */
export function toastIn(el) {
  run(el, [{ opacity: 0, transform: 'translateY(14px) scale(.96)' }, { opacity: 1, transform: 'none' }], {
    duration: 320,
    easing: EASE_SPRING,
  });
}

/** Saída com fade antes de remover o elemento. */
export function fadeOutAndRemove(el, duration = 200) {
  const anim = run(el, [{ opacity: 1 }, { opacity: 0, transform: 'translateY(6px)' }], { duration, fill: 'forwards' });
  if (anim) anim.onfinish = () => el.remove();
  else el.remove();
}

/** Pequeno "pulso" para indicar que algo foi escolhido. */
export function pulse(el) {
  run(el, [{ transform: 'scale(1)' }, { transform: 'scale(.94)' }, { transform: 'scale(1)' }], { duration: 260 });
}

/** Efeito de onda ao clicar em botões, chips e opções (delegado para toda a página). */
export function setupRipples(root = document) {
  root.addEventListener('pointerdown', (e) => {
    const target = e.target.closest('.btn, .ia-option, .chip, .suggestions button, .icon-btn, .hero-hint button, .palette-option');
    if (!target || reduced() || target.disabled) return;
    const rect = target.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2;
    const dot = document.createElement('span');
    dot.className = 'ripple';
    dot.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - rect.left - size / 2}px;top:${e.clientY - rect.top - size / 2}px`;
    if (getComputedStyle(target).position === 'static') target.style.position = 'relative';
    target.style.overflow = 'hidden';
    target.appendChild(dot);
    const anim = dot.animate(
      [
        { transform: 'scale(0)', opacity: 0.35 },
        { transform: 'scale(1)', opacity: 0 },
      ],
      { duration: 550, easing: 'ease-out' },
    );
    anim.onfinish = () => dot.remove();
  });
}

/**
 * Utilitários compartilhados pelos modais (configurações, paleta, confirmação):
 * pilha de modais com `inert` no app de fundo, trap de Tab, restauração de foco
 * e animações de entrada/saída com fallback por timeout.
 */

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface ModalEntry {
  root: HTMLElement;
  lastFocused: HTMLElement | null;
}

const stack: ModalEntry[] = [];
let focusRestorer: (() => void) | null = null;
let keyListenerInstalled = false;

/** Define como devolver o foco quando o último modal fecha (ex.: painel ativo). */
export function setModalFocusRestorer(fn: () => void): void {
  focusRestorer = fn;
}

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function appRoot(): HTMLElement | null {
  return document.getElementById('app');
}

function isVisible(el: HTMLElement): boolean {
  return el.getClientRects().length > 0;
}

export function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.tabIndex >= 0 && isVisible(el) && !el.closest('[inert]')
  );
}

function onDocumentKeydown(ev: KeyboardEvent): void {
  if (ev.key !== 'Tab' || stack.length === 0) return;
  const top = stack[stack.length - 1];
  const items = getFocusable(top.root);
  if (items.length === 0) {
    ev.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement as HTMLElement | null;
  const inside = !!active && top.root.contains(active);

  if (!inside) {
    ev.preventDefault();
    (ev.shiftKey ? last : first).focus();
    return;
  }
  if (ev.shiftKey && active === first) {
    ev.preventDefault();
    last.focus();
  } else if (!ev.shiftKey && active === last) {
    ev.preventDefault();
    first.focus();
  }
}

export interface ModalHandle {
  /** Libera o modal; devolve o foco ao modal de baixo ou ao restaurador global. */
  release(): void;
}

/**
 * Registra `root` como modal ativo: torna o app (e modais inferiores) inertes,
 * prende o Tab dentro de `root` e foca `initialFocus` (ou o primeiro controle).
 */
export function pushModal(root: HTMLElement, initialFocus?: HTMLElement | null): ModalHandle {
  if (!keyListenerInstalled) {
    document.addEventListener('keydown', onDocumentKeydown, true);
    keyListenerInstalled = true;
  }

  const prev = stack[stack.length - 1];
  if (prev) {
    prev.lastFocused = document.activeElement as HTMLElement | null;
    prev.root.inert = true;
  }
  const app = appRoot();
  if (app) app.inert = true;
  root.inert = false;

  const entry: ModalEntry = { root, lastFocused: null };
  stack.push(entry);

  requestAnimationFrame(() => {
    if (!stack.includes(entry)) return;
    const target = initialFocus && root.contains(initialFocus) ? initialFocus : getFocusable(root)[0];
    target?.focus();
  });

  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      const idx = stack.indexOf(entry);
      if (idx === -1) return;
      const wasTop = idx === stack.length - 1;
      stack.splice(idx, 1);

      const nextTop = stack[stack.length - 1];
      if (nextTop) {
        nextTop.root.inert = false;
        if (wasTop) {
          const back = nextTop.lastFocused;
          if (back && nextTop.root.contains(back)) back.focus();
          else getFocusable(nextTop.root)[0]?.focus();
        }
        return;
      }
      if (app) app.inert = false;
      focusRestorer?.();
    },
  };
}

export function hasOpenModal(): boolean {
  return stack.length > 0;
}

/**
 * Executa a animação de saída (`closingClass`) e chama `done` no fim
 * (animationend/transitionend) ou após `timeoutMs` como fallback.
 */
export function runExitAnimation(
  el: HTMLElement,
  closingClass: string,
  done: () => void,
  timeoutMs = 220
): void {
  if (prefersReducedMotion()) {
    done();
    return;
  }
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    el.removeEventListener('animationend', onEnd);
    el.removeEventListener('transitionend', onEnd);
    window.clearTimeout(timer);
    done();
  };
  const onEnd = (ev: Event) => {
    if (ev.target === el) finish();
  };
  el.inert = true;
  el.addEventListener('animationend', onEnd);
  el.addEventListener('transitionend', onEnd);
  const timer = window.setTimeout(finish, timeoutMs);
  el.classList.add(closingClass);
}

/* ------------------------------------------------------------------ */
/* Popovers (dropdowns / barra de busca) com classe .hidden + saída animada */
/* ------------------------------------------------------------------ */

const closingTimers = new WeakMap<HTMLElement, number>();

export function isPopoverShown(el: HTMLElement | null): boolean {
  return !!el && !el.classList.contains('hidden') && !el.classList.contains('is-closing');
}

export function showPopover(el: HTMLElement): void {
  const timer = closingTimers.get(el);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    closingTimers.delete(el);
  }
  el.classList.remove('is-closing');
  el.classList.remove('hidden');
}

export function hidePopover(el: HTMLElement): void {
  if (el.classList.contains('hidden') || el.classList.contains('is-closing')) return;
  if (prefersReducedMotion()) {
    el.classList.add('hidden');
    return;
  }
  el.classList.add('is-closing');
  const finish = () => {
    el.removeEventListener('animationend', onEnd);
    const timer = closingTimers.get(el);
    if (timer !== undefined) window.clearTimeout(timer);
    closingTimers.delete(el);
    if (el.classList.contains('is-closing')) {
      el.classList.remove('is-closing');
      el.classList.add('hidden');
    }
  };
  const onEnd = (ev: AnimationEvent) => {
    if (ev.target === el) finish();
  };
  el.addEventListener('animationend', onEnd);
  closingTimers.set(el, window.setTimeout(finish, 180));
}

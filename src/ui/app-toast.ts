/** Toast não bloqueante da aplicação (fora do #app, não fica inerte sob modais). */

let toastEl: HTMLElement | null = null;
let hideTimer: number | null = null;

function ensureEl(): HTMLElement {
  if (toastEl && toastEl.isConnected) return toastEl;
  toastEl = document.createElement('div');
  toastEl.className = 'app-toast';
  toastEl.setAttribute('role', 'status');
  toastEl.setAttribute('aria-live', 'polite');
  toastEl.addEventListener('click', () => toastEl?.classList.remove('is-visible'));
  document.body.appendChild(toastEl);
  return toastEl;
}

export function showAppToast(message: string, kind: 'success' | 'error' = 'success', durationMs?: number): void {
  const el = ensureEl();
  el.textContent = message;
  el.classList.toggle('is-error', kind === 'error');
  el.classList.remove('is-visible');
  void el.offsetWidth;
  el.classList.add('is-visible');
  if (hideTimer !== null) window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    hideTimer = null;
    el.classList.remove('is-visible');
  }, durationMs ?? (kind === 'error' ? 6000 : 2500));
}

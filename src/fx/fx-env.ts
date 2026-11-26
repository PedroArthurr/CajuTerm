/**
 * Utilitários de ambiente compartilhados pelas camadas de FX (DPR, reduced-motion, foco/visibilidade).
 * Cada watcher devolve uma função de cleanup.
 */

export function currentDpr(): number {
  return Math.min(window.devicePixelRatio || 1, 2);
}

/** Dispara `cb` quando o devicePixelRatio muda (ex.: janela movida para outro monitor). */
export function watchDpr(cb: () => void): () => void {
  let mql: MediaQueryList | null = null;
  const onChange = () => {
    arm();
    cb();
  };
  const arm = () => {
    mql?.removeEventListener('change', onChange);
    mql = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mql.addEventListener('change', onChange);
  };
  arm();
  return () => {
    mql?.removeEventListener('change', onChange);
    mql = null;
  };
}

export interface ReducedMotionWatch {
  readonly reduced: boolean;
  dispose(): void;
}

export function watchReducedMotion(cb: (reduced: boolean) => void): ReducedMotionWatch {
  const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
  const state = { reduced: mql.matches };
  const onChange = (ev: MediaQueryListEvent) => {
    state.reduced = ev.matches;
    cb(ev.matches);
  };
  mql.addEventListener('change', onChange);
  return {
    get reduced() {
      return state.reduced;
    },
    dispose: () => mql.removeEventListener('change', onChange),
  };
}

/** Observa o elemento pai do canvas (mudanças de layout que não disparam window.resize). */
export function watchParentResize(canvas: HTMLCanvasElement, cb: () => void): () => void {
  const parent = canvas.parentElement;
  if (!parent || typeof ResizeObserver === 'undefined') return () => {};
  const ro = new ResizeObserver(() => cb());
  ro.observe(parent);
  return () => ro.disconnect();
}

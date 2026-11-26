import { FitAddon } from '@xterm/addon-fit';
import { ImageAddon } from '@xterm/addon-image';
import { LigaturesAddon } from '@xterm/addon-ligatures';
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal, type IDisposable, type IMarker, type ITerminalOptions, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import '../styles/terminal.css';

import { t } from '../i18n';
import type {
  AppSettings,
  CursorScreenPos,
  ProfileConfig,
  ThemeConfig,
} from '../types';
import { openExternalUrl, ptyKill, ptyResize, ptySpawn, ptyWrite } from './pty-bridge';

export interface SearchResultsInfo {
  resultIndex: number;
  resultCount: number;
}

export interface TerminalPaneOptions {
  paneId: string;
  profile: ProfileConfig;
  settings: AppSettings;
  theme: ThemeConfig;
  isAppShortcut: (ev: KeyboardEvent) => boolean;
  onFocus: (pane: TerminalPane) => void;
  onTitleChange: (pane: TerminalPane, title: string) => void;
  onCursorMove: (pane: TerminalPane, pos: CursorScreenPos) => void;
  onTyping: (pane: TerminalPane, pos: CursorScreenPos) => void;
  onDimensionsChange: (pane: TerminalPane, cols: number, rows: number) => void;
  onMessageEnd?: (pane: TerminalPane) => void;
  onBell?: (pane: TerminalPane) => void;
  onErrorDetected?: (pane: TerminalPane) => void;
  onConfirmCommand?: (pane: TerminalPane, rawInput: string, resolvedCommand: string) => void;
  onSearchResults?: (pane: TerminalPane, r: SearchResultsInfo) => void;
  onConfirmPaste?: (pane: TerminalPane, text: string, proceed: () => void) => void;
}

/** Posição do cursor; `hidden` quando o cursor está fora do viewport (scrollback rolado). */
type PaneCursorPos = CursorScreenPos & { hidden?: boolean };

const ANSI_STRIP_RE = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const ERROR_RE = /(?:^|\s)(?:error|erro|exception|fatal|panic|failed|falha|err!)(?:\s|:|$)/i;
const ACTIVITY_SAMPLE = 2048;
const PTY_RESIZE_DEBOUNCE_MS = 50;
const WEBGL_RETRY_MS = 1500;
const WEBGL_MAX_RETRIES = 3;
const WEBGL_SUSPEND_DELAY_MS = 1000;
const FONT_MIN = 8;
const FONT_MAX = 40;
const MAX_PROMPT_MARKS = 2000;

// ---- Ctrl seguro → cursor "pointer" em links só com Ctrl pressionado (ver terminal.css) ----
let linkModRefs = 0;
let linkModCleanup: (() => void) | null = null;
function acquireLinkModifierTracking(): () => void {
  if (linkModRefs++ === 0) {
    const root = document.documentElement;
    const onKey = (ev: KeyboardEvent) => root.classList.toggle('caju-link-mod', ev.ctrlKey);
    const onMouse = (ev: MouseEvent) => root.classList.toggle('caju-link-mod', ev.ctrlKey);
    const onBlur = () => root.classList.remove('caju-link-mod');
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('mousemove', onMouse, { capture: true, passive: true });
    window.addEventListener('blur', onBlur);
    linkModCleanup = () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      window.removeEventListener('mousemove', onMouse, true);
      window.removeEventListener('blur', onBlur);
      root.classList.remove('caju-link-mod');
    };
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--linkModRefs === 0) {
      linkModCleanup?.();
      linkModCleanup = null;
    }
  };
}

// ---- Helpers de cor (decorations de busca exigem #RRGGBB) ----
function parseColor(input: string | undefined): [number, number, number] | null {
  if (!input) return null;
  const s = input.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) {
      h = h
        .slice(0, 3)
        .split('')
        .map((c) => c + c)
        .join('');
    }
    if (h.length < 6) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])].map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
    ) as [number, number, number];
  }
  return null;
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

function mixColors(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// ---- Helpers de CWD (OSC 7 / OSC 9;9) ----
function normalizeWindowsPath(raw: string): string | null {
  let p = raw.trim();
  if (p.length >= 2 && p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
  if (/^[A-Za-z]:([\\/]|$)/.test(p)) {
    p = p.replace(/\//g, '\\');
    return /^[A-Za-z]:$/.test(p) ? `${p}\\` : p;
  }
  if (/^\\\\[^\\]/.test(p)) return p; // UNC
  return null;
}

function parseOsc7(data: string): string | null {
  const m = /^file:\/\/([^/]*)(\/.*)$/i.exec(data.trim());
  if (!m) return null;
  let path = m[2];
  try {
    path = decodeURIComponent(path);
  } catch {
    // mantém o caminho cru se o encoding estiver quebrado
  }
  if (/^\/[A-Za-z]:([\\/]|$)/.test(path)) {
    return normalizeWindowsPath(path.slice(1));
  }
  // Caminhos POSIX (WSL/MSYS) não servem como cwd de spawn no Windows
  return null;
}

export class TerminalPane {
  public readonly paneId: string;
  public readonly element: HTMLDivElement;
  public readonly terminal: Terminal;
  public profile: ProfileConfig;
  public ptyId: number | null = null;
  public exited = false;
  public title: string;
  /** Último diretório reportado pelo shell (OSC 7 / OSC 9;9), ou o cwd do perfil. */
  public cwd: string | null;

  private fitAddon: FitAddon;
  private searchAddon: SearchAddon;
  private webglAddon: WebglAddon | null = null;
  private ligaturesAddon: LigaturesAddon | null = null;
  private resizeObserver: ResizeObserver;
  private opts: TerminalPaneOptions;
  private currentSettings: AppSettings;
  private currentTheme: ThemeConfig;
  private fitTimer: number | null = null;
  private fitRaf: number | null = null;
  private disposed = false;
  private lineInputBuffer = '';
  private streamActive = false;
  private streamStartedAt = 0;
  private streamBytes = 0;
  private streamChunks = 0;
  private idleTimer: number | null = null;
  private lastErrorSoundAt = 0;
  private lastMouseOrReportAt = 0;
  private lastKeyboardInputAt = 0;
  private scrollbarEl!: HTMLDivElement;
  private scrollThumbEl!: HTMLDivElement;
  private scrollbarRaf: number | null = null;
  private scrollActivityTimer: number | null = null;
  private scrollDisposables: IDisposable[] = [];
  private scrollDrag: { pointerId: number; startY: number; startLine: number } | null = null;

  // Spawn / PTY
  private spawnGen = 0;
  private ptyResizeTimer: number | null = null;
  private lastPtyCols = -1;
  private lastPtyRows = -1;

  // WebGL
  private webglWanted = true;
  private webglRetries = 0;
  private webglLoadedAt = 0;
  private webglRetryTimer: number | null = null;
  private webglSuspendTimer: number | null = null;

  // Cursor FX
  private fxActive = false;
  private screenEl: HTMLElement | null = null;
  private screenRect: DOMRect | null = null;
  private cursorRaf: number | null = null;

  // Zoom / busca / seleção / marcas
  private zoomOffset = 0;
  private wheelZoomAccum = 0;
  private lastThemeKey = '';
  private searchDecorations: NonNullable<ISearchOptions['decorations']> | null = null;
  private searchActive = false;
  private copyTimer: number | null = null;
  private promptMarkers: IMarker[] = [];

  private disposables: IDisposable[] = [];
  private domCleanups: Array<() => void> = [];

  constructor(opts: TerminalPaneOptions) {
    this.opts = opts;
    this.paneId = opts.paneId;
    this.profile = opts.profile;
    this.currentSettings = opts.settings;
    this.currentTheme = opts.theme;
    this.title = opts.profile.name;
    this.cwd = opts.profile.cwd || null;

    this.element = document.createElement('div');
    this.element.className = 'terminal-pane';
    this.element.dataset.paneId = opts.paneId;

    const initialTheme = this.buildXtermTheme(opts.theme, opts.settings);
    this.lastThemeKey = JSON.stringify(initialTheme);

    this.terminal = new Terminal({
      allowProposedApi: true,
      allowTransparency: true,
      cursorBlink: opts.settings.cursor.blink,
      cursorStyle: opts.settings.cursor.style,
      fontFamily: opts.settings.fontFamily,
      fontSize: this.effectiveFontSize(opts.settings),
      lineHeight: opts.settings.lineHeight,
      scrollback: opts.settings.scrollback,
      macOptionIsMeta: true,
      windowsMode: false, // ConPTY já envia sequências VT completas
      theme: initialTheme,
      // OSC 8: sem confirm()/window.open do xterm dentro do webview; abre externo só com Ctrl+clique
      linkHandler: {
        activate: (event, uri) => {
          if (event.ctrlKey) void openExternalUrl(uri);
        },
        allowNonHttpProtocols: false,
      },
    });

    this.fitAddon = new FitAddon();
    this.searchAddon = new SearchAddon();
    const webLinksAddon = new WebLinksAddon((event, uri) => {
      if (!event.ctrlKey) return;
      void openExternalUrl(uri);
    });
    const unicode11Addon = new Unicode11Addon();
    const imageAddon = new ImageAddon();

    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(this.searchAddon);
    this.terminal.loadAddon(webLinksAddon);
    this.terminal.loadAddon(unicode11Addon);
    this.terminal.loadAddon(imageAddon);
    this.terminal.unicode.activeVersion = '11';

    this.terminal.open(this.element);
    this.screenEl = this.element.querySelector<HTMLElement>('.xterm-screen');
    this.setupScrollbar();

    // Ativa acelerador WebGL com retry automático caso o driver perca o contexto
    this.tryEnableWebgl();

    // Ativa ligaduras tipográficas se habilitadas (Fontes Nerd Fonts / JetBrains / Cascadia)
    if (opts.settings.ligatures) {
      this.tryEnableLigatures();
    }

    this.domCleanups.push(acquireLinkModifierTracking());

    // Intercepta Shift+Enter (quebra de linha sem enviar), /clear com confirmação, copiar/colar, zoom, marcas e atalhos globais
    this.terminal.attachCustomKeyEventHandler((ev) => {
      if (this.opts.isAppShortcut(ev)) {
        return false;
      }
      if (ev.type === 'keydown') {
        this.lastKeyboardInputAt = performance.now();
      }

      // Shift+Enter ou Ctrl+Enter -> envia LF (\n / Ctrl+J) sem submeter o prompt (AGY, Claude Code, shells)
      if (ev.key === 'Enter' && (ev.shiftKey || ev.ctrlKey) && !ev.altKey) {
        ev.preventDefault();
        if (ev.type === 'keydown' && !this.exited && this.ptyId !== null) {
          void ptyWrite(this.ptyId, '\n');
          this.lineInputBuffer = `${this.lineInputBuffer}\n`.slice(-256);
          this.emitTypingFx();
        }
        return false;
      }

      // Confirmação ao pressionar Enter em /clear ou /cl3ar quando confirmClear estiver ativo
      if (
        ev.key === 'Enter' &&
        !ev.shiftKey &&
        !ev.ctrlKey &&
        !ev.altKey &&
        this.currentSettings.confirmClear &&
        !this.exited &&
        this.ptyId !== null
      ) {
        const currentLine = this.lineInputBuffer.trim().toLowerCase();
        if (currentLine === '/clear' || currentLine === '/cl3ar') {
          ev.preventDefault();
          if (ev.type === 'keydown') {
            this.opts.onConfirmCommand?.(this, this.lineInputBuffer.trim(), '/clear');
          }
          return false;
        }
      }

      if (ev.type === 'keydown') {
        const keyLower = ev.key.toLowerCase();

        // Ctrl+Shift+C ou Ctrl+C com texto selecionado -> Copiar
        if (ev.ctrlKey && !ev.altKey && keyLower === 'c' && (ev.shiftKey || this.terminal.hasSelection())) {
          const selection = this.terminal.getSelection();
          if (selection) {
            void navigator.clipboard.writeText(selection).catch(() => {});
          }
          // Ctrl+C simples limpa a seleção para que o próximo Ctrl+C volte a enviar SIGINT
          if (!ev.shiftKey) {
            this.terminal.clearSelection();
          }
          return false;
        }

        // Ctrl+Shift+V -> Colar via Clipboard API
        if (ev.ctrlKey && ev.shiftKey && !ev.altKey && keyLower === 'v') {
          this.pasteFromClipboard();
          return false;
        }

        // Ctrl+Shift+↑ / ↓ -> salta entre prompts marcados (OSC 133;A)
        if (ev.ctrlKey && ev.shiftKey && !ev.altKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) {
          if (this.jumpToPrompt(ev.key === 'ArrowUp' ? -1 : 1)) {
            ev.preventDefault();
            return false;
          }
        }

        // Ctrl+= / Ctrl+- / Ctrl+0 -> zoom de fonte por painel (transitório)
        if (ev.ctrlKey && !ev.altKey) {
          const zoomIn = keyLower === '=' || keyLower === '+' || ev.code === 'NumpadAdd';
          const zoomOut = (keyLower === '-' && !ev.shiftKey) || ev.code === 'NumpadSubtract';
          const zoomReset = !ev.shiftKey && (keyLower === '0' || ev.code === 'Numpad0');
          if (zoomIn || zoomOut || zoomReset) {
            ev.preventDefault();
            if (zoomReset) this.resetZoom();
            else this.adjustZoom(zoomIn ? 1 : -1);
            return false;
          }
        }
      }

      return true;
    });

    // Menu de contexto direito (Copiar / Colar)
    this.element.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      if (this.terminal.hasSelection()) {
        const text = this.terminal.getSelection();
        if (text) {
          void navigator.clipboard.writeText(text).catch(() => {});
          this.terminal.clearSelection();
        }
      } else {
        this.pasteFromClipboard();
      }
    });

    this.element.addEventListener('mousedown', () => {
      this.opts.onFocus(this);
      this.terminal.focus();
    });

    this.element.addEventListener(
      'compositionend',
      () => {
        this.lastKeyboardInputAt = performance.now();
      },
      true
    );

    // Paste nativo (menu do sistema / Shift+Insert / IME): intercepta antes do textarea do xterm
    this.element.addEventListener(
      'paste',
      (ev) => {
        const text = ev.clipboardData?.getData('text/plain') ?? '';
        ev.preventDefault();
        ev.stopPropagation();
        this.pasteText(text);
      },
      true
    );

    // Ctrl+roda -> zoom de fonte (acumula deltas para touchpads de alta precisão)
    this.element.addEventListener(
      'wheel',
      (ev) => {
        if (!ev.ctrlKey) return;
        ev.preventDefault();
        ev.stopPropagation();
        const dy = ev.deltaMode === 1 ? ev.deltaY * 33 : ev.deltaMode === 2 ? ev.deltaY * 400 : ev.deltaY;
        this.wheelZoomAccum += dy;
        if (Math.abs(this.wheelZoomAccum) >= 50) {
          this.adjustZoom(this.wheelZoomAccum < 0 ? 1 : -1);
          this.wheelZoomAccum = 0;
        }
      },
      { capture: true, passive: false }
    );

    this.terminal.onData((data) => {
      if (this.exited) {
        if (data === '\r' || data === '\n') {
          this.exited = false;
          this.terminal.write('\r\n');
          void this.spawnShell();
        }
        return;
      }
      if (this.isNonTypingTerminalData(data)) {
        this.lastMouseOrReportAt = performance.now();
        if (this.ptyId !== null) {
          void ptyWrite(this.ptyId, data);
        }
        return;
      }
      this.updateLineBufferFromInput(data);
      if (this.ptyId !== null) {
        void ptyWrite(this.ptyId, data);
      }
      this.emitTypingFx();
    });

    this.terminal.onBell(() => {
      this.opts.onBell?.(this);
    });

    this.terminal.onCursorMove(() => {
      if (this.isRecentMouseSuppression()) {
        return;
      }
      this.scheduleCursorReport();
    });

    this.terminal.onTitleChange((nextTitle) => {
      const clean = nextTitle.trim();
      if (clean && clean !== this.title) {
        this.title = clean;
        this.opts.onTitleChange(this, clean);
      }
    });

    this.terminal.onResize(({ cols, rows }) => {
      this.schedulePtyResize();
      this.screenRect = null;
      this.opts.onDimensionsChange(this, cols, rows);
      this.scheduleCursorReport();
    });

    this.disposables.push(
      // Viewport rolou: o cursor muda de posição na tela (ou sai dela)
      this.terminal.onScroll(() => this.scheduleCursorReport()),
      this.terminal.onSelectionChange(() => this.handleSelectionChange()),
      this.searchAddon.onDidChangeResults((r) => this.opts.onSearchResults?.(this, r)),
      this.terminal.parser.registerOscHandler(7, (data) => {
        const path = parseOsc7(data);
        if (path) this.cwd = path;
        return true;
      }),
      this.terminal.parser.registerOscHandler(9, (data) => {
        // ConEmu / Windows Terminal: OSC 9;9;<cwd>. Outras formas de OSC 9 (notificação/progresso) seguem adiante.
        if (!data.startsWith('9;')) return false;
        const path = normalizeWindowsPath(data.slice(2));
        if (path) this.cwd = path;
        return true;
      }),
      this.terminal.parser.registerOscHandler(133, (data) => {
        if (data === 'A' || data.startsWith('A;')) this.addPromptMarker();
        return true;
      })
    );

    const onWindowResize = () => {
      this.screenRect = null;
    };
    window.addEventListener('resize', onWindowResize);
    this.domCleanups.push(() => window.removeEventListener('resize', onWindowResize));

    this.resizeObserver = new ResizeObserver(() => {
      this.screenRect = null;
      this.scheduleFit();
      this.scheduleScrollbarUpdate();
    });
    this.resizeObserver.observe(this.element);

    // Ajuste inicial e spawn do ConPTY
    requestAnimationFrame(() => {
      this.fitNow();
      void this.spawnShell();
    });
  }

  /**
   * Scrollbar customizada desenhada no gutter que o FitAddon reserva (viewport.scrollBarWidth).
   * A nativa fica oculta via CSS: no WebView2 ela é fina/overlay e quase invisível sobre o fundo transparente.
   */
  private setupScrollbar(): void {
    this.scrollbarEl = document.createElement('div');
    this.scrollbarEl.className = 'term-scrollbar';
    this.scrollThumbEl = document.createElement('div');
    this.scrollThumbEl.className = 'term-scrollbar-thumb';
    this.scrollbarEl.appendChild(this.scrollThumbEl);
    this.element.appendChild(this.scrollbarEl);

    const update = () => this.scheduleScrollbarUpdate();
    this.scrollDisposables.push(
      this.terminal.onScroll(update),
      this.terminal.onWriteParsed(update),
      this.terminal.onResize(update),
      this.terminal.buffer.onBufferChange(update)
    );

    this.element.addEventListener(
      'wheel',
      (ev) => {
        if (!ev.ctrlKey) this.flashScrollbar();
      },
      { passive: true, capture: true }
    );

    this.scrollbarEl.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      const metrics = this.getScrollMetrics();
      if (!metrics) return;

      // Clique no track: centraliza o thumb no ponto clicado e segue arrastando dali
      if (ev.target !== this.scrollThumbEl) {
        const rect = this.scrollbarEl.getBoundingClientRect();
        const ratio = (ev.clientY - rect.top - metrics.thumbH / 2) / Math.max(1, metrics.trackH - metrics.thumbH);
        this.terminal.scrollToLine(Math.round(Math.min(1, Math.max(0, ratio)) * metrics.maxScroll));
      }

      this.scrollDrag = {
        pointerId: ev.pointerId,
        startY: ev.clientY,
        startLine: this.terminal.buffer.active.viewportY,
      };
      this.scrollbarEl.setPointerCapture(ev.pointerId);
      this.scrollbarEl.classList.add('is-dragging');
      this.opts.onFocus(this);
    });

    this.scrollbarEl.addEventListener('pointermove', (ev) => {
      const drag = this.scrollDrag;
      if (!drag || ev.pointerId !== drag.pointerId) return;
      const metrics = this.getScrollMetrics();
      if (!metrics) return;
      const linesPerPx = metrics.maxScroll / Math.max(1, metrics.trackH - metrics.thumbH);
      const target = Math.round(drag.startLine + (ev.clientY - drag.startY) * linesPerPx);
      this.terminal.scrollToLine(Math.min(metrics.maxScroll, Math.max(0, target)));
    });

    const endDrag = (ev: PointerEvent) => {
      if (!this.scrollDrag || ev.pointerId !== this.scrollDrag.pointerId) return;
      this.scrollDrag = null;
      this.scrollbarEl.classList.remove('is-dragging');
      if (this.scrollbarEl.hasPointerCapture(ev.pointerId)) {
        this.scrollbarEl.releasePointerCapture(ev.pointerId);
      }
      this.terminal.focus();
    };
    this.scrollbarEl.addEventListener('pointerup', endDrag);
    this.scrollbarEl.addEventListener('pointercancel', endDrag);
    // Evita que o mousedown de compatibilidade inicie seleção no xterm / roube o foco
    this.scrollbarEl.addEventListener('mousedown', (ev) => ev.stopPropagation());

    this.scheduleScrollbarUpdate();
  }

  private getScrollMetrics(): { trackH: number; thumbH: number; maxScroll: number } | null {
    const buf = this.terminal.buffer.active;
    const maxScroll = buf.baseY;
    const trackH = this.scrollbarEl.clientHeight;
    if (maxScroll <= 0 || trackH <= 0) return null;
    const total = maxScroll + this.terminal.rows;
    const thumbH = Math.min(trackH, Math.max(28, (trackH * this.terminal.rows) / total));
    return { trackH, thumbH, maxScroll };
  }

  private scheduleScrollbarUpdate(): void {
    if (this.scrollbarRaf !== null || this.disposed) return;
    this.scrollbarRaf = requestAnimationFrame(() => {
      this.scrollbarRaf = null;
      this.updateScrollbar();
    });
  }

  private updateScrollbar(): void {
    if (this.disposed) return;
    const metrics = this.getScrollMetrics();
    this.scrollbarEl.classList.toggle('has-scroll', metrics !== null);
    if (!metrics) {
      this.scrollbarEl.classList.remove('is-scrolled-up');
      return;
    }
    const viewportY = this.terminal.buffer.active.viewportY;
    const top = (metrics.trackH - metrics.thumbH) * (viewportY / metrics.maxScroll);
    this.scrollThumbEl.style.height = `${metrics.thumbH}px`;
    this.scrollThumbEl.style.transform = `translateY(${top}px)`;
    this.scrollbarEl.classList.toggle('is-scrolled-up', viewportY < metrics.maxScroll);
  }

  private flashScrollbar(): void {
    this.scrollbarEl.classList.add('is-active');
    if (this.scrollActivityTimer !== null) {
      window.clearTimeout(this.scrollActivityTimer);
    }
    this.scrollActivityTimer = window.setTimeout(() => {
      this.scrollActivityTimer = null;
      this.scrollbarEl.classList.remove('is-active');
    }, 1100);
  }

  // ---------------------------------------------------------------- WebGL

  private tryEnableWebgl(): void {
    if (this.webglAddon || this.disposed || !this.webglWanted) return;
    try {
      const addon = new WebglAddon();
      addon.onContextLoss(() => {
        if (this.webglAddon === addon) {
          this.webglAddon = null;
        }
        addon.dispose();
        this.scheduleWebglRetry();
      });
      this.terminal.loadAddon(addon);
      this.webglAddon = addon;
      this.webglLoadedAt = performance.now();
    } catch {
      this.webglAddon = null;
    }
  }

  private scheduleWebglRetry(): void {
    if (this.disposed) return;
    // Contexto que viveu bastante tempo: perda nova não é um loop de falha, zera o orçamento
    if (performance.now() - this.webglLoadedAt > 10_000) {
      this.webglRetries = 0;
    }
    if (this.webglRetries >= WEBGL_MAX_RETRIES) return;
    this.webglRetries += 1;
    if (this.webglRetryTimer !== null) window.clearTimeout(this.webglRetryTimer);
    this.webglRetryTimer = window.setTimeout(() => {
      this.webglRetryTimer = null;
      this.tryEnableWebgl();
    }, WEBGL_RETRY_MS);
  }

  /**
   * Libera (true) ou restaura (false) o contexto WebGL do painel. Usado pelo workspace para panes em abas
   * inativas (Chromium limita ~16 contextos). A liberação é adiada para não "thrashar" ao alternar abas rápido.
   */
  public setWebglSuspended(suspended: boolean): void {
    if (this.disposed) return;
    if (suspended) {
      this.webglWanted = false;
      if (this.webglRetryTimer !== null) {
        window.clearTimeout(this.webglRetryTimer);
        this.webglRetryTimer = null;
      }
      if (!this.webglAddon || this.webglSuspendTimer !== null) return;
      this.webglSuspendTimer = window.setTimeout(() => {
        this.webglSuspendTimer = null;
        if (this.webglWanted || !this.webglAddon) return;
        const addon = this.webglAddon;
        this.webglAddon = null;
        addon.dispose();
      }, WEBGL_SUSPEND_DELAY_MS);
      return;
    }
    this.webglWanted = true;
    if (this.webglSuspendTimer !== null) {
      window.clearTimeout(this.webglSuspendTimer);
      this.webglSuspendTimer = null;
    }
    if (!this.webglAddon) {
      this.webglRetries = 0;
      this.tryEnableWebgl();
    }
  }

  private tryEnableLigatures(): void {
    if (this.ligaturesAddon) return;
    try {
      const addon = new LigaturesAddon();
      this.terminal.loadAddon(addon);
      this.ligaturesAddon = addon;
    } catch {
      this.ligaturesAddon = null;
    }
  }

  private buildXtermTheme(theme: ThemeConfig, settings: AppSettings): ITheme {
    return {
      // Fundo transparente para permitir o acrylic/mica + mídia + gradiente por trás
      background: 'rgba(0, 0, 0, 0)',
      foreground: theme.colors.foreground,
      cursor: settings.cursor.color || theme.colors.cursor,
      cursorAccent: theme.colors.cursorAccent,
      selectionBackground: theme.colors.selectionBackground,
      black: theme.colors.black,
      red: theme.colors.red,
      green: theme.colors.green,
      yellow: theme.colors.yellow,
      blue: theme.colors.blue,
      magenta: theme.colors.magenta,
      cyan: theme.colors.cyan,
      white: theme.colors.white,
      brightBlack: theme.colors.brightBlack,
      brightRed: theme.colors.brightRed,
      brightGreen: theme.colors.brightGreen,
      brightYellow: theme.colors.brightYellow,
      brightBlue: theme.colors.brightBlue,
      brightMagenta: theme.colors.brightMagenta,
      brightCyan: theme.colors.brightCyan,
      brightWhite: theme.colors.brightWhite,
    };
  }

  // ---------------------------------------------------------------- PTY

  public async spawnShell(): Promise<void> {
    if (this.disposed) return;
    this.exited = false;
    const gen = ++this.spawnGen;
    if (this.ptyResizeTimer !== null) {
      window.clearTimeout(this.ptyResizeTimer);
      this.ptyResizeTimer = null;
    }

    try {
      // Saída pode chegar antes do invoke resolver (o handler é registrado no próprio spawn)
      const id = await ptySpawn(
        {
          shell: this.profile.shell,
          args: this.profile.args,
          cwd: this.profile.cwd,
          env: this.profile.env,
          cols: this.terminal.cols,
          rows: this.terminal.rows,
        },
        {
          onData: (data) => {
            if (gen === this.spawnGen) this.writeOutput(data);
          },
          onExit: (code) => {
            if (gen === this.spawnGen) this.handleProcessExit(code);
          },
        }
      );
      if (this.disposed || gen !== this.spawnGen) {
        void ptyKill(id).catch(() => {});
        return;
      }
      // O processo saiu antes do spawn resolver: handleProcessExit já tratou
      if (this.exited) return;
      this.ptyId = id;
      // Tamanho pode ter mudado durante o await: envia o atual (Rust faz o clamp)
      this.lastPtyCols = -1;
      this.lastPtyRows = -1;
      this.flushPtyResize();
    } catch (err) {
      if (this.disposed || gen !== this.spawnGen) return;
      this.exited = true;
      this.terminal.writeln(`\r\n\x1b[31m[Erro ao iniciar shell]: ${String(err)}\x1b[0m`);
      this.terminal.writeln(`\x1b[33m${t('terminal.restartPrompt', this.currentSettings.language)}\x1b[0m`);
    }
  }

  /** Debounce trailing do pty_resize: arrastar divisórias não inunda o ConPTY de reflows. */
  private schedulePtyResize(): void {
    if (this.ptyId === null || this.exited || this.disposed) return;
    if (this.ptyResizeTimer !== null) {
      window.clearTimeout(this.ptyResizeTimer);
    }
    this.ptyResizeTimer = window.setTimeout(() => {
      this.ptyResizeTimer = null;
      this.flushPtyResize();
    }, PTY_RESIZE_DEBOUNCE_MS);
  }

  private flushPtyResize(): void {
    if (this.ptyId === null || this.exited || this.disposed) return;
    const { cols, rows } = this.terminal;
    if (cols === this.lastPtyCols && rows === this.lastPtyRows) return;
    this.lastPtyCols = cols;
    this.lastPtyRows = rows;
    void ptyResize(this.ptyId, cols, rows).catch(() => {});
  }

  public writeOutput(data: string): void {
    if (this.disposed) return;
    this.terminal.write(data);
    this.analyzeOutputActivity(data);
  }

  private isNonTypingTerminalData(data: string): boolean {
    if (!data.startsWith('\x1b')) {
      return false;
    }
    return (
      /^(?:\x1b\[<[\d;]+[Mm])+$/.test(data) ||
      /^(?:\x1b\[\d+;\d+;\d+M)+$/.test(data) ||
      /^\x1b\[M[\s\S]{3,}$/.test(data) ||
      /^(?:\x1b\[[IO])+$/.test(data) ||
      /^\x1b(?:\[\??\d+;\d+R|\[[?>=][\d;]*c|\[\??\d+;\d+\$y|\][\s\S]*?(?:\x07|\x1b\\)|P[\s\S]*?\x1b\\)$/.test(
        data
      )
    );
  }

  private isRecentMouseSuppression(): boolean {
    const now = performance.now();
    return (
      now - this.lastMouseOrReportAt < 220 &&
      this.lastMouseOrReportAt > this.lastKeyboardInputAt
    );
  }

  private updateLineBufferFromInput(data: string): void {
    if (data === '\r') {
      this.lineInputBuffer = '';
      return;
    }
    if (data === '\x7f' || data === '\b') {
      this.lineInputBuffer = this.lineInputBuffer.slice(0, -1);
      return;
    }
    if (data === '\x03' || data === '\x15' || data === '\x1b') {
      this.lineInputBuffer = '';
      return;
    }
    if (!data.includes('\x1b')) {
      const cleaned = data.replace(/\r/g, '');
      this.lineInputBuffer = (this.lineInputBuffer + cleaned).slice(-256);
    }
  }

  private analyzeOutputActivity(data: string): void {
    // Ninguém consome fim-de-mensagem/erro: não há por que analisar
    if (!this.opts.onMessageEnd && !this.opts.onErrorDetected) return;

    // Chunks grandes (até 64KB): analisa só a cauda — suficiente para atividade e detecção de erro
    const sample = data.length > ACTIVITY_SAMPLE ? data.slice(-ACTIVITY_SAMPLE) : data;
    const plain = sample.includes('\x1b') ? sample.replace(ANSI_STRIP_RE, '') : sample;

    if (plain.trim().length > 0) {
      if (!this.streamActive) {
        if (this.isRecentMouseSuppression()) {
          return;
        }
        this.streamActive = true;
        this.streamStartedAt = performance.now();
        this.streamBytes = 0;
        this.streamChunks = 0;
      }
      this.streamBytes += plain.length;
      this.streamChunks += 1;

      if (this.opts.onErrorDetected && ERROR_RE.test(plain)) {
        const now = performance.now();
        if (now - this.lastErrorSoundAt > 4000) {
          this.lastErrorSoundAt = now;
          this.opts.onErrorDetected(this);
        }
      }
    }

    if (this.idleTimer !== null) {
      window.clearTimeout(this.idleTimer);
    }

    const threshold = Math.max(400, this.currentSettings.sounds?.idleThresholdMs ?? 1100);
    this.idleTimer = window.setTimeout(() => {
      this.idleTimer = null;
      if (!this.streamActive || this.disposed) return;

      const duration = performance.now() - this.streamStartedAt;
      const isSubstantial =
        this.streamChunks >= 3 && (duration >= 800 || this.streamBytes >= 160);

      this.streamActive = false;
      this.streamBytes = 0;
      this.streamChunks = 0;

      if (isSubstantial) {
        this.opts.onMessageEnd?.(this);
      }
    }, threshold);
  }

  public handleProcessExit(exitCode: number | null): void {
    if (this.disposed) return;
    if (this.idleTimer !== null) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.ptyResizeTimer !== null) {
      window.clearTimeout(this.ptyResizeTimer);
      this.ptyResizeTimer = null;
    }
    this.streamActive = false;
    this.ptyId = null;
    this.exited = true;
    const lang = this.currentSettings.language;
    const codeLabel = exitCode === null ? '?' : String(exitCode);
    this.terminal.writeln('');
    this.terminal.writeln(
      `\x1b[38;2;255;42;133m[CajuTerm] ${t('terminal.exited', lang)} (código ${codeLabel}).\x1b[0m`
    );
    this.terminal.writeln(`\x1b[38;2;0;240;255m${t('terminal.restartPrompt', lang)}\x1b[0m`);
    if (exitCode !== null && exitCode !== 0) {
      this.opts.onErrorDetected?.(this);
    }
  }

  // ---------------------------------------------------------------- Aparência / zoom

  private effectiveFontSize(settings: AppSettings = this.currentSettings): number {
    if (this.zoomOffset === 0) return settings.fontSize;
    return Math.max(FONT_MIN, Math.min(FONT_MAX, settings.fontSize + this.zoomOffset));
  }

  private setTermOption<K extends keyof ITerminalOptions>(key: K, value: ITerminalOptions[K]): boolean {
    if (this.terminal.options[key] === value) return false;
    this.terminal.options[key] = value;
    return true;
  }

  public updateAppearance(settings: AppSettings, theme: ThemeConfig): void {
    this.currentSettings = settings;
    if (theme !== this.currentTheme) {
      this.currentTheme = theme;
      this.searchDecorations = null;
    }

    // Só atribui o que mudou: o xterm compara por identidade e reconstrói o atlas WebGL a cada theme novo
    let metricsChanged = false;
    metricsChanged = this.setTermOption('fontFamily', settings.fontFamily) || metricsChanged;
    metricsChanged = this.setTermOption('fontSize', this.effectiveFontSize(settings)) || metricsChanged;
    metricsChanged = this.setTermOption('lineHeight', settings.lineHeight) || metricsChanged;
    this.setTermOption('scrollback', settings.scrollback);
    this.setTermOption('cursorBlink', settings.cursor.blink);
    this.setTermOption('cursorStyle', settings.cursor.style);

    const nextTheme = this.buildXtermTheme(theme, settings);
    const themeKey = JSON.stringify(nextTheme);
    if (themeKey !== this.lastThemeKey) {
      this.lastThemeKey = themeKey;
      this.terminal.options.theme = nextTheme;
      this.searchDecorations = null;
    }

    if (settings.ligatures && !this.ligaturesAddon) {
      this.tryEnableLigatures();
    } else if (!settings.ligatures && this.ligaturesAddon) {
      this.ligaturesAddon.dispose();
      this.ligaturesAddon = null;
    }

    if (metricsChanged) {
      this.screenRect = null;
    }
    this.scheduleFit();
  }

  /** Zoom transitório por painel (não persistido). delta em pontos de fonte. */
  public adjustZoom(delta: number): void {
    const base = this.currentSettings.fontSize;
    const target = Math.max(FONT_MIN, Math.min(FONT_MAX, base + this.zoomOffset + delta));
    this.applyZoomOffset(target - base);
  }

  public resetZoom(): void {
    this.applyZoomOffset(0);
  }

  private applyZoomOffset(offset: number): void {
    if (this.disposed) return;
    this.zoomOffset = offset;
    if (this.setTermOption('fontSize', this.effectiveFontSize())) {
      this.screenRect = null;
      // Refit no próximo frame (sem esperar o debounce) para o reflow acompanhar o zoom
      this.requestFitFrame();
    }
  }

  public scheduleFit(): void {
    if (this.fitTimer !== null) {
      window.clearTimeout(this.fitTimer);
    }
    this.fitTimer = window.setTimeout(() => {
      this.fitTimer = null;
      this.fitNow();
    }, 35);
  }

  /** Fit coalescido em rAF (no máximo um por frame) — usado em arrastos de divisória e zoom. */
  public requestFitFrame(): void {
    if (this.fitRaf !== null || this.disposed) return;
    this.fitRaf = requestAnimationFrame(() => {
      this.fitRaf = null;
      this.fitNow();
    });
  }

  public fitNow(): void {
    if (this.disposed) return;
    if (this.element.clientWidth < 30 || this.element.clientHeight < 20) return;
    try {
      this.fitAddon.fit();
    } catch {
      // Ignora erros transitórios durante transições de layout
    }
    this.screenRect = null;
    this.scheduleCursorReport();
  }

  // ---------------------------------------------------------------- Busca

  private getSearchDecorations(): NonNullable<ISearchOptions['decorations']> {
    if (this.searchDecorations) return this.searchDecorations;
    const theme = this.currentTheme;
    const bg = parseColor(theme.colors.background) ?? [12, 10, 20];
    const accent = parseColor(theme.accent) ?? parseColor(theme.colors.cursor) ?? [255, 42, 133];
    const accent2 =
      parseColor(theme.accentSecondary) ?? parseColor(theme.colors.selectionBackground) ?? [0, 240, 255];
    this.searchDecorations = {
      matchBackground: toHex(mixColors(bg, accent2, 0.38)),
      matchBorder: toHex(mixColors(bg, accent2, 0.7)),
      matchOverviewRuler: toHex(accent2),
      activeMatchBackground: toHex(mixColors(bg, accent, 0.62)),
      activeMatchBorder: toHex(accent),
      activeMatchColorOverviewRuler: toHex(accent),
    };
    return this.searchDecorations;
  }

  public searchNext(query: string, caseSensitive: boolean, regex: boolean, incremental = false): boolean {
    if (!query) {
      this.clearSearch();
      return false;
    }
    this.searchActive = true;
    return this.searchAddon.findNext(query, {
      caseSensitive,
      regex,
      incremental,
      decorations: this.getSearchDecorations(),
    });
  }

  public searchPrev(query: string, caseSensitive: boolean, regex: boolean): boolean {
    if (!query) {
      this.clearSearch();
      return false;
    }
    this.searchActive = true;
    return this.searchAddon.findPrevious(query, {
      caseSensitive,
      regex,
      decorations: this.getSearchDecorations(),
    });
  }

  public clearSearch(): void {
    this.searchActive = false;
    this.searchAddon.clearDecorations();
  }

  // ---------------------------------------------------------------- Clipboard

  private handleSelectionChange(): void {
    if (this.copyTimer !== null) {
      window.clearTimeout(this.copyTimer);
      this.copyTimer = null;
    }
    // Busca seleciona o match ativo: não deve sobrescrever o clipboard
    if (!this.currentSettings.copyOnSelect || this.searchActive) return;
    this.copyTimer = window.setTimeout(() => {
      this.copyTimer = null;
      if (this.disposed || !this.terminal.hasSelection()) return;
      const text = this.terminal.getSelection();
      if (text) void navigator.clipboard.writeText(text).catch(() => {});
    }, 120);
  }

  private pasteFromClipboard(): void {
    void navigator.clipboard
      .readText()
      .then((clip) => this.pasteText(clip))
      .catch(() => {});
  }

  /**
   * Ponto único de colagem (Ctrl+Shift+V, botão direito, evento paste nativo).
   * Texto multilinha sem bracketed paste executaria linha a linha: pede confirmação via onConfirmPaste.
   */
  public pasteText(text: string): void {
    if (!text || this.disposed) return;
    this.lastKeyboardInputAt = performance.now();
    const proceed = () => {
      if (this.disposed) return;
      this.terminal.paste(text);
    };
    const isMultiline = /[\r\n]/.test(text.replace(/[\r\n\s]+$/, ''));
    if (isMultiline && !this.terminal.modes.bracketedPasteMode && this.opts.onConfirmPaste) {
      this.opts.onConfirmPaste(this, text, proceed);
      return;
    }
    proceed();
  }

  // ---------------------------------------------------------------- Prompt marks (OSC 133)

  private addPromptMarker(): void {
    if (this.terminal.buffer.active.type !== 'normal') return;
    const marker = this.terminal.registerMarker(0);
    if (!marker) return;
    const last = this.promptMarkers[this.promptMarkers.length - 1];
    if (last && last.line === marker.line) {
      marker.dispose();
      return;
    }
    // Linhas que saem do scrollback descartam o marker: remove da lista
    marker.onDispose(() => {
      const idx = this.promptMarkers.indexOf(marker);
      if (idx >= 0) this.promptMarkers.splice(idx, 1);
    });
    this.promptMarkers.push(marker);
    if (this.promptMarkers.length > MAX_PROMPT_MARKS) {
      this.promptMarkers[0].dispose();
    }
  }

  /** Rola para o prompt anterior/seguinte. Retorna false se não há marcas (tecla segue para o shell). */
  public jumpToPrompt(direction: -1 | 1): boolean {
    const lines = this.promptMarkers.map((m) => m.line).filter((l) => l >= 0);
    if (lines.length === 0) return false;
    const buf = this.terminal.buffer.active;
    const top = buf.viewportY;
    if (direction < 0) {
      let target = -1;
      for (const l of lines) if (l < top && l > target) target = l;
      if (target >= 0) this.terminal.scrollToLine(target);
    } else {
      let target = Number.POSITIVE_INFINITY;
      for (const l of lines) if (l > top && l < target) target = l;
      if (Number.isFinite(target) && target < buf.baseY) this.terminal.scrollToLine(target);
      else this.terminal.scrollToBottom();
    }
    return true;
  }

  // ---------------------------------------------------------------- Comandos

  public clearBuffer(): void {
    this.terminal.clear();
  }

  public sendText(text: string, appendEnter = true): void {
    if (this.disposed || this.exited || this.ptyId === null) return;
    const payload = appendEnter ? `${text}\r` : text;
    void ptyWrite(this.ptyId, payload);
    if (appendEnter) {
      this.lineInputBuffer = '';
    } else {
      this.lineInputBuffer = (this.lineInputBuffer + text).slice(-256);
    }
    this.focus();
  }

  public replaceCurrentLineAndRun(rawInput: string, resolvedCommand: string): void {
    if (this.disposed || this.exited || this.ptyId === null) return;
    if (rawInput === resolvedCommand) {
      void ptyWrite(this.ptyId, '\r');
    } else {
      const backspaces = '\x7f'.repeat(rawInput.length);
      void ptyWrite(this.ptyId, `${backspaces}${resolvedCommand}\r`);
    }
    this.lineInputBuffer = '';
    this.focus();
  }

  public changeDirectory(targetPath: string): void {
    if (this.disposed || this.exited || this.ptyId === null) return;
    const winPath = targetPath.replace(/\//g, '\\');
    const shellLower = this.profile.shell.toLowerCase();

    let cmd: string;
    if (shellLower.includes('cmd')) {
      cmd = `cd /d "${winPath}"\r`;
    } else if (shellLower.includes('wsl')) {
      const wslPath = winPath.replace(/^([a-zA-Z]):\\/, (_, d: string) => `/mnt/${d.toLowerCase()}/`).replace(/\\/g, '/');
      cmd = `cd "${wslPath}"\r`;
    } else {
      cmd = `Set-Location -LiteralPath '${winPath.replace(/'/g, "''")}'\r`;
    }

    void ptyWrite(this.ptyId, cmd);
    this.focus();
  }

  // ---------------------------------------------------------------- Foco / cursor FX

  public focus(): void {
    this.element.classList.add('focused');
    this.terminal.focus();
    this.screenRect = null;
    this.opts.onCursorMove(this, this.getCursorScreenPos());
    this.opts.onDimensionsChange(this, this.terminal.cols, this.terminal.rows);
  }

  public blurVisual(): void {
    this.element.classList.remove('focused');
  }

  /** Workspace marca o painel ativo da aba ativa; os demais não calculam posição de cursor para FX. */
  public setFxActive(active: boolean): void {
    this.fxActive = active;
    if (!active && this.cursorRaf !== null) {
      cancelAnimationFrame(this.cursorRaf);
      this.cursorRaf = null;
    }
  }

  private emitTypingFx(): void {
    if (!this.fxActive) return;
    const pos = this.getCursorScreenPos();
    if (!pos.hidden) {
      this.opts.onTyping(this, pos);
    }
    this.opts.onCursorMove(this, pos);
  }

  /** Coalesce relatórios de cursor (saída em lote, scroll, resize) em um por frame. */
  private scheduleCursorReport(): void {
    if (!this.fxActive || this.cursorRaf !== null || this.disposed) return;
    this.cursorRaf = requestAnimationFrame(() => {
      this.cursorRaf = null;
      if (!this.fxActive || this.disposed) return;
      this.opts.onCursorMove(this, this.getCursorScreenPos());
    });
  }

  private getScreenRect(): DOMRect {
    if (!this.screenRect) {
      if (!this.screenEl || !this.screenEl.isConnected) {
        this.screenEl = this.element.querySelector<HTMLElement>('.xterm-screen');
      }
      this.screenRect = (this.screenEl ?? this.element).getBoundingClientRect();
    }
    return this.screenRect;
  }

  public getCursorScreenPos(): PaneCursorPos {
    const rect = this.getScreenRect();

    const cols = Math.max(1, this.terminal.cols);
    const rows = Math.max(1, this.terminal.rows);

    const cellWidth = rect.width / cols;
    const cellHeight = rect.height / rows;

    const buf = this.terminal.buffer.active;
    const cx = buf.cursorX;
    // cursorY é relativo a baseY; converte para linha do viewport (scrollback rolado desloca)
    const row = buf.baseY + buf.cursorY - buf.viewportY;

    const pos: PaneCursorPos = {
      x: rect.left + cx * cellWidth,
      y: rect.top + row * cellHeight,
      cellWidth,
      cellHeight,
      containerLeft: rect.left,
      containerTop: rect.top,
      containerWidth: rect.width,
      containerHeight: rect.height,
    };
    if (row < 0 || row >= rows) {
      pos.hidden = true;
    }
    return pos;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.spawnGen += 1; // descarta eventos tardios do PTY
    const timers = [
      this.fitTimer,
      this.idleTimer,
      this.scrollActivityTimer,
      this.ptyResizeTimer,
      this.webglRetryTimer,
      this.webglSuspendTimer,
      this.copyTimer,
    ];
    for (const id of timers) {
      if (id !== null) window.clearTimeout(id);
    }
    for (const raf of [this.scrollbarRaf, this.fitRaf, this.cursorRaf]) {
      if (raf !== null) cancelAnimationFrame(raf);
    }
    this.resizeObserver.disconnect();
    this.scrollDisposables.forEach((d) => d.dispose());
    this.scrollDisposables = [];
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this.promptMarkers.slice().forEach((m) => m.dispose());
    this.promptMarkers = [];
    this.domCleanups.forEach((fn) => fn());
    this.domCleanups = [];
    if (this.ptyId !== null) {
      void ptyKill(this.ptyId).catch(() => {});
      this.ptyId = null;
    }
    this.webglAddon?.dispose();
    this.webglAddon = null;
    this.ligaturesAddon?.dispose();
    this.terminal.dispose();
    this.element.remove();
  }
}

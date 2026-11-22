import { FitAddon } from '@xterm/addon-fit';
import { ImageAddon } from '@xterm/addon-image';
import { LigaturesAddon } from '@xterm/addon-ligatures';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

import { t } from '../i18n';
import type {
  AppSettings,
  CursorScreenPos,
  ProfileConfig,
  ThemeConfig,
} from '../types';
import { openExternalUrl, ptyKill, ptyResize, ptySpawn, ptyWrite } from './pty-bridge';

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
}

export class TerminalPane {
  public readonly paneId: string;
  public readonly element: HTMLDivElement;
  public readonly terminal: Terminal;
  public profile: ProfileConfig;
  public ptyId: number | null = null;
  public exited = false;
  public title: string;

  private fitAddon: FitAddon;
  private searchAddon: SearchAddon;
  private webglAddon: WebglAddon | null = null;
  private ligaturesAddon: LigaturesAddon | null = null;
  private resizeObserver: ResizeObserver;
  private opts: TerminalPaneOptions;
  private currentSettings: AppSettings;
  private fitTimer: number | null = null;
  private disposed = false;

  constructor(opts: TerminalPaneOptions) {
    this.opts = opts;
    this.paneId = opts.paneId;
    this.profile = opts.profile;
    this.currentSettings = opts.settings;
    this.title = opts.profile.name;

    this.element = document.createElement('div');
    this.element.className = 'terminal-pane';
    this.element.dataset.paneId = opts.paneId;

    this.terminal = new Terminal({
      allowProposedApi: true,
      allowTransparency: true,
      cursorBlink: opts.settings.cursor.blink,
      cursorStyle: opts.settings.cursor.style,
      fontFamily: opts.settings.fontFamily,
      fontSize: opts.settings.fontSize,
      lineHeight: opts.settings.lineHeight,
      scrollback: opts.settings.scrollback,
      macOptionIsMeta: true,
      windowsMode: false, // ConPTY já envia sequências VT completas
      theme: this.buildXtermTheme(opts.theme, opts.settings),
    });

    this.fitAddon = new FitAddon();
    this.searchAddon = new SearchAddon();
    const webLinksAddon = new WebLinksAddon((_event, uri) => {
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

    // Ativa acelerador WebGL com fallback automático caso o driver perca o contexto
    this.tryEnableWebgl();

    // Ativa ligaduras tipográficas se habilitadas (Fontes Nerd Fonts / JetBrains / Cascadia)
    if (opts.settings.ligatures) {
      this.tryEnableLigatures();
    }

    // Intercepta copiar/colar e atalhos globais do CajuTerm antes do xterm
    this.terminal.attachCustomKeyEventHandler((ev) => {
      if (this.opts.isAppShortcut(ev)) {
        return false;
      }

      if (ev.type === 'keydown') {
        const keyLower = ev.key.toLowerCase();

        // Ctrl+Shift+C ou Ctrl+C com texto selecionado -> Copiar
        if (ev.ctrlKey && !ev.altKey && keyLower === 'c' && (ev.shiftKey || this.terminal.hasSelection())) {
          const selection = this.terminal.getSelection();
          if (selection) {
            void navigator.clipboard.writeText(selection);
          }
          return false;
        }

        // Ctrl+Shift+V -> Colar via Clipboard API
        if (ev.ctrlKey && ev.shiftKey && !ev.altKey && keyLower === 'v') {
          void navigator.clipboard.readText().then((clip) => {
            if (clip) this.terminal.paste(clip);
          });
          return false;
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
          void navigator.clipboard.writeText(text);
          this.terminal.clearSelection();
        }
      } else {
        void navigator.clipboard.readText().then((clip) => {
          if (clip) this.terminal.paste(clip);
        });
      }
    });

    this.element.addEventListener('mousedown', () => {
      this.opts.onFocus(this);
      this.terminal.focus();
    });

    this.terminal.onData((data) => {
      if (this.exited) {
        if (data === '\r' || data === '\n') {
          this.exited = false;
          this.terminal.write('\r\n');
          void this.spawnShell();
        }
        return;
      }
      if (this.ptyId !== null) {
        void ptyWrite(this.ptyId, data);
      }
      const pos = this.getCursorScreenPos();
      this.opts.onTyping(this, pos);
      this.opts.onCursorMove(this, pos);
    });

    this.terminal.onCursorMove(() => {
      this.opts.onCursorMove(this, this.getCursorScreenPos());
    });

    this.terminal.onTitleChange((nextTitle) => {
      const clean = nextTitle.trim();
      if (clean) {
        this.title = clean;
        this.opts.onTitleChange(this, clean);
      }
    });

    this.terminal.onResize(({ cols, rows }) => {
      if (this.ptyId !== null && !this.exited) {
        void ptyResize(this.ptyId, cols, rows);
      }
      this.opts.onDimensionsChange(this, cols, rows);
    });

    this.resizeObserver = new ResizeObserver(() => {
      this.scheduleFit();
    });
    this.resizeObserver.observe(this.element);

    // Ajuste inicial e spawn do ConPTY
    requestAnimationFrame(() => {
      this.fitNow();
      void this.spawnShell();
    });
  }

  private tryEnableWebgl(): void {
    try {
      const addon = new WebglAddon();
      addon.onContextLoss(() => {
        addon.dispose();
        this.webglAddon = null;
      });
      this.terminal.loadAddon(addon);
      this.webglAddon = addon;
    } catch {
      this.webglAddon = null;
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

  private buildXtermTheme(theme: ThemeConfig, settings: AppSettings) {
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

  public async spawnShell(): Promise<void> {
    if (this.disposed) return;
    this.exited = false;
    const cols = Math.max(20, this.terminal.cols);
    const rows = Math.max(5, this.terminal.rows);

    try {
      const id = await ptySpawn({
        shell: this.profile.shell,
        args: this.profile.args,
        cwd: this.profile.cwd,
        env: this.profile.env,
        cols,
        rows,
      });
      if (this.disposed) {
        void ptyKill(id);
        return;
      }
      this.ptyId = id;
      await ptyResize(id, cols, rows);
    } catch (err) {
      this.exited = true;
      this.terminal.writeln(`\r\n\x1b[31m[Erro ao iniciar shell]: ${String(err)}\x1b[0m`);
      this.terminal.writeln(`\x1b[33m${t('terminal.restartPrompt', this.currentSettings.language)}\x1b[0m`);
    }
  }

  public writeOutput(data: string): void {
    if (!this.disposed) {
      this.terminal.write(data);
    }
  }

  public handleProcessExit(exitCode: number | null): void {
    if (this.disposed) return;
    this.ptyId = null;
    this.exited = true;
    const lang = this.currentSettings.language;
    const codeLabel = exitCode === null ? '?' : String(exitCode);
    this.terminal.writeln('');
    this.terminal.writeln(
      `\x1b[38;2;255;42;133m[CajuTerm] ${t('terminal.exited', lang)} (código ${codeLabel}).\x1b[0m`
    );
    this.terminal.writeln(`\x1b[38;2;0;240;255m${t('terminal.restartPrompt', lang)}\x1b[0m`);
  }

  public updateAppearance(settings: AppSettings, theme: ThemeConfig): void {
    this.currentSettings = settings;

    this.terminal.options.fontFamily = settings.fontFamily;
    this.terminal.options.fontSize = settings.fontSize;
    this.terminal.options.lineHeight = settings.lineHeight;
    this.terminal.options.scrollback = settings.scrollback;
    this.terminal.options.cursorBlink = settings.cursor.blink;
    this.terminal.options.cursorStyle = settings.cursor.style;
    this.terminal.options.theme = this.buildXtermTheme(theme, settings);

    if (settings.ligatures && !this.ligaturesAddon) {
      this.tryEnableLigatures();
    } else if (!settings.ligatures && this.ligaturesAddon) {
      this.ligaturesAddon.dispose();
      this.ligaturesAddon = null;
    }

    this.scheduleFit();
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

  public fitNow(): void {
    if (this.disposed) return;
    if (this.element.clientWidth < 30 || this.element.clientHeight < 20) return;
    try {
      this.fitAddon.fit();
    } catch {
      // Ignora erros transitórios durante transições de layout
    }
  }

  public searchNext(query: string, caseSensitive: boolean, regex: boolean): boolean {
    if (!query) return false;
    return this.searchAddon.findNext(query, { caseSensitive, regex, incremental: false });
  }

  public searchPrev(query: string, caseSensitive: boolean, regex: boolean): boolean {
    if (!query) return false;
    return this.searchAddon.findPrevious(query, { caseSensitive, regex });
  }

  public clearSearch(): void {
    this.searchAddon.clearDecorations();
  }

  public clearBuffer(): void {
    this.terminal.clear();
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

  public focus(): void {
    this.element.classList.add('focused');
    this.terminal.focus();
    this.opts.onCursorMove(this, this.getCursorScreenPos());
    this.opts.onDimensionsChange(this, this.terminal.cols, this.terminal.rows);
  }

  public blurVisual(): void {
    this.element.classList.remove('focused');
  }

  public getCursorScreenPos(): CursorScreenPos {
    const screenEl =
      this.element.querySelector<HTMLElement>('.xterm-screen') ?? this.element;
    const rect = screenEl.getBoundingClientRect();

    const cols = Math.max(1, this.terminal.cols);
    const rows = Math.max(1, this.terminal.rows);

    const cellWidth = rect.width / cols;
    const cellHeight = rect.height / rows;

    const cx = this.terminal.buffer.active.cursorX;
    const cy = this.terminal.buffer.active.cursorY;

    return {
      x: rect.left + cx * cellWidth,
      y: rect.top + cy * cellHeight,
      cellWidth,
      cellHeight,
      containerLeft: rect.left,
      containerTop: rect.top,
      containerWidth: rect.width,
      containerHeight: rect.height,
    };
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.fitTimer !== null) {
      window.clearTimeout(this.fitTimer);
    }
    this.resizeObserver.disconnect();
    if (this.ptyId !== null) {
      void ptyKill(this.ptyId);
      this.ptyId = null;
    }
    this.webglAddon?.dispose();
    this.ligaturesAddon?.dispose();
    this.terminal.dispose();
    this.element.remove();
  }
}

import { Channel, invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { BUILTIN_THEMES, DEFAULT_SETTINGS } from '../themes';
import type { AppSettings, ConfigBundle, QuickPathEntry, ThemeConfig } from '../types';

export interface PtySpawnArgs {
  shell?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols: number;
  rows: number;
}

/** Callbacks por sessão. Entregues pelo `Channel` próprio da sessão, na ordem exata da saída. */
export interface PtyHandlers {
  onData: (data: string) => void;
  /** Chamado uma única vez quando o shell termina sozinho (não é chamado após `ptyKill`). */
  onExit: (exitCode: number | null) => void;
}

/** Mensagem única do canal PTY (espelha `PtyEvent` em src-tauri/src/pty.rs). */
type PtyChannelMessage = { kind: 'data'; data: string } | { kind: 'exit'; exitCode: number | null };

interface PtySessionState {
  handlers: PtyHandlers;
  closed: boolean;
}

/** Sessões conhecidas por id — usadas para silenciar a entrega depois de `ptyKill`. */
const sessions = new Map<number, PtySessionState>();

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

// Estado local fallback quando aberto apenas em navegador (sem Tauri)
let mockNextId = 1000;

function dispatch(state: PtySessionState, msg: PtyChannelMessage): void {
  if (state.closed) return;
  if (msg.kind === 'data') {
    state.handlers.onData(msg.data);
  } else {
    state.closed = true;
    state.handlers.onExit(msg.exitCode ?? null);
  }
}

export async function ptySpawn(opts: PtySpawnArgs, handlers: PtyHandlers): Promise<number> {
  const state: PtySessionState = { handlers, closed: false };

  if (!isTauriRuntime()) {
    const id = mockNextId++;
    sessions.set(id, state);
    setTimeout(() => {
      dispatch(state, {
        kind: 'data',
        data:
          '\x1b[38;2;255;42;133mCajuTerm Preview (Modo Web)\x1b[0m\r\n' +
          '\x1b[38;2;0;240;255mExecute `npm run tauri dev` para conectar ao ConPTY + PowerShell real.\x1b[0m\r\n\r\n' +
          'PS C:\CajuTerm> ',
      });
    }, 50);
    return id;
  }

  // Canal criado ANTES do invoke: nenhum byte emitido antes de o id voltar é perdido.
  const channel = new Channel<PtyChannelMessage>();
  channel.onmessage = (msg) => dispatch(state, msg);

  const id = await invoke<number>('pty_spawn', {
    shell: opts.shell ?? null,
    args: opts.args ?? null,
    cwd: opts.cwd ?? null,
    env: opts.env ?? null,
    cols: opts.cols,
    rows: opts.rows,
    onEvent: channel,
  });
  if (!state.closed) sessions.set(id, state);
  return id;
}

interface WriteQueue {
  inFlight: boolean;
  buffer: string;
  waiters: Array<{ resolve: () => void; reject: (err: unknown) => void }>;
}

/** Fila por sessão: no máximo 1 `pty_write` em voo; o restante é coalescido, preservando a ordem. */
const writeQueues = new Map<number, WriteQueue>();

function flushWrites(id: number, queue: WriteQueue): void {
  const data = queue.buffer;
  const waiters = queue.waiters;
  queue.buffer = '';
  queue.waiters = [];
  queue.inFlight = true;

  invoke('pty_write', { id, data }).then(
    () => waiters.forEach((w) => w.resolve()),
    (err) => waiters.forEach((w) => w.reject(err))
  ).finally(() => {
    queue.inFlight = false;
    if (queue.buffer.length > 0) {
      flushWrites(id, queue);
    } else {
      writeQueues.delete(id);
    }
  });
}

export async function ptyWrite(id: number, data: string): Promise<void> {
  if (!isTauriRuntime()) {
    const state = sessions.get(id);
    if (state) dispatch(state, { kind: 'data', data: data === '\r' ? '\r\nPS C:\CajuTerm> ' : data });
    return;
  }
  if (data.length === 0) return;

  let queue = writeQueues.get(id);
  if (!queue) {
    queue = { inFlight: false, buffer: '', waiters: [] };
    writeQueues.set(id, queue);
  }
  queue.buffer += data;
  const q = queue;
  return new Promise<void>((resolve, reject) => {
    q.waiters.push({ resolve, reject });
    if (!q.inFlight) flushWrites(id, q);
  });
}

export async function ptyResize(id: number, cols: number, rows: number): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke('pty_resize', { id, cols, rows });
}

export async function ptyKill(id: number): Promise<void> {
  const state = sessions.get(id);
  if (state) state.closed = true;
  sessions.delete(id);
  if (!isTauriRuntime()) return;
  await invoke('pty_kill', { id });
}

/** `true` se há programa rodando sob o shell (claude, vim, ssh...). Em erro assume livre. */
export async function ptyHasChild(id: number): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    return await invoke<boolean>('pty_has_child', { id });
  } catch {
    return false;
  }
}

export async function onConfigReloaded(handler: (bundle: ConfigBundle) => void): Promise<UnlistenFn> {
  if (!isTauriRuntime()) {
    return () => {};
  }
  return listen<ConfigBundle>('config-reloaded', (event) => handler(event.payload));
}

/** Serializa mutações de configuração: cada save só começa após o anterior terminar (última escrita vence). */
let configChain: Promise<unknown> = Promise.resolve();

function serializeConfigOp<T>(op: () => Promise<T>): Promise<T> {
  const run = configChain.then(op, op);
  configChain = run.catch(() => undefined);
  return run;
}

export async function getConfigBundle(): Promise<ConfigBundle> {
  if (!isTauriRuntime()) {
    const settings = DEFAULT_SETTINGS();
    return {
      configDir: '%APPDATA%\\CajuTerm',
      settings,
      rawSettingsJson: JSON.stringify(settings, null, 2),
      customCss: '',
      themes: [...BUILTIN_THEMES],
      fonts: [],
    };
  }
  return invoke<ConfigBundle>('get_config_bundle');
}

export async function saveSettings(settings: AppSettings): Promise<ConfigBundle> {
  if (!isTauriRuntime()) {
    return {
      configDir: '%APPDATA%\\CajuTerm',
      settings,
      rawSettingsJson: JSON.stringify(settings, null, 2),
      customCss: '',
      themes: [...BUILTIN_THEMES],
      fonts: [],
    };
  }
  return serializeConfigOp(() => invoke<ConfigBundle>('save_settings', { settings }));
}

export async function saveRawSettings(rawJson: string): Promise<ConfigBundle> {
  if (!isTauriRuntime()) {
    const parsed = JSON.parse(rawJson) as AppSettings;
    return saveSettings(parsed);
  }
  return serializeConfigOp(() => invoke<ConfigBundle>('save_raw_settings', { rawJson }));
}

export async function saveCustomCss(css: string): Promise<ConfigBundle> {
  if (!isTauriRuntime()) {
    const b = await getConfigBundle();
    b.customCss = css;
    return b;
  }
  return serializeConfigOp(() => invoke<ConfigBundle>('save_custom_css', { css }));
}

export async function saveTheme(theme: ThemeConfig): Promise<ConfigBundle> {
  if (!isTauriRuntime()) {
    const b = await getConfigBundle();
    b.themes = [...b.themes.filter((t) => t.id !== theme.id), theme];
    return b;
  }
  return serializeConfigOp(() => invoke<ConfigBundle>('save_theme', { theme }));
}

export async function deleteTheme(themeId: string): Promise<ConfigBundle> {
  if (!isTauriRuntime()) {
    const b = await getConfigBundle();
    b.themes = b.themes.filter((t) => t.id !== themeId);
    return b;
  }
  return serializeConfigOp(() => invoke<ConfigBundle>('delete_theme', { themeId }));
}

export async function installFontBase64(fileName: string, base64Data: string): Promise<ConfigBundle> {
  if (!isTauriRuntime()) {
    return getConfigBundle();
  }
  return serializeConfigOp(() => invoke<ConfigBundle>('install_font_base64', { fileName, base64Data }));
}

export async function openConfigDir(): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke('open_config_dir');
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!isTauriRuntime()) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  await invoke('open_external_url', { url });
}

export async function applyWindowVibrancy(
  vibrancy: 'acrylic' | 'mica' | 'none',
  tintRgba?: [number, number, number, number]
): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke('apply_window_vibrancy', { vibrancy, tintRgba: tintRgba ?? null });
}

export async function toggleQuakeMode(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  return invoke<boolean>('toggle_quake_mode');
}

export async function updateQuakeShortcut(shortcut: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke('update_quake_shortcut', { shortcut });
}

export async function windowMinimize(): Promise<void> {
  if (!isTauriRuntime()) return;
  await getCurrentWindow().minimize();
}

export async function windowToggleMaximize(): Promise<void> {
  if (!isTauriRuntime()) return;
  await getCurrentWindow().toggleMaximize();
}

export async function windowClose(): Promise<void> {
  if (!isTauriRuntime()) return;
  await getCurrentWindow().close();
}

export async function windowSetAlwaysOnTop(flag: boolean): Promise<void> {
  if (!isTauriRuntime()) return;
  await getCurrentWindow().setAlwaysOnTop(flag);
}

export async function windowStartDragging(): Promise<void> {
  if (!isTauriRuntime()) return;
  await getCurrentWindow().startDragging();
}

export async function listQuickPaths(): Promise<QuickPathEntry[]> {
  if (!isTauriRuntime()) {
    return [
      { label: 'virtus', path: 'Y:/virtus/virtus', group: 'Favoritos' },
      { label: 'Github-PA', path: 'Y:/Github-PA', group: 'Favoritos' },
      { label: 'CajuTerm', path: 'Y:/Github-PA/CajuTerm', group: 'Y:/Github-PA' },
    ];
  }
  return invoke<QuickPathEntry[]>('list_quick_paths');
}

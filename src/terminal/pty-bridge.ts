import { invoke } from '@tauri-apps/api/core';
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

export interface PtyOutputPayload {
  id: number;
  data: string;
}

export interface PtyExitPayload {
  id: number;
  exitCode: number | null;
}

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

// Estado local fallback quando aberto apenas em navegador (sem Tauri)
let mockNextId = 1000;
const mockOutputListeners = new Set<(payload: PtyOutputPayload) => void>();

export async function ptySpawn(opts: PtySpawnArgs): Promise<number> {
  if (!isTauriRuntime()) {
    const id = mockNextId++;
    setTimeout(() => {
      for (const cb of mockOutputListeners) {
        cb({
          id,
          data:
            '\x1b[38;2;255;42;133mCajuTerm Preview (Modo Web)\x1b[0m\r\n' +
            '\x1b[38;2;0;240;255mExecute `npm run tauri dev` para conectar ao ConPTY + PowerShell real.\x1b[0m\r\n\r\n' +
            'PS C:\\CajuTerm> ',
        });
      }
    }, 50);
    return id;
  }
  return invoke<number>('pty_spawn', {
    shell: opts.shell ?? null,
    args: opts.args ?? null,
    cwd: opts.cwd ?? null,
    env: opts.env ?? null,
    cols: opts.cols,
    rows: opts.rows,
  });
}

export async function ptyWrite(id: number, data: string): Promise<void> {
  if (!isTauriRuntime()) {
    const out = data === '\r' ? '\r\nPS C:\\CajuTerm> ' : data;
    for (const cb of mockOutputListeners) {
      cb({ id, data: out });
    }
    return;
  }
  await invoke('pty_write', { id, data });
}

export async function ptyResize(id: number, cols: number, rows: number): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke('pty_resize', { id, cols, rows });
}

export async function ptyKill(id: number): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke('pty_kill', { id });
}

export async function onPtyOutput(handler: (payload: PtyOutputPayload) => void): Promise<UnlistenFn> {
  if (!isTauriRuntime()) {
    mockOutputListeners.add(handler);
    return () => {
      mockOutputListeners.delete(handler);
    };
  }
  return listen<PtyOutputPayload>('pty-output', (event) => handler(event.payload));
}

export async function onPtyExit(handler: (payload: PtyExitPayload) => void): Promise<UnlistenFn> {
  if (!isTauriRuntime()) {
    return () => {};
  }
  return listen<PtyExitPayload>('pty-exit', (event) => handler(event.payload));
}

export async function onConfigReloaded(handler: (bundle: ConfigBundle) => void): Promise<UnlistenFn> {
  if (!isTauriRuntime()) {
    return () => {};
  }
  return listen<ConfigBundle>('config-reloaded', (event) => handler(event.payload));
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
  return invoke<ConfigBundle>('save_settings', { settings });
}

export async function saveRawSettings(rawJson: string): Promise<ConfigBundle> {
  if (!isTauriRuntime()) {
    const parsed = JSON.parse(rawJson) as AppSettings;
    return saveSettings(parsed);
  }
  return invoke<ConfigBundle>('save_raw_settings', { rawJson });
}

export async function saveCustomCss(css: string): Promise<ConfigBundle> {
  if (!isTauriRuntime()) {
    const b = await getConfigBundle();
    b.customCss = css;
    return b;
  }
  return invoke<ConfigBundle>('save_custom_css', { css });
}

export async function saveTheme(theme: ThemeConfig): Promise<ConfigBundle> {
  if (!isTauriRuntime()) {
    const b = await getConfigBundle();
    b.themes = [...b.themes.filter((t) => t.id !== theme.id), theme];
    return b;
  }
  return invoke<ConfigBundle>('save_theme', { theme });
}

export async function installFontBase64(fileName: string, base64Data: string): Promise<ConfigBundle> {
  if (!isTauriRuntime()) {
    return getConfigBundle();
  }
  return invoke<ConfigBundle>('install_font_base64', { fileName, base64Data });
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

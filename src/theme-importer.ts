import type { ThemeColors, ThemeConfig } from './types';

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return s || `imported-${Date.now()}`;
}

function normalizeColor(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  const cleaned = raw.trim().replace(/^['"]|['"]$/g, '');
  if (cleaned.startsWith('0x') && cleaned.length >= 8) {
    return `#${cleaned.slice(2, 8)}`;
  }
  if (/^#[0-9a-fA-F]{6}$/.test(cleaned) || /^#[0-9a-fA-F]{3}$/.test(cleaned)) {
    return cleaned;
  }
  return fallback;
}

function buildThemeObject(name: string, colors: ThemeColors): ThemeConfig {
  return {
    id: slugify(name),
    name,
    category: 'Imported',
    accent: colors.magenta,
    accentSecondary: colors.cyan,
    uiSurface: `${colors.background}cc`,
    uiBorder: `${colors.magenta}66`,
    colors,
  };
}

/**
 * Converte um esquema do Windows Terminal (JSON) para ThemeConfig.
 */
function parseWindowsTerminal(rawText: string): ThemeConfig | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return null;
  }

  const candidate = Array.isArray(parsed)
    ? parsed[0]
    : typeof parsed === 'object' && parsed !== null && 'schemes' in parsed && Array.isArray((parsed as { schemes: unknown[] }).schemes)
      ? (parsed as { schemes: unknown[] }).schemes[0]
      : parsed;

  if (!candidate || typeof candidate !== 'object') return null;
  const obj = candidate as Record<string, string | undefined>;
  if (!obj.background || !obj.foreground) return null;

  const colors: ThemeColors = {
    background: normalizeColor(obj.background, '#0b0716'),
    foreground: normalizeColor(obj.foreground, '#eef2ff'),
    cursor: normalizeColor(obj.cursorColor, '#ff2a85'),
    cursorAccent: normalizeColor(obj.background, '#0b0716'),
    selectionBackground: normalizeColor(obj.selectionBackground, 'rgba(255,42,133,0.3)'),
    black: normalizeColor(obj.black, '#11111b'),
    red: normalizeColor(obj.red, '#f38ba8'),
    green: normalizeColor(obj.green, '#a6e3a1'),
    yellow: normalizeColor(obj.yellow, '#f9e2af'),
    blue: normalizeColor(obj.blue, '#89b4fa'),
    magenta: normalizeColor(obj.purple ?? obj.magenta, '#cba6f7'),
    cyan: normalizeColor(obj.cyan, '#94e2d5'),
    white: normalizeColor(obj.white, '#cdd6f4'),
    brightBlack: normalizeColor(obj.brightBlack, '#585b70'),
    brightRed: normalizeColor(obj.brightRed, '#f38ba8'),
    brightGreen: normalizeColor(obj.brightGreen, '#a6e3a1'),
    brightYellow: normalizeColor(obj.brightYellow, '#f9e2af'),
    brightBlue: normalizeColor(obj.brightBlue, '#89b4fa'),
    brightMagenta: normalizeColor(obj.brightPurple ?? obj.brightMagenta, '#cba6f7'),
    brightCyan: normalizeColor(obj.brightCyan, '#94e2d5'),
    brightWhite: normalizeColor(obj.brightWhite, '#ffffff'),
  };

  return buildThemeObject(obj.name || 'Windows Terminal Theme', colors);
}

/**
 * Converte XML `.itermcolors` (iTerm2 Plist) para ThemeConfig.
 */
function parseIterm2(rawText: string, hintName?: string): ThemeConfig | null {
  if (!rawText.includes('<plist') && !rawText.includes('Ansi 0 Color')) {
    return null;
  }

  const doc = new DOMParser().parseFromString(rawText, 'application/xml');
  const rootDict = doc.querySelector('plist > dict');
  if (!rootDict) return null;

  const map = new Map<string, string>();
  const children = Array.from(rootDict.children);
  for (let i = 0; i < children.length - 1; i += 2) {
    const keyEl = children[i];
    const valEl = children[i + 1];
    if (keyEl.tagName !== 'key' || valEl.tagName !== 'dict') continue;

    const keyName = keyEl.textContent?.trim() ?? '';
    const inner = Array.from(valEl.children);
    let r = 0;
    let g = 0;
    let b = 0;

    for (let j = 0; j < inner.length - 1; j += 2) {
      const compName = inner[j].textContent?.trim();
      const compVal = parseFloat(inner[j + 1].textContent?.trim() ?? '0');
      if (compName === 'Red Component') r = Math.round(compVal * 255);
      if (compName === 'Green Component') g = Math.round(compVal * 255);
      if (compName === 'Blue Component') b = Math.round(compVal * 255);
    }

    const toHex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
    map.set(keyName, `#${toHex(r)}${toHex(g)}${toHex(b)}`);
  }

  if (!map.has('Background Color') && !map.has('Ansi 0 Color')) {
    return null;
  }

  const colors: ThemeColors = {
    background: map.get('Background Color') ?? '#0b0716',
    foreground: map.get('Foreground Color') ?? '#eef2ff',
    cursor: map.get('Cursor Color') ?? '#ff2a85',
    cursorAccent: map.get('Cursor Text Color') ?? map.get('Background Color') ?? '#0b0716',
    selectionBackground: map.get('Selection Color') ?? 'rgba(255,42,133,0.32)',
    black: map.get('Ansi 0 Color') ?? '#000000',
    red: map.get('Ansi 1 Color') ?? '#ff5555',
    green: map.get('Ansi 2 Color') ?? '#50fa7b',
    yellow: map.get('Ansi 3 Color') ?? '#f1fa8c',
    blue: map.get('Ansi 4 Color') ?? '#bd93f9',
    magenta: map.get('Ansi 5 Color') ?? '#ff79c6',
    cyan: map.get('Ansi 6 Color') ?? '#8be9fd',
    white: map.get('Ansi 7 Color') ?? '#f8f8f2',
    brightBlack: map.get('Ansi 8 Color') ?? '#6272a4',
    brightRed: map.get('Ansi 9 Color') ?? '#ff6e6e',
    brightGreen: map.get('Ansi 10 Color') ?? '#69ff94',
    brightYellow: map.get('Ansi 11 Color') ?? '#ffffa5',
    brightBlue: map.get('Ansi 12 Color') ?? '#d6acff',
    brightMagenta: map.get('Ansi 13 Color') ?? '#ff92df',
    brightCyan: map.get('Ansi 14 Color') ?? '#a4ffff',
    brightWhite: map.get('Ansi 15 Color') ?? '#ffffff',
  };

  return buildThemeObject(hintName || 'iTerm2 Imported', colors);
}

/**
 * Converte temas do Alacritty em TOML ou YAML para ThemeConfig.
 */
function parseAlacritty(rawText: string, hintName?: string): ThemeConfig | null {
  if (!rawText.includes('colors') && !rawText.includes('primary') && !rawText.includes('background')) {
    return null;
  }

  const sections: Record<string, Record<string, string>> = {};
  let currentSection = 'root';

  const lines = rawText.split(/\r?\n/);
  for (const rawLine of lines) {
    const noComment = rawLine.replace(/#.*$/, (match, offset, full) => {
      const before = full.slice(0, offset);
      // Preserva hex (#ffffff) dentro de aspas ou após : / =
      if (/[:=]\s*['"]?$/.test(before)) return match;
      return '';
    });
    const line = noComment.trim();
    if (!line) continue;

    // Cabeçalho TOML: [colors.primary]
    const tomlHeader = line.match(/^\[([^\]]+)\]$/);
    if (tomlHeader) {
      currentSection = tomlHeader[1].trim();
      sections[currentSection] ??= {};
      continue;
    }

    // Cabeçalho YAML: primary:, normal:, bright:, cursor:, selection:
    const yamlHeader = line.match(/^(colors|primary|normal|bright|cursor|selection):$/);
    if (yamlHeader) {
      currentSection = yamlHeader[1] === 'colors' ? 'colors' : `colors.${yamlHeader[1]}`;
      sections[currentSection] ??= {};
      continue;
    }

    // Par chave = valor (TOML) ou chave: valor (YAML)
    const kv = line.match(/^([a-zA-Z0-9_]+)\s*[:=]\s*(.+)$/);
    if (kv) {
      const key = kv[1].trim();
      const val = kv[2].trim().replace(/,$/, '');
      sections[currentSection] ??= {};
      sections[currentSection][key] = val;
    }
  }

  const primary = sections['colors.primary'] ?? sections['primary'] ?? {};
  const normal = sections['colors.normal'] ?? sections['normal'] ?? {};
  const bright = sections['colors.bright'] ?? sections['bright'] ?? {};
  const cursorSec = sections['colors.cursor'] ?? sections['cursor'] ?? {};
  const selectionSec = sections['colors.selection'] ?? sections['selection'] ?? {};

  if (!primary.background && !normal.black) {
    return null;
  }

  const bg = normalizeColor(primary.background, '#0b0716');
  const fg = normalizeColor(primary.foreground, '#eef2ff');

  const colors: ThemeColors = {
    background: bg,
    foreground: fg,
    cursor: normalizeColor(cursorSec.cursor, '#ff2a85'),
    cursorAccent: normalizeColor(cursorSec.text, bg),
    selectionBackground: normalizeColor(selectionSec.background, 'rgba(255,42,133,0.3)'),
    black: normalizeColor(normal.black, '#11111b'),
    red: normalizeColor(normal.red, '#ff5555'),
    green: normalizeColor(normal.green, '#50fa7b'),
    yellow: normalizeColor(normal.yellow, '#f1fa8c'),
    blue: normalizeColor(normal.blue, '#89b4fa'),
    magenta: normalizeColor(normal.magenta, '#ff79c6'),
    cyan: normalizeColor(normal.cyan, '#8be9fd'),
    white: normalizeColor(normal.white, '#f8f8f2'),
    brightBlack: normalizeColor(bright.black, '#6272a4'),
    brightRed: normalizeColor(bright.red, '#ff6e6e'),
    brightGreen: normalizeColor(bright.green, '#69ff94'),
    brightYellow: normalizeColor(bright.yellow, '#ffffa5'),
    brightBlue: normalizeColor(bright.blue, '#a4c8ff'),
    brightMagenta: normalizeColor(bright.magenta, '#ff92df'),
    brightCyan: normalizeColor(bright.cyan, '#a4ffff'),
    brightWhite: normalizeColor(bright.white, '#ffffff'),
  };

  return buildThemeObject(hintName || 'Alacritty Imported', colors);
}

/**
 * Tenta detectar e importar automaticamente temas do Windows Terminal (JSON),
 * iTerm2 (.itermcolors XML) ou Alacritty (TOML / YAML).
 */
export function importExternalTheme(rawText: string, fileName?: string): ThemeConfig | null {
  const hint = fileName ? fileName.replace(/\.[^.]+$/, '') : undefined;
  return (
    parseWindowsTerminal(rawText) ??
    parseIterm2(rawText, hint) ??
    parseAlacritty(rawText, hint)
  );
}

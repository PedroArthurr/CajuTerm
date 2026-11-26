
let altRightDown = false;
if (typeof window !== 'undefined') {
  const track = (ev: KeyboardEvent) => {
    if (ev.code === 'AltRight') altRightDown = ev.type === 'keydown';
  };
  window.addEventListener('keydown', track, true);
  window.addEventListener('keyup', track, true);
  window.addEventListener('blur', () => {
    altRightDown = false;
  });
}
/**
 * Casamento de atalhos por tecla FÍSICA (KeyboardEvent.code), independente do layout.
 * Mantém o formato de string do config ("Ctrl+Shift+T", "Ctrl+,", "Alt+ArrowLeft"...).
 *
 * Motivo: no ABNT2, Ctrl+Alt equivale a AltGr para geração de caracteres —
 * Ctrl+Alt+1 chega com ev.key '¹' e Ctrl+Shift+, chega como '<'. Comparar ev.code
 * resolve ambos.
 */

const NAMED_CODES: Record<string, string[]> = {
  '`': ['Backquote'],
  backquote: ['Backquote'],
  grave: ['Backquote'],
  ',': ['Comma'],
  comma: ['Comma'],
  '.': ['Period'],
  period: ['Period'],
  '/': ['Slash', 'IntlRo', 'NumpadDivide'],
  slash: ['Slash', 'IntlRo'],
  ';': ['Semicolon'],
  semicolon: ['Semicolon'],
  "'": ['Quote'],
  quote: ['Quote'],
  '[': ['BracketLeft'],
  bracketleft: ['BracketLeft'],
  ']': ['BracketRight'],
  bracketright: ['BracketRight'],
  '\\': ['Backslash', 'IntlBackslash'],
  backslash: ['Backslash', 'IntlBackslash'],
  '-': ['Minus', 'NumpadSubtract'],
  minus: ['Minus', 'NumpadSubtract'],
  '=': ['Equal'],
  equal: ['Equal'],
  plus: ['Equal', 'NumpadAdd'],
  space: ['Space'],
  tab: ['Tab'],
  enter: ['Enter', 'NumpadEnter'],
  return: ['Enter', 'NumpadEnter'],
  escape: ['Escape'],
  esc: ['Escape'],
  backspace: ['Backspace'],
  delete: ['Delete'],
  del: ['Delete'],
  insert: ['Insert'],
  home: ['Home'],
  end: ['End'],
  pageup: ['PageUp'],
  pagedown: ['PageDown'],
  arrowleft: ['ArrowLeft'],
  left: ['ArrowLeft'],
  arrowright: ['ArrowRight'],
  right: ['ArrowRight'],
  arrowup: ['ArrowUp'],
  up: ['ArrowUp'],
  arrowdown: ['ArrowDown'],
  down: ['ArrowDown'],
};

interface ParsedCombo {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  codes: string[];
  /** true quando o nome foi traduzido para codes conhecidos (sem fallback por ev.key). */
  mapped: boolean;
  /** Fallback textual (ev.key) para nomes não mapeados. */
  keyName: string;
}

const parseCache = new Map<string, ParsedCombo | null>();

function keyNameToCodes(name: string): string[] | null {
  const lower = name.toLowerCase();
  if (/^[a-z]$/.test(lower)) return [`Key${lower.toUpperCase()}`];
  if (/^[0-9]$/.test(lower)) return [`Digit${lower}`, `Numpad${lower}`];
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) return [lower.toUpperCase()];
  return NAMED_CODES[lower] ?? NAMED_CODES[name] ?? null;
}

function parseCombo(combo: string): ParsedCombo | null {
  const cached = parseCache.get(combo);
  if (cached !== undefined) return cached;

  const trimmed = combo.trim();
  if (!trimmed) {
    parseCache.set(combo, null);
    return null;
  }
  // "Ctrl++" → última parte é '+'
  const rawParts = trimmed.split('+').map((p) => p.trim());
  let mainKey = rawParts[rawParts.length - 1];
  let mods = rawParts.slice(0, -1);
  if (mainKey === '' && rawParts.length >= 2) {
    mainKey = '+';
    mods = rawParts.slice(0, -2);
  }
  const lowerMods = mods.map((m) => m.toLowerCase());
  const parsed: ParsedCombo = {
    ctrl: lowerMods.some((m) => m === 'ctrl' || m === 'control' || m === 'commandorcontrol' || m === 'cmdorctrl'),
    shift: lowerMods.includes('shift'),
    alt: lowerMods.includes('alt') || lowerMods.includes('option'),
    codes: [],
    mapped: false,
    keyName: mainKey.toLowerCase(),
  };
  const mapped = mainKey === '+' ? ['Equal', 'NumpadAdd'] : keyNameToCodes(mainKey);
  if (mapped) {
    parsed.codes = mapped;
    parsed.mapped = true;
  } else {
    // Permite nomes de code crus no config ("KeyQ", "Digit1", "Numpad5"...)
    parsed.codes = [mainKey];
  }
  parseCache.set(combo, parsed);
  return parsed;
}

export function matchesShortcut(ev: KeyboardEvent, combo: string): boolean {
  const parsed = parseCombo(combo);
  if (!parsed) return false;

  if (ev.ctrlKey !== parsed.ctrl) return false;
  if (ev.shiftKey !== parsed.shift) return false;
  if (ev.altKey !== parsed.alt) return false;

  // AltGr real (Alt direito) gera Ctrl+Alt no Windows: não engole caracteres digitados.
  // getModifierState('AltGraph') não distingue Ctrl+Alt esquerdo de AltGr no Chromium/Windows,
  // então decide pela tecla física (AltRight) rastreada globalmente.
  if (parsed.ctrl && parsed.alt && altRightDown) return false;

  const code = (ev.code || '').toLowerCase();
  if (code && parsed.codes.some((c) => c.toLowerCase() === code)) return true;
  // Nomes mapeados casam só por tecla física; nomes livres (ex.: "ç") caem no ev.key
  if (parsed.mapped && code) return false;
  return (ev.key || '').toLowerCase() === parsed.keyName;
}

const DISPLAY_NAMES: Record<string, string> = {
  commandorcontrol: 'Ctrl',
  cmdorctrl: 'Ctrl',
  control: 'Ctrl',
  ctrl: 'Ctrl',
  shift: 'Shift',
  alt: 'Alt',
  option: 'Alt',
  backquote: '`',
  grave: '`',
  comma: ',',
  period: '.',
  slash: '/',
  semicolon: ';',
  quote: "'",
  bracketleft: '[',
  bracketright: ']',
  backslash: '\\',
  minus: '-',
  equal: '=',
  plus: '+',
  arrowleft: '←',
  left: '←',
  arrowright: '→',
  right: '→',
  arrowup: '↑',
  up: '↑',
  arrowdown: '↓',
  down: '↓',
  escape: 'Esc',
  esc: 'Esc',
  pageup: 'PgUp',
  pagedown: 'PgDn',
  space: 'Space',
  tab: 'Tab',
  enter: 'Enter',
  return: 'Enter',
  delete: 'Del',
  del: 'Del',
};

/** "CommandOrControl+Backquote" → "Ctrl+`", "Alt+ArrowLeft" → "Alt+←". */
export function formatShortcut(combo: string | undefined | null): string {
  if (!combo || !combo.trim()) return '';
  const parts = combo.trim().split('+').map((p) => p.trim());
  if (parts.length >= 2 && parts[parts.length - 1] === '') {
    parts.splice(parts.length - 2, 2, '+');
  }
  return parts
    .map((p) => {
      const lower = p.toLowerCase();
      if (DISPLAY_NAMES[lower]) return DISPLAY_NAMES[lower];
      if (/^key[a-z]$/.test(lower)) return lower.slice(3).toUpperCase();
      if (/^digit[0-9]$/.test(lower)) return lower.slice(5);
      if (p.length === 1) return p.toUpperCase();
      return p;
    })
    .join('+');
}

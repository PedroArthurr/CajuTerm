import type { AppSettings, ThemeConfig } from './types';

export const BUILTIN_THEMES: ThemeConfig[] = [
  {
    id: 'caju-cyberpunk',
    name: 'Caju Cyberpunk',
    category: 'Neon',
    accent: '#ff2a85',
    accentSecondary: '#00f0ff',
    uiSurface: 'rgba(15, 10, 30, 0.78)',
    uiBorder: 'rgba(255, 42, 133, 0.42)',
    colors: {
      background: '#0b0716',
      foreground: '#eef2ff',
      cursor: '#ff2a85',
      cursorAccent: '#0b0716',
      selectionBackground: 'rgba(255, 42, 133, 0.34)',
      black: '#130d24',
      red: '#ff2a85',
      green: '#18ff9c',
      yellow: '#ff9f1c',
      blue: '#3d8bfd',
      magenta: '#c77dff',
      cyan: '#00f0ff',
      white: '#e2e8f0',
      brightBlack: '#5b527a',
      brightRed: '#ff5ca8',
      brightGreen: '#5cffb8',
      brightYellow: '#ffc15e',
      brightBlue: '#70a9ff',
      brightMagenta: '#e0aaff',
      brightCyan: '#6ef7ff',
      brightWhite: '#ffffff',
    },
  },
  {
    id: 'synthwave-outrun',
    name: 'Synthwave Outrun',
    category: 'Neon',
    accent: '#ff7edb',
    accentSecondary: '#36f9f6',
    uiSurface: 'rgba(24, 16, 44, 0.80)',
    uiBorder: 'rgba(54, 249, 246, 0.38)',
    colors: {
      background: '#161129',
      foreground: '#f4eeff',
      cursor: '#ff7edb',
      cursorAccent: '#161129',
      selectionBackground: 'rgba(255, 126, 219, 0.32)',
      black: '#1e1638',
      red: '#fe4450',
      green: '#72f1b8',
      yellow: '#fede5d',
      blue: '#03edf9',
      magenta: '#ff7edb',
      cyan: '#36f9f6',
      white: '#f4eeff',
      brightBlack: '#6c5d99',
      brightRed: '#ff6e78',
      brightGreen: '#97ffd1',
      brightYellow: '#fff192',
      brightBlue: '#63f5ff',
      brightMagenta: '#ffa6e8',
      brightCyan: '#8afcf9',
      brightWhite: '#ffffff',
    },
  },
  {
    id: 'matrix-phosphor',
    name: 'Matrix Phosphor',
    category: 'Neon',
    accent: '#00ff66',
    accentSecondary: '#66ffaa',
    uiSurface: 'rgba(4, 16, 8, 0.84)',
    uiBorder: 'rgba(0, 255, 102, 0.36)',
    colors: {
      background: '#030b05',
      foreground: '#b8ffce',
      cursor: '#00ff66',
      cursorAccent: '#030b05',
      selectionBackground: 'rgba(0, 255, 102, 0.28)',
      black: '#081c0d',
      red: '#ff4d6d',
      green: '#00ff66',
      yellow: '#b7ff4a',
      blue: '#00d48f',
      magenta: '#4dffb8',
      cyan: '#00ffc8',
      white: '#b8ffce',
      brightBlack: '#28663a',
      brightRed: '#ff758f',
      brightGreen: '#5cff9d',
      brightYellow: '#d4ff80',
      brightBlue: '#42f5b9',
      brightMagenta: '#85ffd0',
      brightCyan: '#66ffe0',
      brightWhite: '#e8fff0',
    },
  },
  {
    id: 'amber-crt-1984',
    name: 'Amber CRT 1984',
    category: 'Retro',
    accent: '#ff9e00',
    accentSecondary: '#ffd166',
    uiSurface: 'rgba(22, 13, 4, 0.86)',
    uiBorder: 'rgba(255, 158, 0, 0.38)',
    colors: {
      background: '#120a02',
      foreground: '#ffcb77',
      cursor: '#ff9e00',
      cursorAccent: '#120a02',
      selectionBackground: 'rgba(255, 158, 0, 0.32)',
      black: '#241404',
      red: '#ff5e3a',
      green: '#c4b23b',
      yellow: '#ff9e00',
      blue: '#d9822b',
      magenta: '#e86f52',
      cyan: '#f4b942',
      white: '#ffcb77',
      brightBlack: '#7a4e1d',
      brightRed: '#ff8266',
      brightGreen: '#e3d26b',
      brightYellow: '#ffc145',
      brightBlue: '#f2a65a',
      brightMagenta: '#ff9b82',
      brightCyan: '#ffd97d',
      brightWhite: '#fff0d1',
    },
  },
  {
    id: 'tokyo-night-glass',
    name: 'Tokyo Night Glass',
    category: 'Dark',
    accent: '#7aa2f7',
    accentSecondary: '#bb9af7',
    uiSurface: 'rgba(22, 24, 36, 0.80)',
    uiBorder: 'rgba(122, 162, 247, 0.34)',
    colors: {
      background: '#131522',
      foreground: '#c0caf5',
      cursor: '#7aa2f7',
      cursorAccent: '#131522',
      selectionBackground: 'rgba(122, 162, 247, 0.28)',
      black: '#15161e',
      red: '#f7768e',
      green: '#9ece6a',
      yellow: '#e0af68',
      blue: '#7aa2f7',
      magenta: '#bb9af7',
      cyan: '#7dcfff',
      white: '#a9b1d6',
      brightBlack: '#414868',
      brightRed: '#ff899d',
      brightGreen: '#b9f27c',
      brightYellow: '#ffca85',
      brightBlue: '#8db2ff',
      brightMagenta: '#d2b8ff',
      brightCyan: '#a4e5ff',
      brightWhite: '#e0e7ff',
    },
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    category: 'Minimal',
    accent: '#cba6f7',
    accentSecondary: '#f5c2e7',
    uiSurface: 'rgba(24, 24, 37, 0.84)',
    uiBorder: 'rgba(203, 166, 247, 0.30)',
    colors: {
      background: '#181825',
      foreground: '#cdd6f4',
      cursor: '#f5e0dc',
      cursorAccent: '#181825',
      selectionBackground: 'rgba(203, 166, 247, 0.28)',
      black: '#45475a',
      red: '#f38ba8',
      green: '#a6e3a1',
      yellow: '#f9e2af',
      blue: '#89b4fa',
      magenta: '#f5c2e7',
      cyan: '#94e2d5',
      white: '#bac2de',
      brightBlack: '#585b70',
      brightRed: '#f38ba8',
      brightGreen: '#a6e3a1',
      brightYellow: '#f9e2af',
      brightBlue: '#89b4fa',
      brightMagenta: '#f5c2e7',
      brightCyan: '#94e2d5',
      brightWhite: '#a6adc8',
    },
  },
];

export function DEFAULT_SETTINGS(): AppSettings {
  return {
    language: 'pt-BR',
    theme: 'caju-cyberpunk',
    defaultProfile: 'pwsh',
    fontFamily: "'JetBrainsMono Nerd Font', 'Cascadia Code NF', 'Cascadia Mono', Consolas, monospace",
    fontSize: 14,
    lineHeight: 1.24,
    ligatures: true,
    scrollback: 10000,
    opacity: 0.86,
    blur: 14,
    vibrancy: 'acrylic',
    alwaysOnTop: false,
    background: {
      mode: 'gradient',
      gradient:
        'radial-gradient(circle at 18% 15%, rgba(255,42,133,0.18), transparent 45%), radial-gradient(circle at 82% 82%, rgba(0,240,255,0.14), transparent 50%)',
      mediaDataUrl: '',
      mediaName: '',
      mediaOpacity: 0.35,
      mediaBlur: 2,
    },
    shaders: {
      enabled: true,
      scanlines: true,
      scanlinesIntensity: 0.18,
      curvature: true,
      curvatureIntensity: 0.12,
      bloom: true,
      bloomIntensity: 0.35,
      chromaticAberration: true,
      chromaticIntensity: 0.15,
      noise: true,
      noiseIntensity: 0.06,
      flicker: true,
      flickerIntensity: 0.04,
    },
    cursor: {
      style: 'block',
      blink: true,
      pulse: true,
      trail: true,
      trailColor: '#00f0ff',
      color: '#ff2a85',
    },
    animations: {
      themeTransitionMs: 360,
      tabFade: true,
      typingParticles: true,
      particleCount: 7,
    },
    sounds: {
      enabled: true,
      preset: 'cyberpunk',
      volume: 0.55,
      messageEnd: true,
      idleThresholdMs: 1100,
      bell: true,
      errorAlert: true,
      reactions: true,
      typingTick: false,
      snippetSend: true,
    },
    confirmClear: true,
    activeSnippetAgent: 'agy',
    snippetUsage: {},
    customSnippets: [],
    profiles: [
      {
        id: 'pwsh',
        name: 'PowerShell (Auto)',
        shell: 'auto',
        args: ['-NoLogo'],
        cwd: '~',
        themeId: null,
        env: {},
        shortcut: 'Ctrl+Alt+1',
      },
      {
        id: 'powershell5',
        name: 'Windows PowerShell 5.1',
        shell: 'powershell.exe',
        args: ['-NoLogo'],
        cwd: '~',
        themeId: 'tokyo-night-glass',
        env: {},
        shortcut: 'Ctrl+Alt+2',
      },
      {
        id: 'cmd',
        name: 'Prompt de Comando (CMD)',
        shell: 'cmd.exe',
        args: [],
        cwd: '~',
        themeId: 'amber-crt-1984',
        env: {},
        shortcut: 'Ctrl+Alt+3',
      },
      {
        id: 'wsl',
        name: 'WSL (Linux)',
        shell: 'wsl.exe',
        args: [],
        cwd: '~',
        themeId: 'matrix-phosphor',
        env: {},
        shortcut: 'Ctrl+Alt+4',
      },
    ],
    keybindings: {
      newTab: 'Ctrl+Shift+T',
      closeTab: 'Ctrl+Shift+W',
      nextTab: 'Ctrl+Tab',
      prevTab: 'Ctrl+Shift+Tab',
      splitVertical: 'Alt+Shift+D',
      splitHorizontal: 'Alt+Shift+E',
      closePane: 'Alt+Shift+W',
      focusLeft: 'Alt+ArrowLeft',
      focusRight: 'Alt+ArrowRight',
      focusUp: 'Alt+ArrowUp',
      focusDown: 'Alt+ArrowDown',
      find: 'Ctrl+Shift+F',
      commandPalette: 'Ctrl+Shift+P',
      openSettings: 'Ctrl+,',
      toggleAlwaysOnTop: 'Ctrl+Shift+A',
      quakeGlobal: 'CommandOrControl+Backquote',
    },
  };
}

export function hexToRgbTuple(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16) || 11;
    const g = parseInt(clean[1] + clean[1], 16) || 7;
    const b = parseInt(clean[2] + clean[2], 16) || 22;
    return [r, g, b];
  }
  if (clean.length >= 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return [
      Number.isFinite(r) ? r : 11,
      Number.isFinite(g) ? g : 7,
      Number.isFinite(b) ? b : 22,
    ];
  }
  return [11, 7, 22];
}

export function hexToNormalizedRgb(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgbTuple(hex);
  return [r / 255, g / 255, b / 255];
}

export function applyThemeCssVariables(theme: ThemeConfig, settings: AppSettings): void {
  const root = document.documentElement;
  const [r, g, b] = hexToRgbTuple(theme.colors.background);
  const alpha = Math.max(0.15, Math.min(1, settings.opacity));

  root.style.setProperty('--caju-theme-transition', `${settings.animations.themeTransitionMs}ms`);
  root.style.setProperty('--caju-bg', theme.colors.background);
  root.style.setProperty('--caju-bg-rgba', `rgba(${r}, ${g}, ${b}, ${alpha})`);
  root.style.setProperty('--caju-fg', theme.colors.foreground);
  root.style.setProperty('--caju-accent', theme.accent);
  root.style.setProperty('--caju-accent-2', theme.accentSecondary);
  root.style.setProperty('--caju-surface', theme.uiSurface);
  root.style.setProperty('--caju-border', theme.uiBorder);
  root.style.setProperty('--caju-blur', `${settings.blur}px`);
  root.style.setProperty('--caju-font', settings.fontFamily);
  root.style.setProperty('--caju-cursor-color', settings.cursor.color || theme.colors.cursor);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function createColorSwatchDot(color: string, size = 16): HTMLSpanElement {
  const dot = document.createElement('span');
  dot.className = 'swatch-dot';
  dot.title = color;
  dot.style.backgroundColor = color;
  dot.style.width = `${size}px`;
  dot.style.height = `${size}px`;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'swatch-svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');

  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('cx', '8');
  circle.setAttribute('cy', '8');
  circle.setAttribute('r', '6.5');
  circle.setAttribute('fill', color);
  circle.setAttribute('stroke', 'rgba(255,255,255,0.35)');
  circle.setAttribute('stroke-width', '1.2');

  svg.appendChild(circle);
  dot.appendChild(svg);
  return dot;
}

export function createThemePreviewStrip(theme: ThemeConfig): SVGSVGElement {
  const palette = [
    theme.colors.background,
    theme.colors.foreground,
    theme.accent,
    theme.accentSecondary,
    theme.colors.red,
    theme.colors.green,
    theme.colors.yellow,
    theme.colors.cyan,
  ];
  const width = palette.length * 24;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'theme-preview-strip');
  svg.setAttribute('viewBox', `0 0 ${width} 8`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');

  palette.forEach((color, idx) => {
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(idx * 24));
    rect.setAttribute('y', '0');
    rect.setAttribute('width', '24');
    rect.setAttribute('height', '8');
    rect.setAttribute('fill', color);
    svg.appendChild(rect);
  });

  return svg;
}

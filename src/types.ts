export type SupportedLanguage = 'pt-BR' | 'en-US' | 'es-ES';

export interface ThemeColors {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface ThemeConfig {
  id: string;
  name: string;
  category: string;
  accent: string;
  accentSecondary: string;
  uiSurface: string;
  uiBorder: string;
  colors: ThemeColors;
}

export interface BackgroundConfig {
  mode: 'solid' | 'gradient' | 'image' | 'video';
  gradient: string;
  mediaDataUrl: string;
  mediaName: string;
  mediaOpacity: number;
  mediaBlur: number;
}

export interface ShaderConfig {
  enabled: boolean;
  scanlines: boolean;
  scanlinesIntensity: number;
  curvature: boolean;
  curvatureIntensity: number;
  bloom: boolean;
  bloomIntensity: number;
  chromaticAberration: boolean;
  chromaticIntensity: number;
  noise: boolean;
  noiseIntensity: number;
  flicker: boolean;
  flickerIntensity: number;
}

export interface CursorConfig {
  style: 'block' | 'bar' | 'underline';
  blink: boolean;
  pulse: boolean;
  trail: boolean;
  trailColor: string;
  color: string;
}

export interface AnimationConfig {
  themeTransitionMs: number;
  tabFade: boolean;
  typingParticles: boolean;
  particleCount: number;
}

export type SoundPreset = 'cyberpunk' | 'arcade' | 'minimal' | 'scifi';

export interface SoundConfig {
  enabled: boolean;
  preset: SoundPreset;
  volume: number;
  messageEnd: boolean;
  idleThresholdMs: number;
  bell: boolean;
  errorAlert: boolean;
  reactions: boolean;
  typingTick: boolean;
  snippetSend: boolean;
}

export type SnippetAgent = 'agy' | 'claude' | 'both';

export interface SnippetItem {
  id: string;
  label: string;
  command: string;
  category: string;
  description: string;
  agent?: SnippetAgent;
  aliases?: string[];
  autoEnter?: boolean;
  confirm?: boolean;
}

export interface ProfileConfig {
  id: string;
  name: string;
  shell: string;
  args: string[];
  cwd: string;
  themeId: string | null;
  env: Record<string, string>;
  shortcut: string;
}

export interface KeybindingsConfig {
  newTab: string;
  closeTab: string;
  nextTab: string;
  prevTab: string;
  splitVertical: string;
  splitHorizontal: string;
  closePane: string;
  focusLeft: string;
  focusRight: string;
  focusUp: string;
  focusDown: string;
  find: string;
  commandPalette: string;
  openSettings: string;
  toggleAlwaysOnTop: string;
  quakeGlobal: string;
}

export interface AppSettings {
  language: SupportedLanguage | string;
  theme: string;
  defaultProfile: string;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  ligatures: boolean;
  scrollback: number;
  opacity: number;
  blur: number;
  vibrancy: 'acrylic' | 'mica' | 'none';
  alwaysOnTop: boolean;
  background: BackgroundConfig;
  shaders: ShaderConfig;
  cursor: CursorConfig;
  animations: AnimationConfig;
  sounds: SoundConfig;
  confirmClear: boolean;
  /** Copia automaticamente o texto selecionado no terminal. */
  copyOnSelect: boolean;
  /** Pastas exibidas no menu de atalhos de pastas (📁) e na paleta. */
  quickPaths: string[];
  activeSnippetAgent?: 'agy' | 'claude';
  snippetUsage?: Record<string, number>;
  customSnippets: SnippetItem[];
  profiles: ProfileConfig[];
  keybindings: KeybindingsConfig;
}

export interface FontAsset {
  family: string;
  fileName: string;
  dataUrl: string;
}

export interface ConfigBundle {
  configDir: string;
  settings: AppSettings;
  rawSettingsJson: string;
  customCss: string;
  themes: ThemeConfig[];
  fonts: FontAsset[];
  /** Presente apenas quando settings.json falhou ao ser lido (backend manteve o último válido). */
  settingsError?: string;
}

export interface CursorScreenPos {
  x: number;
  y: number;
  cellWidth: number;
  cellHeight: number;
  containerLeft: number;
  containerTop: number;
  containerWidth: number;
  containerHeight: number;
}

export interface QuickPathEntry {
  label: string;
  path: string;
  group: string;
}

import './styles/main.css';

import { CursorFxLayer } from './fx/cursor-fx';
import { ShaderOverlay } from './fx/shader-overlay';
import { REACTION_ITEMS, SoundFxEngine, type ReactionKind } from './fx/sound-fx';
import { t } from './i18n';
import {
  getAllSnippets,
  getSnippetAgent,
  getSnippetsForAgent,
  matchesSnippetQuery,
  sortSnippetsByUsage,
} from './snippets';
import {
  applyWindowVibrancy,
  getConfigBundle,
  listQuickPaths,
  onConfigReloaded,
  onPtyExit,
  onPtyOutput,
  saveSettings,
  toggleQuakeMode,
  windowClose,
  windowMinimize,
  windowSetAlwaysOnTop,
  windowStartDragging,
  windowToggleMaximize,
} from './terminal/pty-bridge';
import { WorkspaceManager } from './terminal/workspace';
import { applyThemeCssVariables, BUILTIN_THEMES, hexToRgbTuple } from './themes';
import type {
  AppSettings,
  ConfigBundle,
  FontAsset,
  QuickPathEntry,
  SnippetItem,
  SoundPreset,
  ThemeConfig,
} from './types';
import { CommandPalette, type PaletteCommand } from './ui/command-palette';
import { SettingsModal } from './ui/settings-modal';

const loadedFontKeys = new Set<string>();

async function loadUserFonts(fonts: FontAsset[]): Promise<void> {
  for (const font of fonts) {
    const cacheKey = `${font.family}::${font.fileName}`;
    if (loadedFontKeys.has(cacheKey)) continue;
    try {
      const face = new FontFace(font.family, `url("${font.dataUrl}")`);
      await face.load();
      document.fonts.add(face);
      loadedFontKeys.add(cacheKey);
    } catch (err) {
      console.warn(`Não foi possível carregar fonte ${font.fileName}:`, err);
    }
  }
}

function matchesShortcut(ev: KeyboardEvent, combo: string): boolean {
  if (!combo.trim()) return false;
  const parts = combo.split('+').map((p) => p.trim().toLowerCase());
  const mainKey = parts[parts.length - 1];

  const needCtrl = parts.includes('ctrl') || parts.includes('control') || parts.includes('commandorcontrol');
  const needShift = parts.includes('shift');
  const needAlt = parts.includes('alt');

  if (ev.ctrlKey !== needCtrl) return false;
  if (ev.shiftKey !== needShift) return false;
  if (ev.altKey !== needAlt) return false;

  const evKey = ev.key.toLowerCase();
  if (mainKey === 'backquote' || mainKey === '`') {
    return ev.code === 'Backquote' || evKey === '`';
  }
  if (mainKey === 'tab') return evKey === 'tab';
  if (mainKey === ',') return evKey === ',';
  return evKey === mainKey || ev.code.toLowerCase() === mainKey;
}

function applyBackgroundLayer(settings: AppSettings): void {
  const mediaSlot = document.getElementById('bg-media-slot');
  const tintOverlay = document.getElementById('bg-tint-overlay');
  if (!mediaSlot || !tintOverlay) return;

  const bg = settings.background;
  tintOverlay.style.background = '';

  const nextKey =
    (bg.mode === 'image' || bg.mode === 'video') && bg.mediaDataUrl
      ? `${bg.mode}|${bg.mediaDataUrl}`
      : '';

  if (bg.mode === 'gradient') {
    if (mediaSlot.dataset.mediaKey) {
      mediaSlot.innerHTML = '';
      mediaSlot.dataset.mediaKey = '';
    }
    tintOverlay.style.background = bg.gradient;
    return;
  }

  if (nextKey) {
    let el = mediaSlot.firstElementChild as HTMLImageElement | HTMLVideoElement | null;
    if (mediaSlot.dataset.mediaKey !== nextKey || !el) {
      mediaSlot.innerHTML = '';
      el =
        bg.mode === 'video'
          ? Object.assign(document.createElement('video'), {
              src: bg.mediaDataUrl,
              autoplay: true,
              loop: true,
              muted: true,
              playsInline: true,
            })
          : Object.assign(document.createElement('img'), {
              src: bg.mediaDataUrl,
              alt: bg.mediaName || 'Fundo',
            });
      mediaSlot.dataset.mediaKey = nextKey;
      mediaSlot.appendChild(el);
    }
    el.style.opacity = String(bg.mediaOpacity);
    el.style.filter = bg.mediaBlur > 0 ? `blur(${bg.mediaBlur}px)` : '';
  } else if (mediaSlot.dataset.mediaKey || mediaSlot.childElementCount > 0) {
    mediaSlot.innerHTML = '';
    mediaSlot.dataset.mediaKey = '';
  }
}

function applyCustomCss(css: string): void {
  const styleEl = document.getElementById('user-custom-css');
  if (styleEl) {
    styleEl.textContent = css;
  }
}

async function bootstrap(): Promise<void> {
  let bundle: ConfigBundle = await getConfigBundle();
  let quickPaths: QuickPathEntry[] = await listQuickPaths().catch(() => []);
  await loadUserFonts(bundle.fonts);

  const stageEl = document.getElementById('workspace-container')!;
  const tabsBarEl = document.getElementById('tabs-bar')!;
  const shaderCanvas = document.getElementById('shader-fx-canvas') as HTMLCanvasElement;
  const cursorCanvas = document.getElementById('cursor-fx-canvas') as HTMLCanvasElement;
  const searchBar = document.getElementById('search-bar')!;
  const searchInput = document.getElementById('search-input') as HTMLInputElement;
  const searchCase = document.getElementById('search-case') as HTMLInputElement;
  const searchRegex = document.getElementById('search-regex') as HTMLInputElement;
  const statusFps = document.getElementById('status-fps')!;
  const statusSound = document.getElementById('status-sound')!;
  const statusEffects = document.getElementById('status-effects')!;
  const statusProfile = document.getElementById('status-profile')!;
  const statusDims = document.getElementById('status-dims')!;
  const statusTheme = document.getElementById('status-theme')!;
  const btnAlwaysOnTop = document.getElementById('btn-always-on-top')!;
  const confirmRoot = document.getElementById('confirm-root')!;

  const resolveTheme = (settings: AppSettings, themes: ThemeConfig[]): ThemeConfig => {
    return (
      themes.find((th) => th.id === settings.theme) ??
      themes[0] ??
      BUILTIN_THEMES[0]
    );
  };

  const shaderOverlay = new ShaderOverlay(shaderCanvas, bundle.settings.shaders, (fps) => {
    statusFps.textContent = `${fps} FPS`;
  });
  const cursorFx = new CursorFxLayer(
    cursorCanvas,
    bundle.settings.cursor,
    bundle.settings.animations
  );
  const soundFx = new SoundFxEngine(bundle.settings.sounds);

  let confirmActions: { confirm: () => void; cancel: () => void } | null = null;
  const isConfirmOpen = (): boolean => confirmActions !== null;

  const closeAllTitlebarDropdowns = (exceptId?: string): void => {
    const ids = ['profile-dropdown', 'paths-dropdown', 'snippets-dropdown', 'sounds-dropdown'];
    for (const id of ids) {
      if (id !== exceptId) {
        document.getElementById(id)?.classList.add('hidden');
      }
    }
  };

  const openConfirmModal = (opts: {
    title: string;
    message: string;
    commandPreview: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
    onCancel?: () => void;
  }): void => {
    confirmRoot.innerHTML = '';

    const backdrop = document.createElement('div');
    backdrop.className = 'confirm-backdrop';

    const box = document.createElement('div');
    box.className = 'confirm-box';

    const titleEl = document.createElement('h3');
    titleEl.className = 'confirm-title';
    titleEl.textContent = opts.title;

    const msgEl = document.createElement('p');
    msgEl.className = 'confirm-message';
    msgEl.textContent = opts.message;

    const codeEl = document.createElement('code');
    codeEl.className = 'confirm-code';
    codeEl.textContent = opts.commandPreview;

    const actions = document.createElement('div');
    actions.className = 'confirm-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-secondary';
    cancelBtn.textContent = opts.cancelLabel ?? 'Cancelar (Esc)';

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'btn-primary';
    okBtn.textContent = opts.confirmLabel ?? 'Executar (Enter)';

    const cleanup = (confirmed: boolean) => {
      confirmRoot.innerHTML = '';
      confirmActions = null;
      if (confirmed) {
        opts.onConfirm();
      } else {
        opts.onCancel?.();
      }
      workspace.getActivePane()?.focus();
    };

    confirmActions = {
      confirm: () => cleanup(true),
      cancel: () => cleanup(false),
    };

    backdrop.addEventListener('click', (ev) => {
      if (ev.target === backdrop) cleanup(false);
    });
    cancelBtn.addEventListener('click', () => cleanup(false));
    okBtn.addEventListener('click', () => cleanup(true));

    actions.append(cancelBtn, okBtn);
    box.append(titleEl, msgEl, codeEl, actions);
    backdrop.appendChild(box);
    confirmRoot.appendChild(backdrop);

    requestAnimationFrame(() => okBtn.focus());
  };

  const hasOpenOverlay = (): boolean => {
    const profileOpen = !document.getElementById('profile-dropdown')?.classList.contains('hidden');
    const pathsOpen = !document.getElementById('paths-dropdown')?.classList.contains('hidden');
    const snippetsOpen = !document.getElementById('snippets-dropdown')?.classList.contains('hidden');
    const soundsOpen = !document.getElementById('sounds-dropdown')?.classList.contains('hidden');
    const searchOpen = !searchBar.classList.contains('hidden');
    return (
      profileOpen ||
      pathsOpen ||
      snippetsOpen ||
      soundsOpen ||
      searchOpen ||
      palette.isPaletteOpen() ||
      settingsModal.isModalOpen() ||
      isConfirmOpen()
    );
  };

  const isAppShortcut = (ev: KeyboardEvent): boolean => {
    if (ev.type !== 'keydown') return false;
    if (ev.key === 'Escape' && hasOpenOverlay()) {
      return true;
    }
    const kb = bundle.settings.keybindings;
    const list = [
      kb.newTab,
      kb.closeTab,
      kb.nextTab,
      kb.prevTab,
      kb.splitVertical,
      kb.splitHorizontal,
      kb.closePane,
      kb.focusLeft,
      kb.focusRight,
      kb.focusUp,
      kb.focusDown,
      kb.find,
      kb.commandPalette,
      kb.openSettings,
      kb.toggleAlwaysOnTop,
      ...bundle.settings.profiles.map((p) => p.shortcut).filter(Boolean),
    ];
    return list.some((combo) => matchesShortcut(ev, combo));
  };

  const workspace = new WorkspaceManager(
    stageEl,
    tabsBarEl,
    bundle.settings,
    bundle.themes,
    {
      isAppShortcut,
      onActivePaneChanged: (pane) => {
        if (pane) {
          statusProfile.textContent = pane.profile.name;
          statusDims.textContent = `${pane.terminal.cols}×${pane.terminal.rows}`;
        }
      },
      onCursorMove: (pos) => {
        cursorFx.onCursorMoved(pos);
        shaderOverlay.setCursorPosition(pos);
      },
      onTyping: (pos) => {
        cursorFx.spawnTypingBurst(pos);
        soundFx.playTypingTick();
      },
      onDimensionsChange: (cols, rows) => {
        statusDims.textContent = `${cols}×${rows}`;
      },
      onTabsChanged: () => {},
      onMessageEnd: (pane) => {
        soundFx.playMessageEnd();
        if (workspace.getActivePane()?.paneId === pane.paneId) {
          cursorFx.spawnReactionBurst('✨', pane.getCursorScreenPos());
        }
      },
      onBell: (pane) => {
        soundFx.playBell();
        if (workspace.getActivePane()?.paneId === pane.paneId) {
          cursorFx.spawnReactionBurst('🔔', pane.getCursorScreenPos());
        }
      },
      onErrorDetected: (pane) => {
        soundFx.playErrorAlert();
        if (workspace.getActivePane()?.paneId === pane.paneId) {
          cursorFx.spawnReactionBurst('💥', pane.getCursorScreenPos());
        }
      },
      onConfirmCommand: (pane, rawInput, resolvedCommand) => {
        const diffNote =
          rawInput.toLowerCase() !== resolvedCommand.toLowerCase()
            ? ` (corrigindo "${rawInput}" para "${resolvedCommand}")`
            : '';
        openConfirmModal({
          title: 'Confirmar /clear',
          message: `Deseja limpar o terminal e resetar o contexto da conversa${diffNote}?`,
          commandPreview: resolvedCommand,
          onConfirm: () => {
            soundFx.playSnippetSend();
            pane.replaceCurrentLineAndRun(rawInput, resolvedCommand);
          },
        });
      },
    }
  );

  let activeSettings: AppSettings = bundle.settings;

  const updateCrtSafePadding = (settings: AppSettings): void => {
    const curvature =
      settings.shaders.enabled && settings.shaders.curvature
        ? Math.max(0, settings.shaders.curvatureIntensity)
        : 0;

    // Corresponde ao recuo geométrico exato de crtWarp() em crt.frag.glsl (1.15 / 3.4^2)
    const k = 1.15 / (3.4 * 3.4);
    const warpInset = curvature > 0.001
      ? 0.5 * ((k * curvature) / (1 + k * curvature)) + 0.006
      : 0;

    const padX = Math.round(8 + stageEl.clientWidth * warpInset);
    const padY = Math.round(8 + stageEl.clientHeight * warpInset);
    document.documentElement.style.setProperty('--caju-crt-pad-x', `${padX}px`);
    document.documentElement.style.setProperty('--caju-crt-pad-y', `${padY}px`);
  };

  const applyAllVisuals = (
    settings: AppSettings,
    themes: ThemeConfig[],
    customCss: string
  ): void => {
    activeSettings = settings;
    const theme = resolveTheme(settings, themes);
    applyThemeCssVariables(theme, settings);
    updateCrtSafePadding(settings);
    applyBackgroundLayer(settings);
    applyCustomCss(customCss);

    shaderOverlay.updateConfig(settings.shaders, theme);
    cursorFx.updateConfig(
      settings.cursor,
      settings.animations,
      theme.accent,
      theme.accentSecondary
    );
    soundFx.updateConfig(settings.sounds);

    workspace.updateConfig(settings, themes);
    requestAnimationFrame(() => workspace.fitAllVisible());

    const [r, g, b] = hexToRgbTuple(theme.colors.background);
    const alphaByte = Math.round(Math.max(0.15, Math.min(1, settings.opacity)) * 255);
    void applyWindowVibrancy(settings.vibrancy, [r, g, b, alphaByte]);
    void windowSetAlwaysOnTop(settings.alwaysOnTop);

    btnAlwaysOnTop.classList.toggle('active', settings.alwaysOnTop);
    statusTheme.textContent = theme.name;
    statusEffects.textContent = settings.shaders.enabled ? 'FX ON' : 'FX OFF';
    statusSound.textContent = settings.sounds.enabled ? 'SFX ON' : 'SFX MUTE';
    statusSound.classList.toggle('status-glow', settings.sounds.enabled);

    // Atualiza tooltips traduzidos
    const lang = settings.language;
    document.getElementById('btn-snippets-menu')?.setAttribute('title', t('btn.snippets', lang));
    document.getElementById('btn-sounds-menu')?.setAttribute('title', t('btn.sounds', lang));
    document.getElementById('btn-new-tab')?.setAttribute('title', t('btn.newTab', lang));
    document.getElementById('btn-split-v')?.setAttribute('title', t('btn.splitV', lang));
    document.getElementById('btn-split-h')?.setAttribute('title', t('btn.splitH', lang));
    document.getElementById('btn-search')?.setAttribute('title', t('btn.search', lang));
    document.getElementById('btn-palette')?.setAttribute('title', t('btn.palette', lang));
    btnAlwaysOnTop.setAttribute('title', t('btn.alwaysOnTop', lang));
    document.getElementById('btn-settings')?.setAttribute('title', t('btn.settings', lang));
    searchInput.placeholder = t('search.placeholder', lang);
  };

  const palette = new CommandPalette(document.getElementById('palette-root')!);

  type ActiveSnippetAgent = 'agy' | 'claude';
  type DockFilterMode = 'all' | 'cli' | 'slash';
  const STORAGE_AGENT_KEY = 'cajuterm:activeSnippetAgent';
  const STORAGE_USAGE_KEY = 'cajuterm:snippetUsage';

  const readStoredUsage = (): Record<string, number> => {
    try {
      const raw = localStorage.getItem(STORAGE_USAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
          out[k] = Math.floor(v);
        }
      }
      return out;
    } catch {
      return {};
    }
  };

  const readInitialAgent = (settings: AppSettings): ActiveSnippetAgent => {
    if (settings.activeSnippetAgent === 'agy' || settings.activeSnippetAgent === 'claude') {
      return settings.activeSnippetAgent;
    }
    try {
      return localStorage.getItem(STORAGE_AGENT_KEY) === 'claude' ? 'claude' : 'agy';
    } catch {
      return 'agy';
    }
  };

  const mergeUsageMaps = (
    diskUsage: Record<string, number> | undefined,
    localUsage: Record<string, number>
  ): Record<string, number> => {
    const merged: Record<string, number> = { ...localUsage };
    if (diskUsage) {
      for (const [k, v] of Object.entries(diskUsage)) {
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
          merged[k] = Math.max(merged[k] ?? 0, Math.floor(v));
        }
      }
    }
    return merged;
  };

  let activeAgent: ActiveSnippetAgent = readInitialAgent(bundle.settings);
  let snippetUsage: Record<string, number> = mergeUsageMaps(
    bundle.settings.snippetUsage,
    readStoredUsage()
  );
  let dockFilterMode: DockFilterMode = 'all';
  let dockQuery = '';
  let snippetPersistTimer: number | null = null;

  const persistSnippetStateToStorage = () => {
    try {
      localStorage.setItem(STORAGE_AGENT_KEY, activeAgent);
      localStorage.setItem(STORAGE_USAGE_KEY, JSON.stringify(snippetUsage));
    } catch {
      // Ignora indisponibilidade de storage
    }
  };

  const schedulePersistSnippetState = () => {
    persistSnippetStateToStorage();
    bundle.settings.activeSnippetAgent = activeAgent;
    bundle.settings.snippetUsage = { ...snippetUsage };
    if (snippetPersistTimer !== null) {
      window.clearTimeout(snippetPersistTimer);
    }
    snippetPersistTimer = window.setTimeout(() => {
      snippetPersistTimer = null;
      if (settingsModal.isModalOpen()) return;
      void saveSettings(bundle.settings)
        .then((next) => {
          bundle = next;
        })
        .catch(() => {});
    }, 180);
  };

  const settingsModal = new SettingsModal(document.getElementById('settings-root')!, {
    onLivePreview: (draft, themes, css) => {
      applyAllVisuals(draft, themes, css);
    },
    onBundleCommitted: async (nextBundle) => {
      bundle = nextBundle;
      await loadUserFonts(bundle.fonts);
      applyAllVisuals(bundle.settings, bundle.themes, bundle.customCss);
      renderProfileDropdown();
      if (
        nextBundle.settings.activeSnippetAgent === 'agy' ||
        nextBundle.settings.activeSnippetAgent === 'claude'
      ) {
        activeAgent = nextBundle.settings.activeSnippetAgent;
      }
      snippetUsage = mergeUsageMaps(nextBundle.settings.snippetUsage, snippetUsage);
      persistSnippetStateToStorage();
      renderSnippetsDock();
    },
    onTestSound: (kind) => {
      soundFx.updateConfig(activeSettings.sounds);
      if (kind === 'messageEnd') {
        soundFx.playMessageEnd(true);
        cursorFx.spawnReactionBurst('✨', workspace.getActivePane()?.getCursorScreenPos());
      } else {
        soundFx.playReaction(kind, true);
        const meta = REACTION_ITEMS.find((r) => r.kind === kind);
        if (meta) {
          cursorFx.spawnReactionBurst(meta.emoji, workspace.getActivePane()?.getCursorScreenPos());
        }
      }
    },
  });

  const openSearch = () => {
    searchBar.classList.remove('hidden');
    searchInput.focus();
    searchInput.select();
  };

  const closeSearch = () => {
    searchBar.classList.add('hidden');
    workspace.getActivePane()?.clearSearch();
    workspace.getActivePane()?.focus();
  };

  const toggleAlwaysOnTop = async () => {
    bundle.settings.alwaysOnTop = !bundle.settings.alwaysOnTop;
    bundle = await saveSettings(bundle.settings);
    applyAllVisuals(bundle.settings, bundle.themes, bundle.customCss);
  };

  const triggerReaction = (kind: ReactionKind) => {
    const meta = REACTION_ITEMS.find((r) => r.kind === kind);
    soundFx.playReaction(kind, true);
    cursorFx.spawnReactionBurst(meta?.emoji ?? '✨', workspace.getActivePane()?.getCursorScreenPos());
  };

  const recordSnippetExecution = (snippet: SnippetItem, forceInsertOnly: boolean) => {
    const owner = getSnippetAgent(snippet);
    let changed = false;
    if ((owner === 'agy' || owner === 'claude') && activeAgent !== owner) {
      activeAgent = owner;
      changed = true;
    }
    if (!forceInsertOnly) {
      snippetUsage[snippet.id] = (snippetUsage[snippet.id] ?? 0) + 1;
      changed = true;
    }
    if (changed) {
      renderSnippetsDock();
      schedulePersistSnippetState();
    }
  };

  const executeSnippet = (snippet: SnippetItem, forceInsertOnly = false) => {
    const autoEnter = !forceInsertOnly && snippet.autoEnter !== false;
    const needsConfirm =
      !forceInsertOnly &&
      (snippet.confirm || (snippet.command.trim() === '/clear' && bundle.settings.confirmClear));

    if (needsConfirm) {
      openConfirmModal({
        title: `Confirmar ${snippet.label}`,
        message: snippet.description || 'Confirma a execução deste comando no terminal ativo?',
        commandPreview: snippet.command,
        onConfirm: () => {
          recordSnippetExecution(snippet, false);
          soundFx.playSnippetSend();
          workspace.getActivePane()?.sendText(snippet.command, autoEnter);
        },
      });
      return;
    }

    recordSnippetExecution(snippet, forceInsertOnly);
    soundFx.playSnippetSend();
    workspace.getActivePane()?.sendText(snippet.command, autoEnter);
  };

  const buildPaletteCommands = (): PaletteCommand[] => {
    const lang = bundle.settings.language;
    const kb = bundle.settings.keybindings;
    const cmds: PaletteCommand[] = [
      { id: 'new-tab', label: t('cmd.newTab', lang), shortcut: kb.newTab, run: () => workspace.createTab() },
      { id: 'close-tab', label: t('cmd.closeTab', lang), shortcut: kb.closeTab, run: () => workspace.closeTab() },
      { id: 'split-v', label: t('cmd.splitV', lang), shortcut: kb.splitVertical, run: () => workspace.splitActive('vertical') },
      { id: 'split-h', label: t('cmd.splitH', lang), shortcut: kb.splitHorizontal, run: () => workspace.splitActive('horizontal') },
      { id: 'close-pane', label: t('cmd.closePane', lang), shortcut: kb.closePane, run: () => workspace.closeActivePane() },
      { id: 'find', label: t('cmd.find', lang), shortcut: kb.find, run: openSearch },
      { id: 'settings', label: t('cmd.settings', lang), shortcut: kb.openSettings, run: () => settingsModal.open(bundle) },
      { id: 'aot', label: t('cmd.alwaysOnTop', lang), shortcut: kb.toggleAlwaysOnTop, run: () => void toggleAlwaysOnTop() },
      { id: 'quake', label: t('cmd.quakeMode', lang), shortcut: kb.quakeGlobal, run: () => void toggleQuakeMode() },
      {
        id: 'toggle-shaders',
        label: t('cmd.toggleShaders', lang),
        run: async () => {
          bundle.settings.shaders.enabled = !bundle.settings.shaders.enabled;
          bundle = await saveSettings(bundle.settings);
          applyAllVisuals(bundle.settings, bundle.themes, bundle.customCss);
        },
      },
      {
        id: 'clear',
        label: t('cmd.clearTerminal', lang),
        run: () => workspace.getActivePane()?.clearBuffer(),
      },
    ];

    for (const p of bundle.settings.profiles) {
      cmds.push({
        id: `profile-${p.id}`,
        category: 'Perfil',
        label: p.name,
        shortcut: p.shortcut || undefined,
        run: () => workspace.createTab(p),
      });
    }

    for (const theme of bundle.themes) {
      cmds.push({
        id: `theme-${theme.id}`,
        category: t('cmd.switchTheme', lang),
        label: `${theme.name} (${theme.category})`,
        swatches: [
          theme.colors.background,
          theme.accent,
          theme.accentSecondary,
          theme.colors.green,
          theme.colors.yellow,
          theme.colors.cyan,
        ],
        run: async () => {
          bundle.settings.theme = theme.id;
          bundle = await saveSettings(bundle.settings);
          applyAllVisuals(bundle.settings, bundle.themes, bundle.customCss);
        },
      });
    }

    for (const qp of quickPaths) {
      cmds.push({
        id: `path-cd-${qp.path}`,
        category: 'Path (cd)',
        label: `${qp.label} — ${qp.path}`,
        run: () => workspace.getActivePane()?.changeDirectory(qp.path),
      });
      cmds.push({
        id: `path-tab-${qp.path}`,
        category: 'Path (+ Aba)',
        label: `${qp.label} — ${qp.path}`,
        run: () => workspace.createTab(undefined, qp.path),
      });
    }

    const activeSnippets = sortSnippetsByUsage(
      getSnippetsForAgent(getAllSnippets(bundle.settings.customSnippets), activeAgent),
      snippetUsage,
      activeAgent
    );
    for (const snip of activeSnippets) {
      const aliasSuffix = snip.aliases?.length ? ` (${snip.aliases.slice(0, 2).join(', ')})` : '';
      cmds.push({
        id: `snippet-${snip.id}`,
        category: snip.category,
        label: `${snip.command} — ${snip.description}${aliasSuffix}`,
        run: () => executeSnippet(snip),
      });
    }

    for (const reaction of REACTION_ITEMS) {
      cmds.push({
        id: `reaction-${reaction.kind}`,
        category: 'Reação (Som + FX)',
        label: `${reaction.emoji} ${reaction.label} — ${reaction.title}`,
        run: () => triggerReaction(reaction.kind),
      });
    }

    return cmds;
  };

  const renderPathsDropdown = async () => {
    const menu = document.getElementById('paths-dropdown');
    if (!menu) return;
    quickPaths = await listQuickPaths().catch(() => quickPaths);
    menu.innerHTML = '';

    const filterInput = document.createElement('input');
    filterInput.type = 'text';
    filterInput.className = 'paths-filter-input';
    filterInput.placeholder = 'Filtrar pasta (ex: CajuTerm, virtus)...';

    const listEl = document.createElement('div');
    listEl.className = 'paths-list';

    let visibleEntries: QuickPathEntry[] = [];

    const renderList = () => {
      const q = filterInput.value.trim().toLowerCase();
      visibleEntries = q
        ? quickPaths.filter(
            (e) => e.label.toLowerCase().includes(q) || e.path.toLowerCase().includes(q)
          )
        : quickPaths;

      listEl.innerHTML = '';
      let lastGroup = '';

      for (const entry of visibleEntries) {
        if (entry.group !== lastGroup) {
          lastGroup = entry.group;
          const groupTitle = document.createElement('div');
          groupTitle.className = 'paths-group-title';
          groupTitle.textContent = entry.group;
          listEl.appendChild(groupTitle);
        }

        const row = document.createElement('div');
        row.className = 'paths-row';

        const mainBtn = document.createElement('button');
        mainBtn.type = 'button';
        mainBtn.className = 'paths-main-btn';
        mainBtn.title = `cd "${entry.path}"`;
        mainBtn.innerHTML = `
          <span class="paths-main-label">📁 ${entry.label}</span>
          <span class="paths-main-sub">${entry.path}</span>
        `;
        mainBtn.addEventListener('click', () => {
          menu.classList.add('hidden');
          workspace.getActivePane()?.changeDirectory(entry.path);
        });

        const tabBtn = document.createElement('button');
        tabBtn.type = 'button';
        tabBtn.className = 'paths-mini-btn';
        tabBtn.textContent = '+ Aba';
        tabBtn.title = `Abrir nova aba em ${entry.path}`;
        tabBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          menu.classList.add('hidden');
          workspace.createTab(undefined, entry.path);
        });

        const splitBtn = document.createElement('button');
        splitBtn.type = 'button';
        splitBtn.className = 'paths-mini-btn';
        splitBtn.textContent = '⫼';
        splitBtn.title = `Abrir split vertical em ${entry.path}`;
        splitBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          menu.classList.add('hidden');
          workspace.splitActive('vertical', undefined, entry.path);
        });

        row.append(mainBtn, tabBtn, splitBtn);
        listEl.appendChild(row);
      }
    };

    filterInput.addEventListener('input', renderList);
    filterInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && visibleEntries.length > 0) {
        ev.preventDefault();
        menu.classList.add('hidden');
        workspace.getActivePane()?.changeDirectory(visibleEntries[0].path);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        menu.classList.add('hidden');
        workspace.getActivePane()?.focus();
      }
    });

    menu.append(filterInput, listEl);
    renderList();
    requestAnimationFrame(() => filterInput.focus());
  };

  const snippetsDockEl = document.getElementById('snippets-dock');
  let dockAgyBtn: HTMLButtonElement | null = null;
  let dockClaudeBtn: HTMLButtonElement | null = null;
  let dockPopularLabelEl: HTMLSpanElement | null = null;
  let dockPopularTrackEl: HTMLDivElement | null = null;

  const createAgentSwitch = (onAfterSwitch?: () => void): HTMLDivElement => {
    const switchEl = document.createElement('div');
    switchEl.className = 'snippets-agent-switch';

    const makeBtn = (
      agent: ActiveSnippetAgent,
      label: string,
      title: string
    ): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `agent-pill-btn ${agent}${activeAgent === agent ? ' active' : ''}`;
      btn.textContent = label;
      btn.title = title;
      btn.addEventListener('click', () => {
        if (activeAgent !== agent) {
          activeAgent = agent;
          renderSnippetsDock();
          schedulePersistSnippetState();
        }
        onAfterSwitch?.();
      });
      return btn;
    };

    switchEl.append(
      makeBtn('agy', '⚡ AGY', 'Ativar somente snippets do Antigravity CLI (AGY)'),
      makeBtn('claude', '🤖 Claude', 'Ativar somente snippets do Claude Code')
    );
    return switchEl;
  };

  const getFilteredDropdownSnippets = (): SnippetItem[] => {
    const all = getAllSnippets(bundle.settings.customSnippets);
    const agentSnippets = getSnippetsForAgent(all, activeAgent);
    return agentSnippets.filter((item) => {
      if (dockFilterMode === 'cli') {
        const cmd = item.command.trim().toLowerCase();
        const isCli = item.category.startsWith('CLI') || /^(?:agy|claude)(?:\s|$)/.test(cmd);
        if (!isCli) return false;
      } else if (dockFilterMode === 'slash') {
        if (!item.command.trim().startsWith('/')) return false;
      }
      return matchesSnippetQuery(item, dockQuery);
    });
  };

  const fitPopularChips = (): void => {
    if (!dockPopularTrackEl) return;
    const chips = Array.from(dockPopularTrackEl.children) as HTMLElement[];
    for (const chip of chips) {
      chip.style.display = '';
    }
    const maxWidth = dockPopularTrackEl.clientWidth;
    if (maxWidth <= 0) return;

    let overflowed = false;
    for (let i = 0; i < chips.length; i++) {
      const chip = chips[i];
      if (i === 0) continue;
      if (overflowed || chip.offsetLeft + chip.offsetWidth > maxWidth) {
        overflowed = true;
        chip.style.display = 'none';
      }
    }
  };

  const renderSnippetsDropdown = (): void => {
    const menu = document.getElementById('snippets-dropdown');
    if (!menu) return;
    menu.innerHTML = '';
    menu.dataset.agent = activeAgent;

    const topBar = document.createElement('div');
    topBar.className = 'snippets-dd-top';

    const agentSwitch = createAgentSwitch();

    const filtersWrap = document.createElement('div');
    filtersWrap.className = 'snippets-cat-bar';
    const filterButtons: Array<{ mode: DockFilterMode; btn: HTMLButtonElement }> = [];

    const filterInput = document.createElement('input');
    filterInput.type = 'text';
    filterInput.className = 'paths-filter-input';
    filterInput.autocomplete = 'off';
    filterInput.spellcheck = false;
    filterInput.placeholder = 'Filtrar snippet (Enter executa)...';
    filterInput.value = dockQuery;

    const listEl = document.createElement('div');
    listEl.className = 'snippets-dd-list';

    let visibleEntries: SnippetItem[] = [];

    const renderList = () => {
      visibleEntries = getFilteredDropdownSnippets();
      listEl.innerHTML = '';

      if (visibleEntries.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'snippets-dd-empty';
        empty.textContent = `Nenhum snippet do ${activeAgent === 'agy' ? 'AGY' : 'Claude'} encontrado.`;
        listEl.appendChild(empty);
        return;
      }

      for (const snip of visibleEntries) {
        const row = document.createElement('div');
        row.className = 'snippets-dd-row';

        const runBtn = document.createElement('button');
        runBtn.type = 'button';
        runBtn.className = 'snippets-dd-run';
        runBtn.title = `${snip.label} — ${snip.description} (Clique: executar | Shift/Dir: colar sem Enter)`;

        const runTop = document.createElement('div');
        runTop.className = 'snippets-dd-run-top';

        const codeEl = document.createElement('code');
        codeEl.textContent = snip.command.trim();
        runTop.appendChild(codeEl);

        if (snip.confirm) {
          const badge = document.createElement('span');
          badge.className = 'snippet-badge snippet-badge-warn';
          badge.textContent = 'confirm';
          runTop.appendChild(badge);
        } else if (snip.autoEnter === false) {
          const badge = document.createElement('span');
          badge.className = 'snippet-badge';
          badge.textContent = 'prompt';
          runTop.appendChild(badge);
        }

        const count = snippetUsage[snip.id] ?? 0;
        if (count > 0) {
          const countEl = document.createElement('span');
          countEl.className = 'snippet-count-badge';
          countEl.textContent = `×${count}`;
          runTop.appendChild(countEl);
        }

        const descEl = document.createElement('span');
        descEl.className = 'snippets-dd-desc';
        descEl.textContent = snip.description;

        runBtn.append(runTop, descEl);
        runBtn.addEventListener('click', (ev) => {
          menu.classList.add('hidden');
          executeSnippet(snip, ev.shiftKey);
        });
        runBtn.addEventListener('contextmenu', (ev) => {
          ev.preventDefault();
          menu.classList.add('hidden');
          executeSnippet(snip, true);
        });

        const insertBtn = document.createElement('button');
        insertBtn.type = 'button';
        insertBtn.className = 'snippet-pill-edit';
        insertBtn.textContent = '✎';
        insertBtn.title = 'Colar no prompt sem pressionar Enter';
        insertBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          menu.classList.add('hidden');
          executeSnippet(snip, true);
        });

        row.append(runBtn, insertBtn);
        listEl.appendChild(row);
      }
    };

    for (const def of [
      { mode: 'all' as const, label: 'Todos' },
      { mode: 'cli' as const, label: 'CLI' },
      { mode: 'slash' as const, label: '/ Comandos' },
    ]) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `snippet-cat-chip${def.mode === dockFilterMode ? ' active' : ''}`;
      btn.textContent = def.label;
      btn.addEventListener('click', () => {
        dockFilterMode = def.mode;
        for (const item of filterButtons) {
          item.btn.classList.toggle('active', item.mode === dockFilterMode);
        }
        renderList();
        filterInput.focus();
      });
      filterButtons.push({ mode: def.mode, btn });
      filtersWrap.appendChild(btn);
    }

    filterInput.addEventListener('input', () => {
      dockQuery = filterInput.value;
      renderList();
    });
    filterInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && visibleEntries.length > 0) {
        ev.preventDefault();
        menu.classList.add('hidden');
        executeSnippet(visibleEntries[0], ev.shiftKey);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        menu.classList.add('hidden');
        workspace.getActivePane()?.focus();
      }
    });

    topBar.append(agentSwitch, filtersWrap);
    menu.append(topBar, filterInput, listEl);
    renderList();
    requestAnimationFrame(() => filterInput.focus());
  };

  function renderSnippetsDock(): void {
    if (!snippetsDockEl || !dockPopularTrackEl || !dockPopularLabelEl) return;

    snippetsDockEl.dataset.agent = activeAgent;
    dockAgyBtn?.classList.toggle('active', activeAgent === 'agy');
    dockClaudeBtn?.classList.toggle('active', activeAgent === 'claude');
    dockPopularLabelEl.textContent = '🔥 Mais Usados';

    const all = getAllSnippets(bundle.settings.customSnippets);
    const agentSnippets = getSnippetsForAgent(all, activeAgent);
    const ranked = sortSnippetsByUsage(agentSnippets, snippetUsage, activeAgent);

    dockPopularTrackEl.innerHTML = '';
    for (const snip of ranked) {
      const count = snippetUsage[snip.id] ?? 0;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `popular-chip${count > 0 ? ' used' : ''}`;
      chip.title = `${snip.label} — ${snip.description} (Clique: executar | Shift/Dir: colar)`;

      const cmdCode = document.createElement('code');
      cmdCode.className = 'popular-cmd';
      cmdCode.textContent = snip.command.trim();
      chip.appendChild(cmdCode);

      if (count > 0) {
        const countBadge = document.createElement('span');
        countBadge.className = 'popular-count';
        countBadge.textContent = `×${count}`;
        chip.appendChild(countBadge);
      }

      chip.addEventListener('click', (ev) => {
        executeSnippet(snip, ev.shiftKey);
      });
      chip.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        executeSnippet(snip, true);
      });

      dockPopularTrackEl.appendChild(chip);
    }

    fitPopularChips();

    const snippetsMenu = document.getElementById('snippets-dropdown');
    if (snippetsMenu && !snippetsMenu.classList.contains('hidden')) {
      renderSnippetsDropdown();
    }

    requestAnimationFrame(() => {
      fitPopularChips();
      updateCrtSafePadding(activeSettings);
      workspace.fitAllVisible();
    });
  }

  const initSnippetsDock = () => {
    if (!snippetsDockEl) return;
    snippetsDockEl.innerHTML = '';

    const agentSwitch = createAgentSwitch(() => {
      workspace.getActivePane()?.focus();
    });
    dockAgyBtn = agentSwitch.children[0] as HTMLButtonElement;
    dockClaudeBtn = agentSwitch.children[1] as HTMLButtonElement;

    dockPopularLabelEl = document.createElement('span');
    dockPopularLabelEl.className = 'snippets-popular-label';

    dockPopularTrackEl = document.createElement('div');
    dockPopularTrackEl.className = 'snippets-popular-track';

    snippetsDockEl.append(agentSwitch, dockPopularLabelEl, dockPopularTrackEl);
    renderSnippetsDock();
  };

  const persistSoundUpdate = async (mutator: (s: AppSettings['sounds']) => void) => {
    mutator(bundle.settings.sounds);
    soundFx.updateConfig(bundle.settings.sounds);
    applyAllVisuals(bundle.settings, bundle.themes, bundle.customCss);
    bundle = await saveSettings(bundle.settings);
  };

  const renderSoundsDropdown = () => {
    const menu = document.getElementById('sounds-dropdown');
    if (!menu) return;
    menu.innerHTML = '';

    const snd = bundle.settings.sounds;

    const header = document.createElement('div');
    header.className = 'sounds-dd-header';

    const title = document.createElement('span');
    title.className = 'sounds-dd-title';
    title.textContent = 'Sons & Reações';

    const muteBtn = document.createElement('button');
    muteBtn.type = 'button';
    muteBtn.className = `paths-mini-btn${snd.enabled ? ' active' : ''}`;
    muteBtn.textContent = snd.enabled ? '🔊 Ativo' : '🔇 Mutado';
    muteBtn.addEventListener('click', () => {
      void persistSoundUpdate((s) => {
        s.enabled = !s.enabled;
      }).then(() => renderSoundsDropdown());
    });
    header.append(title, muteBtn);

    const grid = document.createElement('div');
    grid.className = 'reactions-grid';
    for (const item of REACTION_ITEMS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'reaction-btn';
      btn.title = item.title;
      btn.innerHTML = `<span class="reaction-emoji">${item.emoji}</span><span>${item.label}</span>`;
      btn.addEventListener('click', () => {
        triggerReaction(item.kind);
      });
      grid.appendChild(btn);
    }

    const msgEndTestBtn = document.createElement('button');
    msgEndTestBtn.type = 'button';
    msgEndTestBtn.className = 'sounds-test-btn';
    msgEndTestBtn.textContent = '✨ Testar Som de Fim de Mensagem';
    msgEndTestBtn.addEventListener('click', () => {
      soundFx.playMessageEnd(true);
      cursorFx.spawnReactionBurst('✨', workspace.getActivePane()?.getCursorScreenPos());
    });

    const controls = document.createElement('div');
    controls.className = 'sounds-controls-panel';

    const presetSelect = document.createElement('select');
    presetSelect.className = 'sounds-select';
    for (const p of [
      { value: 'cyberpunk', label: 'Cyberpunk Synth' },
      { value: 'arcade', label: 'Arcade 8-Bit' },
      { value: 'minimal', label: 'Minimal Crystal' },
      { value: 'scifi', label: 'Sci-Fi Holo' },
    ]) {
      const opt = document.createElement('option');
      opt.value = p.value;
      opt.textContent = p.label;
      if (snd.preset === p.value) opt.selected = true;
      presetSelect.appendChild(opt);
    }
    presetSelect.addEventListener('change', () => {
      void persistSoundUpdate((s) => {
        s.preset = presetSelect.value as SoundPreset;
      }).then(() => soundFx.playMessageEnd(true));
    });

    const volWrap = document.createElement('label');
    volWrap.className = 'sounds-vol-row';
    volWrap.innerHTML = `<span>Vol</span>`;
    const volSlider = document.createElement('input');
    volSlider.type = 'range';
    volSlider.min = '0';
    volSlider.max = '1';
    volSlider.step = '0.05';
    volSlider.value = String(snd.volume);
    volSlider.addEventListener('input', () => {
      bundle.settings.sounds.volume = parseFloat(volSlider.value);
      soundFx.updateConfig(bundle.settings.sounds);
    });
    volSlider.addEventListener('change', () => {
      void persistSoundUpdate((s) => {
        s.volume = parseFloat(volSlider.value);
      });
    });
    volWrap.appendChild(volSlider);

    const togglesRow = document.createElement('div');
    togglesRow.className = 'sounds-toggles-grid';

    const addToggle = (label: string, checked: boolean, setter: (v: boolean) => void) => {
      const lbl = document.createElement('label');
      lbl.className = 'sounds-toggle-chip';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = checked;
      cb.addEventListener('change', () => {
        void persistSoundUpdate(() => setter(cb.checked));
      });
      lbl.append(cb, document.createTextNode(` ${label}`));
      togglesRow.appendChild(lbl);
    };

    addToggle('Fim de Msg', snd.messageEnd, (v) => {
      bundle.settings.sounds.messageEnd = v;
    });
    addToggle('Bell / Aprovar', snd.bell, (v) => {
      bundle.settings.sounds.bell = v;
    });
    addToggle('Erros', snd.errorAlert, (v) => {
      bundle.settings.sounds.errorAlert = v;
    });
    addToggle('Teclas', snd.typingTick, (v) => {
      bundle.settings.sounds.typingTick = v;
    });

    controls.append(presetSelect, volWrap, togglesRow);
    menu.append(header, grid, msgEndTestBtn, controls);
  };

  const renderProfileDropdown = () => {
    const menu = document.getElementById('profile-dropdown');
    if (!menu) return;
    menu.innerHTML = '';
    for (const profile of bundle.settings.profiles) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = profile.shortcut ? `${profile.name} (${profile.shortcut})` : profile.name;
      btn.addEventListener('click', () => {
        menu.classList.add('hidden');
        workspace.createTab(profile);
      });
      menu.appendChild(btn);
    }
  };

  // Arrastar e maximizar janela pela barra de título
  const titlebarEl = document.getElementById('titlebar');
  titlebarEl?.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0) return;
    const target = ev.target as HTMLElement | null;
    if (target?.closest('button, input, select, a, .tab-item, .profile-dropdown')) {
      return;
    }
    if (ev.detail === 2) {
      void windowToggleMaximize();
    } else {
      void windowStartDragging();
    }
  });

  // Botões da barra superior e controles de janela
  document.getElementById('paths-dropdown')?.addEventListener('click', (ev) => ev.stopPropagation());
  document.getElementById('snippets-dropdown')?.addEventListener('click', (ev) => ev.stopPropagation());
  document.getElementById('sounds-dropdown')?.addEventListener('click', (ev) => ev.stopPropagation());

  document.getElementById('btn-paths-menu')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    closeAllTitlebarDropdowns('paths-dropdown');
    const pathsMenu = document.getElementById('paths-dropdown');
    if (!pathsMenu) return;
    const willOpen = pathsMenu.classList.contains('hidden');
    pathsMenu.classList.toggle('hidden');
    if (willOpen) {
      void renderPathsDropdown();
    }
  });
  document.getElementById('btn-snippets-menu')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    closeAllTitlebarDropdowns('snippets-dropdown');
    const snippetsMenu = document.getElementById('snippets-dropdown');
    if (!snippetsMenu) return;
    const willOpen = snippetsMenu.classList.contains('hidden');
    snippetsMenu.classList.toggle('hidden');
    if (willOpen) {
      renderSnippetsDropdown();
    }
  });
  document.getElementById('btn-sounds-menu')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    closeAllTitlebarDropdowns('sounds-dropdown');
    const soundsMenu = document.getElementById('sounds-dropdown');
    if (!soundsMenu) return;
    const willOpen = soundsMenu.classList.contains('hidden');
    soundsMenu.classList.toggle('hidden');
    if (willOpen) {
      renderSoundsDropdown();
    }
  });
  document.getElementById('btn-new-tab')?.addEventListener('click', () => workspace.createTab());
  document.getElementById('btn-profile-menu')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    closeAllTitlebarDropdowns('profile-dropdown');
    document.getElementById('profile-dropdown')?.classList.toggle('hidden');
  });
  document.addEventListener('click', () => {
    closeAllTitlebarDropdowns();
  });
  statusSound.addEventListener('click', () => {
    void persistSoundUpdate((s) => {
      s.enabled = !s.enabled;
    });
  });
  document.getElementById('btn-split-v')?.addEventListener('click', () => workspace.splitActive('vertical'));
  document.getElementById('btn-split-h')?.addEventListener('click', () => workspace.splitActive('horizontal'));
  document.getElementById('btn-close-split')?.addEventListener('click', () => workspace.closeActivePane());
  document.getElementById('btn-search')?.addEventListener('click', openSearch);
  document.getElementById('btn-palette')?.addEventListener('click', () =>
    palette.toggle(buildPaletteCommands(), bundle.settings.language)
  );
  btnAlwaysOnTop.addEventListener('click', () => void toggleAlwaysOnTop());
  document.getElementById('btn-settings')?.addEventListener('click', () => settingsModal.toggle(bundle));

  document.getElementById('win-min')?.addEventListener('click', () => void windowMinimize());
  document.getElementById('win-max')?.addEventListener('click', () => void windowToggleMaximize());
  document.getElementById('win-close')?.addEventListener('click', () => void windowClose());

  // Busca no terminal
  document.getElementById('search-next')?.addEventListener('click', () => {
    workspace.getActivePane()?.searchNext(searchInput.value, searchCase.checked, searchRegex.checked);
  });
  document.getElementById('search-prev')?.addEventListener('click', () => {
    workspace.getActivePane()?.searchPrev(searchInput.value, searchCase.checked, searchRegex.checked);
  });
  document.getElementById('search-close')?.addEventListener('click', closeSearch);
  searchInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      if (ev.shiftKey) {
        workspace.getActivePane()?.searchPrev(searchInput.value, searchCase.checked, searchRegex.checked);
      } else {
        workspace.getActivePane()?.searchNext(searchInput.value, searchCase.checked, searchRegex.checked);
      }
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      closeSearch();
    }
  });

  // Atalhos globais do teclado dentro do app (fase de captura para garantir Esc em qualquer modal/menu)
  window.addEventListener(
    'keydown',
    (ev) => {
      if (confirmActions) {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          ev.stopPropagation();
          confirmActions.cancel();
          return;
        }
        if (ev.key === 'Enter') {
          ev.preventDefault();
          ev.stopPropagation();
          confirmActions.confirm();
          return;
        }
      }

      if (ev.key === 'Escape') {
        const snippetsDropdown = document.getElementById('snippets-dropdown');
        if (snippetsDropdown && !snippetsDropdown.classList.contains('hidden')) {
          ev.preventDefault();
          ev.stopPropagation();
          snippetsDropdown.classList.add('hidden');
          workspace.getActivePane()?.focus();
          return;
        }
        const soundsDropdown = document.getElementById('sounds-dropdown');
        if (soundsDropdown && !soundsDropdown.classList.contains('hidden')) {
          ev.preventDefault();
          ev.stopPropagation();
          soundsDropdown.classList.add('hidden');
          workspace.getActivePane()?.focus();
          return;
        }
        const pathsDropdown = document.getElementById('paths-dropdown');
        if (pathsDropdown && !pathsDropdown.classList.contains('hidden')) {
          ev.preventDefault();
          ev.stopPropagation();
          pathsDropdown.classList.add('hidden');
          workspace.getActivePane()?.focus();
          return;
        }
        const dropdown = document.getElementById('profile-dropdown');
        if (dropdown && !dropdown.classList.contains('hidden')) {
          ev.preventDefault();
          ev.stopPropagation();
          dropdown.classList.add('hidden');
          workspace.getActivePane()?.focus();
          return;
        }
        if (palette.isPaletteOpen()) {
          ev.preventDefault();
          ev.stopPropagation();
          palette.close();
          workspace.getActivePane()?.focus();
          return;
        }
        if (settingsModal.isModalOpen()) {
          ev.preventDefault();
          ev.stopPropagation();
          settingsModal.close();
          workspace.getActivePane()?.focus();
          return;
        }
        if (!searchBar.classList.contains('hidden')) {
          ev.preventDefault();
          ev.stopPropagation();
          closeSearch();
          return;
        }
      }

      const kb = bundle.settings.keybindings;
      if (matchesShortcut(ev, kb.commandPalette)) {
        ev.preventDefault();
        palette.toggle(buildPaletteCommands(), bundle.settings.language);
      } else if (matchesShortcut(ev, kb.openSettings)) {
        ev.preventDefault();
        settingsModal.toggle(bundle);
      } else if (matchesShortcut(ev, kb.find)) {
        ev.preventDefault();
        openSearch();
      } else if (matchesShortcut(ev, kb.newTab)) {
        ev.preventDefault();
        workspace.createTab();
      } else if (matchesShortcut(ev, kb.closeTab)) {
        ev.preventDefault();
        if (workspace.hasMultiplePanesInActiveTab()) {
          workspace.closeActivePane();
        } else {
          workspace.closeTab();
        }
      } else if (matchesShortcut(ev, kb.nextTab)) {
        ev.preventDefault();
        workspace.cycleTab(1);
      } else if (matchesShortcut(ev, kb.prevTab)) {
        ev.preventDefault();
        workspace.cycleTab(-1);
      } else if (matchesShortcut(ev, kb.splitVertical)) {
        ev.preventDefault();
        workspace.splitActive('vertical');
      } else if (matchesShortcut(ev, kb.splitHorizontal)) {
        ev.preventDefault();
        workspace.splitActive('horizontal');
      } else if (matchesShortcut(ev, kb.closePane)) {
        ev.preventDefault();
        workspace.closeActivePane();
      } else if (matchesShortcut(ev, kb.focusLeft)) {
        ev.preventDefault();
        workspace.focusDirection('left');
      } else if (matchesShortcut(ev, kb.focusRight)) {
        ev.preventDefault();
        workspace.focusDirection('right');
      } else if (matchesShortcut(ev, kb.focusUp)) {
        ev.preventDefault();
        workspace.focusDirection('up');
      } else if (matchesShortcut(ev, kb.focusDown)) {
        ev.preventDefault();
        workspace.focusDirection('down');
      } else if (matchesShortcut(ev, kb.toggleAlwaysOnTop)) {
        ev.preventDefault();
        void toggleAlwaysOnTop();
      } else {
        for (const p of bundle.settings.profiles) {
          if (p.shortcut && matchesShortcut(ev, p.shortcut)) {
            ev.preventDefault();
            workspace.createTab(p);
            return;
          }
        }
      }
    },
    true
  );

  // Eventos do Backend Rust (saída PTY em lotes de 4ms, fim do shell e hot-reload)
  await onPtyOutput(({ id, data }) => {
    workspace.findPaneByPtyId(id)?.writeOutput(data);
  });

  await onPtyExit(({ id, exitCode }) => {
    workspace.findPaneByPtyId(id)?.handleProcessExit(exitCode);
  });

  await onConfigReloaded(async (reloaded) => {
    bundle = reloaded;
    await loadUserFonts(bundle.fonts);
    applyAllVisuals(bundle.settings, bundle.themes, bundle.customCss);
    renderProfileDropdown();
    if (snippetPersistTimer === null) {
      if (
        reloaded.settings.activeSnippetAgent === 'agy' ||
        reloaded.settings.activeSnippetAgent === 'claude'
      ) {
        activeAgent = reloaded.settings.activeSnippetAgent;
      }
      snippetUsage = mergeUsageMaps(reloaded.settings.snippetUsage, readStoredUsage());
      persistSnippetStateToStorage();
    }
    renderSnippetsDock();
  });

  window.addEventListener('resize', () => {
    fitPopularChips();
    updateCrtSafePadding(activeSettings);
    shaderOverlay.resize();
    cursorFx.resize();
    workspace.fitAllVisible();
  });

  initSnippetsDock();
  applyAllVisuals(bundle.settings, bundle.themes, bundle.customCss);
  renderProfileDropdown();
  workspace.createTab();
}

void bootstrap();

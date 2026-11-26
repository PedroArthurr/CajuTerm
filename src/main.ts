import './styles/main.css';

import { getCurrentWindow } from '@tauri-apps/api/window';
import { CursorFxLayer } from './fx/cursor-fx';
import { ShaderOverlay } from './fx/shader-overlay';
import { REACTION_ITEMS, SoundFxEngine, type ReactionKind } from './fx/sound-fx';
import { normalizeLang, t } from './i18n';
import { formatShortcut, matchesShortcut } from './shortcuts';
import {
  mergeUsageMaps,
  readInitialAgent,
  readStoredUsage,
  writeSnippetStateToStorage,
  type ActiveSnippetAgent,
} from './snippet-store';
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
  isTauriRuntime,
  listQuickPaths,
  onConfigReloaded,
  saveSettings,
  toggleQuakeMode,
  windowClose,
  windowMinimize,
  windowSetAlwaysOnTop,
  windowStartDragging,
  windowToggleMaximize,
} from './terminal/pty-bridge';
import type { TerminalPane } from './terminal/terminal-pane';
import { WorkspaceManager } from './terminal/workspace';
import { applyThemeCssVariables, BUILTIN_THEMES, hexToRgbTuple } from './themes';
import type {
  AppSettings,
  ConfigBundle,
  FontAsset,
  KeybindingsConfig,
  QuickPathEntry,
  SnippetItem,
  SoundPreset,
  ThemeConfig,
} from './types';
import { showAppToast } from './ui/app-toast';
import { CommandPalette, type PaletteCommand } from './ui/command-palette';
import { ConfirmModal } from './ui/confirm-modal';
import { hidePopover, isPopoverShown, setModalFocusRestorer, showPopover } from './ui/modal-utils';
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
              alt: bg.mediaName || '',
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
  // Evita recalcular estilos a cada tick de preview quando o CSS não mudou
  if (styleEl && styleEl.textContent !== css) {
    styleEl.textContent = css;
  }
}

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Dropdowns da barra de título e o botão que abre cada um. */
const DROPDOWNS = [
  { id: 'profile-dropdown', btn: 'btn-profile-menu' },
  { id: 'paths-dropdown', btn: 'btn-paths-menu' },
  { id: 'snippets-dropdown', btn: 'btn-snippets-menu' },
  { id: 'sounds-dropdown', btn: 'btn-sounds-menu' },
] as const;
type DropdownId = (typeof DROPDOWNS)[number]['id'];

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
  const searchCount = document.getElementById('search-count');
  const statusFps = document.getElementById('status-fps')!;
  const statusSound = document.getElementById('status-sound')!;
  const statusEffects = document.getElementById('status-effects')!;
  const statusProfile = document.getElementById('status-profile')!;
  const statusDims = document.getElementById('status-dims')!;
  const statusTheme = document.getElementById('status-theme')!;
  const btnAlwaysOnTop = document.getElementById('btn-always-on-top')!;
  const appEl = document.getElementById('app');

  const lang = (): string => bundle.settings.language;

  const resolveTheme = (settings: AppSettings, themes: ThemeConfig[]): ThemeConfig => {
    return (
      themes.find((th) => th.id === settings.theme) ??
      themes[0] ??
      BUILTIN_THEMES[0]
    );
  };

  // Erro de leitura do settings.json (backend manteve o último válido): toast uma vez por erro
  let lastSettingsError = '';
  const reportSettingsError = (b: ConfigBundle): void => {
    const err = b.settingsError ?? '';
    if (err && err !== lastSettingsError) {
      showAppToast(`${t('app.settingsError', b.settings.language)} ${err}`, 'error', 8000);
    }
    lastSettingsError = err;
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

  const confirmModal = new ConfirmModal(document.getElementById('confirm-root')!, lang);

  const focusActivePane = (): void => {
    workspace.getActivePane()?.focus();
  };
  setModalFocusRestorer(focusActivePane);

  /* ---------------------------- Dropdowns ---------------------------- */

  const getDropdown = (id: DropdownId): HTMLElement | null => document.getElementById(id);

  const setDropdownExpanded = (id: DropdownId, expanded: boolean): void => {
    const def = DROPDOWNS.find((d) => d.id === id);
    if (def) document.getElementById(def.btn)?.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  };

  const closeDropdown = (id: DropdownId, refocus = false): void => {
    const el = getDropdown(id);
    if (el) hidePopover(el);
    setDropdownExpanded(id, false);
    if (refocus) focusActivePane();
  };

  const closeAllTitlebarDropdowns = (exceptId?: DropdownId): void => {
    for (const { id } of DROPDOWNS) {
      if (id !== exceptId && isPopoverShown(getDropdown(id))) closeDropdown(id);
    }
  };

  const openDropdownId = (): DropdownId | undefined =>
    DROPDOWNS.find(({ id }) => isPopoverShown(getDropdown(id)))?.id;

  const toggleDropdown = (id: DropdownId, onOpen?: () => void): void => {
    closeAllTitlebarDropdowns(id);
    const el = getDropdown(id);
    if (!el) return;
    if (isPopoverShown(el)) {
      closeDropdown(id);
      return;
    }
    showPopover(el);
    setDropdownExpanded(id, true);
    onOpen?.();
  };

  const isSearchOpen = (): boolean => isPopoverShown(searchBar);

  const hasOpenOverlay = (): boolean =>
    openDropdownId() !== undefined ||
    isSearchOpen() ||
    palette.isPaletteOpen() ||
    settingsModal.isModalOpen() ||
    confirmModal.isOpen();

  /* ---------------------------- Atalhos ------------------------------ */

  interface ShortcutEntry {
    combo: string;
    run: () => void;
  }

  /** Tabela única de atalhos do app: usada pelo despacho e pelo isAppShortcut do xterm. */
  const shortcutEntries = (): ShortcutEntry[] => {
    const kb = bundle.settings.keybindings;
    return [
      { combo: kb.commandPalette, run: () => togglePalette() },
      { combo: kb.openSettings, run: () => toggleSettings() },
      { combo: kb.find, run: () => openSearch() },
      { combo: kb.newTab, run: () => void workspace.createTab() },
      {
        combo: kb.closeTab,
        run: () => {
          if (workspace.hasMultiplePanesInActiveTab()) workspace.closeActivePane();
          else workspace.closeTab();
        },
      },
      { combo: kb.nextTab, run: () => workspace.cycleTab(1) },
      { combo: kb.prevTab, run: () => workspace.cycleTab(-1) },
      { combo: kb.splitVertical, run: () => workspace.splitActive('vertical') },
      { combo: kb.splitHorizontal, run: () => workspace.splitActive('horizontal') },
      { combo: kb.closePane, run: () => workspace.closeActivePane() },
      { combo: kb.focusLeft, run: () => workspace.focusDirection('left') },
      { combo: kb.focusRight, run: () => workspace.focusDirection('right') },
      { combo: kb.focusUp, run: () => workspace.focusDirection('up') },
      { combo: kb.focusDown, run: () => workspace.focusDirection('down') },
      { combo: kb.toggleAlwaysOnTop, run: () => void toggleAlwaysOnTop() },
      ...bundle.settings.profiles
        .filter((p) => !!p.shortcut)
        .map((p) => ({ combo: p.shortcut, run: () => void workspace.createTab(p) })),
    ];
  };

  const findShortcut = (ev: KeyboardEvent): ShortcutEntry | undefined => {
    if (ev.type !== 'keydown') return undefined;
    return shortcutEntries().find((entry) => !!entry.combo && matchesShortcut(ev, entry.combo));
  };

  const isAppShortcut = (ev: KeyboardEvent): boolean => {
    if (ev.type !== 'keydown') return false;
    if (ev.key === 'Escape' && hasOpenOverlay()) return true;
    return findShortcut(ev) !== undefined;
  };

  /* ---------------------------- Busca -------------------------------- */

  const renderSearchCount = (
    r: { resultIndex: number; resultCount: number } | null,
    invalid = false
  ): void => {
    if (!searchCount) return;
    searchCount.classList.remove('is-empty', 'is-invalid');
    if (invalid) {
      searchCount.textContent = t('search.invalidRegex', lang());
      searchCount.classList.add('is-invalid');
      return;
    }
    if (!r || !searchInput.value) {
      searchCount.textContent = '';
      return;
    }
    if (r.resultCount <= 0) {
      searchCount.textContent = t('search.noResults', lang());
      searchCount.classList.add('is-empty');
    } else if (r.resultIndex < 0) {
      // Limite de destaques excedido: o addon não informa o índice atual
      searchCount.textContent = `${r.resultCount}+`;
    } else {
      searchCount.textContent = `${r.resultIndex + 1}/${r.resultCount}`;
    }
  };

  const runSearch = (direction: 'next' | 'prev', incremental = false): void => {
    const pane = workspace.getActivePane();
    if (!pane) return;
    const query = searchInput.value;
    if (!query) {
      pane.clearSearch();
      renderSearchCount(null);
      return;
    }
    try {
      const found =
        direction === 'next'
          ? pane.searchNext(query, searchCase.checked, searchRegex.checked, incremental)
          : pane.searchPrev(query, searchCase.checked, searchRegex.checked);
      // Sem decorações o addon não emite contagem; garante o feedback de "sem resultados"
      if (!found) renderSearchCount({ resultIndex: -1, resultCount: 0 });
    } catch {
      renderSearchCount(null, true);
    }
  };

  let searchDebounce: number | null = null;
  const scheduleIncrementalSearch = (): void => {
    if (searchDebounce !== null) window.clearTimeout(searchDebounce);
    searchDebounce = window.setTimeout(() => {
      searchDebounce = null;
      runSearch('next', true);
    }, 60);
  };

  /* ---------------------------- Workspace ---------------------------- */

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
        const l = lang();
        const diffNote =
          rawInput.toLowerCase() !== resolvedCommand.toLowerCase()
            ? t('clear.diffNote', l, { raw: rawInput, resolved: resolvedCommand })
            : '';
        confirmModal.open({
          title: t('clear.title', l),
          message: t('clear.message', l, { note: diffNote }),
          preview: resolvedCommand,
          onConfirm: () => {
            soundFx.playSnippetSend();
            pane.replaceCurrentLineAndRun(rawInput, resolvedCommand);
          },
        });
      },
      onSearchResults: (pane: TerminalPane, r: { resultIndex: number; resultCount: number }) => {
        if (pane !== workspace.getActivePane() || !isSearchOpen()) return;
        renderSearchCount(r);
      },
      onConfirmPaste: (_pane: TerminalPane, text: string, proceed: () => void) => {
        const l = lang();
        const lines = text.replace(/(\r\n|\r|\n)$/, '').split(/\r\n|\r|\n/);
        const MAX_PREVIEW_LINES = 3;
        const MAX_LINE = 96;
        const previewLines = lines
          .slice(0, MAX_PREVIEW_LINES)
          .map((line) => (line.length > MAX_LINE ? `${line.slice(0, MAX_LINE - 1)}…` : line));
        if (lines.length > MAX_PREVIEW_LINES) {
          previewLines.push(t('paste.more', l, { n: lines.length - MAX_PREVIEW_LINES }));
        }
        confirmModal.open({
          title: t('paste.title', l, { n: lines.length }),
          message: t('paste.message', l),
          preview: previewLines.join('\n'),
          previewMode: 'block',
          confirmLabel: t('paste.confirm', l),
          onConfirm: () => proceed(),
        });
      },
    }
  );

  let activeSettings: AppSettings = bundle.settings;

  /** `cd` no painel ativo; com programa em primeiro plano (claude, vim...) abre nova aba no caminho. */
  const cdActivePane = async (path: string): Promise<void> => {
    const pane = workspace.getActivePane();
    if (!pane) return;
    if ((await pane.changeDirectory(path)) === 'busy') {
      void workspace.createTab(undefined, path);
      showAppToast(t('paths.busyNewTab', lang()));
    }
  };

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

  /* ------------------- Textos e dicas de atalho da UI ----------------- */

  let lastChromeKey = '';
  const applyChromeI18n = (settings: AppSettings): void => {
    const l = settings.language;
    const kb: KeybindingsConfig = settings.keybindings;
    const key = `${l}|${JSON.stringify(kb)}`;
    if (key === lastChromeKey) return;
    lastChromeKey = key;

    document.documentElement.lang = normalizeLang(l);
    document.title = t('app.title', l);

    const setTip = (id: string, labelKey: Parameters<typeof t>[0], combo?: string): void => {
      const el = document.getElementById(id);
      if (!el) return;
      const label = t(labelKey, l);
      const hint = formatShortcut(combo);
      el.title = hint ? `${label} (${hint})` : label;
      el.setAttribute('aria-label', label);
    };

    setTip('btn-paths-menu', 'btn.paths');
    setTip('btn-snippets-menu', 'btn.snippets');
    setTip('btn-sounds-menu', 'btn.sounds');
    setTip('btn-new-tab', 'btn.newTab', kb.newTab);
    setTip('btn-profile-menu', 'btn.profileMenu');
    setTip('btn-split-v', 'btn.splitV', kb.splitVertical);
    setTip('btn-split-h', 'btn.splitH', kb.splitHorizontal);
    setTip('btn-close-split', 'btn.closeSplit', kb.closePane);
    setTip('btn-search', 'btn.search', kb.find);
    setTip('btn-palette', 'btn.palette', kb.commandPalette);
    setTip('btn-always-on-top', 'btn.alwaysOnTop', kb.toggleAlwaysOnTop);
    setTip('btn-settings', 'btn.settings', kb.openSettings);
    setTip('win-min', 'win.minimize');
    setTip('win-max', 'win.maximize');
    setTip('win-close', 'win.close');
    setTip('search-prev', 'search.prev', 'Shift+Enter');
    setTip('search-next', 'search.next', 'Enter');
    setTip('search-close', 'search.close');
    setTip('search-case-label', 'search.caseSensitive');
    setTip('search-regex-label', 'search.regex');
    searchInput.placeholder = t('search.placeholder', l);
    searchInput.setAttribute('aria-label', t('search.placeholder', l));
    document.getElementById('snippets-dock')?.setAttribute('aria-label', t('dock.label', l));
  };

  /* ---------------------------- Visuais ------------------------------ */

  // Cache dos últimos argumentos de IPC para não repetir chamadas idênticas a cada tick
  let lastVibrancyKey = '';
  let lastAlwaysOnTop: boolean | null = null;

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
    const vibrancyKey = `${settings.vibrancy}|${r},${g},${b},${alphaByte}`;
    if (vibrancyKey !== lastVibrancyKey) {
      lastVibrancyKey = vibrancyKey;
      applyWindowVibrancy(settings.vibrancy, [r, g, b, alphaByte]).catch(() => {
        lastVibrancyKey = '';
      });
    }
    if (settings.alwaysOnTop !== lastAlwaysOnTop) {
      lastAlwaysOnTop = settings.alwaysOnTop;
      windowSetAlwaysOnTop(settings.alwaysOnTop).catch(() => {
        lastAlwaysOnTop = null;
      });
    }

    btnAlwaysOnTop.classList.toggle('active', settings.alwaysOnTop);
    btnAlwaysOnTop.setAttribute('aria-pressed', settings.alwaysOnTop ? 'true' : 'false');
    statusTheme.textContent = theme.name;
    statusEffects.textContent = settings.shaders.enabled ? 'FX ON' : 'FX OFF';
    statusSound.textContent = settings.sounds.enabled ? 'SFX ON' : 'SFX MUTE';
    statusSound.classList.toggle('status-glow', settings.sounds.enabled);

    applyChromeI18n(settings);
  };

  const applyCommitted = (): void => {
    applyAllVisuals(bundle.settings, bundle.themes, bundle.customCss);
  };

  /** Salva bundle.settings (já mutado) e reaplica; erros viram toast em vez de rejeição solta. */
  const saveMainSettings = async (): Promise<void> => {
    try {
      bundle = await saveSettings(bundle.settings);
    } catch (err) {
      showAppToast(`${t('app.saveError', lang())} ${errText(err)}`, 'error');
    }
    applyCommitted();
  };

  const palette = new CommandPalette(document.getElementById('palette-root')!);

  /* ---------------------------- Snippets ----------------------------- */

  type DockFilterMode = 'all' | 'cli' | 'slash';

  let activeAgent: ActiveSnippetAgent = readInitialAgent(bundle.settings);
  let snippetUsage: Record<string, number> = mergeUsageMaps(
    bundle.settings.snippetUsage,
    readStoredUsage()
  );
  let dockFilterMode: DockFilterMode = 'all';
  let dockQuery = '';
  let snippetPersistTimer: number | null = null;

  const persistSnippetStateToStorage = () => writeSnippetStateToStorage(activeAgent, snippetUsage);

  const flushSnippetState = () => {
    snippetPersistTimer = null;
    if (settingsModal.isModalOpen()) {
      // O modal mescla esses campos ao salvar; reagenda para depois que ele fechar
      snippetPersistTimer = window.setTimeout(flushSnippetState, 600);
      return;
    }
    void saveSettings(bundle.settings)
      .then((next) => {
        bundle = next;
      })
      .catch(() => {});
  };

  const schedulePersistSnippetState = () => {
    persistSnippetStateToStorage();
    bundle.settings.activeSnippetAgent = activeAgent;
    bundle.settings.snippetUsage = { ...snippetUsage };
    if (snippetPersistTimer !== null) {
      window.clearTimeout(snippetPersistTimer);
    }
    snippetPersistTimer = window.setTimeout(flushSnippetState, 180);
  };

  /* ---------------------------- Modais ------------------------------- */

  const settingsModal = new SettingsModal(document.getElementById('settings-root')!, {
    onLivePreview: (draft, themes, css) => {
      applyAllVisuals(draft, themes, css);
    },
    onBundleCommitted: async (nextBundle) => {
      bundle = nextBundle;
      await loadUserFonts(bundle.fonts);
      applyCommitted();
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
      quickPaths = await listQuickPaths().catch(() => quickPaths);
    },
    onCancel: () => {
      applyCommitted();
    },
    getLiveOverrides: () => ({
      activeSnippetAgent: activeAgent,
      snippetUsage: { ...snippetUsage },
      alwaysOnTop: bundle.settings.alwaysOnTop,
    }),
    confirm: (opts) => confirmModal.open(opts),
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

  const togglePalette = () => {
    closeAllTitlebarDropdowns();
    palette.toggle(buildPaletteCommands(), lang());
  };

  const toggleSettings = () => {
    if (settingsModal.isModalOpen()) {
      settingsModal.requestClose();
      return;
    }
    closeAllTitlebarDropdowns();
    if (palette.isPaletteOpen()) palette.close();
    settingsModal.open(bundle);
  };

  const openSearch = () => {
    closeAllTitlebarDropdowns();
    const wasOpen = isSearchOpen();
    showPopover(searchBar);
    searchInput.focus();
    searchInput.select();
    if (!wasOpen && searchInput.value) runSearch('next', true);
  };

  const closeSearch = () => {
    if (searchDebounce !== null) {
      window.clearTimeout(searchDebounce);
      searchDebounce = null;
    }
    hidePopover(searchBar);
    workspace.getActivePane()?.clearSearch();
    renderSearchCount(null);
    focusActivePane();
  };

  const toggleAlwaysOnTop = async () => {
    bundle.settings.alwaysOnTop = !bundle.settings.alwaysOnTop;
    await saveMainSettings();
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
      const l = lang();
      confirmModal.open({
        title: t('snippet.confirmTitle', l, { label: snippet.label }),
        message: snippet.description || t('snippet.confirmMessage', l),
        preview: snippet.command,
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
    const l = lang();
    const kb = bundle.settings.keybindings;
    const sc = (combo: string | undefined) => formatShortcut(combo) || undefined;
    const cmds: PaletteCommand[] = [
      { id: 'new-tab', label: t('cmd.newTab', l), shortcut: sc(kb.newTab), run: () => void workspace.createTab() },
      { id: 'close-tab', label: t('cmd.closeTab', l), shortcut: sc(kb.closeTab), run: () => workspace.closeTab() },
      { id: 'split-v', label: t('cmd.splitV', l), shortcut: sc(kb.splitVertical), run: () => workspace.splitActive('vertical') },
      { id: 'split-h', label: t('cmd.splitH', l), shortcut: sc(kb.splitHorizontal), run: () => workspace.splitActive('horizontal') },
      { id: 'close-pane', label: t('cmd.closePane', l), shortcut: sc(kb.closePane), run: () => workspace.closeActivePane() },
      { id: 'find', label: t('cmd.find', l), shortcut: sc(kb.find), run: openSearch },
      { id: 'settings', label: t('cmd.settings', l), shortcut: sc(kb.openSettings), run: () => settingsModal.open(bundle) },
      { id: 'aot', label: t('cmd.alwaysOnTop', l), shortcut: sc(kb.toggleAlwaysOnTop), run: () => void toggleAlwaysOnTop() },
      { id: 'quake', label: t('cmd.quakeMode', l), shortcut: sc(kb.quakeGlobal), run: () => void toggleQuakeMode().catch(() => {}) },
      {
        id: 'toggle-shaders',
        label: t('cmd.toggleShaders', l),
        run: () => {
          bundle.settings.shaders.enabled = !bundle.settings.shaders.enabled;
          void saveMainSettings();
        },
      },
      {
        id: 'clear',
        label: t('cmd.clearTerminal', l),
        run: () => workspace.getActivePane()?.clearBuffer(),
      },
      { id: 'zoom-in', label: t('cmd.zoomIn', l), shortcut: 'Ctrl+=', run: () => workspace.getActivePane()?.adjustZoom(1) },
      { id: 'zoom-out', label: t('cmd.zoomOut', l), shortcut: 'Ctrl+-', run: () => workspace.getActivePane()?.adjustZoom(-1) },
      { id: 'zoom-reset', label: t('cmd.zoomReset', l), shortcut: 'Ctrl+0', run: () => workspace.getActivePane()?.resetZoom() },
      { id: 'prompt-prev', label: t('cmd.promptPrev', l), shortcut: 'Ctrl+Shift+↑', run: () => void workspace.getActivePane()?.jumpToPrompt(-1) },
      { id: 'prompt-next', label: t('cmd.promptNext', l), shortcut: 'Ctrl+Shift+↓', run: () => void workspace.getActivePane()?.jumpToPrompt(1) },
    ];

    for (const p of bundle.settings.profiles) {
      cmds.push({
        id: `profile-${p.id}`,
        category: t('palette.catProfile', l),
        label: p.name,
        shortcut: sc(p.shortcut),
        run: () => void workspace.createTab(p),
      });
    }

    for (const theme of bundle.themes) {
      cmds.push({
        id: `theme-${theme.id}`,
        category: t('cmd.switchTheme', l),
        label: `${theme.name} (${theme.category})`,
        swatches: [
          theme.colors.background,
          theme.accent,
          theme.accentSecondary,
          theme.colors.green,
          theme.colors.yellow,
          theme.colors.cyan,
        ],
        run: () => {
          bundle.settings.theme = theme.id;
          void saveMainSettings();
        },
      });
    }

    for (const qp of quickPaths) {
      cmds.push({
        id: `path-cd-${qp.path}`,
        category: t('palette.catPathCd', l),
        label: `${qp.label} — ${qp.path}`,
        run: () => void cdActivePane(qp.path),
      });
      cmds.push({
        id: `path-tab-${qp.path}`,
        category: t('palette.catPathTab', l),
        label: `${qp.label} — ${qp.path}`,
        run: () => void workspace.createTab(undefined, qp.path),
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
        category: t('palette.catReaction', l),
        label: `${reaction.emoji} ${reaction.label} — ${reaction.title}`,
        run: () => triggerReaction(reaction.kind),
      });
    }

    return cmds;
  };

  /* ------------------------ Menus da barra --------------------------- */

  const renderPathsDropdown = async () => {
    const menu = document.getElementById('paths-dropdown');
    if (!menu) return;
    quickPaths = await listQuickPaths().catch(() => quickPaths);
    if (!isPopoverShown(menu)) return;
    const l = lang();
    menu.innerHTML = '';

    const filterInput = document.createElement('input');
    filterInput.type = 'text';
    filterInput.className = 'paths-filter-input';
    filterInput.autocomplete = 'off';
    filterInput.spellcheck = false;
    filterInput.placeholder = t('paths.filter', l);
    filterInput.setAttribute('aria-label', t('paths.filter', l));

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
      if (visibleEntries.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'snippets-dd-empty';
        empty.textContent = t('paths.empty', l);
        listEl.appendChild(empty);
        return;
      }
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
        const labelEl = document.createElement('span');
        labelEl.className = 'paths-main-label';
        labelEl.textContent = `📁 ${entry.label}`;
        const subEl = document.createElement('span');
        subEl.className = 'paths-main-sub';
        subEl.textContent = entry.path;
        mainBtn.append(labelEl, subEl);
        mainBtn.addEventListener('click', () => {
          closeDropdown('paths-dropdown');
          void cdActivePane(entry.path);
        });

        const tabBtn = document.createElement('button');
        tabBtn.type = 'button';
        tabBtn.className = 'paths-mini-btn';
        tabBtn.textContent = t('paths.newTab', l);
        tabBtn.title = t('paths.newTabTitle', l, { path: entry.path });
        tabBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          closeDropdown('paths-dropdown');
          void workspace.createTab(undefined, entry.path);
        });

        const splitBtn = document.createElement('button');
        splitBtn.type = 'button';
        splitBtn.className = 'paths-mini-btn';
        splitBtn.textContent = '⫼';
        splitBtn.title = t('paths.splitTitle', l, { path: entry.path });
        splitBtn.setAttribute('aria-label', splitBtn.title);
        splitBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          closeDropdown('paths-dropdown');
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
        closeDropdown('paths-dropdown');
        void cdActivePane(visibleEntries[0].path);
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
    const l = lang();
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
      makeBtn('agy', '⚡ AGY', t('dock.agyTitle', l)),
      makeBtn('claude', '🤖 Claude', t('dock.claudeTitle', l))
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
    const l = lang();
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
    filterInput.placeholder = t('snippets.filter', l);
    filterInput.setAttribute('aria-label', t('snippets.filter', l));
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
        empty.textContent = t('snippets.empty', l, { agent: activeAgent === 'agy' ? 'AGY' : 'Claude' });
        listEl.appendChild(empty);
        return;
      }

      for (const snip of visibleEntries) {
        const row = document.createElement('div');
        row.className = 'snippets-dd-row';

        const runBtn = document.createElement('button');
        runBtn.type = 'button';
        runBtn.className = 'snippets-dd-run';
        runBtn.title = `${snip.label} — ${snip.description} ${t('snippets.runHint', l)}`;

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
          closeDropdown('snippets-dropdown');
          executeSnippet(snip, ev.shiftKey);
        });
        runBtn.addEventListener('contextmenu', (ev) => {
          ev.preventDefault();
          closeDropdown('snippets-dropdown');
          executeSnippet(snip, true);
        });

        const insertBtn = document.createElement('button');
        insertBtn.type = 'button';
        insertBtn.className = 'snippet-pill-edit';
        insertBtn.textContent = '✎';
        insertBtn.title = t('snippets.insertTitle', l);
        insertBtn.setAttribute('aria-label', t('snippets.insertTitle', l));
        insertBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          closeDropdown('snippets-dropdown');
          executeSnippet(snip, true);
        });

        row.append(runBtn, insertBtn);
        listEl.appendChild(row);
      }
    };

    for (const def of [
      { mode: 'all' as const, label: t('snippets.filterAll', l) },
      { mode: 'cli' as const, label: 'CLI' },
      { mode: 'slash' as const, label: t('snippets.filterSlash', l) },
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
        closeDropdown('snippets-dropdown');
        executeSnippet(visibleEntries[0], ev.shiftKey);
      }
    });

    topBar.append(agentSwitch, filtersWrap);
    menu.append(topBar, filterInput, listEl);
    renderList();
    requestAnimationFrame(() => filterInput.focus());
  };

  function renderSnippetsDock(): void {
    if (!snippetsDockEl || !dockPopularTrackEl || !dockPopularLabelEl) return;
    const l = lang();

    snippetsDockEl.dataset.agent = activeAgent;
    dockAgyBtn?.classList.toggle('active', activeAgent === 'agy');
    dockClaudeBtn?.classList.toggle('active', activeAgent === 'claude');
    if (dockAgyBtn) dockAgyBtn.title = t('dock.agyTitle', l);
    if (dockClaudeBtn) dockClaudeBtn.title = t('dock.claudeTitle', l);
    dockPopularLabelEl.textContent = t('dock.popular', l);

    const all = getAllSnippets(bundle.settings.customSnippets);
    const agentSnippets = getSnippetsForAgent(all, activeAgent);
    const ranked = sortSnippetsByUsage(agentSnippets, snippetUsage, activeAgent);

    dockPopularTrackEl.innerHTML = '';
    for (const snip of ranked) {
      const count = snippetUsage[snip.id] ?? 0;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `popular-chip${count > 0 ? ' used' : ''}`;
      chip.title = `${snip.label} — ${snip.description} ${t('snippets.chipHint', l)}`;

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

    if (isPopoverShown(document.getElementById('snippets-dropdown'))) {
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
      focusActivePane();
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
    applyCommitted();
    try {
      bundle = await saveSettings(bundle.settings);
    } catch (err) {
      showAppToast(`${t('app.saveError', lang())} ${errText(err)}`, 'error');
    }
  };

  const renderSoundsDropdown = () => {
    const menu = document.getElementById('sounds-dropdown');
    if (!menu) return;
    const l = lang();
    menu.innerHTML = '';

    const snd = bundle.settings.sounds;

    const header = document.createElement('div');
    header.className = 'sounds-dd-header';

    const title = document.createElement('span');
    title.className = 'sounds-dd-title';
    title.textContent = t('sounds.title', l);

    const muteBtn = document.createElement('button');
    muteBtn.type = 'button';
    muteBtn.className = `paths-mini-btn${snd.enabled ? ' active' : ''}`;
    muteBtn.textContent = snd.enabled ? t('sounds.on', l) : t('sounds.off', l);
    muteBtn.setAttribute('aria-pressed', snd.enabled ? 'true' : 'false');
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
      const emoji = document.createElement('span');
      emoji.className = 'reaction-emoji';
      emoji.textContent = item.emoji;
      const label = document.createElement('span');
      label.textContent = item.label;
      btn.append(emoji, label);
      btn.addEventListener('click', () => {
        triggerReaction(item.kind);
      });
      grid.appendChild(btn);
    }

    const msgEndTestBtn = document.createElement('button');
    msgEndTestBtn.type = 'button';
    msgEndTestBtn.className = 'sounds-test-btn';
    msgEndTestBtn.textContent = t('sounds.testMsgEnd', l);
    msgEndTestBtn.addEventListener('click', () => {
      soundFx.playMessageEnd(true);
      cursorFx.spawnReactionBurst('✨', workspace.getActivePane()?.getCursorScreenPos());
    });

    const controls = document.createElement('div');
    controls.className = 'sounds-controls-panel';

    const presetSelect = document.createElement('select');
    presetSelect.className = 'sounds-select';
    presetSelect.setAttribute('aria-label', t('settings.snd.preset', l));
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
    const volLabel = document.createElement('span');
    volLabel.textContent = t('sounds.vol', l);
    volWrap.appendChild(volLabel);
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

    addToggle(t('sounds.tgMsgEnd', l), snd.messageEnd, (v) => {
      bundle.settings.sounds.messageEnd = v;
    });
    addToggle(t('sounds.tgBell', l), snd.bell, (v) => {
      bundle.settings.sounds.bell = v;
    });
    addToggle(t('sounds.tgErrors', l), snd.errorAlert, (v) => {
      bundle.settings.sounds.errorAlert = v;
    });
    addToggle(t('sounds.tgTyping', l), snd.typingTick, (v) => {
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
      const hint = formatShortcut(profile.shortcut);
      btn.textContent = hint ? `${profile.name} (${hint})` : profile.name;
      btn.addEventListener('click', () => {
        closeDropdown('profile-dropdown');
        void workspace.createTab(profile);
      });
      menu.appendChild(btn);
    }
  };

  /* ----------------------- Janela e barra superior -------------------- */

  // Arrastar e maximizar janela pela barra de título
  const titlebarEl = document.getElementById('titlebar');
  titlebarEl?.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0) return;
    const target = ev.target as HTMLElement | null;
    if (
      target?.closest(
        'button, input, select, a, label, .tab-item, .profile-dropdown, .paths-dropdown, .snippets-dropdown, .sounds-dropdown'
      )
    ) {
      return;
    }
    if (ev.detail === 2) {
      void windowToggleMaximize();
    } else {
      void windowStartDragging();
    }
  });

  // Janela maximizada: remove cantos arredondados e borda
  if (isTauriRuntime()) {
    try {
      const appWindow = getCurrentWindow();
      let maxSyncPending = false;
      const syncMaximized = () => {
        if (maxSyncPending) return;
        maxSyncPending = true;
        requestAnimationFrame(() => {
          maxSyncPending = false;
          appWindow
            .isMaximized()
            .then((maximized) => appEl?.classList.toggle('is-maximized', maximized))
            .catch(() => {});
        });
      };
      appWindow.onResized(syncMaximized).catch(() => {});
      syncMaximized();
    } catch {
      // Sem API de janela (ambiente de dev no navegador)
    }
  }

  // Botões da barra superior e controles de janela
  for (const { id } of DROPDOWNS) {
    document.getElementById(id)?.addEventListener('click', (ev) => ev.stopPropagation());
  }

  document.getElementById('btn-paths-menu')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    toggleDropdown('paths-dropdown', () => void renderPathsDropdown());
  });
  document.getElementById('btn-snippets-menu')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    toggleDropdown('snippets-dropdown', renderSnippetsDropdown);
  });
  document.getElementById('btn-sounds-menu')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    toggleDropdown('sounds-dropdown', renderSoundsDropdown);
  });
  document.getElementById('btn-new-tab')?.addEventListener('click', () => void workspace.createTab());
  document.getElementById('btn-profile-menu')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    toggleDropdown('profile-dropdown');
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
  document.getElementById('btn-palette')?.addEventListener('click', togglePalette);
  btnAlwaysOnTop.addEventListener('click', () => void toggleAlwaysOnTop());
  document.getElementById('btn-settings')?.addEventListener('click', toggleSettings);

  document.getElementById('win-min')?.addEventListener('click', () => void windowMinimize());
  document.getElementById('win-max')?.addEventListener('click', () => void windowToggleMaximize());
  document.getElementById('win-close')?.addEventListener('click', () => void windowClose());

  // Busca no terminal (incremental com debounce + contador n/m)
  document.getElementById('search-next')?.addEventListener('click', () => runSearch('next'));
  document.getElementById('search-prev')?.addEventListener('click', () => runSearch('prev'));
  document.getElementById('search-close')?.addEventListener('click', closeSearch);
  searchInput.addEventListener('input', scheduleIncrementalSearch);
  searchCase.addEventListener('change', () => runSearch('next', true));
  searchRegex.addEventListener('change', () => runSearch('next', true));
  searchInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (searchDebounce !== null) {
        window.clearTimeout(searchDebounce);
        searchDebounce = null;
      }
      runSearch(ev.shiftKey ? 'prev' : 'next');
    }
  });

  // Atalhos globais (captura): Esc fecha a camada mais alta; modais bloqueiam atalhos do app
  window.addEventListener(
    'keydown',
    (ev) => {
      if (confirmModal.isOpen()) {
        // Enter ativa nativamente o botão focado (Cancelar ou Confirmar)
        if (ev.key === 'Escape') {
          ev.preventDefault();
          ev.stopPropagation();
          confirmModal.cancel();
        }
        return;
      }

      if (ev.key === 'Escape') {
        const openId = openDropdownId();
        if (openId) {
          ev.preventDefault();
          ev.stopPropagation();
          closeDropdown(openId, true);
          return;
        }
        if (palette.isPaletteOpen()) {
          ev.preventDefault();
          ev.stopPropagation();
          palette.close();
          return;
        }
        if (settingsModal.isModalOpen()) {
          ev.preventDefault();
          ev.stopPropagation();
          settingsModal.handleEscape();
          return;
        }
        if (isSearchOpen()) {
          ev.preventDefault();
          ev.stopPropagation();
          closeSearch();
          return;
        }
      }

      if (settingsModal.isModalOpen() || palette.isPaletteOpen()) {
        const kb = bundle.settings.keybindings;
        if (settingsModal.isModalOpen() && matchesShortcut(ev, kb.openSettings)) {
          ev.preventDefault();
          settingsModal.requestClose();
        } else if (palette.isPaletteOpen() && matchesShortcut(ev, kb.commandPalette)) {
          ev.preventDefault();
          palette.close();
        }
        return;
      }

      const entry = findShortcut(ev);
      if (entry) {
        ev.preventDefault();
        entry.run();
      }
    },
    true
  );

  // Hot-reload do backend Rust (a saída PTY agora flui por pane via Channel)
  await onConfigReloaded(async (reloaded) => {
    bundle = reloaded;
    reportSettingsError(reloaded);
    await loadUserFonts(bundle.fonts);
    // Com o modal aberto o preview do rascunho tem prioridade; o estado salvo volta ao fechar
    if (!settingsModal.isModalOpen()) {
      applyCommitted();
    }
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
    quickPaths = await listQuickPaths().catch(() => quickPaths);
  });

  // Resize coalescido por frame
  let resizeRaf = 0;
  window.addEventListener('resize', () => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      fitPopularChips();
      updateCrtSafePadding(activeSettings);
      shaderOverlay.resize();
      cursorFx.resize();
      workspace.fitAllVisible();
    });
  });

  initSnippetsDock();
  applyCommitted();
  renderProfileDropdown();
  void workspace.createTab();
  reportSettingsError(bundle);
}

void bootstrap();

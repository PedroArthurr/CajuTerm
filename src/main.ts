import './styles/main.css';

import { CursorFxLayer } from './fx/cursor-fx';
import { ShaderOverlay } from './fx/shader-overlay';
import { t } from './i18n';
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
import type { AppSettings, ConfigBundle, FontAsset, QuickPathEntry, ThemeConfig } from './types';
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
  mediaSlot.innerHTML = '';
  tintOverlay.style.background = '';

  if (bg.mode === 'gradient') {
    tintOverlay.style.background = bg.gradient;
  } else if ((bg.mode === 'image' || bg.mode === 'video') && bg.mediaDataUrl) {
    const el =
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

    el.style.opacity = String(bg.mediaOpacity);
    el.style.filter = bg.mediaBlur > 0 ? `blur(${bg.mediaBlur}px)` : '';
    mediaSlot.appendChild(el);
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
  const statusEffects = document.getElementById('status-effects')!;
  const statusProfile = document.getElementById('status-profile')!;
  const statusDims = document.getElementById('status-dims')!;
  const statusTheme = document.getElementById('status-theme')!;
  const btnAlwaysOnTop = document.getElementById('btn-always-on-top')!;

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

  const hasOpenOverlay = (): boolean => {
    const profileOpen = !document.getElementById('profile-dropdown')?.classList.contains('hidden');
    const pathsOpen = !document.getElementById('paths-dropdown')?.classList.contains('hidden');
    const searchOpen = !searchBar.classList.contains('hidden');
    return (
      profileOpen ||
      pathsOpen ||
      searchOpen ||
      palette.isPaletteOpen() ||
      settingsModal.isModalOpen()
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
      },
      onDimensionsChange: (cols, rows) => {
        statusDims.textContent = `${cols}×${rows}`;
      },
      onTabsChanged: () => {},
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

    workspace.updateConfig(settings, themes);
    requestAnimationFrame(() => workspace.fitAllVisible());

    const [r, g, b] = hexToRgbTuple(theme.colors.background);
    const alphaByte = Math.round(Math.max(0.15, Math.min(1, settings.opacity)) * 255);
    void applyWindowVibrancy(settings.vibrancy, [r, g, b, alphaByte]);
    void windowSetAlwaysOnTop(settings.alwaysOnTop);

    btnAlwaysOnTop.classList.toggle('active', settings.alwaysOnTop);
    statusTheme.textContent = theme.name;
    statusEffects.textContent = settings.shaders.enabled ? 'FX ON' : 'FX OFF';

    // Atualiza tooltips traduzidos
    const lang = settings.language;
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
  const settingsModal = new SettingsModal(document.getElementById('settings-root')!, {
    onLivePreview: (draft, themes, css) => {
      applyAllVisuals(draft, themes, css);
    },
    onBundleCommitted: async (nextBundle) => {
      bundle = nextBundle;
      await loadUserFonts(bundle.fonts);
      applyAllVisuals(bundle.settings, bundle.themes, bundle.customCss);
      renderProfileDropdown();
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
  document.getElementById('btn-paths-menu')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    document.getElementById('profile-dropdown')?.classList.add('hidden');
    const pathsMenu = document.getElementById('paths-dropdown');
    if (!pathsMenu) return;
    const willOpen = pathsMenu.classList.contains('hidden');
    pathsMenu.classList.toggle('hidden');
    if (willOpen) {
      void renderPathsDropdown();
    }
  });
  document.getElementById('btn-new-tab')?.addEventListener('click', () => workspace.createTab());
  document.getElementById('btn-profile-menu')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    document.getElementById('paths-dropdown')?.classList.add('hidden');
    document.getElementById('profile-dropdown')?.classList.toggle('hidden');
  });
  document.addEventListener('click', () => {
    document.getElementById('profile-dropdown')?.classList.add('hidden');
    document.getElementById('paths-dropdown')?.classList.add('hidden');
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
      if (ev.key === 'Escape') {
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
  });

  window.addEventListener('resize', () => {
    updateCrtSafePadding(activeSettings);
    shaderOverlay.resize();
    cursorFx.resize();
    workspace.fitAllVisible();
  });

  applyAllVisuals(bundle.settings, bundle.themes, bundle.customCss);
  renderProfileDropdown();
  workspace.createTab();
}

void bootstrap();

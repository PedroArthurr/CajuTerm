import type {
  AppSettings,
  CursorScreenPos,
  ProfileConfig,
  ThemeConfig,
} from '../types';
import { TerminalPane } from './terminal-pane';
import '../styles/terminal.css';

export type SplitDirection = 'vertical' | 'horizontal';

export interface LeafNode {
  type: 'leaf';
  pane: TerminalPane;
}

export interface SplitNode {
  type: 'split';
  direction: SplitDirection;
  ratio: number;
  first: LayoutNode;
  second: LayoutNode;
}

export type LayoutNode = LeafNode | SplitNode;

export interface TabRecord {
  id: string;
  root: LayoutNode;
  activePaneId: string;
  containerEl: HTMLDivElement;
  /** Título definido pelo usuário (duplo clique); tem prioridade sobre títulos OSC. */
  customTitle?: string;
}

export interface WorkspaceCallbacks {
  isAppShortcut: (ev: KeyboardEvent) => boolean;
  onActivePaneChanged: (pane: TerminalPane | null) => void;
  onCursorMove: (pos: CursorScreenPos) => void;
  onTyping: (pos: CursorScreenPos) => void;
  onDimensionsChange: (cols: number, rows: number) => void;
  onTabsChanged: () => void;
  onMessageEnd?: (pane: TerminalPane) => void;
  onBell?: (pane: TerminalPane) => void;
  onErrorDetected?: (pane: TerminalPane) => void;
  onConfirmCommand?: (pane: TerminalPane, rawInput: string, resolvedCommand: string) => void;
  onSearchResults?: (pane: TerminalPane, r: { resultIndex: number; resultCount: number }) => void;
  onConfirmPaste?: (pane: TerminalPane, text: string, proceed: () => void) => void;
}

interface TabElements {
  root: HTMLDivElement;
  title: HTMLSpanElement;
}

interface TabDragState {
  tabId: string;
  el: HTMLDivElement;
  pointerId: number;
  startX: number;
  originLeft: number;
  active: boolean;
}

/** Máximo de panes com contexto WebGL vivo (Chromium derruba o mais antigo acima de ~16; o shader usa 1). */
const WEBGL_PANE_BUDGET = 8;
const DRAG_THRESHOLD_PX = 5;
const FLIP_MS = 160;
const FLIP_EASE = 'cubic-bezier(0.2, 0, 0, 1)';

export class WorkspaceManager {
  private stageEl: HTMLElement;
  private tabsBarEl: HTMLElement;
  private callbacks: WorkspaceCallbacks;
  private settings: AppSettings;
  private themes: ThemeConfig[];

  public tabs: TabRecord[] = [];
  public activeTabId: string | null = null;
  private idCounter = 1;

  /** Ordem de uso recente (mais recente primeiro) para o orçamento de contextos WebGL. */
  private tabMru: string[] = [];
  private tabEls = new Map<string, TabElements>();
  private renamingTabId: string | null = null;
  private tabDrag: TabDragState | null = null;

  constructor(
    stageEl: HTMLElement,
    tabsBarEl: HTMLElement,
    settings: AppSettings,
    themes: ThemeConfig[],
    callbacks: WorkspaceCallbacks
  ) {
    this.stageEl = stageEl;
    this.tabsBarEl = tabsBarEl;
    this.settings = settings;
    this.themes = themes;
    this.callbacks = callbacks;
  }

  public updateConfig(settings: AppSettings, themes: ThemeConfig[]): void {
    this.settings = settings;
    this.themes = themes;

    for (const tab of this.tabs) {
      for (const pane of this.collectPanes(tab.root)) {
        const theme = this.resolveThemeForProfile(pane.profile);
        pane.updateAppearance(settings, theme);
      }
    }
  }

  public createTab(profile?: ProfileConfig, cwdOverride?: string): TabRecord {
    const baseProfile =
      profile ??
      this.settings.profiles.find((p) => p.id === this.settings.defaultProfile) ??
      this.settings.profiles[0];

    // Herda o diretório atual do painel ativo quando é o mesmo perfil
    let cwd = cwdOverride;
    if (!cwd) {
      const active = this.getActivePane();
      if (active?.cwd && active.profile.id === baseProfile.id) {
        cwd = active.cwd;
      }
    }
    const resolvedProfile = cwd ? { ...baseProfile, cwd } : baseProfile;

    const tabId = `tab-${this.idCounter++}`;
    const containerEl = document.createElement('div');
    containerEl.className = 'tab-viewport';
    if (this.settings.animations.tabFade) {
      containerEl.classList.add('tab-fade');
    }

    const pane = this.createPane(resolvedProfile);
    const tab: TabRecord = {
      id: tabId,
      root: { type: 'leaf', pane },
      activePaneId: pane.paneId,
      containerEl,
    };

    this.tabs.push(tab);
    this.stageEl.appendChild(containerEl);
    this.renderTabLayout(tab);
    this.switchTab(tab.id);
    return tab;
  }

  public switchTab(tabId: string): void {
    const target = this.tabs.find((t) => t.id === tabId);
    if (!target) return;

    this.activeTabId = tabId;
    this.tabMru = [tabId, ...this.tabMru.filter((id) => id !== tabId)];
    for (const tab of this.tabs) {
      const isActive = tab.id === tabId;
      tab.containerEl.classList.toggle('active', isActive);
    }
    // Restaura WebGL da aba alvo no mesmo task em que ela fica visível (antes do paint)
    this.syncWebglBudget();
    this.syncActivePaneFlags();

    this.renderTabsBar();
    const activePane = this.getActivePane();
    if (activePane) {
      requestAnimationFrame(() => {
        for (const pane of this.collectPanes(target.root)) {
          pane.fitNow();
        }
        this.focusPane(activePane);
      });
    }
    this.callbacks.onTabsChanged();
  }

  public cycleTab(delta: number): void {
    if (this.tabs.length <= 1 || !this.activeTabId) return;
    const idx = this.tabs.findIndex((t) => t.id === this.activeTabId);
    if (idx < 0) return;
    const nextIdx = (idx + delta + this.tabs.length) % this.tabs.length;
    this.switchTab(this.tabs[nextIdx].id);
  }

  public closeTab(tabId?: string): void {
    const targetId = tabId ?? this.activeTabId;
    if (!targetId) return;
    const idx = this.tabs.findIndex((t) => t.id === targetId);
    if (idx < 0) return;

    const [removed] = this.tabs.splice(idx, 1);
    this.tabMru = this.tabMru.filter((id) => id !== removed.id);
    for (const pane of this.collectPanes(removed.root)) {
      pane.dispose();
    }
    removed.containerEl.remove();

    if (this.tabs.length === 0) {
      this.activeTabId = null;
      this.renderTabsBar();
      this.createTab();
      return;
    }

    if (removed.id !== this.activeTabId) {
      // Fechou uma aba de fundo (clique do meio / ×): mantém a aba atual
      this.renderTabsBar();
      this.syncWebglBudget();
      this.callbacks.onTabsChanged();
      return;
    }

    const nextTab = this.tabs[Math.min(idx, this.tabs.length - 1)];
    this.switchTab(nextTab.id);
  }

  public splitActive(direction: SplitDirection, profile?: ProfileConfig, cwdOverride?: string): void {
    const tab = this.getActiveTab();
    if (!tab) return;
    const activePane = this.getActivePane();
    if (!activePane) return;

    const baseProfile = profile ?? activePane.profile;
    // Divisões sempre nascem no diretório atual do painel de origem
    const cwd = cwdOverride ?? activePane.cwd ?? undefined;
    const nextProfile = cwd ? { ...baseProfile, cwd } : baseProfile;
    const newPane = this.createPane(nextProfile);

    tab.root = this.replaceLeafWithSplit(tab.root, activePane.paneId, direction, newPane);
    tab.activePaneId = newPane.paneId;

    this.renderTabLayout(tab);
    this.syncWebglBudget();
    this.syncActivePaneFlags();
    this.updateTabsBarState();
    requestAnimationFrame(() => {
      for (const pane of this.collectPanes(tab.root)) {
        pane.fitNow();
      }
      this.focusPane(newPane);
    });
  }

  public closeActivePane(): void {
    const tab = this.getActiveTab();
    if (!tab) return;
    this.closePaneById(tab.activePaneId);
  }

  public closePaneById(paneId: string): void {
    const tab = this.tabs.find((t) =>
      this.collectPanes(t.root).some((p) => p.paneId === paneId)
    );
    if (!tab) return;

    const panes = this.collectPanes(tab.root);
    if (panes.length <= 1) {
      this.closeTab(tab.id);
      return;
    }

    const victim = panes.find((p) => p.paneId === paneId);
    const nextRoot = this.removeLeaf(tab.root, paneId);
    if (!nextRoot) return;

    victim?.dispose();
    tab.root = nextRoot;

    const remaining = this.collectPanes(tab.root);
    if (tab.activePaneId === paneId || !remaining.some((p) => p.paneId === tab.activePaneId)) {
      tab.activePaneId = remaining[0]?.paneId ?? '';
    }

    this.renderTabLayout(tab);
    this.syncWebglBudget();
    this.syncActivePaneFlags();
    this.updateTabsBarState();
    requestAnimationFrame(() => {
      for (const pane of remaining) {
        pane.fitNow();
      }
      const nextActive = remaining.find((p) => p.paneId === tab.activePaneId) ?? remaining[0];
      if (nextActive) this.focusPane(nextActive);
    });
  }

  public hasMultiplePanesInActiveTab(): boolean {
    const tab = this.getActiveTab();
    if (!tab) return false;
    return this.collectPanes(tab.root).length > 1;
  }

  public focusDirection(dir: 'left' | 'right' | 'up' | 'down'): void {
    const tab = this.getActiveTab();
    const active = this.getActivePane();
    if (!tab || !active) return;

    const panes = this.collectPanes(tab.root);
    if (panes.length <= 1) return;

    const aRect = active.element.getBoundingClientRect();
    const ax = aRect.left + aRect.width / 2;
    const ay = aRect.top + aRect.height / 2;

    let best: TerminalPane | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const candidate of panes) {
      if (candidate.paneId === active.paneId) continue;
      const r = candidate.element.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = cx - ax;
      const dy = cy - ay;

      const valid =
        (dir === 'left' && dx < -10) ||
        (dir === 'right' && dx > 10) ||
        (dir === 'up' && dy < -10) ||
        (dir === 'down' && dy > 10);

      if (!valid) continue;
      const score = Math.hypot(dx, dy);
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    if (best) {
      this.focusPane(best);
    }
  }

  public getActiveTab(): TabRecord | null {
    return this.tabs.find((t) => t.id === this.activeTabId) ?? null;
  }

  public getActivePane(): TerminalPane | null {
    const tab = this.getActiveTab();
    if (!tab) return null;
    const panes = this.collectPanes(tab.root);
    return panes.find((p) => p.paneId === tab.activePaneId) ?? panes[0] ?? null;
  }

  public fitAllVisible(): void {
    const tab = this.getActiveTab();
    if (!tab) return;
    for (const pane of this.collectPanes(tab.root)) {
      pane.fitNow();
    }
  }

  private createPane(profile: ProfileConfig): TerminalPane {
    const paneId = `pane-${this.idCounter++}`;
    const theme = this.resolveThemeForProfile(profile);
    const cb = this.callbacks;

    return new TerminalPane({
      paneId,
      profile,
      settings: this.settings,
      theme,
      isAppShortcut: cb.isAppShortcut,
      onFocus: (pane) => this.focusPane(pane),
      onTitleChange: (pane) => this.updateTabTitleForPane(pane),
      onCursorMove: (pane, pos) => {
        if (this.getActivePane()?.paneId === pane.paneId) {
          cb.onCursorMove(pos);
        }
      },
      onTyping: (pane, pos) => {
        if (this.getActivePane()?.paneId === pane.paneId) {
          cb.onTyping(pos);
        }
      },
      onDimensionsChange: (pane, cols, rows) => {
        if (this.getActivePane()?.paneId === pane.paneId) {
          cb.onDimensionsChange(cols, rows);
        }
      },
      // Só repassa os opcionais existentes: o painel pula a análise de saída se ninguém consome
      onMessageEnd: cb.onMessageEnd ? (pane) => cb.onMessageEnd?.(pane) : undefined,
      onBell: (pane) => cb.onBell?.(pane),
      onErrorDetected: cb.onErrorDetected ? (pane) => cb.onErrorDetected?.(pane) : undefined,
      onConfirmCommand: (pane, rawInput, resolvedCommand) =>
        cb.onConfirmCommand?.(pane, rawInput, resolvedCommand),
      onSearchResults: (pane, r) => cb.onSearchResults?.(pane, r),
      onConfirmPaste: cb.onConfirmPaste
        ? (pane, text, proceed) => cb.onConfirmPaste?.(pane, text, proceed)
        : undefined,
    });
  }

  private focusPane(pane: TerminalPane): void {
    const tab = this.tabs.find((t) =>
      this.collectPanes(t.root).some((p) => p.paneId === pane.paneId)
    );
    if (!tab) return;
    const changed = tab.activePaneId !== pane.paneId;
    tab.activePaneId = pane.paneId;
    this.syncActivePaneFlags();

    for (const p of this.collectPanes(tab.root)) {
      if (p.paneId === pane.paneId) {
        p.focus();
      } else {
        p.blurVisual();
      }
    }
    this.callbacks.onActivePaneChanged(pane);
    if (changed) {
      this.updateTabTitle(tab);
    }
  }

  /** Só o painel ativo da aba ativa calcula/emite posição de cursor para os FX. */
  private syncActivePaneFlags(): void {
    for (const tab of this.tabs) {
      const tabActive = tab.id === this.activeTabId;
      for (const p of this.collectPanes(tab.root)) {
        p.setFxActive(tabActive && p.paneId === tab.activePaneId);
      }
    }
  }

  /** Mantém WebGL na aba ativa + abas recentes dentro do orçamento; o resto cai para o renderer DOM (pausado). */
  private syncWebglBudget(): void {
    const order: TabRecord[] = [];
    const seen = new Set<string>();
    const push = (id: string | null) => {
      if (!id || seen.has(id)) return;
      const tab = this.tabs.find((t) => t.id === id);
      if (!tab) return;
      seen.add(id);
      order.push(tab);
    };
    push(this.activeTabId);
    this.tabMru.forEach(push);
    this.tabs.forEach((t) => push(t.id));

    let used = 0;
    for (const tab of order) {
      const panes = this.collectPanes(tab.root);
      const allow = tab.id === this.activeTabId || used + panes.length <= WEBGL_PANE_BUDGET;
      if (allow) used += panes.length;
      for (const p of panes) {
        p.setWebglSuspended(!allow);
      }
    }
  }

  private resolveThemeForProfile(profile: ProfileConfig): ThemeConfig {
    const preferredId = profile.themeId || this.settings.theme;
    return (
      this.themes.find((t) => t.id === preferredId) ??
      this.themes.find((t) => t.id === this.settings.theme) ??
      this.themes[0]
    );
  }

  private replaceLeafWithSplit(
    node: LayoutNode,
    targetPaneId: string,
    direction: SplitDirection,
    newPane: TerminalPane
  ): LayoutNode {
    if (node.type === 'leaf') {
      if (node.pane.paneId === targetPaneId) {
        return {
          type: 'split',
          direction,
          ratio: 0.5,
          first: node,
          second: { type: 'leaf', pane: newPane },
        };
      }
      return node;
    }
    return {
      ...node,
      first: this.replaceLeafWithSplit(node.first, targetPaneId, direction, newPane),
      second: this.replaceLeafWithSplit(node.second, targetPaneId, direction, newPane),
    };
  }

  private removeLeaf(node: LayoutNode, targetPaneId: string): LayoutNode | null {
    if (node.type === 'leaf') {
      return node.pane.paneId === targetPaneId ? null : node;
    }

    const first = this.removeLeaf(node.first, targetPaneId);
    const second = this.removeLeaf(node.second, targetPaneId);

    if (!first) return second;
    if (!second) return first;
    return { ...node, first, second };
  }

  private collectPanes(node: LayoutNode): TerminalPane[] {
    if (node.type === 'leaf') return [node.pane];
    return [...this.collectPanes(node.first), ...this.collectPanes(node.second)];
  }

  private renderTabLayout(tab: TabRecord): void {
    const showPaneClose = this.collectPanes(tab.root).length > 1;
    tab.containerEl.innerHTML = '';
    tab.containerEl.appendChild(this.buildNodeDom(tab.root, showPaneClose));
  }

  private buildNodeDom(node: LayoutNode, showPaneClose: boolean): HTMLElement {
    if (node.type === 'leaf') {
      const slot = document.createElement('div');
      slot.className = 'pane-slot';
      slot.appendChild(node.pane.element);

      if (showPaneClose) {
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'pane-close-btn';
        closeBtn.textContent = '×';
        closeBtn.title = 'Fechar divisão (Alt+Shift+W)';
        closeBtn.setAttribute('aria-label', 'Fechar divisão');
        closeBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
        closeBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.closePaneById(node.pane.paneId);
        });
        slot.appendChild(closeBtn);
      }

      return slot;
    }

    const wrapper = document.createElement('div');
    wrapper.className = `split-container split-${node.direction}`;

    const firstDom = this.buildNodeDom(node.first, showPaneClose);
    const secondDom = this.buildNodeDom(node.second, showPaneClose);

    const pct = Math.max(15, Math.min(85, node.ratio * 100));
    firstDom.style.flex = `0 0 calc(${pct}% - 3px)`;
    secondDom.style.flex = '1 1 0';

    const divider = document.createElement('div');
    divider.className = `split-divider split-divider-${node.direction}`;

    divider.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      const box = wrapper.getBoundingClientRect();
      const panes = this.collectPanes(node);

      const onMove = (moveEv: MouseEvent) => {
        const raw =
          node.direction === 'vertical'
            ? (moveEv.clientX - box.left) / Math.max(box.width, 1)
            : (moveEv.clientY - box.top) / Math.max(box.height, 1);
        node.ratio = Math.max(0.15, Math.min(0.85, raw));
        firstDom.style.flex = `0 0 calc(${node.ratio * 100}% - 3px)`;
        // Fit visual coalescido por frame; o pty_resize é debounced dentro do TerminalPane
        for (const p of panes) {
          p.requestFitFrame();
        }
      };

      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        for (const p of panes) {
          p.requestFitFrame();
        }
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });

    wrapper.append(firstDom, divider, secondDom);
    return wrapper;
  }

  // ------------------------------------------------------------------ Tab bar

  private getTabTitleSource(tab: TabRecord): string {
    if (tab.customTitle) return tab.customTitle;
    const panes = this.collectPanes(tab.root);
    const activePane = panes.find((p) => p.paneId === tab.activePaneId) ?? panes[0];
    return activePane?.title || 'Shell';
  }

  private updateTabTitle(tab: TabRecord, index = this.tabs.indexOf(tab)): void {
    const els = this.tabEls.get(tab.id);
    if (!els || index < 0 || this.renamingTabId === tab.id) return;
    const label = `${index + 1}. ${this.getTabTitleSource(tab)}`;
    if (els.title.textContent !== label) {
      els.title.textContent = label;
    }
  }

  private updateTabTitleForPane(pane: TerminalPane): void {
    const tab = this.tabs.find((t) => t.activePaneId === pane.paneId);
    if (tab) this.updateTabTitle(tab);
  }

  /** Atualização leve: classes de ativo + títulos (sem recriar DOM). */
  private updateTabsBarState(): void {
    this.tabs.forEach((tab, index) => {
      const els = this.tabEls.get(tab.id);
      if (!els) return;
      const isActive = tab.id === this.activeTabId;
      if (els.root.classList.contains('active') !== isActive) {
        els.root.classList.toggle('active', isActive);
        els.root.setAttribute('aria-selected', String(isActive));
      }
      this.updateTabTitle(tab, index);
    });
  }

  /** Reconciliação por id: cria/remove/reordena apenas o necessário e preserva foco/animações. */
  public renderTabsBar(): void {
    const live = new Set(this.tabs.map((t) => t.id));
    for (const [id, els] of this.tabEls) {
      if (!live.has(id)) {
        els.root.remove();
        this.tabEls.delete(id);
        if (this.renamingTabId === id) this.renamingTabId = null;
        if (this.tabDrag?.tabId === id) {
          this.tabDrag = null;
          this.tabsBarEl.classList.remove('is-reordering');
        }
      }
    }
    // Remove nós que não pertencem ao mapa (ex.: markup inicial)
    for (const child of Array.from(this.tabsBarEl.children)) {
      const id = (child as HTMLElement).dataset.tabId;
      if (!id || !this.tabEls.has(id)) child.remove();
    }

    this.tabs.forEach((tab, index) => {
      let els = this.tabEls.get(tab.id);
      if (!els) {
        els = this.createTabElement(tab);
        this.tabEls.set(tab.id, els);
      }
      const current = this.tabsBarEl.children[index] ?? null;
      if (current !== els.root) {
        this.tabsBarEl.insertBefore(els.root, current);
      }
    });

    this.updateTabsBarState();
  }

  private createTabElement(tab: TabRecord): TabElements {
    const tabId = tab.id;
    const root = document.createElement('div');
    root.className = 'tab-item';
    root.dataset.tabId = tabId;
    root.setAttribute('role', 'tab');
    root.setAttribute('aria-selected', 'false');
    root.tabIndex = 0;

    const title = document.createElement('span');
    title.className = 'tab-title';

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.type = 'button';
    close.tabIndex = -1;
    close.textContent = '×';
    close.setAttribute('aria-label', 'Fechar aba');
    close.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    close.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.closeTab(tabId);
    });

    root.addEventListener('click', () => {
      if (this.renamingTabId === tabId) return;
      this.switchTab(tabId);
    });

    // Clique do meio fecha a aba (mousedown evita o autoscroll do botão do meio)
    root.addEventListener('mousedown', (ev) => {
      if (ev.button === 1) ev.preventDefault();
    });
    root.addEventListener('auxclick', (ev) => {
      if (ev.button !== 1) return;
      ev.preventDefault();
      ev.stopPropagation();
      this.closeTab(tabId);
    });

    root.addEventListener('dblclick', (ev) => {
      if ((ev.target as HTMLElement).closest('.tab-close, .tab-rename-input')) return;
      ev.stopPropagation();
      this.startRename(tabId);
    });

    root.addEventListener('keydown', (ev) => {
      if (this.renamingTabId === tabId) return;
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        this.switchTab(tabId);
      } else if (ev.key === 'Delete') {
        ev.preventDefault();
        this.closeTab(tabId);
      } else if (ev.key === 'F2') {
        ev.preventDefault();
        this.startRename(tabId);
      } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
        ev.preventDefault();
        const idx = this.tabs.findIndex((t) => t.id === tabId);
        const next = this.tabs[idx + (ev.key === 'ArrowLeft' ? -1 : 1)];
        if (next) this.tabEls.get(next.id)?.root.focus();
      }
    });

    this.bindTabDrag(root, tabId);

    root.append(title, close);
    return { root, title };
  }

  private startRename(tabId: string): void {
    const tab = this.tabs.find((t) => t.id === tabId);
    const els = this.tabEls.get(tabId);
    if (!tab || !els || this.renamingTabId) return;
    this.renamingTabId = tabId;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tab-rename-input';
    input.spellcheck = false;
    input.maxLength = 80;
    input.value = this.getTabTitleSource(tab);
    input.setAttribute('aria-label', 'Renomear aba');

    els.root.classList.add('is-renaming');
    els.title.hidden = true;
    els.root.insertBefore(input, els.title);

    let done = false;
    const finish = (commit: boolean, refocusTerminal: boolean) => {
      if (done) return;
      done = true;
      if (commit) {
        const value = input.value.trim();
        tab.customTitle = value || undefined;
      }
      input.remove();
      els.title.hidden = false;
      els.root.classList.remove('is-renaming');
      if (this.renamingTabId === tabId) this.renamingTabId = null;
      this.updateTabTitle(tab);
      this.callbacks.onTabsChanged();
      if (refocusTerminal && this.activeTabId === tabId) {
        const pane = this.getActivePane();
        if (pane) this.focusPane(pane);
      }
    };

    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') {
        ev.preventDefault();
        finish(true, true);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        finish(false, true);
      }
    });
    for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick', 'auxclick'] as const) {
      input.addEventListener(type, (ev) => ev.stopPropagation());
    }

    // Foca depois do rAF de switchTab (que foca o terminal) para não perder o foco logo de cara
    requestAnimationFrame(() => {
      if (done) return;
      input.focus();
      input.select();
      input.addEventListener('blur', () => finish(true, false));
    });
  }

  private bindTabDrag(root: HTMLDivElement, tabId: string): void {
    root.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0 || this.renamingTabId === tabId || this.tabDrag?.active) return;
      this.tabDrag = {
        tabId,
        el: root,
        pointerId: ev.pointerId,
        startX: ev.clientX,
        originLeft: root.offsetLeft,
        active: false,
      };
    });

    root.addEventListener('pointermove', (ev) => {
      const drag = this.tabDrag;
      if (!drag || drag.el !== root || ev.pointerId !== drag.pointerId) return;
      if (!drag.active) {
        if ((ev.buttons & 1) === 0) {
          this.tabDrag = null; // botão solto fora da aba antes do limiar
          return;
        }
        if (Math.abs(ev.clientX - drag.startX) < DRAG_THRESHOLD_PX) return;
        drag.active = true;
        // Captura só ao iniciar o arrasto: cliques/duplo-cliques simples mantêm o alvo original
        root.setPointerCapture(ev.pointerId);
        root.style.transition = 'none';
        root.classList.add('is-dragging');
        this.tabsBarEl.classList.add('is-reordering');
      }
      this.updateTabDrag(drag, ev.clientX);
    });

    const end = (ev: PointerEvent) => {
      const drag = this.tabDrag;
      if (!drag || drag.el !== root || ev.pointerId !== drag.pointerId) return;
      this.tabDrag = null;
      if (root.hasPointerCapture(ev.pointerId)) {
        root.releasePointerCapture(ev.pointerId);
      }
      if (!drag.active) return;
      this.tabsBarEl.classList.remove('is-reordering');
      root.classList.remove('is-dragging');
      // Assenta a aba arrastada no slot final
      this.animateTransformTo(root, '');
      this.callbacks.onTabsChanged();
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
    root.addEventListener('lostpointercapture', end);
  }

  private updateTabDrag(drag: TabDragState, clientX: number): void {
    const el = drag.el;
    const currentIndex = this.tabs.findIndex((t) => t.id === drag.tabId);
    if (currentIndex < 0) return;

    const visualLeft = drag.originLeft + (clientX - drag.startX);
    const visualRight = visualLeft + el.offsetWidth;
    const centerOf = (i: number): number => {
      const other = this.tabEls.get(this.tabs[i].id)?.root;
      return other ? other.offsetLeft + other.offsetWidth / 2 : 0;
    };

    // Troca quando a borda da aba arrastada passa do centro da vizinha (histerese natural = gap)
    let target = currentIndex;
    for (let i = currentIndex + 1; i < this.tabs.length; i++) {
      if (visualRight > centerOf(i)) target = i;
      else break;
    }
    if (target === currentIndex) {
      for (let i = currentIndex - 1; i >= 0; i--) {
        if (visualLeft < centerOf(i)) target = i;
        else break;
      }
    }

    if (target !== currentIndex) {
      this.moveTabWithFlip(currentIndex, target, el);
    }
    el.style.transform = `translateX(${visualLeft - el.offsetLeft}px)`;
  }

  /** Reordena this.tabs + DOM animando as demais abas (FLIP, só transform). */
  private moveTabWithFlip(from: number, to: number, dragged: HTMLElement): void {
    const others = this.tabs
      .map((t) => this.tabEls.get(t.id)?.root)
      .filter((r): r is HTMLDivElement => !!r && r !== dragged);
    const first = new Map<HTMLElement, number>();
    for (const r of others) first.set(r, r.getBoundingClientRect().left);

    const [moved] = this.tabs.splice(from, 1);
    this.tabs.splice(to, 0, moved);
    this.tabs.forEach((t, i) => {
      const r = this.tabEls.get(t.id)?.root;
      const current = this.tabsBarEl.children[i] ?? null;
      if (r && current !== r) this.tabsBarEl.insertBefore(r, current);
    });
    this.updateTabsBarState();

    for (const r of others) {
      r.style.transition = 'none';
      r.style.transform = '';
    }
    const deltas = others.map((r) => (first.get(r) ?? 0) - r.getBoundingClientRect().left);
    others.forEach((r, i) => {
      if (Math.abs(deltas[i]) > 0.5) r.style.transform = `translateX(${deltas[i]}px)`;
    });
    void this.tabsBarEl.offsetWidth; // força o "invert" antes do "play"
    others.forEach((r, i) => {
      if (Math.abs(deltas[i]) > 0.5) this.animateTransformTo(r, '');
      else r.style.transition = '';
    });
  }

  private animateTransformTo(el: HTMLElement, transform: string): void {
    el.style.transition = `transform ${FLIP_MS}ms ${FLIP_EASE}`;
    el.style.transform = transform;
    const cleanup = (ev?: TransitionEvent) => {
      if (ev && (ev.target !== el || ev.propertyName !== 'transform')) return;
      el.removeEventListener('transitionend', cleanup);
      window.clearTimeout(timer);
      // Devolve o controle de transição ao CSS (a menos que um novo drag/FLIP tenha assumido)
      if (el.style.transform === transform && !el.classList.contains('is-dragging')) {
        el.style.transition = '';
      }
    };
    const timer = window.setTimeout(() => cleanup(), FLIP_MS + 80);
    el.addEventListener('transitionend', cleanup);
  }
}

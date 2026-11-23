import type {
  AppSettings,
  CursorScreenPos,
  ProfileConfig,
  ThemeConfig,
} from '../types';
import { TerminalPane } from './terminal-pane';

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
}

export class WorkspaceManager {
  private stageEl: HTMLElement;
  private tabsBarEl: HTMLElement;
  private callbacks: WorkspaceCallbacks;
  private settings: AppSettings;
  private themes: ThemeConfig[];

  public tabs: TabRecord[] = [];
  public activeTabId: string | null = null;
  private idCounter = 1;

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
    const resolvedProfile = cwdOverride ? { ...baseProfile, cwd: cwdOverride } : baseProfile;

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
    for (const tab of this.tabs) {
      const isActive = tab.id === tabId;
      tab.containerEl.classList.toggle('active', isActive);
    }

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
    for (const pane of this.collectPanes(removed.root)) {
      pane.dispose();
    }
    removed.containerEl.remove();

    if (this.tabs.length === 0) {
      this.activeTabId = null;
      this.createTab();
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
    const nextProfile = cwdOverride ? { ...baseProfile, cwd: cwdOverride } : baseProfile;
    const newPane = this.createPane(nextProfile);

    tab.root = this.replaceLeafWithSplit(tab.root, activePane.paneId, direction, newPane);
    tab.activePaneId = newPane.paneId;

    this.renderTabLayout(tab);
    this.renderTabsBar();
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
    this.renderTabsBar();
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

  public findPaneByPtyId(ptyId: number): TerminalPane | null {
    for (const tab of this.tabs) {
      for (const pane of this.collectPanes(tab.root)) {
        if (pane.ptyId === ptyId) return pane;
      }
    }
    return null;
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

    return new TerminalPane({
      paneId,
      profile,
      settings: this.settings,
      theme,
      isAppShortcut: this.callbacks.isAppShortcut,
      onFocus: (pane) => this.focusPane(pane),
      onTitleChange: () => this.renderTabsBar(),
      onCursorMove: (pane, pos) => {
        if (this.getActivePane()?.paneId === pane.paneId) {
          this.callbacks.onCursorMove(pos);
        }
      },
      onTyping: (pane, pos) => {
        if (this.getActivePane()?.paneId === pane.paneId) {
          this.callbacks.onTyping(pos);
        }
      },
      onDimensionsChange: (pane, cols, rows) => {
        if (this.getActivePane()?.paneId === pane.paneId) {
          this.callbacks.onDimensionsChange(cols, rows);
        }
      },
      onMessageEnd: (pane) => this.callbacks.onMessageEnd?.(pane),
      onBell: (pane) => this.callbacks.onBell?.(pane),
      onErrorDetected: (pane) => this.callbacks.onErrorDetected?.(pane),
      onConfirmCommand: (pane, rawInput, resolvedCommand) =>
        this.callbacks.onConfirmCommand?.(pane, rawInput, resolvedCommand),
    });
  }

  private focusPane(pane: TerminalPane): void {
    const tab = this.tabs.find((t) =>
      this.collectPanes(t.root).some((p) => p.paneId === pane.paneId)
    );
    if (!tab) return;
    tab.activePaneId = pane.paneId;

    for (const p of this.collectPanes(tab.root)) {
      if (p.paneId === pane.paneId) {
        p.focus();
      } else {
        p.blurVisual();
      }
    }
    this.callbacks.onActivePaneChanged(pane);
    this.renderTabsBar();
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

      const onMove = (moveEv: MouseEvent) => {
        const raw =
          node.direction === 'vertical'
            ? (moveEv.clientX - box.left) / Math.max(box.width, 1)
            : (moveEv.clientY - box.top) / Math.max(box.height, 1);
        node.ratio = Math.max(0.15, Math.min(0.85, raw));
        firstDom.style.flex = `0 0 calc(${node.ratio * 100}% - 3px)`;
        for (const p of this.collectPanes(node)) {
          p.fitNow();
        }
      };

      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });

    wrapper.append(firstDom, divider, secondDom);
    return wrapper;
  }

  public renderTabsBar(): void {
    this.tabsBarEl.innerHTML = '';
    this.tabs.forEach((tab, index) => {
      const activePane =
        this.collectPanes(tab.root).find((p) => p.paneId === tab.activePaneId) ??
        this.collectPanes(tab.root)[0];

      const btn = document.createElement('div');
      btn.className = `tab-item${tab.id === this.activeTabId ? ' active' : ''}`;
      btn.role = 'tab';
      btn.setAttribute('aria-selected', String(tab.id === this.activeTabId));

      const titleSpan = document.createElement('span');
      titleSpan.className = 'tab-title';
      titleSpan.textContent = `${index + 1}. ${activePane?.title || 'Shell'}`;

      const closeSpan = document.createElement('button');
      closeSpan.className = 'tab-close';
      closeSpan.type = 'button';
      closeSpan.textContent = '×';
      closeSpan.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.closeTab(tab.id);
      });

      btn.addEventListener('click', () => this.switchTab(tab.id));
      btn.append(titleSpan, closeSpan);
      this.tabsBarEl.appendChild(btn);
    });
  }
}

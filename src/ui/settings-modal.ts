import { REACTION_ITEMS, type ReactionKind } from '../fx/sound-fx';
import { t, type TranslationKey } from '../i18n';
import { importExternalThemes } from '../theme-importer';
import {
  BUILTIN_THEMES,
  createColorSwatchDot,
  createThemePreviewStrip,
  DEFAULT_SETTINGS,
} from '../themes';
import {
  deleteTheme,
  installFontBase64,
  openConfigDir,
  saveCustomCss,
  saveRawSettings,
  saveSettings,
  saveTheme,
  updateQuakeShortcut,
} from '../terminal/pty-bridge';
import type {
  AppSettings,
  ConfigBundle,
  KeybindingsConfig,
  ProfileConfig,
  SnippetItem,
  SoundPreset,
  ThemeConfig,
} from '../types';
import type { ConfirmOptions } from './confirm-modal';
import { pushModal, runExitAnimation, type ModalHandle } from './modal-utils';

type SettingsTabId =
  | 'appearance'
  | 'background'
  | 'shaders'
  | 'cursor'
  | 'sounds'
  | 'snippets'
  | 'fonts'
  | 'profiles'
  | 'keybindings'
  | 'paths'
  | 'import'
  | 'css'
  | 'json';

export interface SettingsModalHooks {
  onLivePreview: (draft: AppSettings, themes: ThemeConfig[], customCss: string) => void;
  onBundleCommitted: (bundle: ConfigBundle) => void | Promise<void>;
  /** Fechado sem salvar: reaplica o estado salvo (desfaz o preview ao vivo). */
  onCancel: () => void;
  /** Campos vivos mantidos fora do modal (snippet ativo, uso, sempre no topo) mesclados ao salvar. */
  getLiveOverrides?: () => Partial<AppSettings>;
  /** Abre o modal de confirmação compartilhado. */
  confirm: (opts: ConfirmOptions) => void;
  onTestSound?: (kind: 'messageEnd' | ReactionKind) => void;
}

const DEFAULT_THEME_ID = DEFAULT_SETTINGS().theme;
const MEDIA_PLACEHOLDER = '<<mediaDataUrl omitido';
const BUILTIN_THEME_IDS = new Set(BUILTIN_THEMES.map((th) => th.id));

const KEYBINDING_LABELS: Record<keyof KeybindingsConfig, TranslationKey> = {
  newTab: 'kb.newTab',
  closeTab: 'kb.closeTab',
  nextTab: 'kb.nextTab',
  prevTab: 'kb.prevTab',
  splitVertical: 'kb.splitVertical',
  splitHorizontal: 'kb.splitHorizontal',
  closePane: 'kb.closePane',
  focusLeft: 'kb.focusLeft',
  focusRight: 'kb.focusRight',
  focusUp: 'kb.focusUp',
  focusDown: 'kb.focusDown',
  find: 'kb.find',
  commandPalette: 'kb.commandPalette',
  openSettings: 'kb.openSettings',
  toggleAlwaysOnTop: 'kb.toggleAlwaysOnTop',
  quakeGlobal: 'kb.quakeGlobal',
};

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export class SettingsModal {
  private root: HTMLElement;
  private hooks: SettingsModalHooks;
  private isOpen = false;
  private activeTab: SettingsTabId = 'appearance';

  private bundle!: ConfigBundle;
  private draft!: AppSettings;
  private cssDraft = '';
  private jsonDraft = '';
  private jsonDirty = false;
  private baseline = '';
  private previewed = false;
  private previewRaf = 0;
  private saving = false;

  private handle: ModalHandle | null = null;
  private backdropEl: HTMLElement | null = null;
  private modalEl: HTMLElement | null = null;
  private navEl: HTMLElement | null = null;
  private contentEl: HTMLElement | null = null;
  private toastEl: HTMLElement | null = null;
  private saveBtn: HTMLButtonElement | null = null;
  private toastTimer: number | null = null;

  constructor(root: HTMLElement, hooks: SettingsModalHooks) {
    this.root = root;
    this.hooks = hooks;
  }

  public isModalOpen(): boolean {
    return this.isOpen;
  }

  public open(bundle: ConfigBundle): void {
    if (this.isOpen) return;
    this.bundle = bundle;
    this.draft = this.normalizeDraft(structuredClone(bundle.settings));
    this.cssDraft = bundle.customCss;
    this.jsonDraft = '';
    this.jsonDirty = false;
    this.previewed = false;
    this.baseline = this.snapshot();
    this.isOpen = true;
    this.buildShell(true);
    const activeNav = this.navEl?.querySelector<HTMLElement>('.settings-nav-btn.active') ?? null;
    this.handle = pushModal(this.root, activeNav);
  }

  /** Fecha descartando alterações não salvas (desfaz o preview). */
  public close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    if (this.previewRaf) {
      cancelAnimationFrame(this.previewRaf);
      this.previewRaf = 0;
    }
    if (this.toastTimer !== null) {
      window.clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    this.handle?.release();
    this.handle = null;
    if (this.previewed) {
      this.previewed = false;
      this.hooks.onCancel();
    }

    const backdrop = this.backdropEl;
    this.backdropEl = null;
    this.modalEl = null;
    this.navEl = null;
    this.contentEl = null;
    this.toastEl = null;
    this.saveBtn = null;
    if (backdrop) {
      runExitAnimation(backdrop, 'is-closing', () => backdrop.remove(), 200);
    }
  }

  /** Fecha pedindo confirmação se houver alterações não salvas. */
  public requestClose(): void {
    if (!this.isOpen) return;
    if (!this.isDirty()) {
      this.close();
      return;
    }
    const lang = this.draft.language;
    this.hooks.confirm({
      title: t('settings.discardTitle', lang),
      message: t('settings.discardMessage', lang),
      confirmLabel: t('settings.discard', lang),
      cancelLabel: t('settings.keepEditing', lang),
      danger: true,
      initialFocus: 'cancel',
      onConfirm: () => this.close(),
    });
  }

  /** Esc: dentro de textarea apenas sai do campo; caso contrário pede para fechar. */
  public handleEscape(): void {
    const active = document.activeElement;
    if (active instanceof HTMLTextAreaElement && this.root.contains(active)) {
      active.blur();
      this.modalEl?.focus({ preventScroll: true });
      return;
    }
    this.requestClose();
  }

  public toggle(bundle: ConfigBundle): void {
    if (this.isOpen) {
      this.requestClose();
    } else {
      this.open(bundle);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Estado / persistência                                               */
  /* ------------------------------------------------------------------ */

  private normalizeDraft(settings: AppSettings): AppSettings {
    const defaults = DEFAULT_SETTINGS();
    if (!Array.isArray(settings.quickPaths)) settings.quickPaths = defaults.quickPaths;
    if (typeof settings.copyOnSelect !== 'boolean') settings.copyOnSelect = defaults.copyOnSelect;
    return settings;
  }

  /** Serialização para detecção de alterações (mídia grande vira impressão digital). */
  private snapshot(): string {
    return JSON.stringify(this.draft, (key, value: unknown) => {
      if (key === 'mediaDataUrl' && typeof value === 'string' && value.length > 256) {
        return `${value.length}:${value.slice(0, 64)}:${value.slice(-64)}`;
      }
      return value;
    });
  }

  private isDirty(): boolean {
    return this.jsonDirty || this.cssDraft !== this.bundle.customCss || this.snapshot() !== this.baseline;
  }

  /** Preview ao vivo coalescido por frame (sliders disparam dezenas de eventos/s). */
  private emitPreview(): void {
    this.previewed = true;
    if (this.previewRaf) return;
    this.previewRaf = requestAnimationFrame(() => {
      this.previewRaf = 0;
      if (!this.isOpen) return;
      this.hooks.onLivePreview(this.draft, this.bundle.themes, this.cssDraft);
    });
  }

  private async commit(next: ConfigBundle): Promise<void> {
    this.bundle = next;
    this.previewed = false;
    if (this.previewRaf) {
      cancelAnimationFrame(this.previewRaf);
      this.previewRaf = 0;
    }
    await this.hooks.onBundleCommitted(next);
  }

  private setBusy(busy: boolean): void {
    if (!this.saveBtn) return;
    this.saveBtn.disabled = busy;
    this.saveBtn.classList.toggle('is-busy', busy);
  }

  /** Salva custom.css (se alterado), settings e atalho Quake. Retorna true em sucesso total. */
  private async persistAll(): Promise<boolean> {
    if (this.saving) return false;
    this.saving = true;
    this.setBusy(true);
    const lang = this.draft.language;
    try {
      if (this.cssDraft !== this.bundle.customCss) {
        try {
          this.bundle = await saveCustomCss(this.cssDraft);
        } catch (err) {
          this.showToast(`${t('settings.cssSaveError', lang)} ${errText(err)}`, 'error');
          return false;
        }
      }

      Object.assign(this.draft, this.hooks.getLiveOverrides?.() ?? {});
      let next: ConfigBundle;
      try {
        next = await saveSettings(this.draft);
      } catch (err) {
        this.showToast(`${t('settings.saveError', lang)} ${errText(err)}`, 'error');
        return false;
      }
      this.baseline = this.snapshot();
      this.jsonDirty = false;
      await this.commit(next);

      try {
        await updateQuakeShortcut(this.draft.keybindings.quakeGlobal);
      } catch (err) {
        this.showToast(`${t('settings.quakeError', lang)} ${errText(err)}`, 'error');
        return false;
      }

      this.showToast(t('settings.saved', lang), 'success');
      return true;
    } finally {
      this.saving = false;
      this.setBusy(false);
    }
  }

  private showToast(message: string, kind: 'success' | 'error'): void {
    const el = this.toastEl;
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('is-error', kind === 'error');
    // Reinicia a transição quando um toast substitui outro
    el.classList.remove('is-visible');
    void el.offsetWidth;
    el.classList.add('is-visible');
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastTimer = null;
      el.classList.remove('is-visible');
    }, kind === 'error' ? 4000 : 2500);
  }

  /* ------------------------------------------------------------------ */
  /* Estrutura                                                           */
  /* ------------------------------------------------------------------ */

  private tabEntries(lang: string): Array<{ id: SettingsTabId; label: string }> {
    return [
      { id: 'appearance', label: t('settings.tab.appearance', lang) },
      { id: 'background', label: t('settings.tab.background', lang) },
      { id: 'shaders', label: t('settings.tab.shaders', lang) },
      { id: 'cursor', label: t('settings.tab.cursor', lang) },
      { id: 'sounds', label: t('settings.tab.sounds', lang) },
      { id: 'snippets', label: t('settings.tab.snippets', lang) },
      { id: 'fonts', label: t('settings.tab.fonts', lang) },
      { id: 'profiles', label: t('settings.tab.profiles', lang) },
      { id: 'keybindings', label: t('settings.tab.keybindings', lang) },
      { id: 'paths', label: t('settings.tab.paths', lang) },
      { id: 'import', label: t('settings.tab.import', lang) },
      { id: 'css', label: t('settings.tab.css', lang) },
      { id: 'json', label: t('settings.tab.json', lang) },
    ];
  }

  /** Monta backdrop/modal/header/nav. Só recebe a animação de entrada em open(). */
  private buildShell(entering: boolean): void {
    if (!this.isOpen) return;
    const lang = this.draft.language;
    this.root.innerHTML = '';

    const backdrop = document.createElement('div');
    backdrop.className = `settings-backdrop${entering ? ' is-entering' : ''}`;
    let downOnBackdrop = false;
    backdrop.addEventListener('mousedown', (ev) => {
      downOnBackdrop = ev.target === backdrop;
    });
    backdrop.addEventListener('click', (ev) => {
      if (ev.target === backdrop && downOnBackdrop) this.requestClose();
      downOnBackdrop = false;
    });

    const modal = document.createElement('div');
    modal.className = 'settings-modal';
    modal.tabIndex = -1;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'settings-title');

    // Cabeçalho
    const header = document.createElement('div');
    header.className = 'settings-header';

    const titleWrap = document.createElement('div');
    const h2 = document.createElement('h2');
    h2.id = 'settings-title';
    h2.textContent = t('settings.title', lang);
    const subtitle = document.createElement('p');
    subtitle.className = 'settings-subtitle';
    subtitle.append(`${t('settings.subtitle', lang)} • `);
    const dirCode = document.createElement('code');
    dirCode.textContent = this.bundle.configDir;
    subtitle.appendChild(dirCode);
    titleWrap.append(h2, subtitle);

    const headerActions = document.createElement('div');
    headerActions.className = 'settings-header-actions';

    const folderBtn = document.createElement('button');
    folderBtn.type = 'button';
    folderBtn.className = 'btn-secondary';
    folderBtn.textContent = t('settings.openFolder', lang);
    folderBtn.addEventListener('click', () => {
      openConfigDir().catch((err) => this.showToast(`${t('settings.genericError', lang)} ${errText(err)}`, 'error'));
    });

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn-primary';
    saveBtn.textContent = t('settings.save', lang);
    saveBtn.addEventListener('click', () => void this.persistAll());
    this.saveBtn = saveBtn;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn-secondary';
    closeBtn.textContent = t('settings.close', lang);
    closeBtn.title = `${t('settings.close', lang)} (Esc)`;
    closeBtn.addEventListener('click', () => this.requestClose());

    headerActions.append(folderBtn, saveBtn, closeBtn);
    header.append(titleWrap, headerActions);

    // Corpo: Sidebar + Painel
    const body = document.createElement('div');
    body.className = 'settings-body';

    const nav = document.createElement('nav');
    nav.className = 'settings-nav';
    nav.setAttribute('aria-label', t('settings.title', lang));
    for (const item of this.tabEntries(lang)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.tab = item.id;
      b.className = `settings-nav-btn${item.id === this.activeTab ? ' active' : ''}`;
      if (item.id === this.activeTab) b.setAttribute('aria-current', 'page');
      b.textContent = item.label;
      b.addEventListener('click', () => this.selectTab(item.id));
      nav.appendChild(b);
    }

    const content = document.createElement('section');
    content.className = 'settings-content';
    content.tabIndex = -1;

    const toast = document.createElement('div');
    toast.className = 'settings-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');

    body.append(nav, content);
    modal.append(header, body, toast);
    backdrop.appendChild(modal);
    this.root.appendChild(backdrop);

    this.backdropEl = backdrop;
    this.modalEl = modal;
    this.navEl = nav;
    this.contentEl = content;
    this.toastEl = toast;

    this.renderContent(false);
  }

  private selectTab(id: SettingsTabId): void {
    if (id === this.activeTab) return;
    this.activeTab = id;
    this.navEl?.querySelectorAll<HTMLElement>('.settings-nav-btn').forEach((btn) => {
      const active = btn.dataset.tab === id;
      btn.classList.toggle('active', active);
      if (active) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
    this.renderContent(false);
  }

  /** Re-renderiza só o painel; preserva scroll e o campo focado (data-fid). */
  private renderContent(preserve = true): void {
    const content = this.contentEl;
    if (!content || !this.isOpen) return;

    const scrollTop = preserve ? content.scrollTop : 0;
    const active = document.activeElement as HTMLElement | null;
    const hadFocusInside = !!active && content.contains(active);
    const fid = preserve && hadFocusInside ? active?.dataset.fid : undefined;
    let selStart: number | null = null;
    let selEnd: number | null = null;
    if (fid && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) {
      try {
        selStart = active.selectionStart;
        selEnd = active.selectionEnd;
      } catch {
        // inputs sem seleção (range/checkbox)
      }
    }

    content.innerHTML = '';
    this.renderTabContent(content);
    content.scrollTop = scrollTop;

    if (fid) {
      this.focusFid(fid, selStart, selEnd);
    } else if (hadFocusInside) {
      content.focus({ preventScroll: true });
    }
  }

  private focusFid(fid: string, selStart: number | null = null, selEnd: number | null = null): void {
    const el = this.root.querySelector<HTMLElement>(`[data-fid="${CSS.escape(fid)}"]`);
    if (!el) {
      this.contentEl?.focus({ preventScroll: true });
      return;
    }
    el.focus({ preventScroll: true });
    if (selStart !== null && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      try {
        el.setSelectionRange(selStart, selEnd ?? selStart);
      } catch {
        // ignora tipos sem seleção
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Abas                                                                */
  /* ------------------------------------------------------------------ */

  private renderTabContent(container: HTMLElement): void {
    const lang = this.draft.language;

    if (this.activeTab === 'appearance') {
      container.appendChild(
        this.makeSelectRow('settings.language', this.draft.language, [
          { value: 'pt-BR', label: 'Português (Brasil)' },
          { value: 'en-US', label: 'English (US)' },
          { value: 'es-ES', label: 'Español' },
        ], (val) => {
          this.draft.language = val;
          this.emitPreview();
          this.buildShell(false);
          this.focusFid('settings.language');
        })
      );

      const themesHeading = document.createElement('h3');
      themesHeading.className = 'section-heading';
      themesHeading.textContent = t('settings.theme', lang);
      container.appendChild(themesHeading);
      container.appendChild(this.buildThemeGrid(lang));

      container.appendChild(
        this.makeSelectRow('settings.vibrancy', this.draft.vibrancy, [
          { value: 'acrylic', label: t('settings.vibrancyAcrylic', lang) },
          { value: 'mica', label: t('settings.vibrancyMica', lang) },
          { value: 'none', label: t('settings.vibrancyNone', lang) },
        ], (val) => {
          this.draft.vibrancy = val as AppSettings['vibrancy'];
          this.emitPreview();
        })
      );

      container.appendChild(
        this.makeSliderRow('settings.opacity', this.draft.opacity, 0.25, 1.0, 0.02, (v) => {
          this.draft.opacity = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeSliderRow('settings.blur', this.draft.blur, 0, 32, 1, (v) => {
          this.draft.blur = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeSliderRow('settings.fontSize', this.draft.fontSize, 10, 28, 1, (v) => {
          this.draft.fontSize = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeSliderRow('settings.lineHeight', this.draft.lineHeight, 1.0, 1.8, 0.02, (v) => {
          this.draft.lineHeight = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeToggleRow('settings.ligatures', this.draft.ligatures, (checked) => {
          this.draft.ligatures = checked;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeToggleRow('settings.copyOnSelect', this.draft.copyOnSelect, (checked) => {
          this.draft.copyOnSelect = checked;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeSliderRow('settings.scrollback', this.draft.scrollback, 1000, 50000, 1000, (v) => {
          this.draft.scrollback = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeSliderRow('settings.themeTransition', this.draft.animations.themeTransitionMs, 0, 1000, 20, (v) => {
          this.draft.animations.themeTransitionMs = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeToggleRow('settings.tabFade', this.draft.animations.tabFade, (checked) => {
          this.draft.animations.tabFade = checked;
          this.emitPreview();
        })
      );
      return;
    }

    if (this.activeTab === 'background') {
      container.appendChild(
        this.makeSelectRow('settings.bgMode', this.draft.background.mode, [
          { value: 'solid', label: t('settings.bgModeSolid', lang) },
          { value: 'gradient', label: t('settings.bgModeGradient', lang) },
          { value: 'image', label: t('settings.bgModeImage', lang) },
          { value: 'video', label: t('settings.bgModeVideo', lang) },
        ], (val) => {
          this.draft.background.mode = val as AppSettings['background']['mode'];
          this.emitPreview();
          this.renderContent();
        })
      );

      container.appendChild(
        this.makeTextRow('settings.bgGradient', this.draft.background.gradient, (val) => {
          this.draft.background.gradient = val;
          this.emitPreview();
        })
      );

      const uploadRow = document.createElement('div');
      uploadRow.className = 'setting-row';
      const uploadLabel = document.createElement('label');
      uploadLabel.textContent = t('settings.bgUpload', lang);
      uploadRow.appendChild(uploadLabel);
      const controls = document.createElement('div');
      controls.className = 'inline-controls';

      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*,video/mp4,video/webm';
      fileInput.dataset.fid = 'bg-file';
      fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = String(reader.result || '');
          this.draft.background.mediaDataUrl = dataUrl;
          this.draft.background.mediaName = file.name;
          this.draft.background.mode = file.type.startsWith('video/') ? 'video' : 'image';
          this.emitPreview();
          this.renderContent();
        };
        reader.onerror = () => this.showToast(t('settings.fileReadError', lang), 'error');
        reader.readAsDataURL(file);
      });

      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'btn-secondary';
      clearBtn.dataset.fid = 'bg-clear';
      clearBtn.textContent = t('settings.bgClear', lang);
      clearBtn.addEventListener('click', () => {
        this.draft.background.mediaDataUrl = '';
        this.draft.background.mediaName = '';
        this.draft.background.mode = 'gradient';
        this.emitPreview();
        this.renderContent();
      });

      controls.append(fileInput, clearBtn);
      uploadRow.appendChild(controls);
      container.appendChild(uploadRow);

      container.appendChild(
        this.makeSliderRow('settings.bgOpacity', this.draft.background.mediaOpacity, 0, 1, 0.02, (v) => {
          this.draft.background.mediaOpacity = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeSliderRow('settings.bgBlur', this.draft.background.mediaBlur, 0, 24, 1, (v) => {
          this.draft.background.mediaBlur = v;
          this.emitPreview();
        })
      );
      return;
    }

    if (this.activeTab === 'shaders') {
      const s = this.draft.shaders;
      container.appendChild(
        this.makeToggleRow('settings.shaderMaster', s.enabled, (v) => {
          s.enabled = v;
          this.emitPreview();
        })
      );
      const shaderRows: Array<{
        key: TranslationKey;
        on: 'scanlines' | 'curvature' | 'bloom' | 'chromaticAberration' | 'noise' | 'flicker';
        val: 'scanlinesIntensity' | 'curvatureIntensity' | 'bloomIntensity' | 'chromaticIntensity' | 'noiseIntensity' | 'flickerIntensity';
      }> = [
        { key: 'settings.shaderScanlines', on: 'scanlines', val: 'scanlinesIntensity' },
        { key: 'settings.shaderCurvature', on: 'curvature', val: 'curvatureIntensity' },
        { key: 'settings.shaderBloom', on: 'bloom', val: 'bloomIntensity' },
        { key: 'settings.shaderChromatic', on: 'chromaticAberration', val: 'chromaticIntensity' },
        { key: 'settings.shaderNoise', on: 'noise', val: 'noiseIntensity' },
        { key: 'settings.shaderFlicker', on: 'flicker', val: 'flickerIntensity' },
      ];
      for (const row of shaderRows) {
        container.appendChild(
          this.makeShaderToggleAndSlider(
            row.key,
            s[row.on],
            s[row.val],
            (b) => { s[row.on] = b; this.emitPreview(); },
            (v) => { s[row.val] = v; this.emitPreview(); }
          )
        );
      }
      return;
    }

    if (this.activeTab === 'cursor') {
      container.appendChild(
        this.makeSelectRow('settings.cursorStyle', this.draft.cursor.style, [
          { value: 'block', label: t('settings.cursorBlock', lang) },
          { value: 'bar', label: t('settings.cursorBar', lang) },
          { value: 'underline', label: t('settings.cursorUnderline', lang) },
        ], (val) => {
          this.draft.cursor.style = val as AppSettings['cursor']['style'];
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeToggleRow('settings.cursorBlink', this.draft.cursor.blink, (v) => {
          this.draft.cursor.blink = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeToggleRow('settings.cursorPulse', this.draft.cursor.pulse, (v) => {
          this.draft.cursor.pulse = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeToggleRow('settings.cursorTrail', this.draft.cursor.trail, (v) => {
          this.draft.cursor.trail = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeColorRow('settings.cursorColor', this.draft.cursor.color, (v) => {
          this.draft.cursor.color = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeColorRow('settings.cursorTrailColor', this.draft.cursor.trailColor, (v) => {
          this.draft.cursor.trailColor = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeToggleRow('settings.typingParticles', this.draft.animations.typingParticles, (v) => {
          this.draft.animations.typingParticles = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeSliderRow('settings.particleCount', this.draft.animations.particleCount, 1, 18, 1, (v) => {
          this.draft.animations.particleCount = v;
          this.emitPreview();
        })
      );
      return;
    }

    if (this.activeTab === 'sounds') {
      const snd = this.draft.sounds;
      container.appendChild(
        this.makeToggleRow('settings.snd.master', snd.enabled, (v) => {
          snd.enabled = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeSelectRow('settings.snd.preset', snd.preset, [
          { value: 'cyberpunk', label: 'Cyberpunk Synth' },
          { value: 'arcade', label: 'Arcade 8-Bit' },
          { value: 'minimal', label: 'Minimal Crystal' },
          { value: 'scifi', label: 'Sci-Fi Holo' },
        ], (val) => {
          snd.preset = val as SoundPreset;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeSliderRow('settings.snd.volume', snd.volume, 0, 1, 0.05, (v) => {
          snd.volume = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeToggleRow('settings.snd.messageEnd', snd.messageEnd, (v) => {
          snd.messageEnd = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeSliderRow('settings.snd.idleThreshold', snd.idleThresholdMs, 400, 4000, 100, (v) => {
          snd.idleThresholdMs = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeToggleRow('settings.snd.bell', snd.bell, (v) => {
          snd.bell = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeToggleRow('settings.snd.errorAlert', snd.errorAlert, (v) => {
          snd.errorAlert = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeToggleRow('settings.snd.reactions', snd.reactions, (v) => {
          snd.reactions = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeToggleRow('settings.snd.snippetSend', snd.snippetSend, (v) => {
          snd.snippetSend = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeToggleRow('settings.snd.typingTick', snd.typingTick, (v) => {
          snd.typingTick = v;
          this.emitPreview();
        })
      );

      const testHeading = document.createElement('h3');
      testHeading.className = 'section-heading';
      testHeading.textContent = t('settings.snd.testHeading', lang);
      container.appendChild(testHeading);

      const testRow = document.createElement('div');
      testRow.className = 'installed-fonts-list';

      const msgBtn = document.createElement('button');
      msgBtn.type = 'button';
      msgBtn.className = 'btn-secondary';
      msgBtn.dataset.fid = 'snd-test-msg';
      msgBtn.textContent = t('settings.snd.testMessageEnd', lang);
      msgBtn.addEventListener('click', () => this.hooks.onTestSound?.('messageEnd'));
      testRow.appendChild(msgBtn);

      for (const item of REACTION_ITEMS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn-secondary';
        b.dataset.fid = `snd-test-${item.kind}`;
        b.textContent = `${item.emoji} ${item.label}`;
        b.title = item.title;
        b.addEventListener('click', () => this.hooks.onTestSound?.(item.kind));
        testRow.appendChild(b);
      }

      container.appendChild(testRow);
      return;
    }

    if (this.activeTab === 'snippets') {
      container.appendChild(
        this.makeToggleRow('settings.confirmClear', this.draft.confirmClear, (v) => {
          this.draft.confirmClear = v;
          this.emitPreview();
        })
      );

      const note = document.createElement('p');
      note.className = 'muted-note';
      note.textContent = t('settings.snippetsNote', lang);
      container.appendChild(note);

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'btn-primary';
      addBtn.dataset.fid = 'snippet-add';
      addBtn.textContent = t('settings.snippetAdd', lang);
      addBtn.addEventListener('click', () => {
        const item: SnippetItem = {
          id: `custom-${Date.now()}`,
          label: t('settings.snippetDefaultLabel', lang),
          command: 'agy --dangerously-skip-permissions',
          category: t('settings.snippetDefaultCategory', lang),
          description: t('settings.snippetDefaultDescription', lang),
          aliases: [],
          autoEnter: true,
          confirm: false,
        };
        this.draft.customSnippets.push(item);
        this.emitPreview();
        this.renderContent();
        this.focusFid(`snip-${this.draft.customSnippets.length - 1}-label`);
      });
      container.appendChild(addBtn);

      this.draft.customSnippets.forEach((snip, idx) => {
        const card = document.createElement('div');
        card.className = 'profile-editor-card';
        const grid = document.createElement('div');
        grid.className = 'profile-grid';

        const fields: Array<{ f: string; key: TranslationKey; value: string }> = [
          { f: 'label', key: 'settings.field.name', value: snip.label },
          { f: 'command', key: 'settings.field.command', value: snip.command },
          { f: 'category', key: 'settings.field.category', value: snip.category },
          { f: 'aliases', key: 'settings.field.aliases', value: (snip.aliases ?? []).join(', ') },
          { f: 'description', key: 'settings.field.description', value: snip.description },
        ];
        for (const field of fields) {
          grid.appendChild(this.makeGridInput(t(field.key, lang), `snip-${idx}-${field.f}`, field.value, (val) => {
            if (field.f === 'label') snip.label = val;
            if (field.f === 'command') snip.command = val;
            if (field.f === 'category') snip.category = val || t('settings.snippetDefaultCategory', lang);
            if (field.f === 'description') snip.description = val;
            if (field.f === 'aliases') {
              snip.aliases = val
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
            }
            this.emitPreview();
          }));
        }

        const flags = document.createElement('div');
        flags.className = 'snippet-flags-row';
        const makeFlag = (f: 'autoEnter' | 'confirm', key: TranslationKey, checked: boolean) => {
          const lbl = document.createElement('label');
          lbl.className = 'checkbox-label';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = checked;
          cb.dataset.fid = `snip-${idx}-${f}`;
          cb.addEventListener('change', () => {
            if (f === 'autoEnter') snip.autoEnter = cb.checked;
            else snip.confirm = cb.checked;
            this.emitPreview();
          });
          lbl.append(cb, document.createTextNode(` ${t(key, lang)}`));
          return lbl;
        };
        flags.append(
          makeFlag('autoEnter', 'settings.field.autoEnter', snip.autoEnter !== false),
          makeFlag('confirm', 'settings.field.confirm', !!snip.confirm)
        );
        grid.appendChild(flags);
        card.appendChild(grid);

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn-danger';
        del.dataset.fid = `snip-${idx}-delete`;
        del.textContent = t('settings.profileDelete', lang);
        del.addEventListener('click', () => {
          this.draft.customSnippets.splice(idx, 1);
          this.emitPreview();
          this.renderContent();
        });
        card.appendChild(del);
        container.appendChild(card);
      });
      return;
    }

    if (this.activeTab === 'fonts') {
      container.appendChild(
        this.makeTextRow('settings.fontFamily', this.draft.fontFamily, (val) => {
          this.draft.fontFamily = val;
          this.emitPreview();
        })
      );

      const uploadRow = document.createElement('div');
      uploadRow.className = 'setting-row';
      const uploadLabel = document.createElement('label');
      uploadLabel.textContent = t('settings.fontUpload', lang);
      uploadRow.appendChild(uploadLabel);

      const fontInput = document.createElement('input');
      fontInput.type = 'file';
      fontInput.accept = '.ttf,.otf,.woff,.woff2';
      fontInput.dataset.fid = 'font-file';
      fontInput.addEventListener('change', () => {
        const file = fontInput.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const dataUrl = String(reader.result || '');
            const next = await installFontBase64(file.name, dataUrl);
            const family = file.name.replace(/\.[^.]+$/, '');
            this.draft.fontFamily = `'${family}', ${this.draft.fontFamily}`;
            await this.commit(next);
            this.emitPreview();
            this.renderContent();
            this.showToast(t('settings.fontInstalledToast', lang), 'success');
          } catch (err) {
            this.showToast(`${t('settings.fontError', lang)} ${errText(err)}`, 'error');
          }
        };
        reader.onerror = () => this.showToast(t('settings.fileReadError', lang), 'error');
        reader.readAsDataURL(file);
      });
      uploadRow.appendChild(fontInput);
      container.appendChild(uploadRow);

      const listHeading = document.createElement('h3');
      listHeading.className = 'section-heading';
      listHeading.textContent = t('settings.fontInstalled', lang);
      container.appendChild(listHeading);

      const fontsList = document.createElement('div');
      fontsList.className = 'installed-fonts-list';
      if (this.bundle.fonts.length === 0) {
        const p = document.createElement('p');
        p.className = 'muted-note';
        p.append(`${t('settings.fontNone', lang)} `);
        const code = document.createElement('code');
        code.textContent = `${this.bundle.configDir}\\fonts`;
        p.appendChild(code);
        fontsList.appendChild(p);
      } else {
        for (const f of this.bundle.fonts) {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'font-chip';
          item.dataset.fid = `font-${f.fileName}`;
          item.textContent = `${f.family} (${f.fileName})`;
          item.addEventListener('click', () => {
            this.draft.fontFamily = `'${f.family}', 'JetBrainsMono Nerd Font', monospace`;
            this.emitPreview();
            this.renderContent();
          });
          fontsList.appendChild(item);
        }
      }
      container.appendChild(fontsList);
      return;
    }

    if (this.activeTab === 'profiles') {
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'btn-primary';
      addBtn.dataset.fid = 'profile-add';
      addBtn.textContent = t('settings.profileAdd', lang);
      addBtn.addEventListener('click', () => {
        const created: ProfileConfig = {
          id: `profile-${Date.now()}`,
          name: t('settings.profileDefaultName', lang),
          shell: 'pwsh.exe',
          args: ['-NoLogo'],
          cwd: '~',
          themeId: null,
          env: {},
          shortcut: '',
        };
        this.draft.profiles.push(created);
        this.emitPreview();
        this.renderContent();
        this.focusFid(`profile-${this.draft.profiles.length - 1}-name`);
      });
      container.appendChild(addBtn);

      this.draft.profiles.forEach((p, idx) => {
        const card = document.createElement('div');
        card.className = 'profile-editor-card';
        const grid = document.createElement('div');
        grid.className = 'profile-grid';

        const fields: Array<{ f: string; label: string; value: string; placeholder?: string }> = [
          { f: 'name', label: t('settings.field.name', lang), value: p.name },
          { f: 'shell', label: 'Shell', value: p.shell },
          { f: 'args', label: t('settings.field.args', lang), value: p.args.join(' ') },
          { f: 'cwd', label: 'CWD', value: p.cwd },
          { f: 'shortcut', label: t('settings.field.shortcut', lang), value: p.shortcut },
          {
            f: 'themeId',
            label: t('settings.field.themeId', lang),
            value: p.themeId ?? '',
            placeholder: t('settings.field.themeIdPlaceholder', lang),
          },
        ];
        for (const field of fields) {
          grid.appendChild(this.makeGridInput(field.label, `profile-${idx}-${field.f}`, field.value, (val) => {
            if (field.f === 'name') p.name = val;
            if (field.f === 'shell') p.shell = val;
            if (field.f === 'args') p.args = val.trim() ? val.trim().split(/\s+/) : [];
            if (field.f === 'cwd') p.cwd = val;
            if (field.f === 'shortcut') p.shortcut = val;
            if (field.f === 'themeId') p.themeId = val.trim() || null;
            this.emitPreview();
          }, field.placeholder));
        }
        card.appendChild(grid);

        if (this.draft.profiles.length > 1) {
          const del = document.createElement('button');
          del.type = 'button';
          del.className = 'btn-danger';
          del.dataset.fid = `profile-${idx}-delete`;
          del.textContent = t('settings.profileDelete', lang);
          del.addEventListener('click', () => {
            this.draft.profiles.splice(idx, 1);
            this.emitPreview();
            this.renderContent();
          });
          card.appendChild(del);
        }
        container.appendChild(card);
      });
      return;
    }

    if (this.activeTab === 'keybindings') {
      const hint = document.createElement('p');
      hint.className = 'muted-note';
      hint.textContent = t('settings.kbHint', lang);
      container.appendChild(hint);

      const entries = Object.entries(this.draft.keybindings) as Array<[keyof KeybindingsConfig, string]>;
      for (const [key, val] of entries) {
        const labelKey = KEYBINDING_LABELS[key];
        const row = labelKey
          ? this.makeTextRow(labelKey, val, (nextVal) => {
              this.draft.keybindings[key] = nextVal;
              this.emitPreview();
            })
          : this.makeRawTextRow(String(key), `kb-${String(key)}`, val, (nextVal) => {
              this.draft.keybindings[key] = nextVal;
              this.emitPreview();
            });
        container.appendChild(row);
      }
      return;
    }

    if (this.activeTab === 'paths') {
      const hint = document.createElement('p');
      hint.className = 'muted-note';
      hint.textContent = t('settings.quickPathsHint', lang);
      const globHint = document.createElement('p');
      globHint.className = 'muted-note';
      globHint.append(`${t('settings.quickPathsGlobHint', lang)} `);
      const example = document.createElement('code');
      example.textContent = 'Y:/Github-PA/*';
      globHint.appendChild(example);
      container.append(hint, globHint);

      const list = document.createElement('div');
      list.className = 'quick-paths-list';
      if (this.draft.quickPaths.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'muted-note';
        empty.textContent = t('settings.quickPathsEmpty', lang);
        list.appendChild(empty);
      }
      this.draft.quickPaths.forEach((path, idx) => {
        const row = document.createElement('div');
        row.className = 'setting-row quick-path-row';

        const input = document.createElement('input');
        input.type = 'text';
        input.value = path;
        input.spellcheck = false;
        input.placeholder = 'C:/Projetos  ·  C:/Projetos/*';
        input.dataset.fid = `qp-${idx}`;
        input.setAttribute('aria-label', `${t('settings.tab.paths', lang)} ${idx + 1}`);
        input.addEventListener('input', () => {
          this.draft.quickPaths[idx] = input.value;
        });
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            this.addQuickPath();
          }
        });

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn-secondary btn-icon';
        remove.dataset.fid = `qp-del-${idx}`;
        remove.textContent = '✕';
        remove.title = t('settings.quickPathsRemove', lang);
        remove.setAttribute('aria-label', `${t('settings.quickPathsRemove', lang)}: ${path}`);
        remove.addEventListener('click', () => {
          this.draft.quickPaths.splice(idx, 1);
          this.renderContent();
          const nextIdx = Math.min(idx, this.draft.quickPaths.length - 1);
          this.focusFid(nextIdx >= 0 ? `qp-del-${nextIdx}` : 'qp-add');
        });

        row.append(input, remove);
        list.appendChild(row);
      });
      container.appendChild(list);

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'btn-primary';
      addBtn.dataset.fid = 'qp-add';
      addBtn.textContent = t('settings.quickPathsAdd', lang);
      addBtn.addEventListener('click', () => this.addQuickPath());
      container.appendChild(addBtn);
      return;
    }

    if (this.activeTab === 'import') {
      this.renderImportTab(container, lang);
      return;
    }

    if (this.activeTab === 'css') {
      const hint = document.createElement('p');
      hint.className = 'muted-note';
      hint.textContent = t('settings.cssHint', lang);

      const editor = document.createElement('textarea');
      editor.className = 'code-editor';
      editor.rows = 16;
      editor.spellcheck = false;
      editor.dataset.fid = 'css-editor';
      editor.value = this.cssDraft;
      editor.addEventListener('input', () => {
        this.cssDraft = editor.value;
        this.emitPreview();
      });

      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'btn-primary';
      applyBtn.dataset.fid = 'css-save';
      applyBtn.textContent = t('settings.save', lang);
      applyBtn.addEventListener('click', async () => {
        applyBtn.disabled = true;
        try {
          const next = await saveCustomCss(this.cssDraft);
          await this.commit(next);
          // Mantém o restante do draft em preview após o commit do CSS
          if (this.snapshot() !== this.baseline) this.emitPreview();
          this.showToast(t('settings.saved', lang), 'success');
        } catch (err) {
          this.showToast(`${t('settings.cssSaveError', lang)} ${errText(err)}`, 'error');
        } finally {
          applyBtn.disabled = false;
        }
      });

      container.append(hint, editor, applyBtn);
      return;
    }

    if (this.activeTab === 'json') {
      const hint = document.createElement('p');
      hint.className = 'muted-note';
      hint.textContent = t('settings.jsonHint', lang);

      if (!this.jsonDirty) {
        this.jsonDraft = this.serializeDraftForJson();
      }

      const editor = document.createElement('textarea');
      editor.className = 'code-editor';
      editor.rows = 18;
      editor.spellcheck = false;
      editor.dataset.fid = 'json-editor';
      editor.value = this.jsonDraft;
      editor.addEventListener('input', () => {
        this.jsonDraft = editor.value;
        this.jsonDirty = true;
      });

      const errEl = document.createElement('p');
      errEl.className = 'import-status';

      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'btn-primary';
      applyBtn.dataset.fid = 'json-apply';
      applyBtn.textContent = t('settings.applyRaw', lang);
      applyBtn.addEventListener('click', async () => {
        errEl.textContent = '';
        errEl.classList.remove('is-error');
        let raw = this.jsonDraft;
        try {
          const parsed = JSON.parse(raw) as Partial<AppSettings>;
          const media = parsed.background?.mediaDataUrl;
          if (parsed.background && typeof media === 'string' && media.startsWith(MEDIA_PLACEHOLDER)) {
            parsed.background.mediaDataUrl = this.draft.background.mediaDataUrl;
            raw = JSON.stringify(parsed, null, 2);
          }
        } catch (err) {
          errEl.textContent = `${t('settings.jsonParseError', lang)} ${errText(err)}`;
          errEl.classList.add('is-error');
          return;
        }
        applyBtn.disabled = true;
        try {
          const next = await saveRawSettings(raw);
          this.draft = this.normalizeDraft(structuredClone(next.settings));
          this.baseline = this.snapshot();
          this.jsonDirty = false;
          await this.commit(next);
          this.showToast(t('settings.saved', lang), 'success');
          this.renderContent();
        } catch (err) {
          errEl.textContent = errText(err);
          errEl.classList.add('is-error');
        } finally {
          applyBtn.disabled = false;
        }
      });

      container.append(hint, editor, applyBtn, errEl);
    }
  }

  private addQuickPath(): void {
    this.draft.quickPaths.push('');
    this.renderContent();
    this.focusFid(`qp-${this.draft.quickPaths.length - 1}`);
  }

  /** JSON exibido sem o dataURL da mídia (pode ter vários MB); restaurado ao aplicar. */
  private serializeDraftForJson(): string {
    return JSON.stringify(
      this.draft,
      (key, value: unknown) => {
        if (key === 'mediaDataUrl' && typeof value === 'string' && value.length > 0) {
          return `${MEDIA_PLACEHOLDER}: ${Math.max(1, Math.round(value.length / 1024))} KB>>`;
        }
        return value;
      },
      2
    );
  }

  /* ------------------------------------------------------------------ */
  /* Temas: grade, exclusão e importação                                  */
  /* ------------------------------------------------------------------ */

  private buildThemeGrid(lang: string): HTMLElement {
    const grid = document.createElement('div');
    grid.className = 'theme-cards-grid';

    const syncSelection = () => {
      grid.querySelectorAll<HTMLButtonElement>('.theme-card').forEach((card) => {
        const theme = this.bundle.themes.find((th) => th.id === card.dataset.themeId);
        const active = card.dataset.themeId === this.draft.theme;
        card.classList.toggle('active', active);
        card.setAttribute('aria-pressed', active ? 'true' : 'false');
        card.style.borderColor = active && theme ? theme.accent : '';
      });
    };

    for (const theme of this.bundle.themes) {
      const wrap = document.createElement('div');
      wrap.className = 'theme-card-wrap';

      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'theme-card';
      card.dataset.themeId = theme.id;
      card.dataset.fid = `theme-${theme.id}`;

      const top = document.createElement('div');
      top.className = 'theme-card-top';
      const titleEl = document.createElement('strong');
      titleEl.textContent = theme.name;
      const badgeEl = document.createElement('span');
      badgeEl.className = 'theme-badge';
      badgeEl.textContent = theme.category;
      top.append(titleEl, badgeEl);

      const swatchesWrap = document.createElement('div');
      swatchesWrap.className = 'theme-swatches';
      for (const c of [
        theme.colors.background,
        theme.accent,
        theme.accentSecondary,
        theme.colors.green,
        theme.colors.yellow,
        theme.colors.cyan,
      ]) {
        swatchesWrap.appendChild(createColorSwatchDot(c, 16));
      }

      card.append(top, swatchesWrap, createThemePreviewStrip(theme));
      card.addEventListener('click', () => {
        if (this.draft.theme === theme.id) return;
        this.draft.theme = theme.id;
        this.emitPreview();
        syncSelection();
      });
      wrap.appendChild(card);

      if (!BUILTIN_THEME_IDS.has(theme.id)) {
        wrap.classList.add('is-removable');
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'theme-card-delete';
        del.dataset.fid = `theme-del-${theme.id}`;
        del.textContent = '✕';
        del.title = t('settings.themeDelete', lang);
        del.setAttribute('aria-label', `${t('settings.themeDelete', lang)}: ${theme.name}`);
        del.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.confirmDeleteTheme(theme);
        });
        wrap.appendChild(del);
      }
      grid.appendChild(wrap);
    }
    syncSelection();
    return grid;
  }

  private confirmDeleteTheme(theme: ThemeConfig): void {
    const lang = this.draft.language;
    this.hooks.confirm({
      title: t('settings.themeDeleteTitle', lang),
      message: t('settings.themeDeleteMessage', lang, { name: theme.name }),
      preview: theme.id,
      confirmLabel: t('settings.themeDelete', lang),
      danger: true,
      initialFocus: 'cancel',
      onConfirm: () => void this.deleteThemeNow(theme),
    });
  }

  private async deleteThemeNow(theme: ThemeConfig): Promise<void> {
    const lang = this.draft.language;
    try {
      let next = await deleteTheme(theme.id);
      if (next.settings.theme === theme.id) {
        next = await saveSettings({
          ...next.settings,
          ...(this.hooks.getLiveOverrides?.() ?? {}),
          theme: DEFAULT_THEME_ID,
        });
      }
      if (this.draft.theme === theme.id) {
        this.draft.theme = DEFAULT_THEME_ID;
      }
      // O tema salvo também mudou: ajusta a linha de base para não acusar alteração falsa
      try {
        const base = JSON.parse(this.baseline) as AppSettings;
        if (base.theme === theme.id) {
          base.theme = DEFAULT_THEME_ID;
          this.baseline = JSON.stringify(base);
        }
      } catch {
        // linha de base inválida: mantém
      }
      if (!this.isOpen) return;
      await this.commit(next);
      this.emitPreview();
      this.renderContent();
      this.showToast(t('settings.themeDeleted', lang, { name: theme.name }), 'success');
    } catch (err) {
      this.showToast(`${t('settings.themeDeleteError', lang)} ${errText(err)}`, 'error');
    }
  }

  private renderImportTab(container: HTMLElement, lang: string): void {
    const hint = document.createElement('p');
    hint.className = 'muted-note';
    hint.textContent = t('settings.importHint', lang);

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,.jsonc,.itermcolors,.toml,.yml,.yaml';
    fileInput.dataset.fid = 'import-file';

    const textarea = document.createElement('textarea');
    textarea.className = 'code-editor';
    textarea.rows = 12;
    textarea.spellcheck = false;
    textarea.dataset.fid = 'import-text';
    textarea.placeholder = '{ "name": "Meu Tema", "background": "#0b0716", ... }';

    // Seletor exibido quando o arquivo contém vários esquemas (settings.json do Windows Terminal)
    const pickerRow = document.createElement('div');
    pickerRow.className = 'setting-row import-picker';
    pickerRow.hidden = true;
    const pickerLabel = document.createElement('label');
    pickerLabel.textContent = t('settings.importPick', lang);
    const picker = document.createElement('select');
    picker.dataset.fid = 'import-picker';
    pickerRow.append(pickerLabel, picker);

    const msg = document.createElement('p');
    msg.className = 'import-status';

    let candidates: ThemeConfig[] = [];
    const refreshCandidates = () => {
      candidates = importExternalThemes(
        textarea.value,
        fileInput.files?.[0]?.name,
        this.bundle.themes.map((th) => th.id)
      );
      const previous = picker.value;
      picker.innerHTML = '';
      if (candidates.length > 1) {
        const all = document.createElement('option');
        all.value = 'all';
        all.textContent = t('settings.importAll', lang, { n: candidates.length });
        picker.appendChild(all);
        candidates.forEach((th, i) => {
          const opt = document.createElement('option');
          opt.value = String(i);
          opt.textContent = th.name;
          picker.appendChild(opt);
        });
        if (previous && Array.from(picker.options).some((o) => o.value === previous)) {
          picker.value = previous;
        }
        pickerRow.hidden = false;
      } else {
        pickerRow.hidden = true;
      }
    };

    let parseTimer: number | null = null;
    textarea.addEventListener('input', () => {
      if (parseTimer !== null) window.clearTimeout(parseTimer);
      parseTimer = window.setTimeout(() => {
        parseTimer = null;
        refreshCandidates();
      }, 220);
    });

    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      f.text()
        .then((txt) => {
          textarea.value = txt;
          refreshCandidates();
        })
        .catch(() => this.showToast(t('settings.fileReadError', lang), 'error'));
    });

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-primary';
    btn.dataset.fid = 'import-apply';
    btn.textContent = t('settings.importButton', lang);
    btn.addEventListener('click', async () => {
      msg.textContent = '';
      msg.classList.remove('is-error');
      refreshCandidates();
      if (candidates.length === 0) {
        msg.textContent = t('settings.importError', lang);
        msg.classList.add('is-error');
        return;
      }
      const selected =
        !pickerRow.hidden && picker.value !== 'all' ? [candidates[Number(picker.value)]].filter(Boolean) : candidates;

      btn.disabled = true;
      try {
        for (const theme of selected) {
          this.bundle = await saveTheme(theme);
        }
      } catch (err) {
        btn.disabled = false;
        this.showToast(`${t('settings.importSaveError', lang)} ${errText(err)}`, 'error');
        return;
      }
      this.draft.theme = selected[0].id;
      const ok = await this.persistAll();
      btn.disabled = false;
      if (ok) {
        this.showToast(t('settings.importSuccessN', lang, { n: selected.length }), 'success');
        refreshCandidates();
      }
    });

    container.append(hint, fileInput, textarea, pickerRow, btn, msg);
  }

  /* ------------------------------------------------------------------ */
  /* Construtores de linha                                                */
  /* ------------------------------------------------------------------ */

  private makeSelectRow(
    key: TranslationKey,
    value: string,
    options: Array<{ value: string; label: string }>,
    onChange: (val: string) => void
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'setting-row';
    const id = `set-${key.replace(/\W+/g, '-')}`;
    const lbl = document.createElement('label');
    lbl.htmlFor = id;
    lbl.textContent = t(key, this.draft.language);
    const select = document.createElement('select');
    select.id = id;
    select.dataset.fid = key;
    for (const opt of options) {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      if (opt.value === value) o.selected = true;
      select.appendChild(o);
    }
    select.addEventListener('change', () => onChange(select.value));
    row.append(lbl, select);
    return row;
  }

  private makeSliderRow(
    key: TranslationKey,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (val: number) => void
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'setting-row';
    const id = `set-${key.replace(/\W+/g, '-')}`;
    const lbl = document.createElement('label');
    lbl.htmlFor = id;
    lbl.textContent = t(key, this.draft.language);

    const right = document.createElement('div');
    right.className = 'slider-wrap';

    const input = document.createElement('input');
    input.type = 'range';
    input.id = id;
    input.dataset.fid = key;
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);

    const valSpan = document.createElement('span');
    valSpan.className = 'slider-val';
    valSpan.textContent = String(value);

    input.addEventListener('input', () => {
      const num = parseFloat(input.value);
      valSpan.textContent = String(num);
      onChange(num);
    });

    right.append(input, valSpan);
    row.append(lbl, right);
    return row;
  }

  private makeToggleRow(
    key: TranslationKey,
    checked: boolean,
    onChange: (checked: boolean) => void
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'setting-row';
    const id = `set-${key.replace(/\W+/g, '-')}`;
    const lbl = document.createElement('label');
    lbl.htmlFor = id;
    lbl.textContent = t(key, this.draft.language);
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.dataset.fid = key;
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    row.append(lbl, input);
    return row;
  }

  private makeShaderToggleAndSlider(
    key: TranslationKey,
    enabled: boolean,
    intensity: number,
    onToggle: (b: boolean) => void,
    onIntensity: (v: number) => void
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'setting-row';
    const label = t(key, this.draft.language);

    const left = document.createElement('label');
    left.className = 'checkbox-label';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.fid = `${key}-on`;
    cb.checked = enabled;
    cb.addEventListener('change', () => onToggle(cb.checked));
    left.append(cb, document.createTextNode(` ${label}`));

    const right = document.createElement('div');
    right.className = 'slider-wrap';
    const range = document.createElement('input');
    range.type = 'range';
    range.dataset.fid = `${key}-val`;
    range.setAttribute('aria-label', label);
    range.min = '0';
    range.max = '1';
    range.step = '0.02';
    range.value = String(intensity);

    const valSpan = document.createElement('span');
    valSpan.className = 'slider-val';
    valSpan.textContent = intensity.toFixed(2);

    range.addEventListener('input', () => {
      const v = parseFloat(range.value);
      valSpan.textContent = v.toFixed(2);
      onIntensity(v);
    });

    right.append(range, valSpan);
    row.append(left, right);
    return row;
  }

  private makeTextRow(key: TranslationKey, value: string, onChange: (val: string) => void): HTMLElement {
    return this.makeRawTextRow(t(key, this.draft.language), key, value, onChange);
  }

  private makeRawTextRow(
    label: string,
    fid: string,
    value: string,
    onChange: (val: string) => void
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'setting-row';
    const id = `set-${fid.replace(/\W+/g, '-')}`;
    const lbl = document.createElement('label');
    lbl.htmlFor = id;
    lbl.textContent = label;
    const input = document.createElement('input');
    input.type = 'text';
    input.id = id;
    input.spellcheck = false;
    input.dataset.fid = fid;
    input.value = value;
    input.addEventListener('input', () => onChange(input.value));
    row.append(lbl, input);
    return row;
  }

  private makeGridInput(
    label: string,
    fid: string,
    value: string,
    onChange: (val: string) => void,
    placeholder?: string
  ): HTMLElement {
    const lbl = document.createElement('label');
    lbl.append(`${label} `);
    const input = document.createElement('input');
    input.type = 'text';
    input.spellcheck = false;
    input.dataset.fid = fid;
    input.value = value;
    if (placeholder) input.placeholder = placeholder;
    input.addEventListener('input', () => onChange(input.value));
    lbl.appendChild(input);
    return lbl;
  }

  private makeColorRow(key: TranslationKey, value: string, onChange: (val: string) => void): HTMLElement {
    const row = document.createElement('div');
    row.className = 'setting-row';
    const id = `set-${key.replace(/\W+/g, '-')}`;
    const lbl = document.createElement('label');
    lbl.htmlFor = id;
    lbl.textContent = t(key, this.draft.language);
    const input = document.createElement('input');
    input.type = 'color';
    input.id = id;
    input.dataset.fid = key;
    input.value = value.startsWith('#') ? value : '#ff2a85';
    input.addEventListener('input', () => onChange(input.value));
    row.append(lbl, input);
    return row;
  }
}

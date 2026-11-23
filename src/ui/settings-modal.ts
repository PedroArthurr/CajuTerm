import { REACTION_ITEMS, type ReactionKind } from '../fx/sound-fx';
import { t } from '../i18n';
import { importExternalTheme } from '../theme-importer';
import { createColorSwatchDot, createThemePreviewStrip } from '../themes';
import {
  installFontBase64,
  openConfigDir,
  saveCustomCss,
  saveRawSettings,
  saveSettings,
  saveTheme,
  updateQuakeShortcut,
} from '../terminal/pty-bridge';
import type { AppSettings, ConfigBundle, ProfileConfig, SnippetItem, SoundPreset, ThemeConfig } from '../types';

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
  | 'import'
  | 'css'
  | 'json';

export interface SettingsModalHooks {
  onLivePreview: (draft: AppSettings, themes: ThemeConfig[], customCss: string) => void;
  onBundleCommitted: (bundle: ConfigBundle) => void;
  onTestSound?: (kind: 'messageEnd' | ReactionKind) => void;
}

export class SettingsModal {
  private root: HTMLElement;
  private hooks: SettingsModalHooks;
  private isOpen = false;
  private activeTab: SettingsTabId = 'appearance';

  private bundle!: ConfigBundle;
  private draft!: AppSettings;
  private cssDraft = '';
  private jsonDraft = '';
  private toastMsg = '';

  constructor(root: HTMLElement, hooks: SettingsModalHooks) {
    this.root = root;
    this.hooks = hooks;
  }

  public isModalOpen(): boolean {
    return this.isOpen;
  }

  public open(bundle: ConfigBundle): void {
    this.bundle = bundle;
    this.draft = structuredClone(bundle.settings);
    this.cssDraft = bundle.customCss;
    this.jsonDraft = JSON.stringify(bundle.settings, null, 2);
    this.toastMsg = '';
    this.isOpen = true;
    this.render();
  }

  public close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.innerHTML = '';
  }

  public toggle(bundle: ConfigBundle): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open(bundle);
    }
  }

  private emitPreview(): void {
    this.jsonDraft = JSON.stringify(this.draft, null, 2);
    this.hooks.onLivePreview(this.draft, this.bundle.themes, this.cssDraft);
  }

  private async persistSettings(): Promise<void> {
    const next = await saveSettings(this.draft);
    await updateQuakeShortcut(this.draft.keybindings.quakeGlobal);
    this.bundle = next;
    this.toastMsg = t('settings.saved', this.draft.language);
    this.hooks.onBundleCommitted(next);
    this.render();
  }

  private render(): void {
    if (!this.isOpen) return;
    const lang = this.draft.language;
    this.root.innerHTML = '';

    const backdrop = document.createElement('div');
    backdrop.className = 'settings-backdrop';
    backdrop.addEventListener('click', (ev) => {
      if (ev.target === backdrop) this.close();
    });

    const modal = document.createElement('div');
    modal.className = 'settings-modal';

    // Cabeçalho
    const header = document.createElement('div');
    header.className = 'settings-header';
    header.innerHTML = `
      <div>
        <h2>${t('settings.title', lang)}</h2>
        <p class="settings-subtitle">${t('settings.subtitle', lang)} • <code>${this.bundle.configDir}</code></p>
      </div>
    `;

    const headerActions = document.createElement('div');
    headerActions.className = 'settings-header-actions';

    const folderBtn = document.createElement('button');
    folderBtn.className = 'btn-secondary';
    folderBtn.textContent = t('settings.openFolder', lang);
    folderBtn.addEventListener('click', () => void openConfigDir());

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn-primary';
    saveBtn.textContent = t('settings.save', lang);
    saveBtn.addEventListener('click', () => void this.persistSettings());

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn-secondary';
    closeBtn.textContent = t('settings.close', lang);
    closeBtn.addEventListener('click', () => this.close());

    headerActions.append(folderBtn, saveBtn, closeBtn);
    header.appendChild(headerActions);

    // Corpo: Sidebar + Painel
    const body = document.createElement('div');
    body.className = 'settings-body';

    const nav = document.createElement('aside');
    nav.className = 'settings-nav';

    const tabEntries: Array<{ id: SettingsTabId; label: string }> = [
      { id: 'appearance', label: t('settings.tab.appearance', lang) },
      { id: 'background', label: t('settings.tab.background', lang) },
      { id: 'shaders', label: t('settings.tab.shaders', lang) },
      { id: 'cursor', label: t('settings.tab.cursor', lang) },
      { id: 'sounds', label: t('settings.tab.sounds', lang) },
      { id: 'snippets', label: t('settings.tab.snippets', lang) },
      { id: 'fonts', label: t('settings.tab.fonts', lang) },
      { id: 'profiles', label: t('settings.tab.profiles', lang) },
      { id: 'keybindings', label: t('settings.tab.keybindings', lang) },
      { id: 'import', label: t('settings.tab.import', lang) },
      { id: 'css', label: t('settings.tab.css', lang) },
      { id: 'json', label: t('settings.tab.json', lang) },
    ];

    for (const item of tabEntries) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `settings-nav-btn${item.id === this.activeTab ? ' active' : ''}`;
      b.textContent = item.label;
      b.addEventListener('click', () => {
        this.activeTab = item.id;
        this.render();
      });
      nav.appendChild(b);
    }

    const content = document.createElement('section');
    content.className = 'settings-content';
    if (this.toastMsg) {
      const toast = document.createElement('div');
      toast.className = 'settings-toast';
      toast.textContent = this.toastMsg;
      content.appendChild(toast);
    }

    this.renderTabContent(content);
    body.append(nav, content);
    modal.append(header, body);
    backdrop.appendChild(modal);
    this.root.appendChild(backdrop);
  }

  private renderTabContent(container: HTMLElement): void {
    const lang = this.draft.language;

    if (this.activeTab === 'appearance') {
      // Idioma
      container.appendChild(
        this.makeSelectRow(t('settings.language', lang), this.draft.language, [
          { value: 'pt-BR', label: 'Português (Brasil)' },
          { value: 'en-US', label: 'English (US)' },
          { value: 'es-ES', label: 'Español' },
        ], (val) => {
          this.draft.language = val;
          this.emitPreview();
          this.render();
        })
      );

      // Grade visual de Temas
      const themesHeading = document.createElement('h3');
      themesHeading.className = 'section-heading';
      themesHeading.textContent = t('settings.theme', lang);
      container.appendChild(themesHeading);

      const grid = document.createElement('div');
      grid.className = 'theme-cards-grid';
      for (const theme of this.bundle.themes) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = `theme-card${theme.id === this.draft.theme ? ' active' : ''}`;
        card.style.borderColor = theme.id === this.draft.theme ? theme.accent : '';

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

        const previewStrip = createThemePreviewStrip(theme);

        card.append(top, swatchesWrap, previewStrip);
        card.addEventListener('click', () => {
          this.draft.theme = theme.id;
          this.emitPreview();
          this.render();
        });
        grid.appendChild(card);
      }
      container.appendChild(grid);

      // Material Windows & Sliders
      container.appendChild(
        this.makeSelectRow(t('settings.vibrancy', lang), this.draft.vibrancy, [
          { value: 'acrylic', label: 'Windows Acrylic (Translúcido)' },
          { value: 'mica', label: 'Windows 11 Mica' },
          { value: 'none', label: 'Desativado (Sólido / CSS)' },
        ], (val) => {
          this.draft.vibrancy = val as AppSettings['vibrancy'];
          this.emitPreview();
        })
      );

      container.appendChild(
        this.makeSliderRow(t('settings.opacity', lang), this.draft.opacity, 0.25, 1.0, 0.02, (v) => {
          this.draft.opacity = v;
          this.emitPreview();
        })
      );

      container.appendChild(
        this.makeSliderRow(t('settings.blur', lang), this.draft.blur, 0, 32, 1, (v) => {
          this.draft.blur = v;
          this.emitPreview();
        })
      );

      container.appendChild(
        this.makeSliderRow(t('settings.fontSize', lang), this.draft.fontSize, 10, 28, 1, (v) => {
          this.draft.fontSize = v;
          this.emitPreview();
        })
      );

      container.appendChild(
        this.makeSliderRow(t('settings.lineHeight', lang), this.draft.lineHeight, 1.0, 1.8, 0.02, (v) => {
          this.draft.lineHeight = v;
          this.emitPreview();
        })
      );

      container.appendChild(
        this.makeToggleRow(t('settings.ligatures', lang), this.draft.ligatures, (checked) => {
          this.draft.ligatures = checked;
          this.emitPreview();
        })
      );

      container.appendChild(
        this.makeSliderRow(t('settings.scrollback', lang), this.draft.scrollback, 1000, 50000, 1000, (v) => {
          this.draft.scrollback = v;
          this.emitPreview();
        })
      );

      container.appendChild(
        this.makeSliderRow(t('settings.themeTransition', lang), this.draft.animations.themeTransitionMs, 0, 1000, 20, (v) => {
          this.draft.animations.themeTransitionMs = v;
          this.emitPreview();
        })
      );

      container.appendChild(
        this.makeToggleRow(t('settings.tabFade', lang), this.draft.animations.tabFade, (checked) => {
          this.draft.animations.tabFade = checked;
          this.emitPreview();
        })
      );
      return;
    }

    if (this.activeTab === 'background') {
      container.appendChild(
        this.makeSelectRow(t('settings.bgMode', lang), this.draft.background.mode, [
          { value: 'solid', label: 'Cor Sólida / Acrylic' },
          { value: 'gradient', label: 'Gradiente Neon' },
          { value: 'image', label: 'Imagem / GIF Animado' },
          { value: 'video', label: 'Vídeo em Loop (.mp4/.webm)' },
        ], (val) => {
          this.draft.background.mode = val as AppSettings['background']['mode'];
          this.emitPreview();
          this.render();
        })
      );

      container.appendChild(
        this.makeTextRow(t('settings.bgGradient', lang), this.draft.background.gradient, (val) => {
          this.draft.background.gradient = val;
          this.emitPreview();
        })
      );

      const uploadRow = document.createElement('div');
      uploadRow.className = 'setting-row';
      uploadRow.innerHTML = `<label>${t('settings.bgUpload', lang)}</label>`;
      const controls = document.createElement('div');
      controls.className = 'inline-controls';

      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*,video/mp4,video/webm';
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
          this.render();
        };
        reader.readAsDataURL(file);
      });

      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'btn-secondary';
      clearBtn.textContent = t('settings.bgClear', lang);
      clearBtn.addEventListener('click', () => {
        this.draft.background.mediaDataUrl = '';
        this.draft.background.mediaName = '';
        this.draft.background.mode = 'gradient';
        this.emitPreview();
        this.render();
      });

      controls.append(fileInput, clearBtn);
      uploadRow.appendChild(controls);
      container.appendChild(uploadRow);

      container.appendChild(
        this.makeSliderRow(t('settings.bgOpacity', lang), this.draft.background.mediaOpacity, 0, 1, 0.02, (v) => {
          this.draft.background.mediaOpacity = v;
          this.emitPreview();
        })
      );

      container.appendChild(
        this.makeSliderRow(t('settings.bgBlur', lang), this.draft.background.mediaBlur, 0, 24, 1, (v) => {
          this.draft.background.mediaBlur = v;
          this.emitPreview();
        })
      );
      return;
    }

    if (this.activeTab === 'shaders') {
      const s = this.draft.shaders;
      container.appendChild(
        this.makeToggleRow(t('settings.shaderMaster', lang), s.enabled, (v) => {
          s.enabled = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeShaderToggleAndSlider(
          t('settings.shaderScanlines', lang),
          s.scanlines,
          s.scanlinesIntensity,
          (b) => { s.scanlines = b; this.emitPreview(); },
          (v) => { s.scanlinesIntensity = v; this.emitPreview(); }
        )
      );
      container.appendChild(
        this.makeShaderToggleAndSlider(
          t('settings.shaderCurvature', lang),
          s.curvature,
          s.curvatureIntensity,
          (b) => { s.curvature = b; this.emitPreview(); },
          (v) => { s.curvatureIntensity = v; this.emitPreview(); }
        )
      );
      container.appendChild(
        this.makeShaderToggleAndSlider(
          t('settings.shaderBloom', lang),
          s.bloom,
          s.bloomIntensity,
          (b) => { s.bloom = b; this.emitPreview(); },
          (v) => { s.bloomIntensity = v; this.emitPreview(); }
        )
      );
      container.appendChild(
        this.makeShaderToggleAndSlider(
          t('settings.shaderChromatic', lang),
          s.chromaticAberration,
          s.chromaticIntensity,
          (b) => { s.chromaticAberration = b; this.emitPreview(); },
          (v) => { s.chromaticIntensity = v; this.emitPreview(); }
        )
      );
      container.appendChild(
        this.makeShaderToggleAndSlider(
          t('settings.shaderNoise', lang),
          s.noise,
          s.noiseIntensity,
          (b) => { s.noise = b; this.emitPreview(); },
          (v) => { s.noiseIntensity = v; this.emitPreview(); }
        )
      );
      container.appendChild(
        this.makeShaderToggleAndSlider(
          t('settings.shaderFlicker', lang),
          s.flicker,
          s.flickerIntensity,
          (b) => { s.flicker = b; this.emitPreview(); },
          (v) => { s.flickerIntensity = v; this.emitPreview(); }
        )
      );
      return;
    }

    if (this.activeTab === 'cursor') {
      container.appendChild(
        this.makeSelectRow(t('settings.cursorStyle', lang), this.draft.cursor.style, [
          { value: 'block', label: 'Block' },
          { value: 'bar', label: 'Bar (|)' },
          { value: 'underline', label: 'Underline (_)' },
        ], (val) => {
          this.draft.cursor.style = val as AppSettings['cursor']['style'];
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeToggleRow(t('settings.cursorBlink', lang), this.draft.cursor.blink, (v) => {
          this.draft.cursor.blink = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeToggleRow(t('settings.cursorPulse', lang), this.draft.cursor.pulse, (v) => {
          this.draft.cursor.pulse = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeToggleRow(t('settings.cursorTrail', lang), this.draft.cursor.trail, (v) => {
          this.draft.cursor.trail = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeColorRow(t('settings.cursorColor', lang), this.draft.cursor.color, (v) => {
          this.draft.cursor.color = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeColorRow(t('settings.cursorTrailColor', lang), this.draft.cursor.trailColor, (v) => {
          this.draft.cursor.trailColor = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeToggleRow(t('settings.typingParticles', lang), this.draft.animations.typingParticles, (v) => {
          this.draft.animations.typingParticles = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeSliderRow(t('settings.particleCount', lang), this.draft.animations.particleCount, 1, 18, 1, (v) => {
          this.draft.animations.particleCount = v;
          this.emitPreview();
        })
      );
      return;
    }

    if (this.activeTab === 'sounds') {
      const snd = this.draft.sounds;
      container.appendChild(
        this.makeToggleRow('Ativar Efeitos de Som (Master)', snd.enabled, (v) => {
          snd.enabled = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeSelectRow('Estilo / Timbre Sonoro', snd.preset, [
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
        this.makeSliderRow('Volume Geral', snd.volume, 0, 1, 0.05, (v) => {
          snd.volume = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeToggleRow('Som de Fim de Mensagem (resposta do agente / comando longo)', snd.messageEnd, (v) => {
          snd.messageEnd = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeSliderRow('Silêncio para Fim de Mensagem (ms)', snd.idleThresholdMs, 400, 4000, 100, (v) => {
          snd.idleThresholdMs = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeToggleRow('Som de Bell / Pedido de Permissão (\\x07)', snd.bell, (v) => {
          snd.bell = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeToggleRow('Alerta Sonoro ao Detectar Erro / Exit != 0', snd.errorAlert, (v) => {
          snd.errorAlert = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeToggleRow('Efeitos Sonoros de Reações (Soundboard & Bursts)', snd.reactions, (v) => {
          snd.reactions = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeToggleRow('Som ao Enviar Snippet / Comando', snd.snippetSend, (v) => {
          snd.snippetSend = v;
          this.emitPreview();
        })
      );
      container.appendChild(
        this.makeToggleRow('Som Mecânico Sutil ao Digitar', snd.typingTick, (v) => {
          snd.typingTick = v;
          this.emitPreview();
        })
      );

      const testHeading = document.createElement('h3');
      testHeading.className = 'section-heading';
      testHeading.textContent = 'Testar Efeitos & Reações';
      container.appendChild(testHeading);

      const testRow = document.createElement('div');
      testRow.className = 'installed-fonts-list';

      const msgBtn = document.createElement('button');
      msgBtn.type = 'button';
      msgBtn.className = 'btn-secondary';
      msgBtn.textContent = '✨ Fim de Mensagem';
      msgBtn.addEventListener('click', () => this.hooks.onTestSound?.('messageEnd'));
      testRow.appendChild(msgBtn);

      for (const item of REACTION_ITEMS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn-secondary';
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
        this.makeToggleRow('Pedir confirmação antes de executar /clear ou /cl3ar', this.draft.confirmClear, (v) => {
          this.draft.confirmClear = v;
          this.emitPreview();
        })
      );

      const note = document.createElement('p');
      note.className = 'muted-note';
      note.textContent =
        'Os snippets nativos (agy --dangerously-skip-permissions, claude --dangerously-skip-permissions, /clear e todos os comandos / de AGY e Claude Code) estão disponíveis no botão ⚡ da barra superior e em Ctrl+Shift+P.';
      container.appendChild(note);

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'btn-primary';
      addBtn.textContent = '+ Novo Snippet Personalizado';
      addBtn.addEventListener('click', () => {
        const item: SnippetItem = {
          id: `custom-${Date.now()}`,
          label: 'Meu Snippet',
          command: 'agy --dangerously-skip-permissions',
          category: 'Personalizados',
          description: 'Atalho personalizado',
          aliases: [],
          autoEnter: true,
          confirm: false,
        };
        this.draft.customSnippets.push(item);
        this.emitPreview();
        this.render();
      });
      container.appendChild(addBtn);

      this.draft.customSnippets.forEach((snip, idx) => {
        const card = document.createElement('div');
        card.className = 'profile-editor-card';
        card.innerHTML = `
          <div class="profile-grid">
            <label>Nome <input data-f="label" value="${escapeAttr(snip.label)}" /></label>
            <label>Comando <input data-f="command" value="${escapeAttr(snip.command)}" /></label>
            <label>Categoria <input data-f="category" value="${escapeAttr(snip.category)}" /></label>
            <label>Aliases (vírgula) <input data-f="aliases" value="${escapeAttr((snip.aliases ?? []).join(', '))}" /></label>
            <label>Descrição <input data-f="description" value="${escapeAttr(snip.description)}" /></label>
            <div class="snippet-flags-row">
              <label class="checkbox-label"><input type="checkbox" data-f="autoEnter" ${snip.autoEnter !== false ? 'checked' : ''} /> Enviar Enter automático</label>
              <label class="checkbox-label"><input type="checkbox" data-f="confirm" ${snip.confirm ? 'checked' : ''} /> Pedir confirmação</label>
            </div>
          </div>
        `;
        card.querySelectorAll<HTMLInputElement>('input').forEach((inp) => {
          const eventName = inp.type === 'checkbox' ? 'change' : 'input';
          inp.addEventListener(eventName, () => {
            const field = inp.dataset.f;
            if (field === 'label') snip.label = inp.value;
            if (field === 'command') snip.command = inp.value;
            if (field === 'category') snip.category = inp.value || 'Personalizados';
            if (field === 'description') snip.description = inp.value;
            if (field === 'aliases') {
              snip.aliases = inp.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
            }
            if (field === 'autoEnter') snip.autoEnter = inp.checked;
            if (field === 'confirm') snip.confirm = inp.checked;
            this.emitPreview();
          });
        });

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn-danger';
        del.textContent = t('settings.profileDelete', lang);
        del.addEventListener('click', () => {
          this.draft.customSnippets.splice(idx, 1);
          this.emitPreview();
          this.render();
        });
        card.appendChild(del);
        container.appendChild(card);
      });
      return;
    }

    if (this.activeTab === 'fonts') {
      container.appendChild(
        this.makeTextRow(t('settings.fontFamily', lang), this.draft.fontFamily, (val) => {
          this.draft.fontFamily = val;
          this.emitPreview();
        })
      );

      const uploadRow = document.createElement('div');
      uploadRow.className = 'setting-row';
      uploadRow.innerHTML = `<label>${t('settings.fontUpload', lang)}</label>`;

      const fontInput = document.createElement('input');
      fontInput.type = 'file';
      fontInput.accept = '.ttf,.otf,.woff,.woff2';
      fontInput.addEventListener('change', () => {
        const file = fontInput.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
          const dataUrl = String(reader.result || '');
          const next = await installFontBase64(file.name, dataUrl);
          this.bundle = next;
          const family = file.name.replace(/\.[^.]+$/, '');
          this.draft.fontFamily = `'${family}', ${this.draft.fontFamily}`;
          this.hooks.onBundleCommitted(next);
          this.emitPreview();
          this.render();
        };
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
        fontsList.innerHTML = `<p class="muted-note">Nenhuma fonte customizada em <code>${this.bundle.configDir}\\fonts</code>.</p>`;
      } else {
        for (const f of this.bundle.fonts) {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'font-chip';
          item.textContent = `${f.family} (${f.fileName})`;
          item.addEventListener('click', () => {
            this.draft.fontFamily = `'${f.family}', 'JetBrainsMono Nerd Font', monospace`;
            this.emitPreview();
            this.render();
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
      addBtn.textContent = t('settings.profileAdd', lang);
      addBtn.addEventListener('click', () => {
        const created: ProfileConfig = {
          id: `profile-${Date.now()}`,
          name: 'Novo Perfil PowerShell',
          shell: 'pwsh.exe',
          args: ['-NoLogo'],
          cwd: '~',
          themeId: null,
          env: {},
          shortcut: '',
        };
        this.draft.profiles.push(created);
        this.emitPreview();
        this.render();
      });
      container.appendChild(addBtn);

      this.draft.profiles.forEach((p, idx) => {
        const card = document.createElement('div');
        card.className = 'profile-editor-card';
        card.innerHTML = `
          <div class="profile-grid">
            <label>Nome <input data-f="name" value="${escapeAttr(p.name)}" /></label>
            <label>Shell <input data-f="shell" value="${escapeAttr(p.shell)}" /></label>
            <label>Args (espaço) <input data-f="args" value="${escapeAttr(p.args.join(' '))}" /></label>
            <label>CWD <input data-f="cwd" value="${escapeAttr(p.cwd)}" /></label>
            <label>Atalho <input data-f="shortcut" value="${escapeAttr(p.shortcut)}" /></label>
            <label>Tema ID <input data-f="themeId" value="${escapeAttr(p.themeId ?? '')}" placeholder="(Global)" /></label>
          </div>
        `;
        card.querySelectorAll<HTMLInputElement>('input').forEach((inp) => {
          inp.addEventListener('input', () => {
            const field = inp.dataset.f;
            if (field === 'name') p.name = inp.value;
            if (field === 'shell') p.shell = inp.value;
            if (field === 'args') p.args = inp.value.trim() ? inp.value.trim().split(/\s+/) : [];
            if (field === 'cwd') p.cwd = inp.value;
            if (field === 'shortcut') p.shortcut = inp.value;
            if (field === 'themeId') p.themeId = inp.value.trim() || null;
            this.emitPreview();
          });
        });
        if (this.draft.profiles.length > 1) {
          const del = document.createElement('button');
          del.type = 'button';
          del.className = 'btn-danger';
          del.textContent = t('settings.profileDelete', lang);
          del.addEventListener('click', () => {
            this.draft.profiles.splice(idx, 1);
            this.emitPreview();
            this.render();
          });
          card.appendChild(del);
        }
        container.appendChild(card);
      });
      return;
    }

    if (this.activeTab === 'keybindings') {
      const entries = Object.entries(this.draft.keybindings) as Array<
        [keyof AppSettings['keybindings'], string]
      >;
      for (const [key, val] of entries) {
        container.appendChild(
          this.makeTextRow(key, val, (nextVal) => {
            this.draft.keybindings[key] = nextVal;
            this.emitPreview();
          })
        );
      }
      return;
    }

    if (this.activeTab === 'import') {
      const hint = document.createElement('p');
      hint.className = 'muted-note';
      hint.textContent = t('settings.importHint', lang);

      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.json,.itermcolors,.toml,.yml,.yaml';

      const textarea = document.createElement('textarea');
      textarea.className = 'code-editor';
      textarea.rows = 12;
      textarea.placeholder = '{ "name": "Meu Tema", "background": "#0b0716", ... }';

      fileInput.addEventListener('change', () => {
        const f = fileInput.files?.[0];
        if (!f) return;
        f.text().then((txt) => {
          textarea.value = txt;
        });
      });

      const msg = document.createElement('p');
      msg.className = 'import-status';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-primary';
      btn.textContent = t('settings.importButton', lang);
      btn.addEventListener('click', async () => {
        const imported = importExternalTheme(textarea.value, fileInput.files?.[0]?.name);
        if (!imported) {
          msg.textContent = t('settings.importError', lang);
          msg.style.color = '#ff5ca8';
          return;
        }
        const nextBundle = await saveTheme(imported);
        this.bundle = nextBundle;
        this.draft.theme = imported.id;
        await this.persistSettings();
        this.toastMsg = t('settings.importSuccess', lang);
        this.render();
      });

      container.append(hint, fileInput, textarea, btn, msg);
      return;
    }

    if (this.activeTab === 'css') {
      const hint = document.createElement('p');
      hint.className = 'muted-note';
      hint.textContent = t('settings.cssHint', lang);

      const editor = document.createElement('textarea');
      editor.className = 'code-editor';
      editor.rows = 16;
      editor.value = this.cssDraft;
      editor.addEventListener('input', () => {
        this.cssDraft = editor.value;
        this.emitPreview();
      });

      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'btn-primary';
      applyBtn.textContent = t('settings.save', lang);
      applyBtn.addEventListener('click', async () => {
        const next = await saveCustomCss(this.cssDraft);
        this.bundle = next;
        this.toastMsg = t('settings.saved', lang);
        this.hooks.onBundleCommitted(next);
        this.render();
      });

      container.append(hint, editor, applyBtn);
      return;
    }

    if (this.activeTab === 'json') {
      const hint = document.createElement('p');
      hint.className = 'muted-note';
      hint.textContent = t('settings.jsonHint', lang);

      const editor = document.createElement('textarea');
      editor.className = 'code-editor';
      editor.rows = 18;
      editor.value = this.jsonDraft;
      editor.addEventListener('input', () => {
        this.jsonDraft = editor.value;
      });

      const errEl = document.createElement('p');
      errEl.className = 'import-status';

      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'btn-primary';
      applyBtn.textContent = t('settings.applyRaw', lang);
      applyBtn.addEventListener('click', async () => {
        try {
          const next = await saveRawSettings(this.jsonDraft);
          this.bundle = next;
          this.draft = structuredClone(next.settings);
          this.toastMsg = t('settings.saved', lang);
          this.hooks.onBundleCommitted(next);
          this.render();
        } catch (err) {
          errEl.textContent = String(err);
          errEl.style.color = '#ff5ca8';
        }
      });

      container.append(hint, editor, applyBtn, errEl);
    }
  }

  private makeSelectRow(
    label: string,
    value: string,
    options: Array<{ value: string; label: string }>,
    onChange: (val: string) => void
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'setting-row';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    const select = document.createElement('select');
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
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (val: number) => void
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'setting-row';
    const lbl = document.createElement('label');
    lbl.textContent = label;

    const right = document.createElement('div');
    right.className = 'slider-wrap';

    const input = document.createElement('input');
    input.type = 'range';
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
    label: string,
    checked: boolean,
    onChange: (checked: boolean) => void
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'setting-row';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    row.append(lbl, input);
    return row;
  }

  private makeShaderToggleAndSlider(
    label: string,
    enabled: boolean,
    intensity: number,
    onToggle: (b: boolean) => void,
    onIntensity: (v: number) => void
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'setting-row';

    const left = document.createElement('label');
    left.className = 'checkbox-label';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = enabled;
    cb.addEventListener('change', () => onToggle(cb.checked));
    left.append(cb, document.createTextNode(` ${label}`));

    const right = document.createElement('div');
    right.className = 'slider-wrap';
    const range = document.createElement('input');
    range.type = 'range';
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

  private makeTextRow(
    label: string,
    value: string,
    onChange: (val: string) => void
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'setting-row';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.addEventListener('input', () => onChange(input.value));
    row.append(lbl, input);
    return row;
  }

  private makeColorRow(
    label: string,
    value: string,
    onChange: (val: string) => void
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'setting-row';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    const input = document.createElement('input');
    input.type = 'color';
    input.value = value.startsWith('#') ? value : '#ff2a85';
    input.addEventListener('input', () => onChange(input.value));
    row.append(lbl, input);
    return row;
  }
}

function escapeAttr(val: string): string {
  return val.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

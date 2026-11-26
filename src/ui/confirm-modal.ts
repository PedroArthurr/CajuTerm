import { t } from '../i18n';
import { pushModal, runExitAnimation, type ModalHandle } from './modal-utils';

export interface ConfirmOptions {
  title: string;
  message: string;
  /** Texto exibido em monoespaçado (comando, trecho colado...). */
  preview?: string;
  /** 'block' preserva quebras de linha (preview multi-linha). */
  previewMode?: 'inline' | 'block';
  confirmLabel?: string;
  cancelLabel?: string;
  /** Estiliza o botão de confirmação como ação destrutiva. */
  danger?: boolean;
  /** Foco inicial: 'confirm' (padrão) ou 'cancel'. */
  initialFocus?: 'confirm' | 'cancel';
  onConfirm: () => void;
  onCancel?: () => void;
}

/**
 * Modal de confirmação reutilizável. Esc cancela (tratado pelo listener global
 * via `cancel()`); Enter ativa nativamente o botão focado; clique no fundo cancela.
 */
export class ConfirmModal {
  private root: HTMLElement;
  private getLang: () => string;
  private active: { opts: ConfirmOptions; handle: ModalHandle; backdrop: HTMLElement } | null = null;

  constructor(root: HTMLElement, getLang: () => string) {
    this.root = root;
    this.getLang = getLang;
  }

  public isOpen(): boolean {
    return this.active !== null;
  }

  public cancel(): void {
    this.finish(false);
  }

  public open(opts: ConfirmOptions): void {
    if (this.active) {
      // Substitui um modal já aberto sem disparar callbacks
      this.active.handle.release();
      this.active = null;
    }
    this.root.innerHTML = '';
    const lang = this.getLang();

    const backdrop = document.createElement('div');
    backdrop.className = 'confirm-backdrop';

    const box = document.createElement('div');
    box.className = 'confirm-box';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    box.tabIndex = -1;

    const titleId = `confirm-title-${Date.now()}`;
    const msgId = `${titleId}-msg`;
    box.setAttribute('aria-labelledby', titleId);
    box.setAttribute('aria-describedby', msgId);

    const titleEl = document.createElement('h3');
    titleEl.className = 'confirm-title';
    titleEl.id = titleId;
    titleEl.textContent = opts.title;

    const msgEl = document.createElement('p');
    msgEl.className = 'confirm-message';
    msgEl.id = msgId;
    msgEl.textContent = opts.message;

    box.append(titleEl, msgEl);

    if (opts.preview) {
      const codeEl = document.createElement(opts.previewMode === 'block' ? 'pre' : 'code');
      codeEl.className = `confirm-code${opts.previewMode === 'block' ? ' confirm-code-block' : ''}`;
      codeEl.textContent = opts.preview;
      box.appendChild(codeEl);
    }

    const actions = document.createElement('div');
    actions.className = 'confirm-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-secondary';
    cancelBtn.textContent = opts.cancelLabel ?? t('confirm.cancel', lang);

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = opts.danger ? 'btn-danger' : 'btn-primary';
    okBtn.textContent = opts.confirmLabel ?? t('confirm.run', lang);

    // Só cancela se o clique começou E terminou no fundo (arrastar de dentro para fora não fecha)
    let downOnBackdrop = false;
    backdrop.addEventListener('mousedown', (ev) => {
      downOnBackdrop = ev.target === backdrop;
      if (downOnBackdrop) ev.preventDefault();
    });
    backdrop.addEventListener('click', (ev) => {
      if (ev.target === backdrop && downOnBackdrop) this.finish(false);
      downOnBackdrop = false;
    });
    cancelBtn.addEventListener('click', () => this.finish(false));
    okBtn.addEventListener('click', () => this.finish(true));

    actions.append(cancelBtn, okBtn);
    box.appendChild(actions);
    backdrop.appendChild(box);
    this.root.appendChild(backdrop);

    const handle = pushModal(this.root, opts.initialFocus === 'cancel' ? cancelBtn : okBtn);
    this.active = { opts, handle, backdrop };
  }

  private finish(confirmed: boolean): void {
    const current = this.active;
    if (!current) return;
    this.active = null;
    // Libera primeiro (restaura foco/inert) e só então executa a ação escolhida
    current.handle.release();
    runExitAnimation(current.backdrop, 'is-closing', () => {
      if (current.backdrop.parentElement === this.root) {
        current.backdrop.remove();
      }
    }, 160);
    if (confirmed) {
      current.opts.onConfirm();
    } else {
      current.opts.onCancel?.();
    }
  }
}

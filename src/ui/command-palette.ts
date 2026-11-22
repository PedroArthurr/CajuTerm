import { t } from '../i18n';

export interface PaletteCommand {
  id: string;
  label: string;
  shortcut?: string;
  category?: string;
  run: () => void;
}

export class CommandPalette {
  private root: HTMLElement;
  private isOpen = false;
  private commands: PaletteCommand[] = [];
  private selectedIdx = 0;
  private lang = 'pt-BR';

  constructor(root: HTMLElement) {
    this.root = root;
  }

  public isPaletteOpen(): boolean {
    return this.isOpen;
  }

  public open(commands: PaletteCommand[], lang: string): void {
    this.commands = commands;
    this.lang = lang;
    this.selectedIdx = 0;
    this.isOpen = true;
    this.render('');
  }

  public close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.innerHTML = '';
  }

  public toggle(commands: PaletteCommand[], lang: string): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open(commands, lang);
    }
  }

  private render(initialQuery: string): void {
    this.root.innerHTML = '';

    const backdrop = document.createElement('div');
    backdrop.className = 'palette-backdrop';
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) this.close();
    });

    const box = document.createElement('div');
    box.className = 'palette-box';

    const input = document.createElement('input');
    input.className = 'palette-input';
    input.type = 'text';
    input.value = initialQuery;
    input.placeholder = t('palette.placeholder', this.lang);

    const list = document.createElement('div');
    list.className = 'palette-list';

    let filtered = this.commands;

    const refreshList = () => {
      const q = input.value.trim().toLowerCase();
      filtered = q
        ? this.commands.filter(
            (c) =>
              c.label.toLowerCase().includes(q) ||
              (c.category?.toLowerCase().includes(q) ?? false)
          )
        : this.commands;

      if (this.selectedIdx >= filtered.length) {
        this.selectedIdx = Math.max(0, filtered.length - 1);
      }

      list.innerHTML = '';
      if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'palette-empty';
        empty.textContent = t('palette.empty', this.lang);
        list.appendChild(empty);
        return;
      }

      filtered.forEach((cmd, idx) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = `palette-item${idx === this.selectedIdx ? ' selected' : ''}`;

        const left = document.createElement('span');
        left.className = 'palette-item-label';
        left.textContent = cmd.category ? `[${cmd.category}] ${cmd.label}` : cmd.label;

        row.appendChild(left);
        if (cmd.shortcut) {
          const kbd = document.createElement('kbd');
          kbd.className = 'palette-kbd';
          kbd.textContent = cmd.shortcut;
          row.appendChild(kbd);
        }

        row.addEventListener('click', () => {
          this.close();
          cmd.run();
        });
        list.appendChild(row);
      });
    };

    input.addEventListener('input', () => {
      this.selectedIdx = 0;
      refreshList();
    });

    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        this.close();
      } else if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        this.selectedIdx = Math.min(filtered.length - 1, this.selectedIdx + 1);
        refreshList();
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        this.selectedIdx = Math.max(0, this.selectedIdx - 1);
        refreshList();
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        const chosen = filtered[this.selectedIdx];
        if (chosen) {
          this.close();
          chosen.run();
        }
      }
    });

    box.append(input, list);
    backdrop.appendChild(box);
    this.root.appendChild(backdrop);

    refreshList();
    requestAnimationFrame(() => input.focus());
  }
}

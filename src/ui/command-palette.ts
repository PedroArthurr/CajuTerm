import { t } from '../i18n';
import { createColorSwatchDot } from '../themes';
import { pushModal, runExitAnimation, type ModalHandle } from './modal-utils';

export interface PaletteCommand {
  id: string;
  label: string;
  shortcut?: string;
  category?: string;
  swatches?: string[];
  run: () => void;
}

interface FoldedText {
  /** Texto normalizado (minúsculas, sem acentos), 1:1 com o original. */
  folded: string;
}

interface ScoredCommand {
  cmd: PaletteCommand;
  display: string;
  score: number;
  order: number;
  ranges: Array<[number, number]>;
}

const COMBINING_MARKS = /[̀-ͯ]/g;

/** Normaliza caractere a caractere para manter os índices alinhados ao original (destaque). */
function foldText(text: string): FoldedText {
  let folded = '';
  for (const ch of text) {
    const base = ch.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase();
    // Mantém exatamente o mesmo número de unidades UTF-16 do original
    const unit = base.length === ch.length ? base : ch.toLowerCase().length === ch.length ? ch.toLowerCase() : ch;
    folded += unit;
  }
  return { folded };
}

function foldQuery(q: string): string {
  return q.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase();
}

const isWordChar = (c: string | undefined): boolean => !!c && /[\p{L}\p{N}]/u.test(c);

function findBestOccurrence(hay: string, token: string): { idx: number; weight: number } | null {
  let idx = hay.indexOf(token);
  if (idx === -1) return null;
  const firstIdx = idx;
  while (idx !== -1) {
    if (!isWordChar(hay[idx - 1])) {
      return { idx, weight: idx === 0 || (idx === 1 && hay[0] === '[') ? 3 : 2 };
    }
    idx = hay.indexOf(token, idx + 1);
  }
  return { idx: firstIdx, weight: 1 };
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    const cur = sorted[i];
    if (cur[0] <= last[1]) last[1] = Math.max(last[1], cur[1]);
    else out.push(cur);
  }
  return out;
}

export class CommandPalette {
  private root: HTMLElement;
  private isOpen = false;
  private commands: PaletteCommand[] = [];
  private selectedIdx = 0;
  private lang = 'pt-BR';
  private handle: ModalHandle | null = null;
  private backdrop: HTMLElement | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  public isPaletteOpen(): boolean {
    return this.isOpen;
  }

  public open(commands: PaletteCommand[], lang: string): void {
    if (this.isOpen) this.close();
    this.commands = commands;
    this.lang = lang;
    this.selectedIdx = 0;
    this.isOpen = true;
    this.render();
  }

  public close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.handle?.release();
    this.handle = null;
    const backdrop = this.backdrop;
    this.backdrop = null;
    if (backdrop) {
      runExitAnimation(backdrop, 'is-closing', () => backdrop.remove(), 160);
    }
  }

  public toggle(commands: PaletteCommand[], lang: string): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open(commands, lang);
    }
  }

  private rank(query: string): ScoredCommand[] {
    const tokens = foldQuery(query).split(/\s+/).filter(Boolean);
    const out: ScoredCommand[] = [];
    this.commands.forEach((cmd, order) => {
      const display = cmd.category ? `[${cmd.category}] ${cmd.label}` : cmd.label;
      if (tokens.length === 0) {
        out.push({ cmd, display, score: 0, order, ranges: [] });
        return;
      }
      const { folded } = foldText(display);
      let score = 0;
      const ranges: Array<[number, number]> = [];
      for (const tok of tokens) {
        const hit = findBestOccurrence(folded, tok);
        if (!hit) return;
        score += hit.weight;
        ranges.push([hit.idx, hit.idx + tok.length]);
      }
      out.push({ cmd, display, score, order, ranges: mergeRanges(ranges) });
    });
    if (tokens.length > 0) {
      out.sort((a, b) => b.score - a.score || a.order - b.order);
    }
    return out;
  }

  private render(): void {
    this.root.innerHTML = '';

    const backdrop = document.createElement('div');
    backdrop.className = 'palette-backdrop';
    let downOnBackdrop = false;
    backdrop.addEventListener('mousedown', (e) => {
      downOnBackdrop = e.target === backdrop;
      if (downOnBackdrop) e.preventDefault();
    });
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop && downOnBackdrop) this.close();
      downOnBackdrop = false;
    });

    const box = document.createElement('div');
    box.className = 'palette-box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', t('btn.palette', this.lang));

    const listId = 'palette-listbox';
    const input = document.createElement('input');
    input.className = 'palette-input';
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = t('palette.placeholder', this.lang);
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', listId);
    input.setAttribute('aria-autocomplete', 'list');

    const list = document.createElement('div');
    list.className = 'palette-list';
    list.id = listId;
    list.setAttribute('role', 'listbox');

    let filtered: ScoredCommand[] = [];
    let rows: HTMLElement[] = [];
    let lastPointer = { x: -1, y: -1 };

    const applySelection = (scroll: boolean) => {
      rows.forEach((row, idx) => {
        const sel = idx === this.selectedIdx;
        row.classList.toggle('selected', sel);
        row.setAttribute('aria-selected', sel ? 'true' : 'false');
      });
      const current = rows[this.selectedIdx];
      if (current) {
        input.setAttribute('aria-activedescendant', current.id);
        if (scroll) current.scrollIntoView({ block: 'nearest' });
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    };

    const runEntry = (entry: ScoredCommand | undefined) => {
      if (!entry) return;
      this.close();
      entry.cmd.run();
    };

    const buildLabel = (entry: ScoredCommand): HTMLElement => {
      const label = document.createElement('span');
      label.className = 'palette-item-label';
      if (entry.ranges.length === 0) {
        label.textContent = entry.display;
        return label;
      }
      let cursor = 0;
      for (const [start, end] of entry.ranges) {
        if (start > cursor) label.appendChild(document.createTextNode(entry.display.slice(cursor, start)));
        const mark = document.createElement('mark');
        mark.className = 'palette-hl';
        mark.textContent = entry.display.slice(start, end);
        label.appendChild(mark);
        cursor = end;
      }
      if (cursor < entry.display.length) {
        label.appendChild(document.createTextNode(entry.display.slice(cursor)));
      }
      return label;
    };

    const refreshList = () => {
      filtered = this.rank(input.value);
      if (this.selectedIdx >= filtered.length) {
        this.selectedIdx = Math.max(0, filtered.length - 1);
      }

      list.innerHTML = '';
      rows = [];
      if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'palette-empty';
        empty.textContent = t('palette.empty', this.lang);
        list.appendChild(empty);
        input.removeAttribute('aria-activedescendant');
        return;
      }

      const frag = document.createDocumentFragment();
      filtered.forEach((entry, idx) => {
        const cmd = entry.cmd;
        const row = document.createElement('button');
        row.type = 'button';
        row.tabIndex = -1;
        row.id = `palette-opt-${idx}`;
        row.className = 'palette-item';
        row.setAttribute('role', 'option');

        const leftWrap = document.createElement('span');
        leftWrap.className = 'palette-item-left';
        leftWrap.appendChild(buildLabel(entry));

        if (cmd.swatches?.length) {
          const swatchBar = document.createElement('span');
          swatchBar.className = 'palette-swatches';
          for (const color of cmd.swatches) {
            swatchBar.appendChild(createColorSwatchDot(color, 11));
          }
          leftWrap.appendChild(swatchBar);
        }

        row.appendChild(leftWrap);
        if (cmd.shortcut) {
          const kbd = document.createElement('kbd');
          kbd.className = 'palette-kbd';
          kbd.textContent = cmd.shortcut;
          row.appendChild(kbd);
        }

        row.addEventListener('mousedown', (ev) => ev.preventDefault()); // mantém o foco no input
        row.addEventListener('click', () => runEntry(entry));
        row.addEventListener('mousemove', (ev) => {
          // Ignora mousemove sintético disparado pelo scroll (mesma posição)
          if (ev.clientX === lastPointer.x && ev.clientY === lastPointer.y) return;
          lastPointer = { x: ev.clientX, y: ev.clientY };
          if (this.selectedIdx !== idx) {
            this.selectedIdx = idx;
            applySelection(false);
          }
        });
        rows.push(row);
        frag.appendChild(row);
      });
      list.appendChild(frag);
      list.scrollTop = 0;
      applySelection(true);
    };

    input.addEventListener('input', () => {
      this.selectedIdx = 0;
      refreshList();
    });

    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        this.close();
      } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (filtered.length === 0) return;
        const delta = ev.key === 'ArrowDown' ? 1 : -1;
        // Navegação circular
        this.selectedIdx = (this.selectedIdx + delta + filtered.length) % filtered.length;
        applySelection(true);
      } else if (ev.key === 'PageDown' || ev.key === 'PageUp') {
        ev.preventDefault();
        if (filtered.length === 0) return;
        const step = Math.max(1, Math.floor(list.clientHeight / 38));
        const delta = ev.key === 'PageDown' ? step : -step;
        this.selectedIdx = Math.max(0, Math.min(filtered.length - 1, this.selectedIdx + delta));
        applySelection(true);
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        runEntry(filtered[this.selectedIdx]);
      }
    });

    box.append(input, list);
    backdrop.appendChild(box);
    this.root.appendChild(backdrop);
    this.backdrop = backdrop;

    refreshList();
    this.handle = pushModal(this.root, input);
  }
}

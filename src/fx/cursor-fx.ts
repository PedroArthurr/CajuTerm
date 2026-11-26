import type { AnimationConfig, CursorConfig, CursorScreenPos } from '../types';
import { currentDpr, watchDpr, watchParentResize, watchReducedMotion, type ReducedMotionWatch } from './fx-env';

interface TrailSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  life: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  color: string;
}

interface FloatingReaction {
  x: number;
  y: number;
  vy: number;
  emoji: string;
  life: number;
}

/** TerminalPane marca `hidden` quando o cursor está fora do viewport (scrollback rolado). */
type FxCursorPos = CursorScreenPos & { hidden?: boolean };

export class CursorFxLayer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private cursorCfg: CursorConfig;
  private animCfg: AnimationConfig;

  private lastPos: { x: number; y: number } | null = null;
  private currentCursor: CursorScreenPos | null = null;
  private trails: TrailSegment[] = [];
  private particles: Particle[] = [];
  private reactions: FloatingReaction[] = [];
  private rafId: number | null = null;
  private accentColors = ['#ff2a85', '#00f0ff', '#ff7b00'];
  private disposed = false;

  // Retângulo do canvas em cache (atualizado em resize) — evita layout forçado a cada frame/evento
  private rectLeft = 0;
  private rectTop = 0;
  private cssW = 1;
  private cssH = 1;

  private reducedMotion: ReducedMotionWatch;
  private cleanups: Array<() => void> = [];

  constructor(canvas: HTMLCanvasElement, cursorCfg: CursorConfig, animCfg: AnimationConfig) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cursorCfg = { ...cursorCfg };
    this.animCfg = { ...animCfg };
    this.reducedMotion = watchReducedMotion((reduced) => {
      if (reduced) {
        this.trails = [];
        this.particles = [];
      }
      this.requestFrame();
    });
    this.cleanups.push(
      () => this.reducedMotion.dispose(),
      watchDpr(() => this.resize()),
      watchParentResize(canvas, () => this.resize())
    );
    this.resize();
  }

  public updateConfig(cursorCfg: CursorConfig, animCfg: AnimationConfig, accent?: string, accent2?: string): void {
    this.cursorCfg = { ...cursorCfg };
    this.animCfg = { ...animCfg };
    if (accent && accent2) {
      this.accentColors = [accent, accent2, cursorCfg.trailColor || '#00f0ff'];
    }
    if (!this.cursorCfg.trail) this.trails = [];
    this.requestFrame();
  }

  public resize(): void {
    const parent = this.canvas.parentElement;
    if (!parent || this.disposed) return;
    const dpr = currentDpr();
    const w = Math.max(1, Math.floor(parent.clientWidth * dpr));
    const h = Math.max(1, Math.floor(parent.clientHeight * dpr));
    const changed = this.canvas.width !== w || this.canvas.height !== h;
    if (changed) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);

    const rect = this.canvas.getBoundingClientRect();
    this.rectLeft = rect.left;
    this.rectTop = rect.top;
    this.cssW = Math.max(1, rect.width);
    this.cssH = Math.max(1, rect.height);

    // Redimensionar limpa o bitmap: redesenha já (antes do paint) para não piscar
    if (changed && this.rafId === null) {
      this.render(performance.now());
      if (this.isAnimating()) this.requestFrame();
    }
  }

  private get motionReduced(): boolean {
    return this.reducedMotion.reduced;
  }

  public onCursorMoved(pos: CursorScreenPos): void {
    if ((pos as FxCursorPos).hidden) {
      // Cursor rolou para fora do viewport: esconde pulse e não gera trail ao voltar
      if (this.currentCursor !== null) {
        this.currentCursor = null;
        this.lastPos = null;
        this.requestFrame();
      }
      return;
    }

    const cx = pos.x - this.rectLeft + pos.cellWidth * 0.5;
    const cy = pos.y - this.rectTop + pos.cellHeight * 0.5;

    if (this.cursorCfg.trail && this.lastPos && !this.motionReduced) {
      const dist = Math.hypot(cx - this.lastPos.x, cy - this.lastPos.y);
      if (dist > 2 && dist < 800) {
        this.trails.push({
          x1: this.lastPos.x,
          y1: this.lastPos.y,
          x2: cx,
          y2: cy,
          life: 1.0,
        });
        if (this.trails.length > 48) {
          this.trails.shift();
        }
      }
    }

    const prev = this.currentCursor;
    this.lastPos = { x: cx, y: cy };
    this.currentCursor = pos;

    const moved =
      !prev ||
      prev.x !== pos.x ||
      prev.y !== pos.y ||
      prev.cellWidth !== pos.cellWidth ||
      prev.cellHeight !== pos.cellHeight;
    if (moved || this.trails.length > 0) {
      this.requestFrame();
    }
  }

  public spawnTypingBurst(pos: CursorScreenPos | null): void {
    if (!this.animCfg.typingParticles || !pos || this.motionReduced) return;
    if ((pos as FxCursorPos).hidden) return;
    const ox = pos.x - this.rectLeft + pos.cellWidth * 0.5;
    const oy = pos.y - this.rectTop + pos.cellHeight * 0.5;
    const count = Math.max(1, Math.min(20, this.animCfg.particleCount));

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.8 + Math.random() * 2.4;
      this.particles.push({
        x: ox,
        y: oy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.6,
        size: 1.4 + Math.random() * 2.0,
        life: 1.0,
        color: this.accentColors[i % this.accentColors.length],
      });
    }
    if (this.particles.length > 180) {
      this.particles.splice(0, this.particles.length - 180);
    }
    this.requestFrame();
  }

  public spawnReactionBurst(emoji: string, pos?: CursorScreenPos | null): void {
    const candidate = pos ?? this.currentCursor;
    const target = candidate && !(candidate as FxCursorPos).hidden ? candidate : null;
    const w = this.cssW;
    const h = this.cssH;
    const ox = target ? target.x - this.rectLeft + target.cellWidth * 0.5 : w * 0.5;
    const oy = target ? target.y - this.rectTop : h * 0.45;
    const reduced = this.motionReduced;

    this.reactions.push({
      x: Math.max(28, Math.min(w - 28, ox)),
      y: Math.max(36, Math.min(h - 20, oy)),
      vy: reduced ? 0 : -1.35,
      emoji,
      life: 1.0,
    });
    if (this.reactions.length > 18) {
      this.reactions.shift();
    }

    if (!reduced) {
      for (let i = 0; i < 12; i++) {
        const angle = (Math.PI * 2 * i) / 12 + Math.random() * 0.25;
        const speed = 1.1 + Math.random() * 2.5;
        this.particles.push({
          x: ox,
          y: oy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 0.8,
          size: 1.8 + Math.random() * 2.2,
          life: 1.0,
          color: this.accentColors[i % this.accentColors.length],
        });
      }
      if (this.particles.length > 180) {
        this.particles.splice(0, this.particles.length - 180);
      }
    }
    this.requestFrame();
  }

  /** Há algo que muda frame a frame? Senão o loop para e o último frame fica estático. */
  private isAnimating(): boolean {
    return (
      this.trails.length > 0 ||
      this.particles.length > 0 ||
      this.reactions.length > 0 ||
      (this.cursorCfg.pulse && this.currentCursor !== null && !this.motionReduced)
    );
  }

  private requestFrame(): void {
    if (this.rafId !== null || this.disposed) return;
    this.rafId = requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    this.rafId = null;
    if (this.disposed) return;
    this.render(now);
    if (this.isAnimating()) {
      this.requestFrame();
    }
  };

  private render(now: number): void {
    const ctx = this.ctx;
    if (!ctx) return;

    ctx.clearRect(0, 0, this.cssW, this.cssH);

    // 1. Pulse neon ao redor do cursor ativo (estático com prefers-reduced-motion)
    if (this.cursorCfg.pulse && this.currentCursor) {
      const cx = this.currentCursor.x - this.rectLeft;
      const cy = this.currentCursor.y - this.rectTop;
      const pulse = this.motionReduced ? 0.75 : 0.55 + 0.45 * Math.sin(now * 0.006);
      const color = this.cursorCfg.color || '#ff2a85';

      ctx.save();
      ctx.globalAlpha = 0.34 * pulse;
      ctx.shadowColor = color;
      ctx.shadowBlur = 14 + pulse * 10;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.strokeRect(
        cx - 1,
        cy - 1,
        this.currentCursor.cellWidth + 2,
        this.currentCursor.cellHeight + 2
      );
      ctx.restore();
    }

    // 2. Trail neon suave ao mover o cursor
    if (this.trails.length > 0) {
      ctx.save();
      ctx.lineCap = 'round';
      for (let i = this.trails.length - 1; i >= 0; i--) {
        const seg = this.trails[i];
        seg.life -= 0.065;
        if (seg.life <= 0) {
          this.trails.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = seg.life * 0.72;
        ctx.strokeStyle = this.cursorCfg.trailColor || '#00f0ff';
        ctx.shadowColor = this.cursorCfg.trailColor || '#00f0ff';
        ctx.shadowBlur = 12 * seg.life;
        ctx.lineWidth = 3.2 * seg.life;
        ctx.beginPath();
        ctx.moveTo(seg.x1, seg.y1);
        ctx.lineTo(seg.x2, seg.y2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 3. Partículas opcionais ao digitar
    if (this.particles.length > 0) {
      ctx.save();
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.055; // gravidade sutil
        p.life -= 0.045;
        if (p.life <= 0) {
          this.particles.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = p.life * 0.9;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 4. Emojis flutuantes de reações e notificações
    if (this.reactions.length > 0) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const reduced = this.motionReduced;
      for (let i = this.reactions.length - 1; i >= 0; i--) {
        const r = this.reactions[i];
        r.y += r.vy;
        r.vy *= 0.985;
        r.life -= 0.018;
        if (r.life <= 0) {
          this.reactions.splice(i, 1);
          continue;
        }
        const scale = reduced ? 1 : 0.9 + (1 - r.life) * 0.45;
        ctx.globalAlpha = Math.min(1, r.life * 1.4);
        ctx.font = `${Math.round(22 * scale)}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
        ctx.shadowColor = this.accentColors[0];
        ctx.shadowBlur = 12;
        ctx.fillText(r.emoji, r.x, r.y);
      }
      ctx.restore();
    }
  }

  public dispose(): void {
    this.disposed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
  }
}

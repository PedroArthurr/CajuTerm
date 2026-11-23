import type { AnimationConfig, CursorConfig, CursorScreenPos } from '../types';

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

  constructor(canvas: HTMLCanvasElement, cursorCfg: CursorConfig, animCfg: AnimationConfig) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cursorCfg = { ...cursorCfg };
    this.animCfg = { ...animCfg };
    this.resize();
    this.ensureLoop();
  }

  public updateConfig(cursorCfg: CursorConfig, animCfg: AnimationConfig, accent?: string, accent2?: string): void {
    this.cursorCfg = { ...cursorCfg };
    this.animCfg = { ...animCfg };
    if (accent && accent2) {
      this.accentColors = [accent, accent2, cursorCfg.trailColor || '#00f0ff'];
    }
    this.ensureLoop();
  }

  public resize(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(parent.clientWidth * dpr));
    const h = Math.max(1, Math.floor(parent.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  public onCursorMoved(pos: CursorScreenPos): void {
    const rect = this.canvas.getBoundingClientRect();
    const cx = pos.x - rect.left + pos.cellWidth * 0.5;
    const cy = pos.y - rect.top + pos.cellHeight * 0.5;

    if (this.cursorCfg.trail && this.lastPos) {
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

    this.lastPos = { x: cx, y: cy };
    this.currentCursor = pos;
  }

  public spawnTypingBurst(pos: CursorScreenPos | null): void {
    if (!this.animCfg.typingParticles || !pos) return;
    const rect = this.canvas.getBoundingClientRect();
    const ox = pos.x - rect.left + pos.cellWidth * 0.5;
    const oy = pos.y - rect.top + pos.cellHeight * 0.5;
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
  }

  public spawnReactionBurst(emoji: string, pos?: CursorScreenPos | null): void {
    const rect = this.canvas.getBoundingClientRect();
    const target = pos ?? this.currentCursor;
    const ox = target ? target.x - rect.left + target.cellWidth * 0.5 : rect.width * 0.5;
    const oy = target ? target.y - rect.top : rect.height * 0.45;

    this.reactions.push({
      x: Math.max(28, Math.min(rect.width - 28, ox)),
      y: Math.max(36, Math.min(rect.height - 20, oy)),
      vy: -1.35,
      emoji,
      life: 1.0,
    });
    if (this.reactions.length > 18) {
      this.reactions.shift();
    }

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

  private ensureLoop(): void {
    if (this.rafId !== null) return;
    const tick = (now: number) => {
      this.render(now);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private render(now: number): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const rect = this.canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);

    // 1. Pulse neon ao redor do cursor ativo
    if (this.cursorCfg.pulse && this.currentCursor) {
      const cx = this.currentCursor.x - rect.left;
      const cy = this.currentCursor.y - rect.top;
      const pulse = 0.55 + 0.45 * Math.sin(now * 0.006);
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
      for (let i = this.reactions.length - 1; i >= 0; i--) {
        const r = this.reactions[i];
        r.y += r.vy;
        r.vy *= 0.985;
        r.life -= 0.018;
        if (r.life <= 0) {
          this.reactions.splice(i, 1);
          continue;
        }
        const scale = 0.9 + (1 - r.life) * 0.45;
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
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}

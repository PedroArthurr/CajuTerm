import type { SoundConfig, SoundPreset } from '../types';

export type ReactionKind = 'success' | 'launch' | 'alert' | 'error' | 'ai-ready' | 'hype';

export interface ReactionMeta {
  kind: ReactionKind;
  emoji: string;
  label: string;
  title: string;
}

export const REACTION_ITEMS: ReactionMeta[] = [
  { kind: 'success', emoji: '🎉', label: 'GG', title: 'Reação de Sucesso / Concluído' },
  { kind: 'launch', emoji: '🚀', label: 'Launch', title: 'Reação de Deploy / Lançamento' },
  { kind: 'ai-ready', emoji: '🤖', label: 'IA Ready', title: 'Sinal de Agente Pronto' },
  { kind: 'alert', emoji: '⚠️', label: 'Alerta', title: 'Sinal de Atenção / Permissão' },
  { kind: 'error', emoji: '💥', label: 'Fail', title: 'Reação de Erro / Falha' },
  { kind: 'hype', emoji: '🔥', label: 'Hype', title: 'Reação Hype / Streak' },
];

interface ToneStep {
  freq: number;
  freqEnd?: number;
  delay: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
}

export class SoundFxEngine {
  private ctx: AudioContext | null = null;
  private config: SoundConfig;
  private lastTypingAt = 0;
  /** Suspende o AudioContext após ~3s sem sons (libera a thread de áudio / CPU). */
  private suspendTimer: number | null = null;
  private pendingSuspend: Promise<void> | null = null;

  constructor(initialConfig: SoundConfig) {
    this.config = { ...initialConfig };
  }

  public updateConfig(next: SoundConfig): void {
    this.config = { ...next };
  }

  public isEnabled(): boolean {
    return this.config.enabled;
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
    }
    if (this.suspendTimer !== null) {
      window.clearTimeout(this.suspendTimer);
      this.suspendTimer = null;
    }
    const ctx = this.ctx;
    if (this.pendingSuspend) {
      // suspend() ainda em voo: retoma quando concluir, senão as notas agendadas ficariam congeladas
      void this.pendingSuspend.then(() => ctx.resume()).catch(() => {});
    } else if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }
    return ctx;
  }

  private scheduleIdleSuspend(tailSec: number): void {
    if (this.suspendTimer !== null) {
      window.clearTimeout(this.suspendTimer);
    }
    this.suspendTimer = window.setTimeout(() => {
      this.suspendTimer = null;
      const ctx = this.ctx;
      if (!ctx || ctx.state !== 'running' || this.pendingSuspend) return;
      const p: Promise<void> = ctx
        .suspend()
        .catch(() => {})
        .finally(() => {
          if (this.pendingSuspend === p) this.pendingSuspend = null;
        });
      this.pendingSuspend = p;
    }, Math.ceil(tailSec * 1000) + 3000);
  }

  private getEffectiveVolume(multiplier = 1): number {
    const base = Math.max(0, Math.min(1, this.config.volume));
    return Math.max(0, Math.min(0.85, base * 0.42 * multiplier));
  }

  private playSequence(steps: ToneStep[], masterMultiplier = 1): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const masterVol = this.getEffectiveVolume(masterMultiplier);
    if (masterVol <= 0.001) {
      this.scheduleIdleSuspend(0);
      return;
    }
    let tail = 0;

    for (const step of steps) {
      const start = now + Math.max(0, step.delay);
      const dur = Math.max(0.025, step.duration);
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = step.type ?? 'triangle';
      osc.frequency.setValueAtTime(Math.max(40, step.freq), start);
      if (step.freqEnd && step.freqEnd > 0) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(40, step.freqEnd), start + dur);
      }

      const peak = Math.max(0.001, masterVol * (step.gain ?? 1));
      gainNode.gain.setValueAtTime(0.0001, start);
      gainNode.gain.linearRampToValueAtTime(peak, start + Math.min(0.014, dur * 0.25));
      gainNode.gain.exponentialRampToValueAtTime(0.0001, start + dur);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      osc.onended = () => {
        osc.disconnect();
        gainNode.disconnect();
      };
      osc.start(start);
      osc.stop(start + dur + 0.02);
      tail = Math.max(tail, step.delay + dur + 0.02);
    }
    this.scheduleIdleSuspend(tail);
  }

  private resolvePreset(): SoundPreset {
    const p = this.config.preset;
    if (p === 'arcade' || p === 'minimal' || p === 'scifi' || p === 'cyberpunk') {
      return p;
    }
    return 'cyberpunk';
  }

  public playMessageEnd(force = false): void {
    if (!force && (!this.config.enabled || !this.config.messageEnd)) return;
    const preset = this.resolvePreset();

    if (preset === 'arcade') {
      this.playSequence([
        { freq: 523.25, delay: 0, duration: 0.08, type: 'square', gain: 0.7 },
        { freq: 659.25, delay: 0.07, duration: 0.08, type: 'square', gain: 0.75 },
        { freq: 783.99, delay: 0.14, duration: 0.1, type: 'square', gain: 0.8 },
        { freq: 1046.5, delay: 0.22, duration: 0.22, type: 'triangle', gain: 0.9 },
      ]);
      return;
    }

    if (preset === 'minimal') {
      this.playSequence([
        { freq: 587.33, delay: 0, duration: 0.16, type: 'sine', gain: 0.8 },
        { freq: 880, delay: 0.08, duration: 0.24, type: 'sine', gain: 0.7 },
      ]);
      return;
    }

    if (preset === 'scifi') {
      this.playSequence([
        { freq: 440, freqEnd: 660, delay: 0, duration: 0.13, type: 'sine', gain: 0.85 },
        { freq: 660, freqEnd: 990, delay: 0.09, duration: 0.18, type: 'triangle', gain: 0.75 },
        { freq: 1320, delay: 0.16, duration: 0.24, type: 'sine', gain: 0.55 },
      ]);
      return;
    }

    // cyberpunk (default)
    this.playSequence([
      { freq: 440, delay: 0, duration: 0.12, type: 'triangle', gain: 0.8 },
      { freq: 554.37, delay: 0.06, duration: 0.14, type: 'triangle', gain: 0.85 },
      { freq: 659.25, delay: 0.12, duration: 0.18, type: 'sine', gain: 0.9 },
      { freq: 880, delay: 0.18, duration: 0.26, type: 'sine', gain: 0.65 },
    ]);
  }

  public playBell(force = false): void {
    if (!force && (!this.config.enabled || !this.config.bell)) return;
    const preset = this.resolvePreset();

    if (preset === 'arcade') {
      this.playSequence([
        { freq: 987.77, delay: 0, duration: 0.08, type: 'square', gain: 0.75 },
        { freq: 1318.51, delay: 0.08, duration: 0.16, type: 'square', gain: 0.8 },
      ]);
      return;
    }

    if (preset === 'minimal') {
      this.playSequence([{ freq: 1046.5, delay: 0, duration: 0.22, type: 'sine', gain: 0.8 }]);
      return;
    }

    this.playSequence([
      { freq: 783.99, delay: 0, duration: 0.14, type: 'sine', gain: 0.85 },
      { freq: 1174.66, delay: 0.06, duration: 0.2, type: 'triangle', gain: 0.75 },
    ]);
  }

  public playErrorAlert(force = false): void {
    if (!force && (!this.config.enabled || !this.config.errorAlert)) return;
    this.playReaction('error', true);
  }

  public playReaction(kind: ReactionKind, force = false): void {
    if (!force && (!this.config.enabled || !this.config.reactions)) return;
    const preset = this.resolvePreset();
    const wave: OscillatorType = preset === 'arcade' ? 'square' : preset === 'minimal' ? 'sine' : 'triangle';

    switch (kind) {
      case 'success':
        this.playSequence([
          { freq: 523.25, delay: 0, duration: 0.09, type: wave, gain: 0.8 },
          { freq: 659.25, delay: 0.07, duration: 0.09, type: wave, gain: 0.85 },
          { freq: 783.99, delay: 0.14, duration: 0.11, type: wave, gain: 0.9 },
          { freq: 1046.5, delay: 0.21, duration: 0.26, type: 'sine', gain: 0.95 },
        ]);
        break;
      case 'launch':
        this.playSequence([
          { freq: 220, freqEnd: 880, delay: 0, duration: 0.22, type: 'sawtooth', gain: 0.6 },
          { freq: 587.33, freqEnd: 1174.66, delay: 0.12, duration: 0.24, type: 'triangle', gain: 0.75 },
          { freq: 1318.51, delay: 0.26, duration: 0.2, type: 'sine', gain: 0.65 },
        ]);
        break;
      case 'ai-ready':
        this.playSequence([
          { freq: 493.88, delay: 0, duration: 0.09, type: 'sine', gain: 0.75 },
          { freq: 739.99, delay: 0.06, duration: 0.11, type: 'triangle', gain: 0.8 },
          { freq: 987.77, delay: 0.13, duration: 0.22, type: 'sine', gain: 0.85 },
        ]);
        break;
      case 'alert':
        this.playSequence([
          { freq: 622.25, delay: 0, duration: 0.1, type: wave, gain: 0.8 },
          { freq: 622.25, delay: 0.13, duration: 0.14, type: wave, gain: 0.85 },
        ]);
        break;
      case 'error':
        this.playSequence([
          { freq: 311.13, freqEnd: 233.08, delay: 0, duration: 0.14, type: 'sawtooth', gain: 0.65 },
          { freq: 220, freqEnd: 138.59, delay: 0.11, duration: 0.24, type: 'sawtooth', gain: 0.7 },
        ]);
        break;
      case 'hype':
        this.playSequence([
          { freq: 440, delay: 0, duration: 0.06, type: wave, gain: 0.7 },
          { freq: 587.33, delay: 0.05, duration: 0.06, type: wave, gain: 0.75 },
          { freq: 739.99, delay: 0.1, duration: 0.07, type: wave, gain: 0.8 },
          { freq: 880, delay: 0.15, duration: 0.09, type: wave, gain: 0.85 },
          { freq: 1174.66, delay: 0.21, duration: 0.24, type: 'sine', gain: 0.9 },
        ]);
        break;
    }
  }

  public playSnippetSend(): void {
    if (!this.config.enabled || !this.config.snippetSend) return;
    this.playSequence([
      { freq: 520, freqEnd: 820, delay: 0, duration: 0.07, type: 'triangle', gain: 0.65 },
      { freq: 980, delay: 0.04, duration: 0.09, type: 'sine', gain: 0.5 },
    ], 0.8);
  }

  public playTypingTick(): void {
    if (!this.config.enabled || !this.config.typingTick) return;
    const now = performance.now();
    if (now - this.lastTypingAt < 24) return;
    this.lastTypingAt = now;

    const jitter = (Math.random() - 0.5) * 45;
    const preset = this.resolvePreset();
    if (preset === 'arcade') {
      this.playSequence([{ freq: 320 + jitter, delay: 0, duration: 0.03, type: 'square', gain: 0.35 }], 0.45);
      return;
    }
    this.playSequence([{ freq: 240 + jitter, freqEnd: 140, delay: 0, duration: 0.032, type: 'triangle', gain: 0.4 }], 0.45);
  }
}

import fragSource from './crt.frag.glsl?raw';
import { hexToNormalizedRgb } from '../themes';
import type { CursorScreenPos, ShaderConfig, ThemeConfig } from '../types';
import { currentDpr, watchDpr, watchParentResize, watchReducedMotion, type ReducedMotionWatch } from './fx-env';

const VERT_SOURCE = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

/** Efeitos animados no tempo rodam a ~30fps; tolerância evita pular frames em 60Hz por jitter do rAF. */
const ANIMATED_FRAME_MS = 1000 / 30 - 2;

export class ShaderOverlay {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private rafId: number | null = null;
  private startTime = performance.now();
  private lastDrawAt = 0;
  private contextLost = false;
  private disposed = false;
  /** Tempo congelado (s) usado quando prefers-reduced-motion está ativo. */
  private frozenTime: number | null = null;

  private config: ShaderConfig;
  private accentRgb: [number, number, number] = [1, 0.16, 0.52];
  private accent2Rgb: [number, number, number] = [0, 0.94, 1];
  private cursorUniform: [number, number, number] = [0.5, 0.5, 0];

  private uResolution: WebGLUniformLocation | null = null;
  private uTime: WebGLUniformLocation | null = null;
  private uScanlines: WebGLUniformLocation | null = null;
  private uCurvature: WebGLUniformLocation | null = null;
  private uBloom: WebGLUniformLocation | null = null;
  private uChromatic: WebGLUniformLocation | null = null;
  private uNoise: WebGLUniformLocation | null = null;
  private uFlicker: WebGLUniformLocation | null = null;
  private uAccent: WebGLUniformLocation | null = null;
  private uAccent2: WebGLUniformLocation | null = null;
  private uCursor: WebGLUniformLocation | null = null;

  private fpsCounter = 0;
  private lastFpsSample = performance.now();
  private onFpsUpdate?: (fps: number) => void;

  // Cache do retângulo do canvas (atualizado em resize) para setCursorPosition não forçar layout
  private rectLeft = 0;
  private rectTop = 0;
  private rectW = 0;
  private rectH = 0;

  private reducedMotion: ReducedMotionWatch;
  private cleanups: Array<() => void> = [];

  constructor(canvas: HTMLCanvasElement, initialConfig: ShaderConfig, onFpsUpdate?: (fps: number) => void) {
    this.canvas = canvas;
    this.config = { ...initialConfig };
    this.onFpsUpdate = onFpsUpdate;

    this.reducedMotion = watchReducedMotion((reduced) => {
      this.frozenTime = reduced ? this.elapsedSec(performance.now()) : null;
      this.refreshLoop();
    });
    if (this.reducedMotion.reduced) this.frozenTime = 0;

    this.initWebGL();
    this.resize();
    this.bindEnvironment();
    if (this.config.enabled) {
      this.start();
    }
  }

  private bindEnvironment(): void {
    const onLost = (ev: Event) => {
      ev.preventDefault(); // permite webglcontextrestored
      this.contextLost = true;
      this.cancelFrame();
      this.gl = null;
      this.program = null;
    };
    const onRestored = () => {
      this.contextLost = false;
      this.initWebGL();
      this.refreshLoop();
    };
    const onEnvChange = () => this.refreshLoop();

    this.canvas.addEventListener('webglcontextlost', onLost);
    this.canvas.addEventListener('webglcontextrestored', onRestored);
    document.addEventListener('visibilitychange', onEnvChange);
    window.addEventListener('blur', onEnvChange);
    window.addEventListener('focus', onEnvChange);

    this.cleanups.push(
      () => this.canvas.removeEventListener('webglcontextlost', onLost),
      () => this.canvas.removeEventListener('webglcontextrestored', onRestored),
      () => document.removeEventListener('visibilitychange', onEnvChange),
      () => window.removeEventListener('blur', onEnvChange),
      () => window.removeEventListener('focus', onEnvChange),
      () => this.reducedMotion.dispose(),
      watchDpr(() => this.resize()),
      watchParentResize(this.canvas, () => this.resize())
    );
  }

  private initWebGL(): void {
    const gl = this.canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl || gl.isContextLost()) return;

    const vs = this.compileShader(gl, gl.VERTEX_SHADER, VERT_SOURCE);
    const fs = this.compileShader(gl, gl.FRAGMENT_SHADER, fragSource);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    if (!program) return;

    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return;
    }

    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    const aPos = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    this.uResolution = gl.getUniformLocation(program, 'u_resolution');
    this.uTime = gl.getUniformLocation(program, 'u_time');
    this.uScanlines = gl.getUniformLocation(program, 'u_scanlines');
    this.uCurvature = gl.getUniformLocation(program, 'u_curvature');
    this.uBloom = gl.getUniformLocation(program, 'u_bloom');
    this.uChromatic = gl.getUniformLocation(program, 'u_chromatic');
    this.uNoise = gl.getUniformLocation(program, 'u_noise');
    this.uFlicker = gl.getUniformLocation(program, 'u_flicker');
    this.uAccent = gl.getUniformLocation(program, 'u_accent');
    this.uAccent2 = gl.getUniformLocation(program, 'u_accent2');
    this.uCursor = gl.getUniformLocation(program, 'u_cursor');

    this.gl = gl;
    this.program = program;
  }

  private compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Erro de shader WebGL:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  public updateConfig(next: ShaderConfig, theme?: ThemeConfig): void {
    this.config = { ...next };
    if (theme) {
      this.accentRgb = hexToNormalizedRgb(theme.accent);
      this.accent2Rgb = hexToNormalizedRgb(theme.accentSecondary);
    }
    if (this.config.enabled) {
      this.canvas.style.opacity = '1';
      this.start();
    } else {
      this.stop();
      this.canvas.style.opacity = '0';
      if (this.gl) {
        this.gl.clearColor(0, 0, 0, 0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
      }
    }
  }

  public setCursorPosition(pos: CursorScreenPos | null): void {
    let next: [number, number, number];
    if (!pos || (pos as CursorScreenPos & { hidden?: boolean }).hidden) {
      next = [0.5, 0.5, 0];
    } else {
      if (this.rectW <= 0 || this.rectH <= 0) return;
      const nx = (pos.x - this.rectLeft + pos.cellWidth * 0.5) / this.rectW;
      const ny = 1 - (pos.y - this.rectTop + pos.cellHeight * 0.5) / this.rectH;
      next = [Math.max(0, Math.min(1, nx)), Math.max(0, Math.min(1, ny)), 1];
    }
    const prev = this.cursorUniform;
    if (prev[0] === next[0] && prev[1] === next[1] && prev[2] === next[2]) return;
    this.cursorUniform = next;
    // O halo do cursor só existe com bloom ativo
    if (this.config.enabled && this.config.bloom) {
      this.requestStaticDraw();
    }
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
      this.gl?.viewport(0, 0, w, h);
    }
    const rect = this.canvas.getBoundingClientRect();
    this.rectLeft = rect.left;
    this.rectTop = rect.top;
    this.rectW = rect.width;
    this.rectH = rect.height;

    // Redimensionar limpa o drawing buffer: redesenha sincronamente para não piscar
    if (changed && this.config.enabled) {
      this.draw(performance.now());
    }
  }

  /** Mantido público por compatibilidade: (re)avalia o modo de render e desenha. */
  public start(): void {
    this.refreshLoop();
  }

  public stop(): void {
    this.cancelFrame();
  }

  private cancelFrame(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private isPaused(): boolean {
    return document.visibilityState === 'hidden' || !document.hasFocus();
  }

  /** Algum uniform depende de u_time? (bloom/chromatic/noise/flicker animam; scanlines/curvatura são estáticos) */
  private isTimeAnimated(): boolean {
    if (this.frozenTime !== null) return false;
    const c = this.config;
    return (
      (c.bloom && c.bloomIntensity > 0.001) ||
      (c.chromaticAberration && c.chromaticIntensity > 0.001) ||
      (c.noise && c.noiseIntensity > 0.001) ||
      (c.flicker && c.flickerIntensity > 0.001)
    );
  }

  private shouldLoop(): boolean {
    return this.config.enabled && !this.contextLost && !this.disposed && this.isTimeAnimated() && !this.isPaused();
  }

  /** Decide entre loop animado (~30fps) e desenho único sob demanda. */
  private refreshLoop(): void {
    if (!this.config.enabled || this.contextLost || this.disposed || !this.gl) {
      this.cancelFrame();
      return;
    }
    this.cancelFrame();
    this.lastDrawAt = 0;
    this.fpsCounter = 0;
    this.lastFpsSample = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  private requestStaticDraw(): void {
    // Em modo animado o próximo frame do loop já pega o novo estado
    if (this.rafId !== null || this.disposed) return;
    this.rafId = requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    this.rafId = null;
    if (!this.config.enabled || this.contextLost || this.disposed) return;

    const looping = this.shouldLoop();
    if (looping && this.lastDrawAt > 0 && now - this.lastDrawAt < ANIMATED_FRAME_MS) {
      this.rafId = requestAnimationFrame(this.tick);
      return;
    }

    this.draw(now);
    this.lastDrawAt = now;

    if (looping) {
      this.fpsCounter += 1;
      if (now - this.lastFpsSample >= 1000) {
        const fps = Math.round((this.fpsCounter * 1000) / (now - this.lastFpsSample));
        this.fpsCounter = 0;
        this.lastFpsSample = now;
        this.onFpsUpdate?.(fps);
      }
      this.rafId = requestAnimationFrame(this.tick);
    }
  };

  private elapsedSec(now: number): number {
    return (now - this.startTime) / 1000;
  }

  private draw(now: number): void {
    const gl = this.gl;
    if (!gl || !this.program || this.contextLost) return;

    const reduced = this.frozenTime !== null;
    const time = reduced ? (this.frozenTime as number) : this.elapsedSec(now);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.uniform2f(this.uResolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uTime, time);
    gl.uniform1f(this.uScanlines, this.config.scanlines ? this.config.scanlinesIntensity : 0);
    gl.uniform1f(this.uCurvature, this.config.curvature ? this.config.curvatureIntensity : 0);
    gl.uniform1f(this.uBloom, this.config.bloom ? this.config.bloomIntensity : 0);
    gl.uniform1f(this.uChromatic, this.config.chromaticAberration ? this.config.chromaticIntensity : 0);
    gl.uniform1f(this.uNoise, this.config.noise ? this.config.noiseIntensity : 0);
    // Flicker é puramente temporal: desligado com prefers-reduced-motion
    gl.uniform1f(this.uFlicker, this.config.flicker && !reduced ? this.config.flickerIntensity : 0);
    gl.uniform3f(this.uAccent, this.accentRgb[0], this.accentRgb[1], this.accentRgb[2]);
    gl.uniform3f(this.uAccent2, this.accent2Rgb[0], this.accent2Rgb[1], this.accent2Rgb[2]);
    gl.uniform3f(this.uCursor, this.cursorUniform[0], this.cursorUniform[1], this.cursorUniform[2]);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  public dispose(): void {
    this.disposed = true;
    this.cancelFrame();
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
  }
}

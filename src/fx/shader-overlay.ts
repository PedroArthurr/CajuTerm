import fragSource from './crt.frag.glsl?raw';
import { hexToNormalizedRgb } from '../themes';
import type { CursorScreenPos, ShaderConfig, ThemeConfig } from '../types';

const VERT_SOURCE = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

export class ShaderOverlay {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private rafId: number | null = null;
  private startTime = performance.now();

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

  constructor(canvas: HTMLCanvasElement, initialConfig: ShaderConfig, onFpsUpdate?: (fps: number) => void) {
    this.canvas = canvas;
    this.config = { ...initialConfig };
    this.onFpsUpdate = onFpsUpdate;
    this.initWebGL();
    this.resize();
    if (this.config.enabled) {
      this.start();
    }
  }

  private initWebGL(): void {
    const gl = this.canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) return;

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
    if (!pos) {
      this.cursorUniform = [0.5, 0.5, 0];
      return;
    }
    const stageRect = this.canvas.getBoundingClientRect();
    if (stageRect.width <= 0 || stageRect.height <= 0) return;
    const nx = (pos.x - stageRect.left + pos.cellWidth * 0.5) / stageRect.width;
    const ny = 1 - (pos.y - stageRect.top + pos.cellHeight * 0.5) / stageRect.height;
    this.cursorUniform = [
      Math.max(0, Math.min(1, nx)),
      Math.max(0, Math.min(1, ny)),
      1,
    ];
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
      this.gl?.viewport(0, 0, w, h);
    }
  }

  public start(): void {
    if (this.rafId !== null || !this.gl || !this.program) return;
    const renderFrame = (now: number) => {
      if (!this.config.enabled) {
        this.rafId = null;
        return;
      }
      this.draw(now);
      this.rafId = requestAnimationFrame(renderFrame);
    };
    this.rafId = requestAnimationFrame(renderFrame);
  }

  public stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private draw(now: number): void {
    const gl = this.gl;
    if (!gl || !this.program) return;

    const elapsedSec = (now - this.startTime) / 1000;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.uniform2f(this.uResolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uTime, elapsedSec);
    gl.uniform1f(this.uScanlines, this.config.scanlines ? this.config.scanlinesIntensity : 0);
    gl.uniform1f(this.uCurvature, this.config.curvature ? this.config.curvatureIntensity : 0);
    gl.uniform1f(this.uBloom, this.config.bloom ? this.config.bloomIntensity : 0);
    gl.uniform1f(this.uChromatic, this.config.chromaticAberration ? this.config.chromaticIntensity : 0);
    gl.uniform1f(this.uNoise, this.config.noise ? this.config.noiseIntensity : 0);
    gl.uniform1f(this.uFlicker, this.config.flicker ? this.config.flickerIntensity : 0);
    gl.uniform3f(this.uAccent, this.accentRgb[0], this.accentRgb[1], this.accentRgb[2]);
    gl.uniform3f(this.uAccent2, this.accent2Rgb[0], this.accent2Rgb[1], this.accent2Rgb[2]);
    gl.uniform3f(this.uCursor, this.cursorUniform[0], this.cursorUniform[1], this.cursorUniform[2]);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    this.fpsCounter += 1;
    if (now - this.lastFpsSample >= 1000) {
      const fps = Math.round((this.fpsCounter * 1000) / (now - this.lastFpsSample));
      this.fpsCounter = 0;
      this.lastFpsSample = now;
      this.onFpsUpdate?.(fps);
    }
  }

  public dispose(): void {
    this.stop();
  }
}

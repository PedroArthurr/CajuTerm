/**
 * Gerador zero-dependência de ícones PNG (32x32, 128x128, 256x256) e Windows ICO
 * combinando a estética rústica da xilogravura (cordel, goivas e hachuras entalhadas)
 * com uma janela de terminal moderno e o prompt `>_`.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const OUT_DIR = path.resolve('src-tauri/icons');
fs.mkdirSync(OUT_DIR, { recursive: true });

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function sdRoundedBox(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  const t = clamp01(((px - x1) * dx + (py - y1) * dy) / l2);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/**
 * Campo de distância assinado da castanha (formato curvo de meia-lua no topo do caju).
 */
function sdCashewNut(u, v) {
  const dx = u - 0.50;
  const dy = v - 0.345;
  const ang = -0.35;
  const rx = dx * Math.cos(ang) - dy * Math.sin(ang);
  const ry = dx * Math.sin(ang) + dy * Math.cos(ang);

  // Curva em arco ao longo de rx
  const curveY = ry - 0.045 * Math.cos(rx * 13.0) + 0.03;
  const thickness = 0.048 * (1 - 0.45 * clamp01(Math.abs(rx) / 0.11));
  return Math.hypot(rx / 1.85, curveY) - thickness;
}

/**
 * Campo de distância assinado do corpo do caju (pedúnculo piriforme rústico).
 */
function sdCashewApple(u, v) {
  const dx = u - 0.435;
  const dy = v - 0.625;
  const ang = 0.22;
  const rx = dx * Math.cos(ang) - dy * Math.sin(ang);
  const ry = dx * Math.sin(ang) + dy * Math.cos(ang);

  const ny = ry / 0.225;
  // Topo mais estreito próximo à castanha, base bojuda e levemente assimétrica
  const t = clamp01((ny + 1.0) * 0.5);
  const halfW = 0.105 + 0.078 * Math.sin(t * Math.PI * 0.85) + 0.028 * t;
  const nx = rx / halfW;
  return (Math.hypot(nx, ny) - 1.0) * 0.16;
}

function samplePixel(u, v) {
  // 1. Janela moderna squircle
  const boxDist = sdRoundedBox(u, v, 0.5, 0.5, 0.44, 0.44, 0.11);
  if (boxDist > 0.014) {
    return [0, 0, 0, 0];
  }

  const aa = 1 - smoothstep(-0.008, 0.008, boxDist);

  // Fundo escuro de tinta de xilogravura + leve textura de veios de madeira horizontais
  const woodGrain = Math.sin(v * 110 + Math.sin(u * 14) * 1.4) * 0.5 + 0.5;
  let r = mix(11, 20, v) + woodGrain * 5;
  let g = mix(7, 13, v) + woodGrain * 3;
  let b = mix(20, 28, v) + woodGrain * 4;

  // Raios entalhados (estilo cordel) irradiando atrás do caju
  const rayAngle = Math.atan2(v - 0.58, u - 0.46);
  const rayDist = Math.hypot(u - 0.46, v - 0.58);
  if (v > 0.23 && rayDist > 0.16 && rayDist < 0.42) {
    const rayWave = Math.sin(rayAngle * 22);
    if (rayWave > 0.86) {
      const fade = (1 - smoothstep(0.24, 0.42, rayDist)) * 0.35;
      r = mix(r, 232, fade);
      g = mix(g, 168, fade);
      b = mix(b, 88, fade);
    }
  }

  // 2. Barra superior do terminal moderno
  const inHeader = v < 0.22;
  if (inHeader) {
    r = mix(20, 30, u);
    g = mix(14, 21, u);
    b = mix(36, 48, u);
  }

  // Linha divisória da barra (gradiente ocre-xilogravura -> ciano neon)
  const headerLine = Math.abs(v - 0.22);
  if (headerLine < 0.009) {
    const lineA = 1 - smoothstep(0.003, 0.009, headerLine);
    r = mix(r, mix(245, 0, u), lineA);
    g = mix(g, mix(176, 240, u), lineA);
    b = mix(b, mix(65, 255, u), lineA);
  }

  // Três botões da janela moderna no cabeçalho
  const dots = [
    { x: 0.165, y: 0.142, c: [255, 42, 133] },
    { x: 0.235, y: 0.142, c: [255, 170, 40] },
    { x: 0.305, y: 0.142, c: [0, 240, 255] },
  ];
  for (const d of dots) {
    const dd = Math.hypot(u - d.x, v - d.y) - 0.021;
    if (dd < 0.006) {
      const da = 1 - smoothstep(-0.004, 0.006, dd);
      r = mix(r, d.c[0], da);
      g = mix(g, d.c[1], da);
      b = mix(b, d.c[2], da);
    }
  }

  // 3. Moldura interna com entalhes rústicos de goiva (xilogravura)
  const frameDist = sdRoundedBox(u, v, 0.5, 0.57, 0.37, 0.295, 0.055);
  const notchWave = Math.sin((u + v) * 95) * 0.004;
  if (Math.abs(frameDist + notchWave) < 0.011 && v > 0.245) {
    const fa = 1 - smoothstep(0.004, 0.011, Math.abs(frameDist + notchWave));
    r = mix(r, 244, fa * 0.85);
    g = mix(g, 206, fa * 0.85);
    b = mix(b, 134, fa * 0.85);
  }

  // 4. Castanha rústica entalhada no topo do caju
  const dNut = sdCashewNut(u, v);
  if (dNut < 0.022) {
    // Contorno espesso em tinta preta de xilogravura
    const inkA = 1 - smoothstep(0.010, 0.022, dNut);
    r = mix(r, 10, inkA);
    g = mix(g, 6, inkA);
    b = mix(b, 12, inkA);

    if (dNut < 0.003) {
      const fillA = 1 - smoothstep(-0.005, 0.003, dNut);
      // Hachura curva entalhada na castanha
      const nutHatch = Math.sin((u - v) * 145) > 0.28 ? 0.35 : 1.0;
      const nr = mix(155, 245, clamp01(1 - (v - 0.28) * 6)) * nutHatch;
      const ng = mix(105, 205, clamp01(1 - (v - 0.28) * 6)) * nutHatch;
      const nb = mix(65, 145, clamp01(1 - (v - 0.28) * 6)) * nutHatch;
      r = mix(r, nr, fillA);
      g = mix(g, ng, fillA);
      b = mix(b, nb, fillA);
    }
  }

  // 5. Corpo do Caju com textura e hachuras de xilogravura
  const dApple = sdCashewApple(u, v);
  if (dApple < 0.024) {
    // Contorno rústico grosso de xilogravura + leve realce creme externo
    const outerRim = 1 - smoothstep(0.014, 0.024, dApple);
    r = mix(r, 248, outerRim * 0.22);
    g = mix(g, 224, outerRim * 0.22);
    b = mix(b, 176, outerRim * 0.22);

    const inkA = 1 - smoothstep(0.004, 0.016, dApple);
    r = mix(r, 12, inkA);
    g = mix(g, 7, inkA);
    b = mix(b, 14, inkA);

    if (dApple < 0.002) {
      const fillA = 1 - smoothstep(-0.005, 0.002, dApple);
      const gradT = clamp01((v - 0.39) / 0.44);

      // Paleta rústica de caju maduro (vermelho-goiaba -> laranja-caju -> amarelo-ocre)
      let cr = mix(228, 255, gradT);
      let cg = mix(42, 184, gradT);
      let cb = mix(64, 48, gradT);

      // Sombreamento lateral direito + brilho entalhado à esquerda
      const sideShade = clamp01((u - 0.31) / 0.30);
      const carveCurve = v * 92 + Math.sin(u * 20) * 1.8;
      const hatch = Math.sin(carveCurve);

      // Cortes de goiva (sulcos pretos no lado sombreado, filetes ocre suaves no lado iluminado)
      const grooveThreshold = -0.35 + sideShade * 0.48;
      if (hatch < grooveThreshold) {
        const inkDepth = smoothstep(grooveThreshold, grooveThreshold - 0.40, hatch);
        cr = mix(cr, 24, inkDepth * 0.82);
        cg = mix(cg, 12, inkDepth * 0.82);
        cb = mix(cb, 20, inkDepth * 0.82);
      } else {
        const highlight = smoothstep(0.55, 0.18, sideShade) * smoothstep(0.45, 0.75, hatch) * 0.58;
        cr = mix(cr, 255, highlight);
        cg = mix(cg, 238, highlight);
        cb = mix(cb, 195, highlight);
      }

      r = mix(r, cr, fillA);
      g = mix(g, cg, fillA);
      b = mix(b, cb, fillA);
    }
  }

  // 6. Prompt de Terminal Moderno (`>_`) sobreposto no canto inferior direito
  const d1 = distToSegment(u, v, 0.46, 0.535, 0.615, 0.625);
  const d2 = distToSegment(u, v, 0.615, 0.625, 0.46, 0.715);
  const d3 = distToSegment(u, v, 0.645, 0.725, 0.79, 0.725);
  const promptDist = Math.min(d1, d2, d3);

  // Sombra/halo escuro para leitura nítida sobre as hachuras
  if (promptDist < 0.062) {
    const shadowA = (1 - smoothstep(0.025, 0.062, promptDist)) * 0.85;
    r = mix(r, 8, shadowA);
    g = mix(g, 6, shadowA);
    b = mix(b, 16, shadowA);
  }

  // Halo ciano neon moderno
  if (promptDist < 0.055) {
    const glowA = Math.exp(-promptDist * 46) * 0.72;
    r = mix(r, 0, glowA);
    g = mix(g, 240, glowA);
    b = mix(b, 255, glowA);
  }

  // Traço principal nítido branco/ciano
  if (promptDist < 0.032) {
    const strokeA = 1 - smoothstep(0.021, 0.030, promptDist);
    r = mix(r, 232, strokeA);
    g = mix(g, 252, strokeA);
    b = mix(b, 255, strokeA);
  }

  // 7. Borda externa luminosa sutil da janela moderna
  const borderBand = Math.exp(-Math.pow((boxDist + 0.008) * 95, 2));
  r = mix(r, mix(245, 0, u), borderBand * 0.85);
  g = mix(g, mix(176, 240, u), borderBand * 0.85);
  b = mix(b, mix(65, 255, u), borderBand * 0.85);

  return [clamp01(r / 255) * 255, clamp01(g / 255) * 255, clamp01(b / 255) * 255, aa * 255];
}

function renderIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const offsets = [0.25, 0.75];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let rAcc = 0;
      let gAcc = 0;
      let bAcc = 0;
      let aAcc = 0;

      // Supersampling 2x2 para bordas e hachuras sem serrilhado
      for (const oy of offsets) {
        for (const ox of offsets) {
          const u = (x + ox) / size;
          const v = (y + oy) / size;
          const [sr, sg, sb, sa] = samplePixel(u, v);
          const alphaNorm = sa / 255;
          rAcc += sr * alphaNorm;
          gAcc += sg * alphaNorm;
          bAcc += sb * alphaNorm;
          aAcc += alphaNorm;
        }
      }

      const idx = (y * size + x) * 4;
      const avgA = aAcc / 4;
      if (avgA > 0.001) {
        buf[idx] = Math.round(rAcc / aAcc);
        buf[idx + 1] = Math.round(gAcc / aAcc);
        buf[idx + 2] = Math.round(bAcc / aAcc);
        buf[idx + 3] = Math.round(avgA * 255);
      }
    }
  }

  return buf;
}

function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  const dirBuffers = [];
  let offset = 6 + entries.length * 16;

  for (const entry of entries) {
    const dir = Buffer.alloc(16);
    dir[0] = entry.size >= 256 ? 0 : entry.size;
    dir[1] = entry.size >= 256 ? 0 : entry.size;
    dir[2] = 0;
    dir[3] = 0;
    dir.writeUInt16LE(1, 4);
    dir.writeUInt16LE(32, 6);
    dir.writeUInt32LE(entry.png.length, 8);
    dir.writeUInt32LE(offset, 12);
    dirBuffers.push(dir);
    offset += entry.png.length;
  }

  return Buffer.concat([header, ...dirBuffers, ...entries.map((e) => e.png)]);
}

const sizes = [
  { size: 32, file: '32x32.png' },
  { size: 128, file: '128x128.png' },
  { size: 256, file: '128x128@2x.png' },
];

const icoEntries = [];
for (const item of sizes) {
  const rgba = renderIcon(item.size);
  const png = encodePng(item.size, item.size, rgba);
  fs.writeFileSync(path.join(OUT_DIR, item.file), png);
  icoEntries.push({ size: item.size, png });
}

fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), buildIco(icoEntries));
console.log('Ícones CajuTerm (xilogravura + terminal moderno) gerados em src-tauri/icons/.');

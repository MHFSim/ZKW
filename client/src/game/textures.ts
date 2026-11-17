import Phaser from 'phaser';

/**
 * Prozedurale Grafiken MIT Normal Maps: Kachel-Atlas, Figuren, Objekte, Effekte.
 * Alles entsteht im Code – kein Download, gleicher Stil, später austauschbar.
 */

type Height = (x: number, y: number) => number;

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const ctx2d = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: true })!;

function hash(x: number, y: number, seed = 0) {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

function smoothNoise(x: number, y: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, seed: number) {
  return smoothNoise(x, y, seed) * 0.55 + smoothNoise(x * 2.1, y * 2.1, seed + 1) * 0.3 + smoothNoise(x * 4.3, y * 4.3, seed + 2) * 0.15;
}

/** Normal Map aus einem Höhenfeld (Sobel). */
function normalFromHeight(w: number, h: number, height: Height, strength = 2.2, alpha?: Uint8ClampedArray) {
  const c = canvas(w, h);
  const ctx = ctx2d(c);
  const img = ctx.createImageData(w, h);
  const H = (x: number, y: number) => height(Math.min(w - 1, Math.max(0, x)), Math.min(h - 1, Math.max(0, y)));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1) - (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1));
      const dy = H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1) - (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1));
      let nx = -dx * strength;
      let ny = dy * strength;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * w + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = alpha ? alpha[i + 3] : 255;
    }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Höhe aus Alpha (gewölbte "Kissen"-Form) plus Helligkeit – für Figuren und Objekte. */
function spriteHeight(color: HTMLCanvasElement): { height: Height; data: Uint8ClampedArray } {
  const w = color.width;
  const h = color.height;
  const data = ctx2d(color).getImageData(0, 0, w, h).data;
  let field = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) field[i] = data[i * 4 + 3] / 255;
  for (let pass = 0; pass < 4; pass++) {
    const next = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = 0;
        let n = 0;
        for (let oy = -1; oy <= 1; oy++)
          for (let ox = -1; ox <= 1; ox++) {
            const xx = x + ox;
            const yy = y + oy;
            if (xx >= 0 && yy >= 0 && xx < w && yy < h) {
              s += field[yy * w + xx];
              n++;
            }
          }
        next[y * w + x] = s / n;
      }
    field = next;
  }
  const height: Height = (x, y) => {
    const i = y * w + x;
    const lum = (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / (3 * 255);
    return field[i] * 1.2 + lum * 0.25;
  };
  return { height, data };
}

function addLit(scene: Phaser.Scene, key: string, color: HTMLCanvasElement, strength = 3.5) {
  if (scene.textures.exists(key)) return;
  const { height, data } = spriteHeight(color);
  const tex = scene.textures.addCanvas(key, color);
  tex?.setDataSource(normalFromHeight(color.width, color.height, height, strength, data));
}

function addPlain(scene: Phaser.Scene, key: string, color: HTMLCanvasElement) {
  if (!scene.textures.exists(key)) scene.textures.addCanvas(key, color);
}

// =====================================================================
// Kachel-Atlas
// =====================================================================

export const T = {
  rock: 0, brick: 1, street: 2, earth: 3, crate: 4, metal: 5, snowTop: 6, snowRock: 7, grass: 8, labWall: 9,
  backConcrete: 10, backInterior: 11, water: 12, sewer: 13, asphalt: 14, ladder: 15, backLab: 16, backSewer: 17, backRock: 18,
} as const;
const TILE_COUNT = 19;
const S = 64;

type TileGen = (x: number, y: number) => { rgb: [number, number, number]; a?: number; h: number };

const TILE_GENS: Record<number, TileGen> = {
  [T.rock]: (x, y) => {
    const n = fbm(x / 9, y / 9, 3);
    const crack = Math.abs(smoothNoise(x / 6, y / 14, 9) - 0.5) < 0.03 ? 0.6 : 1;
    const f = (0.55 + n * 0.45) * crack;
    return { rgb: [70 * f, 66 * f, 66 * f], h: n * 0.9 * crack };
  },
  [T.backRock]: (x, y) => {
    const n = fbm(x / 9, y / 9, 13);
    const f = 0.32 + n * 0.25;
    return { rgb: [70 * f, 66 * f, 70 * f], h: n * 0.6 };
  },
  [T.brick]: (x, y) => {
    const row = Math.floor(y / 16);
    const off = row % 2 ? 16 : 0;
    const bx = (x + off) % 32;
    const by = y % 16;
    const mortar = bx < 2 || by < 2;
    const id = Math.floor((x + off) / 32) + row * 7;
    const f = mortar ? 0.45 : (0.82 + hash(id, row, 1) * 0.3) * (0.88 + hash(x, y, 1) * 0.2);
    return { rgb: [128 * f, 70 * f, 58 * f], h: mortar ? 0 : 0.7 + hash(x, y, 4) * 0.15 - (bx < 4 || by < 4 ? 0.2 : 0) };
  },
  [T.street]: (x, y) => {
    const n = fbm(x / 6, y / 6, 2);
    let f = 0.75 + n * 0.3;
    if (y < 6) f *= y < 2 ? 1.35 : 1.15;
    if (y === 6) f *= 0.5;
    if (x === 0 || x === 63) f *= 0.7;
    return { rgb: [92 * f, 96 * f, 104 * f], h: n * 0.4 + (y < 6 ? 0.5 : 0) - (x === 0 || x === 63 ? 0.3 : 0) };
  },
  [T.asphalt]: (x, y) => {
    const n = fbm(x / 3, y / 3, 21);
    let f = 0.55 + n * 0.25;
    if (y < 4) f *= 1.3;
    if (y > 10 && y < 13 && x % 32 < 18) f = 1.6; // Mittelstreifen
    return { rgb: [70 * f, 72 * f, 76 * f], h: n * 0.3 + (y < 4 ? 0.4 : 0) };
  },
  [T.earth]: (x, y) => {
    const n = fbm(x / 7, y / 7, 5);
    const stone = smoothNoise(x / 5, y / 5, 8) > 0.72;
    const f = 0.6 + n * 0.3;
    return { rgb: stone ? [90 * f, 86 * f, 84 * f] : [74 * f, 56 * f, 44 * f], h: stone ? 0.8 : n * 0.4 };
  },
  [T.grass]: (x, y) => {
    const n = fbm(x / 5, y / 5, 6);
    const blade = y < 14 + hash(x, 0, 2) * 8;
    if (y < 3 && hash(x, y, 3) > 0.5) return { rgb: [0, 0, 0], a: 0, h: 0 };
    const f = 0.6 + n * 0.4;
    return blade ? { rgb: [62 * f, 104 * f, 52 * f], h: 0.6 + n * 0.3 } : { rgb: [74 * f, 56 * f, 44 * f], h: n * 0.4 };
  },
  [T.snowTop]: (x, y) => {
    const n = fbm(x / 6, y / 6, 7);
    const snow = y < 16 + Math.sin(x / 7) * 4 + hash(x, 0, 5) * 3;
    const f = 0.8 + n * 0.2;
    return snow ? { rgb: [222 * f, 230 * f, 240 * f], h: 0.7 + n * 0.2 } : { rgb: [76 * f, 74 * f, 80 * f], h: n * 0.5 };
  },
  [T.snowRock]: (x, y) => {
    const n = fbm(x / 9, y / 9, 17);
    const f = 0.55 + n * 0.45;
    const frost = smoothNoise(x / 4, y / 4, 31) > 0.78;
    return { rgb: frost ? [180, 192, 210] : [78 * f, 80 * f, 92 * f], h: n * 0.9 };
  },
  [T.crate]: (x, y) => {
    const rib = x % 8 < 2;
    const frame = x < 4 || x > 59 || y < 4 || y > 59;
    const rust = smoothNoise(x / 4, y / 4, 9) > 0.7;
    let rgb: [number, number, number] = rust ? [120, 64, 34] : [46, 92, 110];
    let f = 0.8 + hash(x, y, 5) * 0.15;
    if (rib) f *= 0.75;
    if (frame) f *= 0.6;
    rgb = [rgb[0] * f, rgb[1] * f, rgb[2] * f];
    return { rgb, h: frame ? 0.9 : rib ? 0.2 : 0.5 };
  },
  [T.metal]: (x, y) => {
    if (y > 18) return { rgb: [0, 0, 0], a: 0, h: 0 };
    if (y > 14) return { rgb: [26, 28, 32], h: 0.3 };
    const bar = x % 8 < 3;
    const f = y < 3 ? 1.3 : bar ? 1 : 0.7;
    return { rgb: [80 * f, 88 * f, 98 * f], h: y < 3 ? 1 : bar ? 0.7 : 0.4 };
  },
  [T.labWall]: (x, y) => {
    const grout = x % 16 === 0 || y % 16 === 0;
    const dirt = smoothNoise(x / 10, y / 10, 41) * 0.25;
    const f = grout ? 0.55 : 0.85 - dirt;
    return { rgb: [200 * f, 210 * f, 212 * f], h: grout ? 0.2 : 0.7 };
  },
  [T.sewer]: (x, y) => {
    const row = Math.floor(y / 12);
    const off = row % 2 ? 12 : 0;
    const mortar = (x + off) % 24 < 2 || y % 12 < 2;
    const slime = smoothNoise(x / 8, y / 5, 23) > 0.66;
    const f = mortar ? 0.4 : 0.7 + hash(Math.floor((x + off) / 24), row, 3) * 0.25;
    return { rgb: slime ? [60 * f, 92 * f, 50 * f] : [96 * f, 84 * f, 70 * f], h: mortar ? 0 : 0.7 };
  },
  [T.backConcrete]: (x, y) => {
    const n = fbm(x / 8, y / 8, 15);
    const seam = y % 32 === 0 || x % 64 === 0;
    const f = (0.3 + n * 0.12) * (seam ? 0.7 : 1);
    return { rgb: [110 * f, 114 * f, 122 * f], h: n * 0.4 - (seam ? 0.3 : 0) };
  },
  [T.backInterior]: (_x, y) => {
    const base = y >= 40 ? 0.42 : 0.55;
    const stripe = y >= 38 && y < 41;
    const f = stripe ? 0.75 : base + hash(0, y >> 1, 2) * 0.03;
    return { rgb: [150 * f, 128 * f, 104 * f], h: stripe ? 1 : y > 40 ? 0.6 : 0.3 };
  },
  [T.backLab]: (x, y) => {
    const grout = x % 32 === 0 || y % 32 === 0;
    const f = grout ? 0.3 : 0.45 + smoothNoise(x / 12, y / 12, 51) * 0.08;
    return { rgb: [150 * f, 170 * f, 172 * f], h: grout ? 0.1 : 0.5 };
  },
  [T.backSewer]: (x, y) => {
    const row = Math.floor(y / 12);
    const off = row % 2 ? 12 : 0;
    const mortar = (x + off) % 24 < 2 || y % 12 < 2;
    const f = mortar ? 0.18 : 0.3 + hash(Math.floor((x + off) / 24), row, 7) * 0.1;
    return { rgb: [96 * f, 90 * f, 76 * f], h: mortar ? 0 : 0.6 };
  },
  [T.water]: (x, y) => {
    if (y < 34) return { rgb: [0, 0, 0], a: 0, h: 0 };
    const wave = y < 37 + Math.sin(x / 6) * 1.5;
    return { rgb: wave ? [120, 170, 160] : [40, 70, 64], a: wave ? 200 : 170, h: wave ? 0.8 : 0.4 };
  },
  [T.ladder]: (x, y) => {
    const rail = (x > 14 && x < 20) || (x > 44 && x < 50);
    const rung = y % 16 < 4 && x > 14 && x < 50;
    if (!rail && !rung) return { rgb: [0, 0, 0], a: 0, h: 0 };
    return { rgb: [150, 120, 70], h: rail ? 0.9 : 0.7 };
  },
};

function buildTileset(scene: Phaser.Scene) {
  if (scene.textures.exists('tiles')) return;
  const W = TILE_COUNT * S;
  const color = canvas(W, S);
  const ctx = ctx2d(color);
  const img = ctx.createImageData(W, S);
  const heights = new Float32Array(W * S);
  for (let t = 0; t < TILE_COUNT; t++) {
    const gen = TILE_GENS[t];
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const r = gen(x, y);
        const i = (y * W + t * S + x) * 4;
        img.data[i] = r.rgb[0];
        img.data[i + 1] = r.rgb[1];
        img.data[i + 2] = r.rgb[2];
        img.data[i + 3] = r.a ?? 255;
        heights[y * W + t * S + x] = r.h;
      }
  }
  ctx.putImageData(img, 0, 0);
  const normal = normalFromHeight(W, S, (x, y) => heights[y * W + x], 2.4, img.data);
  const tex = scene.textures.addCanvas('tiles', color);
  tex?.setDataSource(normal);
}

// =====================================================================
// Figuren
// =====================================================================

interface FigureOpts {
  w: number;
  h: number;
  skin: string;
  jacket: string;
  pants: string;
  zombie: boolean;
  hat?: string;
  extra?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  hunch?: number;
}

function figure(scene: Phaser.Scene, key: string, o: FigureOpts) {
  const { w, h } = o;
  const c = canvas(w, h);
  const ctx = ctx2d(c);
  const cx = w / 2 + (o.hunch ?? 0);
  const headR = w * 0.19;
  ctx.fillStyle = o.pants;
  ctx.beginPath();
  ctx.roundRect(w / 2 - w * 0.26, h * 0.6, w * 0.22, h * 0.4, 4);
  ctx.roundRect(w / 2 + w * 0.04, h * 0.6, w * 0.22, h * 0.4, 4);
  ctx.fill();
  ctx.fillStyle = '#16181c';
  ctx.fillRect(w / 2 - w * 0.3, h - 5, w * 0.28, 5);
  ctx.fillRect(w / 2 + w * 0.02, h - 5, w * 0.3, 5);
  ctx.fillStyle = o.jacket;
  ctx.beginPath();
  ctx.roundRect(cx - w * 0.34, h * 0.22, w * 0.68, h * 0.44, 8);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(cx - 1, h * 0.26, 2, h * 0.38);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(cx - w * 0.3, h * 0.24, w * 0.6, 3);
  if (o.zombie) {
    ctx.fillStyle = 'rgba(90,10,10,0.75)';
    ctx.beginPath();
    ctx.ellipse(cx + w * 0.12, h * 0.4, w * 0.12, h * 0.06, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.clearRect(cx - w * 0.34, h * 0.6, w * 0.12, 4);
  }
  ctx.fillStyle = o.skin;
  ctx.beginPath();
  ctx.arc(cx + (o.zombie ? w * 0.06 : 0), h * 0.13, headR, 0, Math.PI * 2);
  ctx.fill();
  if (o.hat) {
    ctx.fillStyle = o.hat;
    ctx.beginPath();
    ctx.arc(cx + (o.zombie ? w * 0.06 : 0), h * 0.11, headR * 1.04, Math.PI, 0);
    ctx.fill();
  }
  if (o.zombie) {
    ctx.fillStyle = '#10140e';
    ctx.fillRect(cx + w * 0.06 + headR * 0.25, h * 0.11, 3, 3);
  }
  o.extra?.(ctx, w, h);
  addLit(scene, key, c);
}

/** Zombie-Grafiken in der Reihenfolge der Arten (siehe shared/zombies.ts). */
function zombies(scene: Phaser.Scene) {
  const Z = (key: string, o: Partial<FigureOpts>) =>
    figure(scene, key, { w: 40, h: 64, skin: '#7f9a72', jacket: '#55604a', pants: '#3a3a40', zombie: true, hunch: 3, ...o });
  Z('z-shambler', { jacket: '#c9ced6', pants: '#5a5f66' }); // Laborkittel
  Z('z-runner', { skin: '#93a678', jacket: '#6b4a3a', pants: '#2a2a30', w: 38, h: 62, hunch: 5 });
  Z('z-brute', { w: 56, h: 76, skin: '#6f8a66', jacket: '#3c4450', pants: '#2a2c33', hunch: 2 });
  Z('z-bomber', {
    skin: '#a8a070', jacket: '#7a6a3a',
    extra: (c, w, h) => {
      c.fillStyle = '#d14b2a';
      c.beginPath();
      c.ellipse(w / 2 + 3, h * 0.42, w * 0.3, h * 0.17, 0, 0, Math.PI * 2);
      c.fill();
    },
  });
  Z('z-mud', { skin: '#5d6a48', jacket: '#4a4232', pants: '#3a3428', w: 46, h: 64, extra: (c, w, h) => {
    c.fillStyle = 'rgba(60,50,30,0.6)';
    c.fillRect(0, h * 0.7, w, h * 0.3);
  } });
  Z('z-swarm', { w: 28, h: 46, skin: '#8a9a7a', jacket: '#3a3a44', hunch: 4 });
  Z('z-spitter', { skin: '#9bbf5a', jacket: '#4a5a2a', extra: (c, w, h) => {
    c.fillStyle = '#b8ff3d';
    c.beginPath();
    c.arc(w / 2 + 8, h * 0.17, 4, 0, Math.PI * 2);
    c.fill();
  } });
  Z('z-skier', { jacket: '#d43a3a', pants: '#1c2a4a', hat: '#e8e8f0', extra: (c, w, h) => {
    c.fillStyle = '#ffb547';
    c.fillRect(w / 2 + 2, h * 0.1, 10, 4);
  } });
  Z('z-electric', { jacket: '#2a3a6a', pants: '#20283a', hat: '#ffd23a', extra: (c, w, h) => {
    c.strokeStyle = '#8fe0ff';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(w * 0.3, h * 0.3);
    c.lineTo(w * 0.5, h * 0.42);
    c.lineTo(w * 0.4, h * 0.5);
    c.lineTo(w * 0.62, h * 0.62);
    c.stroke();
  } });
  Z('z-poacher', { jacket: '#4a5a32', pants: '#3a3020', hat: '#3a2a1a' });
  Z('z-frozen', { skin: '#a8c4d8', jacket: '#6a8aa8', pants: '#4a5a70', w: 44, h: 66, extra: (c, w, h) => {
    c.fillStyle = 'rgba(220,240,255,0.55)';
    c.fillRect(w * 0.2, h * 0.2, w * 0.6, h * 0.08);
    c.fillRect(w * 0.25, h * 0.55, w * 0.5, h * 0.05);
  } });
  figure(scene, 'z-mutant', {
    w: 84, h: 118, skin: '#7a5a6a', jacket: '#5a2a3a', pants: '#2a1a24', zombie: true, hunch: 6,
    extra: (c, w, h) => {
      c.fillStyle = 'rgba(255,60,80,0.8)';
      for (let i = 0; i < 6; i++) {
        c.beginPath();
        c.arc(w * 0.3 + i * 7, h * 0.3 + (i % 2) * 10, 4, 0, Math.PI * 2);
        c.fill();
      }
    },
  });
}

// =====================================================================
// Objekte
// =====================================================================

function obj(scene: Phaser.Scene, key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, lit = true) {
  if (scene.textures.exists(key)) return;
  const c = canvas(w, h);
  draw(ctx2d(c));
  if (lit) addLit(scene, key, c, 3);
  else addPlain(scene, key, c);
}

function objects(scene: Phaser.Scene) {
  obj(scene, 'gun', 40, 12, (c) => {
    c.fillStyle = '#1c1f24';
    c.fillRect(0, 3, 36, 5);
    c.fillRect(8, 6, 6, 6);
    c.fillRect(18, 6, 4, 5);
    c.fillStyle = '#3a404a';
    c.fillRect(2, 3, 30, 2);
    c.fillStyle = '#0d0f12';
    c.fillRect(34, 2, 6, 4);
  });
  obj(scene, 'gun-big', 56, 16, (c) => {
    c.fillStyle = '#1c1f24';
    c.fillRect(0, 4, 50, 7);
    c.fillRect(10, 9, 8, 7);
    c.fillStyle = '#4a505a';
    c.fillRect(2, 4, 44, 2);
    c.fillStyle = '#0d0f12';
    c.fillRect(48, 3, 8, 6);
  });
  obj(scene, 'blade', 46, 10, (c) => {
    c.fillStyle = '#3a2a1a';
    c.fillRect(0, 3, 14, 4);
    c.fillStyle = '#c8ccd4';
    c.beginPath();
    c.moveTo(14, 0);
    c.lineTo(46, 3);
    c.lineTo(14, 10);
    c.fill();
  });
  obj(scene, 'truhe', 72, 48, (c) => {
    c.fillStyle = '#5a3a20';
    c.fillRect(2, 12, 68, 34);
    c.fillStyle = '#7a5030';
    c.fillRect(2, 2, 68, 14);
    c.fillStyle = '#d9a514';
    c.fillRect(0, 14, 72, 4);
    c.fillRect(32, 10, 8, 14);
    c.fillStyle = '#3a2410';
    for (let x = 10; x < 70; x += 14) c.fillRect(x, 20, 2, 24);
  });
  obj(scene, 'generator', 96, 72, (c) => {
    c.fillStyle = '#3a4a3a';
    c.fillRect(4, 14, 88, 56);
    c.fillStyle = '#556a55';
    c.fillRect(8, 18, 80, 10);
    c.fillStyle = '#d9a514';
    c.fillRect(70, 34, 14, 14);
    c.fillStyle = '#1a1c20';
    for (let x = 14; x < 64; x += 8) c.fillRect(x, 34, 4, 28);
    c.fillStyle = '#2a2d31';
    c.fillRect(20, 2, 10, 14);
  });
  obj(scene, 'radio', 64, 96, (c) => {
    c.fillStyle = '#3a404a';
    c.fillRect(8, 40, 48, 56);
    c.fillStyle = '#1a1d22';
    c.fillRect(14, 48, 36, 18);
    c.fillStyle = '#6ec8ff';
    c.fillRect(18, 52, 28, 10);
    c.strokeStyle = '#8a929e';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(32, 40);
    c.lineTo(32, 0);
    c.moveTo(22, 12);
    c.lineTo(42, 12);
    c.moveTo(25, 24);
    c.lineTo(39, 24);
    c.stroke();
  });
  obj(scene, 'loot', 30, 22, (c) => {
    c.fillStyle = '#6a5a3a';
    c.fillRect(1, 6, 28, 16);
    c.fillStyle = '#8a7a4a';
    c.fillRect(1, 2, 28, 6);
    c.fillStyle = '#d9a514';
    c.fillRect(12, 4, 6, 6);
  });
  obj(scene, 'bag', 30, 26, (c) => {
    c.fillStyle = '#4a3a5a';
    c.beginPath();
    c.ellipse(15, 16, 14, 10, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#6a5a7a';
    c.fillRect(11, 2, 8, 8);
  });
  obj(scene, 'paper', 22, 28, (c) => {
    c.fillStyle = '#e8e2cc';
    c.fillRect(1, 1, 20, 26);
    c.fillStyle = '#8a8470';
    for (let y = 6; y < 24; y += 4) c.fillRect(4, y, 14, 1);
  });
  obj(scene, 'funkteil', 30, 24, (c) => {
    c.fillStyle = '#2a4a3a';
    c.fillRect(1, 4, 28, 18);
    c.fillStyle = '#3ddc97';
    c.fillRect(4, 8, 6, 6);
    c.fillStyle = '#d9a514';
    for (let x = 12; x < 28; x += 4) c.fillRect(x, 6, 2, 14);
  });
  obj(scene, 'wallbuy', 70, 50, (c) => {
    c.strokeStyle = '#ffb547';
    c.lineWidth = 3;
    c.strokeRect(3, 3, 64, 44);
    c.fillStyle = 'rgba(255,181,71,0.12)';
    c.fillRect(3, 3, 64, 44);
    c.fillStyle = '#ffb547';
    c.fillRect(12, 20, 44, 6);
    c.fillRect(20, 26, 8, 10);
  }, false);
  obj(scene, 'station', 64, 64, (c) => {
    c.fillStyle = '#4a4036';
    c.fillRect(4, 24, 56, 40);
    c.fillStyle = '#6a5a48';
    c.fillRect(0, 20, 64, 8);
    c.fillStyle = '#2a2420';
    c.fillRect(10, 34, 14, 20);
    c.fillRect(30, 34, 24, 8);
  });
  obj(scene, 'gondel', 90, 70, (c) => {
    c.fillStyle = '#b8342a';
    c.beginPath();
    c.roundRect(4, 20, 82, 48, 10);
    c.fill();
    c.fillStyle = '#a8d4ff';
    c.fillRect(12, 28, 28, 18);
    c.fillRect(50, 28, 28, 18);
    c.fillStyle = '#3a3a40';
    c.fillRect(42, 0, 6, 22);
  });
  obj(scene, 'door-v', 64, 64, (c) => {
    c.fillStyle = '#5a5f66';
    c.fillRect(0, 0, 64, 64);
    for (let i = -64; i < 128; i += 16) {
      c.fillStyle = '#d9a514';
      c.beginPath();
      c.moveTo(i, 0); c.lineTo(i + 8, 0); c.lineTo(i + 8 - 64, 64); c.lineTo(i - 64, 64);
      c.fill();
    }
    c.strokeStyle = '#2a2d31';
    c.lineWidth = 5;
    c.strokeRect(3, 3, 58, 58);
  });
  obj(scene, 'door-h', 64, 64, (c) => {
    c.fillStyle = '#3a3f46';
    c.fillRect(0, 0, 64, 64);
    c.fillStyle = '#20242a';
    for (let x = 6; x < 64; x += 10) c.fillRect(x, 4, 4, 56);
    c.fillStyle = '#d9a514';
    c.fillRect(0, 0, 64, 6);
    c.fillRect(0, 58, 64, 6);
  });
  obj(scene, 'heli', 260, 110, (c) => {
    c.fillStyle = '#3a4a3a';
    c.beginPath();
    c.ellipse(110, 64, 90, 36, 0, 0, Math.PI * 2);
    c.fill();
    c.fillRect(170, 54, 80, 14);
    c.fillStyle = '#a8d4ff';
    c.beginPath();
    c.ellipse(56, 58, 30, 22, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#1a1c20';
    c.fillRect(10, 8, 220, 6);
    c.fillRect(106, 12, 8, 22);
    c.fillRect(60, 96, 110, 6);
  });
}

// =====================================================================
// Effekte und Himmel
// =====================================================================

function radial(scene: Phaser.Scene, key: string, size: number, inner: string, outer: string) {
  const c = canvas(size, size);
  const ctx = ctx2d(c);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  addPlain(scene, key, c);
}

function dot(scene: Phaser.Scene, key: string, color: string, r: number) {
  const c = canvas(r * 2, r * 2);
  const ctx = ctx2d(c);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.fill();
  addPlain(scene, key, c);
}

function effects(scene: Phaser.Scene) {
  radial(scene, 'glow', 128, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)');
  radial(scene, 'flash', 64, 'rgba(255,230,170,1)', 'rgba(255,160,60,0)');
  radial(scene, 'smoke', 64, 'rgba(120,120,128,0.5)', 'rgba(120,120,128,0)');
  radial(scene, 'fire', 32, 'rgba(255,220,120,1)', 'rgba(255,90,20,0)');
  const rain = canvas(3, 34);
  const rc = ctx2d(rain);
  const g = rc.createLinearGradient(0, 0, 0, 34);
  g.addColorStop(0, 'rgba(200,220,255,0)');
  g.addColorStop(1, 'rgba(220,235,255,0.9)');
  rc.fillStyle = g;
  rc.fillRect(1, 0, 1, 34);
  addPlain(scene, 'rain', rain);
  dot(scene, 'snow', '#f4f8ff', 3);
  dot(scene, 'blood', '#9e0d14', 4);
  dot(scene, 'spark', '#ffe2a8', 2);

  // Kugel: weißer, heißer Kern mit weichem Schweif (Farbe kommt per Tint). Spitze rechts.
  const bl = canvas(96, 12);
  const bc = ctx2d(bl);
  const tail = bc.createLinearGradient(0, 0, 96, 0);
  tail.addColorStop(0, 'rgba(255,255,255,0)');
  tail.addColorStop(0.75, 'rgba(255,255,255,0.55)');
  tail.addColorStop(1, 'rgba(255,255,255,0.95)');
  bc.fillStyle = tail;
  bc.beginPath();
  bc.moveTo(0, 6);
  bc.lineTo(84, 2);
  bc.quadraticCurveTo(96, 6, 84, 10);
  bc.closePath();
  bc.fill();
  bc.fillStyle = 'rgba(255,255,255,1)';
  bc.beginPath();
  bc.ellipse(86, 6, 8, 2.6, 0, 0, Math.PI * 2);
  bc.fill();
  addPlain(scene, 'bullet', bl);
  // Weicher Halo für die Kugel (größer, wird eingefärbt)
  const bh = canvas(128, 24);
  const hc = ctx2d(bh);
  const hg = hc.createRadialGradient(100, 12, 0, 100, 12, 28);
  hg.addColorStop(0, 'rgba(255,255,255,0.8)');
  hg.addColorStop(1, 'rgba(255,255,255,0)');
  hc.fillStyle = hg;
  hc.fillRect(0, 0, 128, 24);
  const ht = hc.createLinearGradient(0, 0, 100, 0);
  ht.addColorStop(0, 'rgba(255,255,255,0)');
  ht.addColorStop(1, 'rgba(255,255,255,0.35)');
  hc.fillStyle = ht;
  hc.fillRect(0, 8, 100, 8);
  addPlain(scene, 'bullet-halo', bh);
  // Patronenhülse (Messing) und Einschlag-Staub
  const cs = canvas(8, 4);
  const cc = ctx2d(cs);
  cc.fillStyle = '#c9952e';
  cc.fillRect(0, 0, 8, 4);
  cc.fillStyle = '#f2cf6a';
  cc.fillRect(0, 0, 8, 1.5);
  cc.fillStyle = '#7a5617';
  cc.fillRect(6, 0, 2, 4);
  addPlain(scene, 'casing', cs);
  radial(scene, 'dust', 32, 'rgba(170,160,145,0.55)', 'rgba(170,160,145,0)');
  // Mündungsfeuer als Stern (eingefärbt, additiv)
  const mf = canvas(96, 48);
  const mc = ctx2d(mf);
  const core = mc.createRadialGradient(20, 24, 0, 20, 24, 22);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  mc.fillStyle = core;
  mc.fillRect(0, 0, 96, 48);
  mc.fillStyle = 'rgba(255,255,255,0.85)';
  for (const [len, w, ang] of [[92, 7, 0], [46, 5, -0.55], [46, 5, 0.55], [30, 4, -1.2], [30, 4, 1.2]] as const) {
    mc.save();
    mc.translate(14, 24);
    mc.rotate(ang);
    mc.beginPath();
    mc.moveTo(0, -w);
    mc.lineTo(len, 0);
    mc.lineTo(0, w);
    mc.closePath();
    mc.fill();
    mc.restore();
  }
  addPlain(scene, 'muzzle', mf);
  dot(scene, 'acid', '#b8ff3d', 5);
  dot(scene, 'drip', '#8aa0b0', 2);

  // Nebelband
  const fog = canvas(512, 256);
  const fc = ctx2d(fog);
  for (let i = 0; i < 40; i++) {
    const x = hash(i, 1, 4) * 512;
    const y = 90 + hash(i, 2, 4) * 128;
    const r = 60 + hash(i, 3, 4) * 120;
    for (const dx of [-512, 0, 512]) {
      const gr = fc.createRadialGradient(x + dx, y, 0, x + dx, y, r);
      gr.addColorStop(0, 'rgba(190,200,220,0.16)');
      gr.addColorStop(1, 'rgba(190,200,220,0)');
      fc.fillStyle = gr;
      fc.fillRect(x + dx - r, y - r, r * 2, r * 2);
    }
  }
  addPlain(scene, 'fog', fog);

  // Sternenhimmel (kachelbar) und Vignette als fertige Bilder – kosten beim Zeichnen fast nichts
  const stars = canvas(1024, 800);
  const stc = ctx2d(stars);
  for (let i = 0; i < 160; i++) {
    const big = hash(i, 77, 1) < 0.1;
    stc.fillStyle = `rgba(255,255,255,${0.3 + hash(i, 77, 2) * 0.7})`;
    stc.beginPath();
    stc.arc(hash(i, 77, 3) * 1024, hash(i, 77, 4) * 800, big ? 1.6 : 0.9, 0, Math.PI * 2);
    stc.fill();
  }
  addPlain(scene, 'stars', stars);
  const vig = canvas(512, 288);
  const vc = ctx2d(vig);
  const vg = vc.createRadialGradient(256, 144, 90, 256, 144, 300);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(0.55, 'rgba(0,0,0,0.12)');
  vg.addColorStop(1, 'rgba(0,0,0,0.62)');
  vc.fillStyle = vg;
  vc.fillRect(0, 0, 512, 288);
  addPlain(scene, 'vignette', vig);

  // Berge (Silhouetten mit Schnee) und Stadt-Skyline mit Fensterlicht
  // Kachelbare Bergkette: Summe ganzzahliger Sinus-Frequenzen über 1024 px → nahtlos wiederholbar
  const ridge = (x: number, seed: number) => {
    let v = 0;
    let norm = 0;
    for (const k of [1, 2, 3, 5, 7, 11, 17, 29]) {
      const a = 1 / Math.pow(k, 0.85);
      const ph = hash(k, seed, 5) * Math.PI * 2;
      const sn = Math.sin((x / 1024) * Math.PI * 2 * k + ph);
      v += a * (k <= 3 ? sn : 1 - Math.abs(sn) * 2); // tiefe Frequenzen weich, hohe als Grate
      norm += a;
    }
    return v / norm; // ca. −1 … 1
  };
  for (const [key, seed, base, amp, snow] of [['mountains-far', 3, 290, 190, true], ['mountains-near', 7, 170, 120, false]] as const) {
    const c = canvas(1024, 512);
    const m = ctx2d(c);
    const pts: [number, number][] = [];
    for (let x = 0; x <= 1024; x += 4) pts.push([x, 512 - (base + ridge(x, seed) * amp)]);
    // Körper mit leichtem Verlauf (oben heller = Dunst), damit die Kette auch vor dunklem Himmel lesbar bleibt
    const gr = m.createLinearGradient(0, 512 - base - amp, 0, 512);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(1, '#b8b8b8');
    m.fillStyle = gr;
    m.beginPath();
    m.moveTo(0, 512);
    for (const [x, y] of pts) m.lineTo(x, y);
    m.lineTo(1024, 512);
    m.fill();
    addPlain(scene, key, c);
    if (snow) {
      // Schnee nur auf den hohen Gipfeln, nach unten ausfransend
      const s = canvas(1024, 512);
      const sc = ctx2d(s);
      const snowLine = 512 - (base + amp * 0.32);
      sc.fillStyle = '#ffffff';
      sc.beginPath();
      sc.moveTo(0, 512);
      for (const [x, y] of pts) sc.lineTo(x, y);
      sc.lineTo(1024, 512);
      sc.closePath();
      sc.save();
      sc.clip();
      sc.beginPath();
      sc.moveTo(0, 0);
      for (const [x] of pts) sc.lineTo(x, snowLine + (ridge(x * 7, seed + 4) * 0.5 + 0.5) * 34);
      sc.lineTo(1024, 0);
      sc.fill();
      sc.restore();
      addPlain(scene, `${key}-snow`, s);
    }
  }
  const sil = canvas(1024, 512);
  const win = canvas(1024, 512);
  const s = ctx2d(sil);
  const w = ctx2d(win);
  s.fillStyle = '#ffffff';
  let x = 0;
  let i = 0;
  while (x < 1024) {
    const bw = 50 + hash(i, 23, 1) * 110;
    const bh = 120 + hash(i, 23, 2) * 220;
    const top = 512 - bh;
    s.fillRect(x, top, bw - 4, bh);
    if (hash(i, 23, 3) > 0.7) s.fillRect(x + bw * 0.4, top - 30, 4, 30);
    for (let wy = top + 12; wy < 502; wy += 18)
      for (let wx = x + 8; wx < x + bw - 14; wx += 14) {
        const n = hash(wx, wy, 23);
        if (n > 0.62) {
          w.fillStyle = n > 0.93 ? 'rgba(140,200,255,0.85)' : 'rgba(255,200,120,0.85)';
          w.fillRect(wx, wy, 6, 9);
        }
      }
    x += bw;
    i++;
  }
  addPlain(scene, 'skyline', sil);
  addPlain(scene, 'skyline-win', win);
}

export const PLAYER_COLORS = [0xffb547, 0x6ec8ff, 0x3ddc97, 0xff6fae, 0xb26bff, 0xff8a3d];

export function createTextures(scene: Phaser.Scene) {
  buildTileset(scene);
  PLAYER_COLORS.forEach((c, i) => {
    figure(scene, `player-${i}`, { w: 40, h: 64, skin: '#d9a58a', jacket: `#${c.toString(16).padStart(6, '0')}`, pants: '#2b3445', zombie: false, hat: '#20242b' });
  });
  zombies(scene);
  objects(scene);
  effects(scene);
}

import * as THREE from 'three';

/* ---------- seeded random + tileable noise ---------- */
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return (s % 1000000) / 1000000;
  };
}

function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// periodic value noise (period p in lattice cells)
export function vnoise(x, y, p, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const m = (a) => ((a % p) + p) % p;
  const x0 = m(xi), x1 = m(xi + 1), y0 = m(yi), y1 = m(yi + 1);
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x, y, p, oct = 5, seed = 0, lac = 2, gain = 0.5) {
  let amp = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * vnoise(x * f, y * f, p * f, seed + i * 17);
    norm += amp; amp *= gain; f *= lac;
  }
  return sum / norm;
}

// tileable voronoi: returns [f1, f2, cellId]
export function voronoi(x, y, p, seed = 0, jitter = 0.85) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j;
    const wx = ((cx % p) + p) % p, wy = ((cy % p) + p) % p;
    const px = cx + 0.5 + (hash2(wx, wy, seed) - 0.5) * jitter;
    const py = cy + 0.5 + (hash2(wx, wy, seed + 7) - 0.5) * jitter;
    const d = Math.hypot(px - x, py - y);
    if (d < f1) { f2 = f1; f1 = d; id = hash2(wx, wy, seed + 3); } else if (d < f2) f2 = d;
  }
  return [f1, f2, id];
}

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const tmath = { clamp, mix, smooth };

/* ---------- builders ---------- */
function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function toTexture(c, { srgb = true, repeat = 1, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/**
 * Procedural PBR set. fn(u,v) -> {h, r,g,b (0..1), rough}
 */
export function pbrSet(size, fn, normalStrength = 2.5) {
  const n = size * size;
  const H = new Float32Array(n);
  const col = canvas(size), rgh = canvas(size), nor = canvas(size);
  const cc = col.getContext('2d'), rc = rgh.getContext('2d'), nc = nor.getContext('2d');
  const ci = cc.createImageData(size, size), ri = rc.createImageData(size, size), ni = nc.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = fn(x / size, y / size);
    const i = y * size + x;
    H[i] = o.h;
    ci.data[i * 4] = clamp(o.r) * 255; ci.data[i * 4 + 1] = clamp(o.g) * 255; ci.data[i * 4 + 2] = clamp(o.b) * 255; ci.data[i * 4 + 3] = 255;
    const rr = clamp(o.rough) * 255;
    ri.data[i * 4] = rr; ri.data[i * 4 + 1] = rr; ri.data[i * 4 + 2] = rr; ri.data[i * 4 + 3] = 255;
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const xl = (x - 1 + size) % size, xr = (x + 1) % size, yu = (y - 1 + size) % size, yd = (y + 1) % size;
    const dx = (H[y * size + xr] - H[y * size + xl]) * normalStrength;
    const dy = (H[yd * size + x] - H[yu * size + x]) * normalStrength;
    const len = Math.hypot(dx, dy, 1);
    const i = (y * size + x) * 4;
    ni.data[i] = (-dx / len * 0.5 + 0.5) * 255;
    ni.data[i + 1] = (dy / len * 0.5 + 0.5) * 255;
    ni.data[i + 2] = (1 / len * 0.5 + 0.5) * 255;
    ni.data[i + 3] = 255;
  }
  cc.putImageData(ci, 0, 0); rc.putImageData(ri, 0, 0); nc.putImageData(ni, 0, 0);
  return {
    map: toTexture(col),
    roughnessMap: toTexture(rgh, { srgb: false }),
    normalMap: toTexture(nor, { srgb: false }),
  };
}

export function setRepeat(set, rx, ry = rx) {
  for (const k in set) if (set[k] && set[k].isTexture) { set[k] = set[k].clone(); set[k].needsUpdate = true; set[k].repeat.set(rx, ry); }
  return set;
}

/* ---------- material library ---------- */
const cache = {};
export function lib(name) {
  if (cache[name]) return cache[name];
  const f = GEN[name];
  cache[name] = f();
  return cache[name];
}

const GEN = {
  bark: () => pbrSet(512, (u, v) => {
    const ridge = fbm(u * 6, v * 1.5, 6, 4, 11);
    const fine = fbm(u * 24, v * 6, 24, 3, 12);
    const cracks = Math.pow(1 - Math.abs(Math.sin((u * 14 + ridge * 1.6) * Math.PI)), 6);
    const moss = smooth(0.55, 0.75, fbm(u * 3, v * 3, 3, 4, 13));
    const h = ridge * 0.6 + fine * 0.3 - cracks * 0.5;
    const base = 0.16 + h * 0.18;
    let r = base * 1.05, g = base * 0.92, b = base * 0.82;
    r = mix(r, 0.16, moss * 0.6); g = mix(g, 0.2, moss * 0.6); b = mix(b, 0.12, moss * 0.6);
    return { h, r, g, b, rough: 0.82 + fine * 0.15 - moss * 0.05 };
  }, 4),

  forestGround: () => pbrSet(512, (u, v) => {
    const big = fbm(u * 4, v * 4, 4, 5, 21);
    const [f1, , id] = voronoi(u * 26, v * 26, 26, 22, 1);
    const leaf = smooth(0.42, 0.2, f1) * (id > 0.45 ? 1 : 0);
    const moss = smooth(0.48, 0.62, fbm(u * 6, v * 6, 6, 4, 23));
    const fine = fbm(u * 64, v * 64, 64, 2, 24);
    const h = big * 0.5 + leaf * 0.25 + fine * 0.2;
    let r = 0.11 + big * 0.07 + leaf * (0.08 + id * 0.08), g = 0.09 + big * 0.06 + leaf * 0.05, b = 0.07 + big * 0.04;
    r = mix(r, 0.11, moss * 0.8); g = mix(g, 0.16, moss * 0.8); b = mix(b, 0.08, moss * 0.8);
    return { h, r, g, b, rough: 0.75 - leaf * 0.15 + fine * 0.15 };
  }, 3),

  asphalt: () => pbrSet(512, (u, v) => {
    const grain = fbm(u * 128, v * 128, 128, 2, 31);
    const patch = fbm(u * 3, v * 3, 3, 4, 32);
    const [f1] = voronoi(u * 90, v * 90, 90, 33, 1);
    const stone = smooth(0.25, 0.05, f1);
    const h = grain * 0.4 + stone * 0.4;
    const c = 0.07 + grain * 0.05 + stone * 0.05 + patch * 0.03;
    const wet = smooth(0.45, 0.6, patch);
    return { h, r: c, g: c * 1.02, b: c * 1.06, rough: mix(0.55, 0.12, wet) + grain * 0.1 };
  }, 1.5),

  cobble: () => pbrSet(512, (u, v) => {
    const [f1, f2, id] = voronoi(u * 10, v * 10, 10, 41, 0.75);
    const edge = f2 - f1;
    const stone = smooth(0.02, 0.14, edge);
    const dome = Math.sqrt(clamp(1 - f1 * 1.6));
    const fine = fbm(u * 60, v * 60, 60, 3, 42);
    const h = stone * (0.5 + dome * 0.5) + fine * 0.12;
    const c = 0.14 + id * 0.1 + fine * 0.06;
    const grout = 1 - stone;
    let r = c, g = c * 0.97, b = c * 0.93;
    r = mix(r, 0.06, grout); g = mix(g, 0.07, grout); b = mix(b, 0.05, grout);
    return { h, r, g, b, rough: mix(0.25, 0.7, grout) + fine * 0.2 };
  }, 4),

  stone: () => pbrSet(512, (u, v) => {
    const big = fbm(u * 5, v * 5, 5, 6, 51);
    const fine = fbm(u * 40, v * 40, 40, 3, 52);
    const lichen = smooth(0.58, 0.7, fbm(u * 8, v * 8, 8, 4, 53));
    const h = big * 0.7 + fine * 0.3;
    const c = 0.2 + big * 0.14 + fine * 0.05;
    let r = c, g = c * 0.98, b = c * 0.95;
    r = mix(r, 0.2, lichen * 0.7); g = mix(g, 0.24, lichen * 0.7); b = mix(b, 0.16, lichen * 0.7);
    return { h, r, g, b, rough: 0.78 + fine * 0.18 };
  }, 3),

  brick: () => pbrSet(512, (u, v) => {
    const rows = 16, cols = 8;
    const ry = v * rows, row = Math.floor(ry);
    const rx = u * cols + (row % 2) * 0.5, col = Math.floor(rx);
    const fx = rx - col, fy = ry - row;
    const m = Math.min(fx, 1 - fx) * 4, n = Math.min(fy, 1 - fy) * 2;
    const mortar = 1 - smooth(0.05, 0.14, Math.min(m * 0.25, n * 0.5));
    const id = hash2(((col % cols) + cols) % cols, row % rows, 61);
    const fine = fbm(u * 64, v * 64, 64, 3, 62);
    const stain = fbm(u * 3, v * 3, 3, 4, 63);
    const h = (1 - mortar) * (0.7 + fine * 0.3);
    let r = 0.3 + id * 0.12 + fine * 0.06 - stain * 0.12, g = 0.17 + id * 0.05 + fine * 0.04 - stain * 0.06, b = 0.13 + fine * 0.04 - stain * 0.04;
    r = mix(r, 0.2, mortar); g = mix(g, 0.19, mortar); b = mix(b, 0.17, mortar);
    return { h, r, g, b, rough: mix(0.55, 0.9, mortar) - stain * 0.2 };
  }, 3),

  plaster: () => pbrSet(512, (u, v) => {
    const big = fbm(u * 3, v * 3, 3, 6, 71);
    const fine = fbm(u * 50, v * 50, 50, 3, 72);
    const drip = fbm(u * 30, v * 1.5, 30, 4, 73);
    const stain = smooth(0.45, 0.75, drip * 0.6 + (1 - v) * 0.4 * big);
    const h = fine * 0.4 + big * 0.3;
    const c = 0.42 + big * 0.12 + fine * 0.05;
    return { h, r: c - stain * 0.18, g: c * 0.96 - stain * 0.17, b: c * 0.88 - stain * 0.15, rough: 0.85 - stain * 0.3 };
  }, 1.5),

  wood: () => pbrSet(512, (u, v) => {
    const planks = 6;
    const p = u * planks, pid = Math.floor(p), pf = p - pid;
    const off = hash2(pid, 0, 81) * 10;
    const grain = fbm(pf * 2, v * 1.2 + off, 2, 5, 82 + pid);
    const rings = Math.sin((v * 40 + grain * 6) * 1.0) * 0.5 + 0.5;
    const gap = 1 - smooth(0.0, 0.04, Math.min(pf, 1 - pf));
    const fine = fbm(u * 80, v * 8, 80, 2, 83);
    const id = hash2(pid, 1, 84);
    const h = (1 - gap) * (0.6 + rings * 0.2 + fine * 0.2);
    let c = 0.22 + rings * 0.06 + id * 0.08 + fine * 0.04;
    return { h, r: mix(c * 1.05, 0.03, gap), g: mix(c * 0.86, 0.03, gap), b: mix(c * 0.7, 0.03, gap), rough: 0.68 + fine * 0.2 };
  }, 3),

  snow: () => pbrSet(512, (u, v) => {
    const big = fbm(u * 4, v * 4, 4, 5, 91);
    const fine = fbm(u * 70, v * 70, 70, 2, 92);
    const sp = hash2(Math.floor(u * 512), Math.floor(v * 512), 93) > 0.985 ? 1 : 0;
    const h = big * 0.6 + fine * 0.25;
    const c = 0.82 + big * 0.1 + fine * 0.05;
    return { h, r: c * 0.97, g: c * 0.98, b: c, rough: sp ? 0.15 : 0.8 + fine * 0.1 };
  }, 2),

  mud: () => pbrSet(512, (u, v) => {
    const big = fbm(u * 4, v * 4, 4, 5, 101);
    const fine = fbm(u * 50, v * 50, 50, 3, 102);
    const wet = smooth(0.45, 0.6, big);
    const h = big * 0.5 + fine * 0.3;
    const c = 0.09 + big * 0.06 + fine * 0.03;
    return { h, r: c * 1.1, g: c, b: c * 0.8, rough: mix(0.85, 0.2, wet) };
  }, 2),

  moss: () => pbrSet(256, (u, v) => {
    const fine = fbm(u * 40, v * 40, 40, 4, 111);
    const big = fbm(u * 4, v * 4, 4, 3, 112);
    const h = fine;
    return { h, r: 0.1 + big * 0.06, g: 0.15 + big * 0.07 + fine * 0.05, b: 0.07 + big * 0.02, rough: 0.95 };
  }, 3),

  roof: () => pbrSet(512, (u, v) => {
    const rows = 14, row = Math.floor(v * rows), fy = v * rows - row;
    const col = Math.floor(u * 10 + (row % 2) * 0.5);
    const id = hash2(((col % 10) + 10) % 10, row, 121);
    const fine = fbm(u * 60, v * 60, 60, 3, 122);
    const h = fy * 0.8 + fine * 0.2 - (fy > 0.92 ? 0.5 : 0);
    const c = 0.07 + id * 0.05 + fine * 0.04;
    return { h, r: c, g: c * 1.02, b: c * 1.1, rough: 0.55 + fine * 0.3 };
  }, 3),

  metal: () => pbrSet(256, (u, v) => {
    const fine = fbm(u * 40, v * 40, 40, 4, 131);
    const rust = smooth(0.55, 0.7, fbm(u * 6, v * 6, 6, 4, 132));
    const c = 0.06 + fine * 0.03;
    return { h: fine * 0.3 + rust * 0.3, r: mix(c, 0.2, rust), g: mix(c, 0.1, rust), b: mix(c, 0.05, rust), rough: 0.4 + rust * 0.45 + fine * 0.1 };
  }, 1.5),
};

/* ---------- alpha cards ---------- */
function cardTexture(size, draw) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

const cardCache = {};
export function card(name) {
  if (cardCache[name]) return cardCache[name];
  const r = rng(name.length * 97 + name.charCodeAt(0));
  const T = {
    needles: () => cardTexture(512, (g, s) => {
      // conifer branch spray: central twig + sub twigs + needles
      g.lineCap = 'round';
      const twig = (x0, y0, ang, len, w, depth) => {
        const x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len;
        g.strokeStyle = `rgb(${40 + r() * 15},${34 + r() * 10},${24})`;
        g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
        const n = Math.floor(len / 3.2);
        for (let i = 0; i < n; i++) {
          const t = i / n, px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
          for (const sd of [-1, 1]) {
            const a = ang + sd * (0.9 + r() * 0.3) - 0.25 * sd * t;
            const nl = (10 + r() * 7) * (1 - t * 0.5) * (s / 512);
            const gcol = 48 + r() * 40;
            g.strokeStyle = `rgb(${gcol * 0.55 | 0},${gcol | 0},${gcol * 0.62 | 0})`;
            g.lineWidth = 1.4 * (s / 512);
            g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * nl, py + Math.sin(a) * nl); g.stroke();
          }
        }
        if (depth > 0) {
          const k = 3 + Math.floor(r() * 3);
          for (let i = 0; i < k; i++) {
            const t = 0.2 + (i / k) * 0.7;
            const sd = i % 2 ? 1 : -1;
            twig(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, ang + sd * (0.5 + r() * 0.4), len * (0.45 - t * 0.2), w * 0.6, depth - 1);
          }
        }
      };
      twig(s * 0.5, s * 0.98, -Math.PI / 2, s * 0.92, 5 * s / 512, 2);
    }),

    fern: () => cardTexture(512, (g, s) => {
      g.lineCap = 'round';
      const n = 26;
      g.strokeStyle = 'rgb(46,60,30)'; g.lineWidth = 4;
      g.beginPath(); g.moveTo(s / 2, s); g.quadraticCurveTo(s * 0.52, s * 0.5, s * 0.5, s * 0.02); g.stroke();
      for (let i = 1; i < n; i++) {
        const t = i / n, y = s - t * s * 0.97;
        const len = Math.sin(t * Math.PI * 0.92 + 0.15) * s * 0.42;
        for (const sd of [-1, 1]) {
          const leaflets = Math.max(3, Math.floor(len / 9));
          for (let j = 0; j < leaflets; j++) {
            const q = j / leaflets;
            const lx = s / 2 + sd * q * len, ly = y - q * len * 0.25;
            const lw = (1 - q) * 8 + 2.5;
            const gc = 60 + r() * 40 - t * 10;
            g.fillStyle = `rgb(${gc * 0.62 | 0},${gc | 0},${gc * 0.48 | 0})`;
            g.beginPath(); g.ellipse(lx, ly, lw, lw * 0.5, sd * 0.6 - 0.3, 0, Math.PI * 2); g.fill();
          }
        }
      }
    }),

    leaves: () => cardTexture(512, (g, s) => {
      for (let i = 0; i < 220; i++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * s * 0.44;
        const x = s / 2 + Math.cos(a) * d, y = s / 2 + Math.sin(a) * d;
        const gc = 40 + r() * 45;
        g.fillStyle = `rgb(${gc * 0.7 | 0},${gc | 0},${gc * 0.55 | 0})`;
        g.beginPath(); g.ellipse(x, y, 9 + r() * 7, 4 + r() * 3, r() * Math.PI, 0, Math.PI * 2); g.fill();
      }
    }),

    mossStrand: () => cardTexture(256, (g, s) => {
      g.lineCap = 'round';
      for (let i = 0; i < 26; i++) {
        let x = s * (0.3 + r() * 0.4), y = 0;
        const len = s * (0.5 + r() * 0.5);
        g.lineWidth = 1 + r() * 2.2;
        const c = 120 + r() * 50;
        g.strokeStyle = `rgba(${c * 0.78 | 0},${c * 0.86 | 0},${c * 0.7 | 0},${0.6 + r() * 0.4})`;
        g.beginPath(); g.moveTo(x, y);
        while (y < len) { x += (r() - 0.5) * 6; y += 6 + r() * 6; g.lineTo(x, y); }
        g.stroke();
      }
    }),

    grass: () => cardTexture(256, (g, s) => {
      for (let i = 0; i < 40; i++) {
        const x = s * (0.1 + r() * 0.8), h = s * (0.4 + r() * 0.58), bend = (r() - 0.5) * 40;
        const c = 50 + r() * 50;
        g.fillStyle = `rgb(${c * 0.75 | 0},${c | 0},${c * 0.5 | 0})`;
        g.beginPath(); g.moveTo(x - 3, s); g.quadraticCurveTo(x + bend * 0.4, s - h * 0.6, x + bend, s - h); g.quadraticCurveTo(x + bend * 0.4 + 2, s - h * 0.6, x + 3, s); g.fill();
      }
    }),

    reed: () => cardTexture(256, (g, s) => {
      for (let i = 0; i < 18; i++) {
        const x = s * (0.15 + r() * 0.7), h = s * (0.6 + r() * 0.4), bend = (r() - 0.5) * 30;
        const c = 70 + r() * 40;
        g.strokeStyle = `rgb(${c * 0.85 | 0},${c * 0.82 | 0},${c * 0.55 | 0})`; g.lineWidth = 2.5;
        g.beginPath(); g.moveTo(x, s); g.quadraticCurveTo(x + bend * 0.3, s - h * 0.5, x + bend, s - h); g.stroke();
        if (r() > 0.6) { g.fillStyle = 'rgb(58,44,30)'; g.beginPath(); g.ellipse(x + bend * 0.8, s - h * 0.85, 3.5, 14, 0, 0, Math.PI * 2); g.fill(); }
      }
    }),

    twigs: () => cardTexture(512, (g, s) => {
      g.lineCap = 'round';
      const br = (x, y, a, l, w, d) => {
        const x1 = x + Math.cos(a) * l, y1 = y + Math.sin(a) * l;
        g.strokeStyle = 'rgb(38,32,28)'; g.lineWidth = w; g.beginPath(); g.moveTo(x, y); g.lineTo(x1, y1); g.stroke();
        if (d > 0) for (let i = 0; i < 3; i++) br(x1, y1, a + (r() - 0.5) * 1.3, l * (0.55 + r() * 0.2), w * 0.65, d - 1);
      };
      for (let i = 0; i < 5; i++) br(s / 2 + (r() - 0.5) * 40, s, -Math.PI / 2 + (r() - 0.5) * 0.9, s * 0.28, 6, 5);
    }),

    glow: () => cardTexture(256, (g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.08, 'rgba(255,255,255,0.75)');
      gr.addColorStop(0.3, 'rgba(255,255,255,0.18)');
      gr.addColorStop(0.65, 'rgba(255,255,255,0.04)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
    }),

    fog: () => cardTexture(256, (g, s) => {
      const id = g.createImageData(s, s);
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
        const dx = x / s - 0.5, dy = y / s - 0.5;
        const fall = clamp(1 - Math.hypot(dx, dy) * 2);
        const n = fbm(x / s * 4, y / s * 4, 4, 5, 141);
        const a = Math.pow(fall, 1.6) * smooth(0.25, 0.85, n);
        const i = (y * s + x) * 4;
        id.data[i] = id.data[i + 1] = id.data[i + 2] = 255; id.data[i + 3] = a * 255;
      }
      g.putImageData(id, 0, 0);
    }),

    cookie: () => cardTexture(256, (g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, '#fff'); gr.addColorStop(0.22, '#f4f2ec'); gr.addColorStop(0.3, '#8a8780');
      gr.addColorStop(0.42, '#d8d4cc'); gr.addColorStop(0.47, '#6a6862'); gr.addColorStop(0.8, '#2a2a28'); gr.addColorStop(1, '#000');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
      g.globalAlpha = 0.08;
      for (let i = 0; i < 300; i++) { g.fillStyle = r() > 0.5 ? '#000' : '#fff'; g.fillRect(r() * s, r() * s, 2, 2); }
    }),

    flake: () => cardTexture(64, (g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
    }),

    window: () => cardTexture(256, (g, s) => {
      // warm interior glimpse with curtains and mullions
      const gr = g.createLinearGradient(0, 0, 0, s);
      gr.addColorStop(0, '#ffcf8a'); gr.addColorStop(1, '#b8682c');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
      g.fillStyle = 'rgba(60,30,15,0.55)';
      g.fillRect(0, 0, s * 0.18, s); g.fillRect(s * 0.82, 0, s * 0.18, s);
      g.fillStyle = 'rgba(40,20,10,0.35)';
      for (let i = 0; i < 6; i++) g.fillRect(r() * s, s * 0.6 + r() * s * 0.3, 20 + r() * 40, 40 + r() * 60);
      g.fillStyle = '#1a120c';
      g.fillRect(s * 0.47, 0, s * 0.06, s); g.fillRect(0, s * 0.47, s, s * 0.06);
      g.fillRect(0, 0, s, 10); g.fillRect(0, s - 10, s, 10); g.fillRect(0, 0, 10, s); g.fillRect(s - 10, 0, 10, s);
    }),
  };
  cardCache[name] = T[name]();
  return cardCache[name];
}

/* ---------- optional external enhancement (Poly Haven / three.js examples) ---------- */
export const TEX_BASE = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/textures/';
const loader = new THREE.TextureLoader();
loader.setCrossOrigin('anonymous');

export function loadTex(url, srgb = true) {
  return new Promise((res) => {
    loader.load(url, (t) => {
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
      res(t);
    }, undefined, () => res(null));
  });
}

const phCache = {};
// Fetch a Poly Haven texture set through its public API; resolves null on failure.
export function polyHaven(id) {
  if (phCache[id]) return phCache[id];
  phCache[id] = (async () => {
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 6000);
      const r = await fetch(`https://api.polyhaven.com/files/${id}`, { signal: ctl.signal });
      clearTimeout(to);
      if (!r.ok) return null;
      const j = await r.json();
      const pick = (k) => j[k] && j[k]['1k'] && (j[k]['1k'].jpg || j[k]['1k'].png);
      const d = pick('Diffuse'), n = pick('nor_gl'), ro = pick('Rough');
      if (!d) return null;
      const [map, normalMap, roughnessMap] = await Promise.all([
        loadTex(d.url, true), n ? loadTex(n.url, false) : null, ro ? loadTex(ro.url, false) : null,
      ]);
      if (!map) return null;
      return { map, normalMap, roughnessMap };
    } catch (e) { return null; }
  })();
  return phCache[id];
}

/** Upgrade a material with an external set when it arrives; keeps repeat. */
export function enhance(material, id, repeat = null) {
  polyHaven(id).then((set) => {
    if (!set) return;
    const rep = repeat || (material.map ? material.map.repeat.clone() : new THREE.Vector2(1, 1));
    for (const k of ['map', 'normalMap', 'roughnessMap']) {
      if (!set[k]) continue;
      const t = set[k].clone(); t.needsUpdate = true; t.repeat.copy(rep);
      material[k] = t;
    }
    material.needsUpdate = true;
  });
}

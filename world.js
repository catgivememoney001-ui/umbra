import * as THREE from 'three';
import { Octree } from 'three/addons/math/Octree.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Water } from 'three/addons/objects/Water.js';
import { lib, card, rng, fbm, vnoise, tmath, enhance, loadTex, TEX_BASE, pbrSet, phTex } from './textures.js';

const { clamp, mix, smooth } = tmath;
export const U = { time: { value: 0 } };

/* =========================================================
   Shader patches
   ========================================================= */
function chain(material, fn) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (s, r) => { if (prev) prev(s, r); fn(s, r); };
  material.customProgramCacheKey = () => (material.userData.key || '') + material.uuid.slice(0, 4);
}

// world-space varyings for patches
function addWorldVaryings(s) {
  if (s.vertexShader.includes('vWPos')) return;
  s.vertexShader = 'varying vec3 vWPos;\nvarying vec3 vWNorm;\n' + s.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
    vec4 wp4 = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      wp4 = instanceMatrix * wp4;
    #endif
    wp4 = modelMatrix * wp4;
    vWPos = wp4.xyz;
    vec3 wn3 = objectNormal;
    #ifdef USE_INSTANCING
      wn3 = mat3(instanceMatrix) * wn3;
    #endif
    vWNorm = normalize(mat3(modelMatrix) * wn3);`);
  s.fragmentShader = 'varying vec3 vWPos;\nvarying vec3 vWNorm;\n' + s.fragmentShader;
}

/** Foliage wind sway (vertex). strength scaled with local height. */
export function windSway(material, amount = 0.05, base = 1.5) {
  material.userData.key = (material.userData.key || '') + 'wind';
  material.userData.windArgs = [amount, base];
  chain(material, (s) => {
    s.uniforms.uTime = U.time;
    s.vertexShader = 'uniform float uTime;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec3 ip = vec3(0.0);
      #ifdef USE_INSTANCING
        ip = instanceMatrix[3].xyz;
      #endif
      float hk = max(transformed.y - ${base.toFixed(2)}, 0.0);
      float ph = uTime * 1.1 + ip.x * 0.37 + ip.z * 0.23;
      transformed.x += (sin(ph) + 0.4 * sin(ph * 2.7 + transformed.y)) * ${amount.toFixed(3)} * hk;
      transformed.z += cos(ph * 0.8 + 1.3) * ${amount.toFixed(3)} * 0.7 * hk;`);
  });
  return material;
}

/** Hanging strands sway (moss, vines) based on uv.y distance from anchor */
export function hangSway(material, amount = 0.25) {
  material.userData.key = (material.userData.key || '') + 'hang';
  chain(material, (s) => {
    s.uniforms.uTime = U.time;
    s.vertexShader = 'uniform float uTime;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 hw = modelMatrix * vec4(position, 1.0);
      float k = pow(1.0 - uv.y, 1.6);
      transformed.x += sin(uTime * 0.9 + hw.x * 0.5 + hw.z * 0.3) * ${amount.toFixed(3)} * k;
      transformed.z += cos(uTime * 0.7 + hw.z * 0.4) * ${amount.toFixed(3)} * 0.6 * k;`);
  });
  return material;
}

/** Snow accumulation on upward faces */
export function snowCover(material, amount = 1, threshold = 0.25) {
  material.userData.key = (material.userData.key || '') + 'snow';
  chain(material, (s) => {
    addWorldVaryings(s);
    s.fragmentShader = s.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float sn = smoothstep(${threshold.toFixed(2)}, ${(threshold + 0.35).toFixed(2)}, vWNorm.y + (fract(sin(dot(floor(vWPos.xz*18.0), vec2(12.9898,78.233)))*43758.5453)-0.5)*0.25) * ${amount.toFixed(2)};
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.88, 0.92), sn);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.75, sn);`);
  });
  return material;
}

/** Wet surface with animated rain ripples (perturbs normal, darkens) */
export function wetRipples(material, intensity = 1, scale = 1.6) {
  material.userData.key = (material.userData.key || '') + 'wet';
  chain(material, (s) => {
    addWorldVaryings(s);
    s.uniforms.uTime = U.time;
    s.fragmentShader = 'uniform float uTime;\n' + s.fragmentShader
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      {
        vec2 p = vWPos.xz * ${scale.toFixed(2)};
        vec2 grad = vec2(0.0);
        for (int L = 0; L < 2; L++) {
          vec2 q = p * (1.0 + float(L) * 0.73) + float(L) * 3.1;
          vec2 cell = floor(q);
          for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
            vec2 c = cell + vec2(float(i), float(j));
            float h1 = fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453);
            float h2 = fract(sin(dot(c, vec2(269.5, 183.3))) * 43758.5453);
            vec2 center = c + vec2(h1, h2);
            float t = fract(uTime * 0.9 + h1 * 7.0 + float(L) * 0.5);
            vec2 d = q - center;
            float r = length(d);
            float ring = r - t * 0.9;
            float w = exp(-ring * ring * 160.0) * (1.0 - t) * (1.0 - t);
            grad += normalize(d + 1e-4) * cos(ring * 50.0) * w;
          }
        }
        vec3 wn = normalize(vec3(-grad.x * 0.35 * ${intensity.toFixed(2)}, 1.0, -grad.y * 0.35 * ${intensity.toFixed(2)}));
        vec3 vn = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
        float up = smoothstep(0.6, 0.95, vWNorm.y);
        normal = normalize(mix(normal, normalize(normal + (vn - normalize((viewMatrix * vec4(0.0,1.0,0.0,0.0)).xyz))), up));
      }`);
  });
  return material;
}

/** Foliage: keep the authored (crown-radial) normal on both faces so cards light as a volume */
export function foliageNormals(material) {
  material.userData.key = (material.userData.key || '') + 'fol';
  chain(material, (s) => {
    s.fragmentShader = s.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
      normal = normalize(vNormal);`);
  });
  return material;
}

/** Shadows that respect alpha cut-outs (and wind) */
export function alphaShadow(mesh) {
  const m = mesh.material;
  const o = { map: m.map, alphaMap: m.alphaMap, alphaTest: Math.max(m.alphaTest, 0.4), side: THREE.DoubleSide };
  const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, ...o });
  const dd = new THREE.MeshDistanceMaterial(o);
  if (m.userData.windArgs) { windSway(d, ...m.userData.windArgs); windSway(dd, ...m.userData.windArgs); }
  mesh.customDepthMaterial = d; mesh.customDistanceMaterial = dd;
  return mesh;
}

/** Moss / lichen on upward faces */
export function mossTop(material, amount = 0.5, color = [0.09, 0.13, 0.06]) {
  material.userData.key = (material.userData.key || '') + 'moss';
  chain(material, (s) => {
    addWorldVaryings(s);
    s.fragmentShader = s.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float mo = smoothstep(0.35, 0.85, vWNorm.y + (fract(sin(dot(floor(vWPos.xz*6.0), vec2(12.9898,78.233)))*43758.5453)-0.5)*0.3) * ${amount.toFixed(2)};
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${color.map((v) => v.toFixed(3)).join(',')}), mo);`);
  });
  return material;
}

/**
 * Distance-managed instancing: every few frames fills each level's meshes with the instances in its range.
 * levels: [{ dist, meshes }] in increasing distance; instances beyond the last are culled (fog hides them).
 */
export function dynInstances(world, mats, pos, levels, { step = 0.35 } = {}) {
  for (const L of levels) for (const m of L.meshes) { m.count = 0; m.frustumCulled = false; }
  let acc = step, last = null;
  const fogCut = () => { const f = world.scene.fog; return f && f.density ? Math.min(900, 2.7 / f.density) : 900; };
  world.onUpdate((dt, ctx) => {
    acc += dt;
    const c = ctx.camera.getWorldPosition(_cam);
    if (acc < step && last && last.distanceToSquared(c) < 4) return;
    acc = 0; last = (last || new THREE.Vector3()).copy(c);
    const cut = fogCut();
    const counts = levels.map(() => 0);
    for (let i = 0; i < mats.length; i++) {
      const dx = pos[i].x - c.x, dz = pos[i].z - c.z, d = Math.sqrt(dx * dx + dz * dz);
      if (d > cut) continue;
      for (let l = 0; l < levels.length; l++) {
        if (d < levels[l].dist) { const k = counts[l]++; for (const m of levels[l].meshes) m.setMatrixAt(k, mats[i]); break; }
      }
    }
    levels.forEach((L, l) => { for (const m of L.meshes) { m.count = counts[l]; m.instanceMatrix.needsUpdate = true; } });
  });
}
const _cam = new THREE.Vector3();

/** Brightens rim to fake subsurface/translucency on leaves */
export function translucent(material, color = 0x4a5a2a, k = 0.35) {
  chain(material, (s) => {
    s.fragmentShader = s.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += vec3(${new THREE.Color(color).toArray().map((v) => v.toFixed(3)).join(',')}) * ${k.toFixed(3)} * (1.0 - abs(dot(normalize(vViewPosition), normal))) * 0.15;`);
  });
  return material;
}

/* =========================================================
   Material helpers
   ========================================================= */
export function pbr(name, repeat = 1, extra = {}, ph = null) {
  const set = lib(name);
  const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, ...extra });
  for (const k of ['map', 'normalMap', 'roughnessMap']) {
    const t = set[k].clone(); t.needsUpdate = true;
    if (Array.isArray(repeat)) t.repeat.set(repeat[0], repeat[1]); else t.repeat.set(repeat, repeat);
    m[k] = t;
  }
  if (extra.normalScale === undefined) m.normalScale = new THREE.Vector2(1, 1);
  if (ph) enhance(m, ph);
  return m;
}

export function cardMat(name, extra = {}) {
  return new THREE.MeshStandardMaterial({
    map: card(name), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85, metalness: 0, ...extra,
  });
}

/* =========================================================
   Geometry helpers
   ========================================================= */
export function taperedTube(points, radial, rFn, uScale = 1, vScale = 1, segsPerUnit = 2, rough = 0, seed = 0) {
  const curve = new THREE.CatmullRomCurve3(points);
  const len = curve.getLength();
  const segs = Math.max(2, Math.ceil(len * segsPerUnit));
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [], nor = [], uv = [], idx = [];
  const P = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, P);
    const N = frames.normals[i], B = frames.binormals[i];
    const r = rFn(t);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      n.set(0, 0, 0).addScaledVector(N, Math.cos(a)).addScaledVector(B, Math.sin(a)).normalize();
      // bark ridges & knots so silhouettes are never perfectly round
      const rr = rough ? r * (1 + rough * ((vnoise((j / radial) * 8, t * len * 1.3, 8, seed) - 0.5) * 1.4 + (vnoise((j / radial) * 24, t * len * 0.35, 24, seed + 3) - 0.5) * 0.8)) : r;
      pos.push(P.x + n.x * rr, P.y + n.y * rr, P.z + n.z * rr);
      nor.push(n.x, n.y, n.z);
      uv.push((j / radial) * uScale, (t * len) / vScale);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  if (rough) {
    g.computeVertexNormals();
    const na = g.attributes.normal;
    for (let i = 0; i <= segs; i++) { // weld seam normals
      const a = i * (radial + 1), b = a + radial;
      const x = na.getX(a) + na.getX(b), y = na.getY(a) + na.getY(b), z = na.getZ(a) + na.getZ(b), l = Math.hypot(x, y, z) || 1;
      na.setXYZ(a, x / l, y / l, z / l); na.setXYZ(b, x / l, y / l, z / l);
    }
  }
  return g;
}

function norm(g, withColor = false) {
  let out = g.index ? g.toNonIndexed() : g.clone();
  for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) out.deleteAttribute(k);
  if (!out.attributes.normal) out.computeVertexNormals();
  if (!out.attributes.uv) out.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
  if (withColor && !out.attributes.color) {
    const c = new Float32Array(out.attributes.position.count * 3).fill(1);
    out.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  }
  if (!withColor && out.attributes.color) out.deleteAttribute('color');
  return out;
}

/** Merge many geometries per material into few meshes */
export class Merger {
  constructor() { this.groups = new Map(); }
  add(geometry, matrix, material, colors = false) {
    if (!this.groups.has(material)) this.groups.set(material, { list: [], colors });
    const grp = this.groups.get(material);
    const g = norm(geometry, grp.colors);
    if (matrix) g.applyMatrix4(matrix);
    grp.list.push(g);
  }
  build(parent, { cast = true, receive = true } = {}) {
    const meshes = [];
    for (const [mat, grp] of this.groups) {
      if (!grp.list.length) continue;
      const g = mergeGeometries(grp.list, false);
      grp.list.forEach((x) => x.dispose());
      const m = new THREE.Mesh(g, mat);
      m.castShadow = cast; m.receiveShadow = receive;
      parent.add(m); meshes.push(m);
    }
    this.groups.clear();
    return meshes;
  }
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();
export function mat4(x, y, z, ry = 0, sx = 1, sy = sx, sz = sx, rx = 0, rz = 0) {
  _e.set(rx, ry, rz, 'YXZ');
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e), _s.set(sx, sy, sz));
}

/* =========================================================
   World container
   ========================================================= */
export class World {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.colliderGeoms = [];
    this.updaters = [];
    this.lampLights = [];       // positions (for rain/snow lighting & audio)
    this.sources = [];          // positional audio descriptors
    this.spawn = { pos: new THREE.Vector3(0, 2, 0), yaw: 0, pitch: 0 };
    this.surface = () => 'dirt';
    this.waterLevel = -Infinity;
    this.heightAt = () => 0;
    this.ambience = {};
    this.envIntensity = 0.35;
    this.post = {};
    this.disposables = [];
    this.pending = [];
  }

  collide(geometry, matrix = null) {
    const g = norm(geometry);
    if (matrix) g.applyMatrix4(matrix);
    for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
    this.colliderGeoms.push(g);
  }
  collideBox(x, y, z, sx, sy, sz, ry = 0) {
    this.collide(new THREE.BoxGeometry(sx, sy, sz), mat4(x, y, z, ry));
  }
  collideCyl(x, y, z, r, h) {
    this.collide(new THREE.CylinderGeometry(r, r, h, 8, 1, false), mat4(x, y + h / 2, z));
  }

  buildOctree() {
    if (this.boundGeoms && this.boundGeoms.length) {
      const bg = mergeGeometries(this.boundGeoms, false);
      this.bounds = new Octree().fromGraphNode(new THREE.Mesh(bg));
      bg.dispose(); this.boundGeoms = [];
    }
    const g = mergeGeometries(this.colliderGeoms, false);
    this.colliderGeoms.forEach((x) => x.dispose());
    this.colliderGeoms = [];
    const mesh = new THREE.Mesh(g);
    this.octree = new Octree().fromGraphNode(mesh);
    g.dispose();
  }

  onUpdate(fn) { this.updaters.push(fn); }
  update(dt, ctx) { for (const f of this.updaters) f(dt, ctx); }

  dispose() {
    const seen = new Set();
    this.scene.traverse((o) => {
      if (o.geometry && !o.geometry.userData.keep) o.geometry.dispose();
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        if (seen.has(m)) continue; seen.add(m);
        for (const k of ['map', 'normalMap', 'roughnessMap', 'alphaMap', 'emissiveMap']) {
          // textures are clones sharing sources; disposing clones only frees GPU binding
          if (m[k] && m[k].isTexture && !m[k].userData.keep) m[k].dispose();
        }
        if (m.uniforms && m.uniforms.mirrorSampler) m.uniforms.mirrorSampler.value.dispose?.();
        m.dispose();
      }
    });
    this.disposables.forEach((d) => d.dispose && d.dispose());
    if (this.scene.environment) this.scene.environment.dispose();
  }
}

/* =========================================================
   Sky, environment, fog
   ========================================================= */
export function sky(world, { top, horizon, bottom = horizon, glowDir = null, glow = 0x000000, clouds = 0.5, moon = null, stars = 0 }) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(top) }, uHor: { value: new THREE.Color(horizon) }, uBot: { value: new THREE.Color(bottom) },
      uGlow: { value: new THREE.Color(glow) }, uGlowDir: { value: (glowDir || new THREE.Vector3(0, 0.1, -1)).clone().normalize() },
      uMoon: { value: moon ? moon.clone().normalize() : new THREE.Vector3(0, -1, 0) }, uMoonOn: { value: moon ? 1 : 0 },
      uClouds: { value: clouds }, uStars: { value: stars }, uTime: U.time,
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`,
    fragmentShader: `
      uniform vec3 uTop, uHor, uBot, uGlow, uGlowDir, uMoon; uniform float uMoonOn, uClouds, uStars, uTime;
      varying vec3 vDir;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      float fb(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.03; a*=0.5;} return s; }
      void main(){
        vec3 d = normalize(vDir);
        float y = d.y;
        vec3 c = y > 0.0 ? mix(uHor, uTop, pow(clamp(y,0.0,1.0), 0.55)) : mix(uHor, uBot, clamp(-y*4.0,0.0,1.0));
        float g = pow(max(dot(d, uGlowDir), 0.0), 6.0);
        c += uGlow * g * 0.9 + uGlow * pow(max(dot(d, uGlowDir),0.0), 1.5) * 0.25;
        if (y > 0.0) {
          vec2 uv = d.xz / (y + 0.15) * 1.2 + vec2(uTime*0.004, uTime*0.002);
          float cl = smoothstep(0.42, 0.85, fb(uv*1.4));
          c = mix(c, c*0.75 + uHor*0.18, cl * uClouds * smoothstep(0.0, 0.25, y));
          if (uStars > 0.0) { vec3 q = d * 380.0; vec3 cellq = floor(q); vec2 sp = vec2(dot(cellq, vec3(1.0, 57.0, 113.0)), cellq.y * 0.37); vec3 fq = fract(q) - 0.5; float st = step(0.9965, h(sp)) * smoothstep(0.35, 0.05, length(fq)) * smoothstep(0.05,0.4,y) * (1.0-cl*uClouds); c += vec3(st) * uStars * (0.55+0.45*sin(uTime*2.0+h(sp)*40.0)); }
        }
        if (uMoonOn > 0.5) {
          float md = dot(d, uMoon);
          c += vec3(0.86,0.88,0.92) * smoothstep(0.99975, 0.99985, md) * 0.9;
          c += vec3(0.5,0.55,0.62) * pow(max(md,0.0), 900.0) * 0.25 + vec3(0.3,0.33,0.38) * pow(max(md,0.0), 30.0) * 0.08;
        }
        c += (h(gl_FragCoord.xy + uTime) - 0.5) / 255.0;
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), mat);
  m.frustumCulled = false; m.renderOrder = -10;
  world.scene.add(m);
  world.sky = m;
  // environment map from sky
  const envScene = new THREE.Scene();
  const em = m.clone(); em.material = mat; envScene.add(em);
  const pm = new THREE.PMREMGenerator(world.renderer);
  world.scene.environment = pm.fromScene(envScene, 0.02, 1, 2000).texture;
  pm.dispose();
  return m;
}

/* =========================================================
   Terrain
   ========================================================= */
export function terrain(world, { size = 200, segs = 160, height, material, colorFn = null, collSegs = 100, cx = 0, cz = 0 }) {
  const build = (sg) => {
    const g = new THREE.PlaneGeometry(size, size, sg, sg);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + cx, z = p.getZ(i) + cz;
      p.setXYZ(i, x, height(x, z), z);
    }
    g.computeVertexNormals();
    return g;
  };
  const g = build(segs);
  // uv in world units
  const uv = g.attributes.uv, p = g.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / 4, p.getZ(i) / 4);
  if (colorFn) {
    const c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) { const k = colorFn(p.getX(i), p.getZ(i), p.getY(i)); c[i * 3] = k[0]; c[i * 3 + 1] = k[1]; c[i * 3 + 2] = k[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    material.vertexColors = true;
  }
  const mesh = new THREE.Mesh(g, material);
  mesh.receiveShadow = true;
  world.scene.add(mesh);
  world.collide(build(collSegs));
  world.heightAt = height;
  return mesh;
}

/* polyline path helpers */
export function pathSampler(points, samples = 200) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], 0, p[1])));
  const pts = curve.getSpacedPoints(samples);
  const dist = (x, z) => {
    let best = 1e9, bt = 0, px = 0, pz = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const abx = b.x - a.x, abz = b.z - a.z;
      const t = clamp(((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz));
      const cx = a.x + abx * t, cz = a.z + abz * t;
      const dx = cx - x, dz = cz - z;
      const d = dx * dx + dz * dz;
      if (d < best) { best = d; bt = (i + t) / (pts.length - 1); px = cx; pz = cz; }
    }
    return [Math.sqrt(best), bt, px, pz];
  };
  return { curve, pts, dist };
}

/** ribbon mesh following a curve on terrain */
export function ribbon(world, curve, width, material, heightFn, { segs = 300, lift = 0.03, uvScale = 4, camber = 0.04, collide = false } = {}) {
  const pos = [], uv = [], idx = [];
  const P = new THREE.Vector3(), T = new THREE.Vector3();
  let acc = 0, prev = null;
  const across = 6;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, P); curve.getTangentAt(t, T);
    if (prev) acc += prev.distanceTo(P);
    prev = P.clone();
    const nx = -T.z, nz = T.x;
    const nl = Math.hypot(nx, nz);
    for (let j = 0; j <= across; j++) {
      const s = j / across - 0.5;
      const x = P.x + (nx / nl) * s * width, z = P.z + (nz / nl) * s * width;
      const y = heightFn(x, z) + lift + (0.25 - s * s) * camber * 4;
      pos.push(x, y, z); uv.push((s + 0.5) * width / uvScale, acc / uvScale);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < across; j++) {
    const a = i * (across + 1) + j, b = a + across + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.receiveShadow = true;
  world.scene.add(m);
  if (collide) world.collide(g);
  return m;
}

/* =========================================================
   Vegetation
   ========================================================= */
function bendPlane(w, l, segsL, bend, droop = 0) {
  const g = new THREE.PlaneGeometry(w, l, 1, segsL);
  g.translate(0, l / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), t = y / l;
    p.setZ(i, p.getZ(i) + Math.sin(t * Math.PI * 0.5) * bend * l);
    p.setY(i, y - t * t * droop * l);
  }
  g.computeVertexNormals();
  return g;
}

function aoColors(g, fn) {
  const p = g.attributes.position;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const v = fn(p.getX(i), p.getY(i), p.getZ(i)); c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = v; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
}

/* ---------- lightweight geometry builder ---------- */
export class GB {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; }
  v(x, y, z, nx, ny, nz, u, v, r, g = r, b = r) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.u.push(u, v); this.c.push(r, g, b); return this.p.length / 3 - 1; }
  t(a, b, c) { this.i.push(a, b, c); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}

/* Poly Haven fir_tree_01 twig atlas: rects in image space [x0, y0(top), x1, y1] */
export const FIR = {
  sprigs: [[0.656, 0.047, 0.934, 0.367], [0.191, 0.055, 0.414, 0.313], [0.313, 0.406, 0.637, 0.777], [0.637, 0.457, 0.949, 0.828]],
  small: [0.5, 0.262, 0.625, 0.398],
  bare: [0.316, 0.711, 0.98, 1.0],
  strip: [0.02, 0.0, 0.19, 1.0],
};
export function firTex() {
  return {
    map: phTex('fir_tree_01/fir_tree_01_twig_diff', true, 'jpg', 'needles'), alpha: phTex('fir_tree_01/fir_tree_01_twig_alpha', false, 'jpg', 'white'),
    bark: phTex('fir_tree_01/fir_tree_01_bark_diff', true, 'jpg', 'white'), barkN: phTex('fir_tree_01/fir_tree_01_bark_nor_gl', false), barkR: phTex('fir_tree_01/fir_tree_01_bark_rough', false),
  };
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3(), _qv = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

/**
 * Photo card along direction D (stem → tip) spanning W, bent by `droop`.
 * horiz: atlas rect runs left→right instead of bottom→top. normalFn(P) → outward normal for volumetric shading.
 */
export function card3(B, P, D, W, len, wid, rect, shade, normalFn, droop = 0.15, horiz = false, tint = [1, 1, 1]) {
  const N0 = _n.crossVectors(W, D).normalize();
  if (N0.y < 0) N0.negate();
  const base = B.p.length / 3;
  for (const r of [0, 0.5, 1]) for (const s of [-1, 1]) {
    const px = P.x + D.x * len * r + W.x * wid * 0.5 * s - N0.x * droop * len * r * r;
    const py = P.y + D.y * len * r + W.y * wid * 0.5 * s - N0.y * droop * len * r * r;
    const pz = P.z + D.z * len * r + W.z * wid * 0.5 * s - N0.z * droop * len * r * r;
    const nn = normalFn(px, py, pz, N0);
    const a = (s + 1) / 2;
    let u, v;
    if (horiz) { u = rect[0] + (rect[2] - rect[0]) * r; v = (1 - rect[3]) + (rect[3] - rect[1]) * a; }
    else { u = rect[0] + (rect[2] - rect[0]) * a; v = (1 - rect[3]) + (rect[3] - rect[1]) * r; }
    const k = shade * (0.82 + 0.18 * r);
    B.v(px, py, pz, nn.x, nn.y, nn.z, u, v, k * tint[0], k * tint[1], k * tint[2]);
  }
  for (let r = 0; r < 2; r++) { const a = base + r * 2; B.t(a, a + 2, a + 1); B.t(a + 1, a + 2, a + 3); }
}

/** thin tube using the bark strip of the atlas (same material as the needles → one draw call) */
export function stick(B, pts, r0, r1, radial, rect, shade) {
  const T = new THREE.Vector3(), Nn = new THREE.Vector3(), Bn = new THREE.Vector3();
  const base = B.p.length / 3;
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    T.subVectors(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]).normalize();
    Nn.crossVectors(T, Math.abs(T.y) > 0.95 ? _qv.set(1, 0, 0) : UP).normalize();
    Bn.crossVectors(Nn, T).normalize();
    if (i) acc += p.distanceTo(pts[i - 1]);
    const r = r0 + (r1 - r0) * (i / (pts.length - 1));
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const nx = Nn.x * ca + Bn.x * sa, ny = Nn.y * ca + Bn.y * sa, nz = Nn.z * ca + Bn.z * sa;
      B.v(p.x + nx * r, p.y + ny * r, p.z + nz * r, nx, ny, nz, rect[0] + (rect[2] - rect[0]) * (j / radial), 0.5 + acc * 0.6, shade);
    }
  }
  for (let i = 0; i < pts.length - 1; i++) for (let j = 0; j < radial; j++) {
    const a = base + i * (radial + 1) + j, b = a + radial + 1;
    B.t(a, b, a + 1); B.t(b, b + 1, a + 1);
  }
}

/** conifer skeleton → { trunk, lod0, lod1, height, r0 } */
export function coniferGeometry(seed, h = 22, r0 = 0.45, crown = 3.8, sparse = 1) {
  const R = rng(seed);
  // trunk: flared, ridged bark
  const trunkG = (radial, segs) => {
    const g = new THREE.CylinderGeometry(r0 * 0.1, r0, h, radial, segs, true);
    g.translate(0, h / 2 - 0.6, 0);
    const tp = g.attributes.position;
    for (let i = 0; i < tp.count; i++) {
      const x = tp.getX(i), y = tp.getY(i), z = tp.getZ(i);
      const a = Math.atan2(z, x);
      const flare = 1 + 1.4 * Math.exp(-Math.max(y + 0.6, 0) * 1.5) * (0.7 + 0.3 * Math.sin(a * 5 + seed));
      const nn = 1 + (vnoise((a / Math.PI + 1) * 4, y * 0.5, 8, seed) - 0.5) * 0.14 + (vnoise((a / Math.PI + 1) * 12, y * 0.15, 24, seed + 1) - 0.5) * 0.08;
      tp.setXYZ(i, x * flare * nn, y, z * flare * nn);
    }
    g.computeVertexNormals();
    const tuv = g.attributes.uv;
    for (let i = 0; i < tuv.count; i++) tuv.setXY(i, tuv.getX(i) * 3, (tp.getY(i) + 0.6) / 1.4);
    return g;
  };
  const start = h * (0.3 + R() * 0.08);
  const top = h - 0.4;
  const cy = start + (top - start) * 0.42;
  const normalFn = (x, y, z, N0) => {
    _a.set(x, (y - cy) * 0.45, z).normalize();
    return _b.copy(_a).multiplyScalar(0.72).addScaledVector(N0, 0.4).addScaledVector(UP, 0.25).normalize();
  };
  const trunkR = (y) => r0 * (1 - (y + 0.6) / h) * 0.95 + 0.03;
  // skeleton
  const branches = [];
  let y = start;
  let wi = 0;
  while (y < top - 0.6) {
    const t = (y - start) / (top - start);
    const L = (crown * Math.pow(1 - t, 0.85) * (0.82 + R() * 0.3) + 0.35);
    const n = 5 + Math.floor(R() * 3);
    for (let k = 0; k < n; k++) {
      if (R() > sparse + 0.05) continue;
      const a = (k / n) * Math.PI * 2 + R() * 0.6 + wi * 0.9;
      const pitch = THREE.MathUtils.lerp(-0.22, 0.4, t) + (R() - 0.5) * 0.25;
      branches.push({ y, a, L: L * (0.85 + R() * 0.3), pitch, droop: THREE.MathUtils.lerp(0.32, 0.08, t) * (0.7 + R() * 0.6), t, seed: R() });
    }
    y += (0.42 + R() * 0.22) * (h / 22);
    wi++;
  }
  const pathOf = (b, steps) => {
    const d = new THREE.Vector3(Math.cos(b.a), 0, Math.sin(b.a));
    const r = trunkR(b.y);
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const s = i / steps;
      pts.push(new THREE.Vector3(
        d.x * (r + b.L * s), b.y + b.L * (Math.sin(b.pitch) * s - b.droop * s * s + 0.18 * s * s * s), d.z * (r + b.L * s)));
    }
    return pts;
  };
  const along = (pts, s) => { const f = s * (pts.length - 1), i = Math.min(Math.floor(f), pts.length - 2), k = f - i; return [new THREE.Vector3().lerpVectors(pts[i], pts[i + 1], k), new THREE.Vector3().subVectors(pts[i + 1], pts[i]).normalize()]; };
  const sprigRect = (q) => FIR.sprigs[Math.floor(q * FIR.sprigs.length) % FIR.sprigs.length];
  const aspect = (r) => (r[2] - r[0]) / (r[3] - r[1]);

  const build = (lod) => {
    const B = new GB();
    const R2 = rng(seed * 7 + lod);
    for (const b of branches) {
      if (lod === 1 && R2() < 0.25) continue;
      const pts = pathOf(b, 4);
      const ao = 0.42 + 0.3 * b.t;
      const tint = [0.92 + R2() * 0.12, 0.95 + R2() * 0.08, 0.9 + R2() * 0.08];
      if (lod === 0) stick(B, pts, 0.012 + 0.03 * b.L / crown, 0.004, 4, FIR.strip, ao * 0.8);
      const ds = lod === 0 ? 0.3 : 0.62;
      const sz = lod === 0 ? 1 : 1.75;
      const steps = Math.max(1, Math.floor(b.L * 0.85 / ds));
      for (let i = 0; i < steps; i++) {
        const s = 0.18 + (i / steps) * 0.78;
        const [P, T] = along(pts, s);
        const Wl = _qv.crossVectors(T, UP).normalize().clone();
        for (const side of lod === 0 ? [-1, 1] : [(i % 2) * 2 - 1]) {
          const D = new THREE.Vector3().copy(T).multiplyScalar(0.6).addScaledVector(Wl, side * 0.75).add(new THREE.Vector3(0, 0.06 + R2() * 0.1, 0)).normalize();
          const roll = (R2() - 0.5) * 0.9;
          const W = new THREE.Vector3().crossVectors(UP, D).normalize().applyAxisAngle(D, roll);
          const rect = sprigRect(R2());
          const len = (0.42 + R2() * 0.3) * sz * (0.75 + 0.25 * Math.min(1, b.L / 1.5));
          card3(B, P, D, W, len, len * aspect(rect), rect, ao + 0.45 * s, normalFn, 0.12 + R2() * 0.1, false, tint);
        }
      }
      // tip spray
      const [Pt, Tt] = along(pts, 0.92);
      const rect = sprigRect(R2());
      const Wt = new THREE.Vector3().crossVectors(UP, Tt).normalize();
      card3(B, Pt, Tt.clone().add(new THREE.Vector3(0, 0.12, 0)).normalize(), Wt, 0.7 * sz, 0.7 * sz * aspect(rect), rect, ao + 0.5, normalFn, 0.1, false, tint);
    }
    // leader
    for (let k = 0; k < (lod === 0 ? 3 : 2); k++) {
      const D = new THREE.Vector3((R2() - 0.5) * 0.25, 1, (R2() - 0.5) * 0.25).normalize();
      const W = new THREE.Vector3(Math.cos(k * 2.1), 0, Math.sin(k * 2.1));
      card3(B, new THREE.Vector3(0, top - 1.4, 0), D, W, 1.6, 1.6 * aspect(FIR.sprigs[2]), FIR.sprigs[2], 0.95, normalFn, 0.02);
    }
    if (lod === 0) {
      // dead lower branches with bare twigs
      for (let yy = 1.2; yy < start - 0.3; yy += 0.5 + R2() * 0.4) {
        const nn = 1 + Math.floor(R2() * 3);
        for (let k = 0; k < nn; k++) {
          const a = R2() * 6.283, L = 0.35 + R2() * 0.9 * (yy / start + 0.3);
          const d = new THREE.Vector3(Math.cos(a), -0.15 - R2() * 0.25, Math.sin(a)).normalize();
          const p0 = new THREE.Vector3(Math.cos(a) * trunkR(yy), yy, Math.sin(a) * trunkR(yy));
          const p1 = p0.clone().addScaledVector(d, L);
          stick(B, [p0, p0.clone().lerp(p1, 0.5), p1], 0.018, 0.004, 3, FIR.strip, 0.45);
          if (R2() < 0.7) {
            const W = new THREE.Vector3().crossVectors(UP, d).normalize();
            card3(B, p0.clone().lerp(p1, 0.35), d, W, L * 0.9, L * 0.9 * 0.42, FIR.bare, 0.6, (x, y2, z, N0) => N0, 0.05, true, [0.85, 0.8, 0.75]);
          }
        }
      }
    }
    return B.build();
  };
  return { trunk: trunkG(16, 28), trunkLo: trunkG(8, 6), lod0: build(0), lod1: build(1), height: h, r0 };
}

/**
 * Scatter instanced conifers with distance LOD. places: [{x,z,s,ry}] ; colliders within collideR
 */
export function conifers(world, places, { variants = 3, snow = 0, foliageColor = 0x7c8c74, collideR = 70, h = 22, seed = 1, crown = 3.8, near = 34 } = {}) {
  const T = firTex();
  const tc = new THREE.Color(foliageColor);
  const barkMat = new THREE.MeshStandardMaterial({ map: T.bark, normalMap: T.barkN, roughnessMap: T.barkR, color: 0xb0aaa2, roughness: 1, normalScale: new THREE.Vector2(1.6, 1.6) });
  const folMat = new THREE.MeshStandardMaterial({ map: T.map, alphaMap: T.alpha, alphaTest: 0.42, side: THREE.DoubleSide, vertexColors: true, color: tc, roughness: 0.82, metalness: 0 });
  windSway(folMat, 0.008, 5);
  foliageNormals(folMat);
  translucent(folMat, 0x6a7a3a, 1.6);
  if (snow) { snowCover(folMat, snow, 0.2); snowCover(barkMat, snow * 0.6, 0.55); }
  const geos = [];
  for (let v = 0; v < variants; v++) geos.push(coniferGeometry(seed * 31 + v * 7, h * (0.85 + v * 0.12), 0.42 + v * 0.06, crown * (0.9 + v * 0.1), 1 - v * 0.06));
  const buckets = geos.map(() => []);
  places.forEach((p, i) => buckets[i % variants].push(p));
  buckets.forEach((list, v) => {
    if (!list.length) return;
    const G = geos[v];
    const mk = (geo, mat, shadowAlpha) => { const m = new THREE.InstancedMesh(geo, mat, list.length); m.castShadow = m.receiveShadow = true; if (shadowAlpha) alphaShadow(m); world.scene.add(m); return m; };
    const L0 = [mk(G.trunk, barkMat), mk(G.lod0, folMat, true)];
    const L1 = [mk(G.trunkLo, barkMat), mk(G.lod1, folMat, true)];
    const mats = [], pos = [];
    list.forEach((p, i) => {
      const y = world.heightAt(p.x, p.z);
      mats.push(mat4(p.x, y, p.z, p.ry ?? i * 2.39, p.s ?? 1)); pos.push(new THREE.Vector3(p.x, y, p.z));
      if (Math.hypot(p.x, p.z) < collideR || p.collide) {
        const s = p.s ?? 1;
        const r = G.r0 * s * 1.15;
        world.collide(new THREE.CylinderGeometry(r * 0.55, r, G.height * s * 0.75, 8, 1, false), mat4(p.x, y + G.height * s * 0.375 - 0.6, p.z));
      }
    });
    dynInstances(world, mats, pos, [{ dist: near, meshes: L0 }, { dist: Infinity, meshes: L1 }]);
    world.disposables.push(G.trunk, G.trunkLo, G.lod0, G.lod1);
  });
}

/** fern clump geometry (instanced) */
export function ferns(world, places, { color = 0x7d8f62, snow = 0, scale = 1 } = {}) {
  // Each fern: 12 fronds radiating from centre, each frond has a central rachis
  // with 7 pairs of bent pinnae (sub-leaflets), giving real fern silhouette
  const R0 = rng(42);
  const parts = [];
  const frondCount = 12;
  for (let fi = 0; fi < frondCount; fi++) {
    const angle = (fi / frondCount) * Math.PI * 2 + R0() * 0.4;
    const lean = 0.7 + R0() * 0.3;         // lean-out angle
    const rollA = (R0() - 0.5) * 0.6;       // roll around the frond axis
    const frondLen = 0.85 + R0() * 0.35;
    const pinnaPairs = 7;
    for (let pi = 0; pi <= pinnaPairs; pi++) {
      const t = pi / pinnaPairs;
      // position along frond rachis (bent outward + slight droop)
      const rx = Math.cos(angle) * frondLen * t * lean;
      const rz = Math.sin(angle) * frondLen * t * lean;
      const ry_pos = frondLen * t * (1 - lean * 0.5) - frondLen * t * t * 0.55;
      if (pi === 0) continue; // skip base joint
      // pinnae card: perpendicular to rachis direction, tilted outward
      const pLen = frondLen * (1 - t) * 0.5 + 0.1;
      const pWid = pLen * 0.22;
      // rachis direction in xz-plane
      const dx = Math.cos(angle), dz = Math.sin(angle);
      // pinna direction: perpendicular to rachis + slight upward tilt
      for (const side of [-1, 1]) {
        const pax = -dz * side, paz = dx * side;
        const droop = 0.18 + t * 0.12;
        const g = new THREE.PlaneGeometry(pWid, pLen, 1, 3);
        g.translate(0, pLen / 2, 0);
        // bend pinna downward at tip
        const pp = g.attributes.position;
        for (let vi = 0; vi < pp.count; vi++) {
          const vt = (pp.getY(vi)) / pLen;
          pp.setZ(vi, pp.getZ(vi) - vt * vt * droop * pLen);
        }
        g.computeVertexNormals();
        // orient: rotate so +Y aligns with pinna direction (outward), then tilt down
        g.rotateX(-Math.PI * 0.5 + 0.35 + t * 0.2);   // droop from horizontal
        g.rotateY(Math.atan2(paz, pax) - Math.PI / 2);
        g.applyMatrix4(new THREE.Matrix4().setPosition(rx + pax * 0.08, ry_pos, rz + paz * 0.08));
        aoColors(g, (x, y, z) => 0.25 + 0.75 * clamp(Math.hypot(x, z) / (frondLen + 0.2)));
        parts.push(norm(g, true));
      }
    }
    // tip card
    const tg = bendPlane(0.14, 0.32, 3, 0.28, 0.12);
    tg.rotateX(-lean + 0.2);
    tg.rotateY(angle + Math.PI);
    tg.applyMatrix4(new THREE.Matrix4().setPosition(
      Math.cos(angle) * frondLen * lean, frondLen * (1 - lean * 0.5) - frondLen * 0.55, Math.sin(angle) * frondLen * lean));
    aoColors(tg, (x, y, z) => 0.7 + 0.3 * clamp(y / 0.4));
    parts.push(norm(tg, true));
  }
  const geo = mergeGeometries(parts, false);
  const mat = cardMat('fern', { vertexColors: true, color, roughness: 0.75 });
  windSway(mat, 0.06, 0.15);
  translucent(mat, 0x6a8a3a, 1.8);
  if (snow) snowCover(mat, snow, 0.3);
  const im = new THREE.InstancedMesh(geo, mat, places.length);
  places.forEach((p, i) => im.setMatrixAt(i, mat4(p.x, p.y ?? world.heightAt(p.x, p.z) - 0.05, p.z, p.ry ?? i * 1.7, (p.s ?? 1) * scale)));
  im.castShadow = true; im.receiveShadow = true;
  alphaShadow(im);
  world.scene.add(im);
  world.disposables.push(geo);
  return im;
}

/** crossed-quad clumps (bare twigs etc.); atlas:'firBare' maps the Poly Haven bare-twig photo */
export function clumps(world, places, { tex = 'grass', color = 0x6f7a55, w = 0.8, h = 0.6, snow = 0, sway = 0.12, yOff = 0, frost = false, atlas = null, cards = 5, cast = false } = {}) {
  const parts = [];
  const R = rng(places.length + 7);
  // Build each card as a proper curved blade strip (6 height segments, strong droop)
  for (let i = 0; i < cards; i++) {
    const segsH = 6;
    const wVar = w * (0.75 + R() * 0.5);
    const hVar = h * (0.8 + R() * 0.4);
    const droop = 0.12 + R() * 0.22;    // natural blade arch
    const lean = (R() - 0.5) * 0.55;    // random lean direction
    const taper = 0.15 + R() * 0.2;     // tip narrowing
    const g = new THREE.PlaneGeometry(wVar, hVar, 1, segsH);
    const pos = g.attributes.position;
    // Reshape: taper width toward tip, add forward curve and sideways lean
    for (let vi = 0; vi < pos.count; vi++) {
      const t = (pos.getY(vi) / hVar + 0.5);  // 0 at base, 1 at tip
      const t2 = t * t;
      // taper: narrower toward tip
      const xScale = mix(1, taper, t);
      pos.setX(vi, pos.getX(vi) * xScale);
      // forward arch (curve outward from base)
      pos.setZ(vi, pos.getZ(vi) + t2 * droop * hVar);
      // sideways lean
      pos.setX(vi, pos.getX(vi) + t2 * lean * wVar);
    }
    g.computeVertexNormals();
    if (atlas) g.rotateZ((R() - 0.5) * 0.4);
    g.rotateY((i / cards) * Math.PI + R() * 0.45);
    aoColors(g, (x, y) => 0.3 + 0.7 * clamp(y / hVar + 0.5));
    parts.push(norm(g, true));
  }
  const geo = mergeGeometries(parts, false);
  let mat;
  if (atlas === 'firBare') {
    const T = firTex(), r = FIR.bare;
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, r[0] + (r[2] - r[0]) * v, (1 - r[3]) + (r[3] - r[1]) * u); }
    mat = new THREE.MeshStandardMaterial({ map: T.map, alphaMap: T.alpha, alphaTest: 0.4, side: THREE.DoubleSide, vertexColors: true, color, roughness: 0.9 });
  } else mat = cardMat(tex, { vertexColors: true, color, roughness: 0.8 });
  windSway(mat, sway, 0.05);
  translucent(mat, typeof color === 'number' ? color : 0x5a7a42, 1.3);
  if (snow) snowCover(mat, frost ? snow * 0.55 : snow, frost ? -0.6 : 0.0);
  const im = new THREE.InstancedMesh(geo, mat, places.length);
  places.forEach((p, i) => im.setMatrixAt(i, mat4(p.x, (p.y ?? world.heightAt(p.x, p.z)) + yOff, p.z, p.ry ?? i * 2.1, p.s ?? 1)));
  im.receiveShadow = true;
  if (cast) { im.castShadow = true; alphaShadow(im); }
  world.scene.add(im);
  world.disposables.push(geo);
  return im;
}

/* Poly Haven grass_medium_02 blade photos [x0, y0(top), x1, y1] */
const BLADES = [[0.031, 0.035, 0.164, 0.965], [0.91, 0.145, 0.957, 1], [0.148, 0.195, 0.25, 0.969], [0.672, 0.207, 0.711, 0.895], [0.359, 0.246, 0.406, 0.727], [0.555, 0.5, 0.633, 0.805], [0.809, 0.738, 0.855, 1], [0.449, 0.07, 0.605, 0.762]];

/**
 * Real grass: every blade is its own curved strip textured with a scanned blade.
 * Use for lawns, verge grass, reeds (tall/upright) and moss tufts (tiny/dense).
 */
export function grass(world, places, { color = 0xc8c8b8, height = [0.25, 0.55], blades = 22, lean = 0.55, sway = 0.1, snow = 0, frost = false, near = 40, variants = 4, seed = 5, cast = false, dry = 0.3, spread = 0.2, widthK = 1, yOff = 0 } = {}) {
  const map = phTex('grass_medium_02/grass_medium_02_diff', true, 'png', 'grass');
  const mat = new THREE.MeshStandardMaterial({ map, alphaTest: 0.35, side: THREE.DoubleSide, vertexColors: true, color, roughness: 0.72, metalness: 0 });
  windSway(mat, sway, 0.02);
  foliageNormals(mat);
  translucent(mat, 0x8a9a4a, 1.1);
  if (snow) snowCover(mat, frost ? snow * 0.6 : snow, frost ? -0.5 : 0.15);
  const geos = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let v = 0; v < variants; v++) {
    const R = rng(seed * 13 + v), B = new GB();
    for (let b = 0; b < blades; b++) {
      const rect = BLADES[Math.floor(R() * BLADES.length)];
      const hh = height[0] + (height[1] - height[0]) * Math.pow(R(), 0.8);
      const ang = R() * 6.283, r0 = Math.sqrt(R()) * spread;
      const bx = Math.cos(ang) * r0, bz = Math.sin(ang) * r0;
      const a2 = ang + (R() - 0.5) * 1.4;
      const ox = Math.cos(a2), oz = Math.sin(a2);
      const lb = lean * (0.25 + R() * 0.75);
      const w = Math.min(0.06, hh * (rect[2] - rect[0]) / (rect[3] - rect[1])) * widthK * (0.8 + R() * 0.4);
      const tw = (R() - 0.5) * 1.2;
      const Wx = -oz * Math.cos(tw) + ox * Math.sin(tw) * 0.3, Wz = ox * Math.cos(tw) + oz * Math.sin(tw) * 0.3;
      const dryk = R() < dry ? [1.18, 1.02, 0.72] : [0.9 + R() * 0.1, 1, 0.86];
      const base = B.p.length / 3;
      for (let i = 0; i <= 4; i++) {
        const t = i / 4;
        const out = Math.sin(lb) * hh * t + lb * 0.7 * hh * t * t;
        const py = hh * t * (1 - 0.4 * lb * t);
        const nx = ox * 0.45, ny = 0.85, nz = oz * 0.45;
        const sh = 0.3 + 0.7 * t;
        for (const s of [-1, 1]) {
          B.v(bx + ox * out + Wx * w * 0.5 * s, py, bz + oz * out + Wz * w * 0.5 * s, nx, ny, nz,
            rect[0] + (rect[2] - rect[0]) * (s + 1) / 2, (1 - rect[3]) + (rect[3] - rect[1]) * t, sh * dryk[0], sh * dryk[1], sh * dryk[2]);
        }
      }
      for (let i = 0; i < 4; i++) { const a = base + i * 2; B.t(a, a + 2, a + 1); B.t(a + 1, a + 2, a + 3); }
    }
    geos.push(B.build());
  }
  const lists = geos.map(() => []);
  places.forEach((p, i) => lists[i % geos.length].push(p));
  lists.forEach((list, v) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geos[v], mat, list.length);
    im.receiveShadow = true;
    if (cast) { im.castShadow = true; alphaShadow(im); }
    world.scene.add(im);
    const mats = [], pos = [];
    list.forEach((p, i) => { const y = (p.y ?? world.heightAt(p.x, p.z)) + yOff; mats.push(mat4(p.x, y, p.z, p.ry ?? i * 2.1, p.s ?? 1)); pos.push(new THREE.Vector3(p.x, y, p.z)); });
    dynInstances(world, mats, pos, [{ dist: near, meshes: [im] }]);
  });
  world.disposables.push(...geos);
}

/** displaced rock geometry */
export function rockGeometry(seed, detail = 4) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const a = Math.atan2(v.z, v.x), b = Math.acos(clamp(v.y, -1, 1));
    const n = fbm(a * 1.2 + 5, b * 1.6, 64, 4, seed) * 0.55 + fbm(a * 6, b * 6, 64, 2, seed + 9) * 0.12;
    const flat = v.y < -0.2 ? 0.6 : 1;
    v.multiplyScalar(0.7 + n);
    v.y *= flat * 0.75;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  // planar-ish uv
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) * 0.5 + p.getZ(i) * 0.3, p.getY(i) * 0.5 + p.getZ(i) * 0.2);
  return g;
}

export function rocks(world, places, { color = 0x9a978f, mossy = 0.4, snow = 0, ph = 'rock_wall_08', seed = 3 } = {}) {
  const mat = pbr('stone', 1, { color }, ph);
  if (mossy) {
    chain(mat, (s) => {
      addWorldVaryings(s);
      s.fragmentShader = s.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float mo = smoothstep(0.35, 0.85, vWNorm.y) * ${mossy.toFixed(2)};
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.09, 0.13, 0.06), mo);`);
    });
    mat.userData.key = 'mossrock';
  }
  if (snow) snowCover(mat, snow, 0.3);
  const geos = [rockGeometry(seed, 4), rockGeometry(seed + 5, 4), rockGeometry(seed + 11, 4)];
  const col = [rockGeometry(seed, 1), rockGeometry(seed + 5, 1), rockGeometry(seed + 11, 1)];
  const lists = [[], [], []];
  places.forEach((p, i) => lists[i % 3].push(p));
  lists.forEach((list, v) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geos[v], mat, list.length);
    list.forEach((p, i) => {
      const y = p.y ?? world.heightAt(p.x, p.z) - (p.sink ?? 0.25) * (p.s ?? 1);
      const m = mat4(p.x, y, p.z, p.ry ?? i * 1.3, (p.s ?? 1) * (p.sx ?? 1), (p.s ?? 1) * (p.sy ?? 1), (p.s ?? 1) * (p.sz ?? 1));
      im.setMatrixAt(i, m);
      if ((p.s ?? 1) > 0.4 && p.collide !== false) world.collide(col[v], m);
    });
    im.castShadow = true; im.receiveShadow = true;
    world.scene.add(im);
  });
  world.disposables.push(...geos, ...col);
}

/* Poly Haven tree_small_02 leaf-twig photo regions */
const LEAF_RECTS = [[0.0, 0.0, 0.58, 0.5], [0.0, 0.5, 0.44, 1.0]];
function leafTex() { return { map: phTex('tree_small_02/tree_small_02_leaves_diff', true, 'jpg', 'leaves'), alpha: phTex('tree_small_02/tree_small_02_leaves_alpha', false, 'jpg', 'white') }; }

/** branching tree (oak / bare) — unique geometry with ridged bark, photo leaves / twigs */
export function branchTree(world, x, z, opts = {}) {
  const {
    seed = 1, height = 7, trunkR = 0.45, spread = 1, depth = 4, horizontal = 0.3, leaves = false, moss = false,
    snow = 0, barkColor = 0x9a948c, leafColor = 0x6a7a55, mossColor = 0x9aa08a, collide = true, lean = 0, ry = 0, twigs = false, leafDensity = 5,
  } = opts;
  const R = rng(seed);
  const y0 = world.heightAt(x, z) - 0.3;
  const bark = pbr('bark', 1, { color: barkColor, normalScale: new THREE.Vector2(1.8, 1.8) }, 'bark_brown_02');
  if (moss) mossTop(bark, 0.6, [0.1, 0.12, 0.07]);
  if (snow) snowCover(bark, snow, 0.35);
  const M = new Merger();
  const tips = [], mossPos = [], mids = [];
  const colStart = world.colliderGeoms.length;
  const grow = (start, dir, len, r, d) => {
    const pts = [start.clone()];
    const cur = start.clone(), dd = dir.clone();
    const steps = 4 + (d < 2 ? 2 : 0);
    for (let i = 1; i <= steps; i++) {
      dd.x += (R() - 0.5) * 0.3; dd.z += (R() - 0.5) * 0.3;
      dd.y += (d < depth ? -0.04 * (depth - d) * horizontal : 0) + (R() - 0.5) * 0.14;
      dd.normalize();
      cur.addScaledVector(dd, len / steps);
      pts.push(cur.clone());
    }
    const rEnd = r * 0.55;
    const radial = Math.max(6, Math.round(16 * r / trunkR) + 4);
    const g = taperedTube(pts, radial, (t) => mix(r, rEnd, t) * (1 + (t < 0.06 && d === 0 ? 0.7 * (1 - t / 0.06) : 0)), 2, 2.2, d < 2 ? 3 : 2, d < 2 ? 0.14 : 0.07, seed * 10 + d);
    M.add(g, null, bark);
    if (collide && r > 0.13 && d <= 2) {
      const cg = taperedTube(pts, 6, (t) => mix(r, rEnd, t), 1, 1, 1);
      world.collide(cg); cg.dispose();
    }
    g.dispose();
    if (d >= 2) mids.push({ p: pts[Math.floor(pts.length / 2)].clone(), d: dd.clone() });
    if (d >= depth) { tips.push({ p: cur.clone(), d: dd.clone() }); return; }
    if (moss && d >= 1 && r < trunkR * 0.7) for (let k = 0; k < 2; k++) mossPos.push(new THREE.Vector3().lerpVectors(pts[1], cur, R()));
    const kids = d === 0 ? 3 + Math.floor(R() * 2) : 2 + Math.floor(R() * 2);
    for (let k = 0; k < kids; k++) {
      const a = (k / kids) * Math.PI * 2 + R() * 1.2;
      const up = d === 0 ? 0.35 + R() * 0.3 : 0.2 + R() * 0.5 - horizontal * 0.4;
      const nd = new THREE.Vector3(Math.cos(a) * spread, up, Math.sin(a) * spread).normalize().lerp(dd, 0.35).normalize();
      grow(cur.clone().addScaledVector(dd, -len * R() * 0.25), nd, len * (0.62 + R() * 0.15), rEnd * (0.8 + R() * 0.15), d + 1);
    }
  };
  grow(new THREE.Vector3(0, 0, 0), new THREE.Vector3(lean, 1, lean * 0.5).normalize(), height * 0.45, trunkR, 0);
  const group = new THREE.Group();
  group.position.set(x, y0, z); group.rotation.y = ry;
  M.build(group);
  const crownC = tips.reduce((c, t) => c.add(t.p), new THREE.Vector3()).divideScalar(Math.max(1, tips.length));
  const radialN = (px, py, pz, N0) => {
    const a = new THREE.Vector3(px - crownC.x, (py - crownC.y) * 0.7, pz - crownC.z).normalize();
    return a.multiplyScalar(0.75).addScaledVector(N0, 0.35).add(new THREE.Vector3(0, 0.2, 0)).normalize();
  };
  const addCards = (B, mat) => { const g = B.build(); const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; alphaShadow(m); group.add(m); return m; };
  if (leaves && tips.length) {
    const T = leafTex();
    const mat = new THREE.MeshStandardMaterial({ map: T.map, alphaMap: T.alpha, alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, color: leafColor, roughness: 0.7 });
    windSway(mat, 0.025, 2); foliageNormals(mat); translucent(mat, 0x7a8a3a, 1.4);
    if (snow) snowCover(mat, snow, 0.3);
    const B = new GB();
    for (const t of [...tips, ...mids.filter(() => R() < 0.4)]) for (let k = 0; k < leafDensity; k++) {
      const D = t.d.clone().add(new THREE.Vector3((R() - 0.5) * 1.6, (R() - 0.3) * 1.0, (R() - 0.5) * 1.6)).normalize();
      const W = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), D).normalize().applyAxisAngle(D, (R() - 0.5) * 1.6);
      const rect = LEAF_RECTS[Math.floor(R() * 2)];
      const len = 0.9 + R() * 0.8;
      const P = t.p.clone().addScaledVector(D, -len * 0.25);
      const sh = 0.55 + R() * 0.35;
      card3(B, P, D, W, len, len * (rect[2] - rect[0]) / (rect[3] - rect[1]), rect, sh, radialN, 0.12, false, [0.95 + R() * 0.1, 1, 0.92 + R() * 0.1]);
    }
    addCards(B, mat);
  }
  if (twigs && tips.length) {
    const T = firTex();
    const mat = new THREE.MeshStandardMaterial({ map: T.map, alphaMap: T.alpha, alphaTest: 0.4, side: THREE.DoubleSide, vertexColors: true, color: 0x9a948c, roughness: 0.9 });
    windSway(mat, 0.015, 2);
    if (snow) snowCover(mat, snow * 0.6, -0.4);
    const B = new GB();
    const flat = (px, py, pz, N0) => N0;
    for (const t of [...tips, ...mids]) for (let k = 0; k < 3; k++) {
      const D = t.d.clone().add(new THREE.Vector3((R() - 0.5) * 1.2, R() * 0.6, (R() - 0.5) * 1.2)).normalize();
      const W = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), D).normalize().applyAxisAngle(D, (R() - 0.5) * 2.5);
      const len = 0.7 + R() * 0.7;
      card3(B, t.p, D, W, len, len * 0.42, FIR.bare, 0.75 + R() * 0.25, flat, 0.05, true, [1, 0.96, 0.92]);
    }
    addCards(B, mat);
  }
  if (moss && mossPos.length) {
    const mat = cardMat('mossStrand', { color: mossColor, alphaTest: 0.3, roughness: 1 });
    hangSway(mat, 0.18);
    for (const p of mossPos) {
      const l = 1.2 + R() * 2.6, w = 0.5 + R() * 0.5;
      const g = new THREE.PlaneGeometry(w, l, 1, 4); g.translate(0, -l / 2, 0);
      M.add(g, mat4(p.x, p.y, p.z, R() * 6), mat);
      const g2 = new THREE.PlaneGeometry(w, l, 1, 4); g2.translate(0, -l / 2, 0);
      M.add(g2, mat4(p.x, p.y, p.z, R() * 6 + 1.57), mat);
    }
    M.build(group, { cast: true }).forEach((m) => alphaShadow(m));
  }
  world.scene.add(group);
  // colliders were added in local space: move them into place
  group.updateMatrix();
  for (let i = colStart; i < world.colliderGeoms.length; i++) world.colliderGeoms[i].applyMatrix4(group.matrix);
  return { group, leafPos: tips.map((t) => t.p.clone().applyMatrix4(group.matrix)) };
}

/* =========================================================
   Lights & atmosphere
   ========================================================= */
export function glowSprite(color, size, opacity = 1) {
  const m = new THREE.SpriteMaterial({ map: card('glow'), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const s = new THREE.Sprite(m); s.scale.setScalar(size);
  return s;
}

const coneMat = (color, opacity) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uTime: U.time },
  vertexShader: `varying vec3 vN; varying vec3 vV; varying float vY; varying vec3 vW;
    void main(){ vY = uv.y; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vN = normalize(normalMatrix*normal); vec4 mv = viewMatrix * w; vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform vec3 uColor; uniform float uOpacity; uniform float uTime; varying vec3 vN; varying vec3 vV; varying float vY; varying vec3 vW;
    float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
    float n3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
      return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
    void main(){
      float rim = pow(abs(dot(normalize(vN), normalize(vV))), 1.8);
      float fall = pow(vY, 1.6);
      float dust = 0.65 + 0.35 * n3(vW * 1.8 + vec3(0.0, -uTime*0.15, uTime*0.05));
      float a = rim * fall * uOpacity * dust;
      gl_FragColor = vec4(uColor * a, a);
    }`,
});

/**
 * Street lamp (cast iron, glass lantern). Returns {group, light}
 */
export function streetLamp(world, x, z, { y = null, height = 3.4, color = 0xffb46a, intensity = 28, distance = 22, cone = true, arm = false, flicker = 0, shadow = false, ry = 0 } = {}) {
  const gy = y ?? world.heightAt(x, z);
  const g = new THREE.Group();
  g.position.set(x, gy, z); g.rotation.y = ry;
  const iron = pbr('metal', 1, { color: 0x3a3a3c, metalness: 0.75, roughness: 0.5 });
  const M = new Merger();
  M.add(new THREE.CylinderGeometry(0.16, 0.22, 0.45, 16), mat4(0, 0.22, 0), iron);
  M.add(new THREE.TorusGeometry(0.15, 0.03, 8, 24), mat4(0, 0.46, 0, 0, 1, 1, 1, Math.PI / 2), iron);
  M.add(new THREE.CylinderGeometry(0.05, 0.065, height - 0.4, 12), mat4(0, height / 2, 0), iron);
  M.add(new THREE.TorusGeometry(0.07, 0.02, 8, 16), mat4(0, height * 0.6, 0, 0, 1, 1, 1, Math.PI / 2), iron);
  const hx = arm ? 0.55 : 0;
  if (arm) {
    const curve = [new THREE.Vector3(0, height - 0.3, 0), new THREE.Vector3(0.1, height, 0), new THREE.Vector3(0.4, height + 0.08, 0), new THREE.Vector3(hx, height, 0)];
    M.add(taperedTube(curve, 6, () => 0.03, 1, 1, 6), null, iron);
  }
  // lantern head
  const hy = arm ? height - 0.45 : height + 0.1;
  M.add(new THREE.CylinderGeometry(0.12, 0.09, 0.08, 4), mat4(hx, hy - 0.02, 0, Math.PI / 4), iron);
  M.add(new THREE.ConeGeometry(0.26, 0.24, 4), mat4(hx, hy + 0.56, 0, Math.PI / 4), iron);
  M.add(new THREE.SphereGeometry(0.04, 8, 8), mat4(hx, hy + 0.72, 0), iron);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    M.add(new THREE.BoxGeometry(0.02, 0.48, 0.02), mat4(hx + Math.cos(a) * 0.17, hy + 0.26, Math.sin(a) * 0.17), iron);
  }
  const glass = new THREE.MeshStandardMaterial({ color: 0xffe2b8, emissive: color, emissiveIntensity: 1.6, roughness: 0.15, transparent: true, opacity: 0.55, depthWrite: false });
  const glassG = new THREE.CylinderGeometry(0.2, 0.12, 0.46, 4, 1, true);
  const glassM = new THREE.Mesh(glassG, glass); glassM.position.set(hx, hy + 0.26, 0); glassM.rotation.y = Math.PI / 4;
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(6) }));
  bulb.position.set(hx, hy + 0.22, 0);
  M.build(g);
  g.add(glassM, bulb);
  const light = new THREE.PointLight(color, intensity, distance, 2);
  light.position.set(hx, hy + 0.2, 0);
  if (shadow) { light.castShadow = true; light.shadow.mapSize.set(512, 512); light.shadow.bias = -0.004; light.shadow.radius = 4; }
  g.add(light);
  const s1 = glowSprite(color, 1.6, 0.9); s1.position.copy(light.position); g.add(s1);
  const s2 = glowSprite(color, 7, 0.12); s2.position.copy(light.position); g.add(s2);
  if (cone) {
    const drop = Math.max(0, gy - world.heightAt(x, z));
    const ch = hy + 0.1 + drop;
    const cg = new THREE.CylinderGeometry(0.15, 0.6 + ch * 0.55, ch, 24, 1, true);
    // uv.y: 1 at top
    const cm = new THREE.Mesh(cg, coneMat(color, 0.06));
    cm.position.set(hx, hy + 0.1 - ch / 2, 0);
    g.add(cm);
  }
  world.scene.add(g);
  world.collideCyl(x, gy, z, 0.18, height);
  const wp = new THREE.Vector3(); light.getWorldPosition(wp);
  g.updateMatrixWorld(true); light.getWorldPosition(wp);
  world.lampLights.push({ pos: wp.clone(), color: new THREE.Color(color) });
  world.sources.push({ type: 'hum', pos: wp.clone() });
  if (flicker) {
    const base = intensity;
    world.onUpdate((dt, ctx) => {
      const t = U.time.value;
      const f = 1 - flicker * (Math.sin(t * 13.1) * 0.3 + Math.sin(t * 7.3 + 1) * 0.3 + (Math.random() < 0.004 ? 1 : 0));
      light.intensity = base * f; glass.emissiveIntensity = 1.6 * f;
    });
  }
  dustMotes(world, wp, 2.2, color);
  return { group: g, light };
}

/** floating dust/moths near a light */
export function dustMotes(world, center, radius = 2, color = 0xffd2a0, count = 40) {
  const pos = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * radius * 2; pos[i * 3 + 1] = (Math.random() - 0.7) * radius * 1.4; pos[i * 3 + 2] = (Math.random() - 0.5) * radius * 2;
    seed[i] = Math.random() * 100;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: U.time, uColor: { value: new THREE.Color(color) }, uTex: { value: card('flake') }, uScale: { value: 1 } },
    vertexShader: `uniform float uTime; attribute float seed; varying float vA;
      void main(){ vec3 p = position; float t = uTime * 0.3 + seed;
        p += vec3(sin(t*1.3)*0.4, sin(t*0.9+seed)*0.25, cos(t*1.1)*0.4);
        vec4 mv = modelViewMatrix * vec4(p,1.0);
        vA = 0.35 + 0.65 * (0.5+0.5*sin(uTime*2.0+seed*3.0));
        gl_PointSize = 26.0 / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform sampler2D uTex; varying float vA;
      void main(){ float a = texture2D(uTex, gl_PointCoord).a * vA * 0.7; gl_FragColor = vec4(uColor * a, a); }`,
  });
  const p = new THREE.Points(g, m);
  p.position.copy(center);
  p.frustumCulled = false;
  world.scene.add(p);
  return p;
}

/** fireflies (local saturated accents) */
export function fireflies(world, center, spread, count = 60, color = 0xd8ff8a, height = [0.3, 2.5]) {
  const pos = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = center.x + (Math.random() - 0.5) * spread, z = center.z + (Math.random() - 0.5) * spread;
    pos[i * 3] = x; pos[i * 3 + 1] = world.heightAt(x, z) + height[0] + Math.random() * (height[1] - height[0]); pos[i * 3 + 2] = z;
    seed[i] = Math.random() * 100;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: U.time, uColor: { value: new THREE.Color(color) }, uTex: { value: card('glow') } },
    vertexShader: `uniform float uTime; attribute float seed; varying float vA;
      void main(){ vec3 p = position; float t = uTime * 0.25 + seed;
        p += vec3(sin(t*1.1)*1.2, sin(t*0.7+seed)*0.5, cos(t*0.9)*1.2);
        vec4 mv = modelViewMatrix * vec4(p,1.0);
        float bl = sin(uTime*1.7 + seed*5.0); vA = smoothstep(0.2, 1.0, bl);
        gl_PointSize = 38.0 / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform sampler2D uTex; varying float vA;
      void main(){ float a = texture2D(uTex, gl_PointCoord).a * vA; gl_FragColor = vec4(uColor * a * 1.6, a); }`,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  world.scene.add(p);
  // a soft light that wanders with the swarm
  return p;
}

/** rain streaks wrapping around the camera, lit near lamps */
export function rain(world, { count = 9000, box = 26, speed = 13, color = 0x9aa2a8, opacity = 0.32, wind = [0.8, 0.3] } = {}) {
  const pos = new Float32Array(count * 6);
  const end = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const x = Math.random() * box, y = Math.random() * box, z = Math.random() * box;
    pos.set([x, y, z, x, y, z], i * 6);
    end.set([0, 1], i * 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('isEnd', new THREE.BufferAttribute(end, 1));
  const lights = world.lampLights.slice(0, 8);
  const lp = Array.from({ length: 8 }, (_, i) => (lights[i] ? lights[i].pos.clone() : new THREE.Vector3(0, -999, 0)));
  const lc = Array.from({ length: 8 }, (_, i) => (lights[i] ? lights[i].color.clone() : new THREE.Color(0)));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: U.time, uCam: { value: new THREE.Vector3() }, uBox: { value: box }, uSpeed: { value: speed },
      uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uWind: { value: new THREE.Vector2(...wind) },
      uLP: { value: lp }, uLC: { value: lc }, uFlash: { value: new THREE.Vector3(0, -999, 0) }, uFlashOn: { value: 0 }, uFlashDir: { value: new THREE.Vector3() },
    },
    vertexShader: `uniform float uTime, uBox, uSpeed; uniform vec3 uCam; uniform vec2 uWind; uniform vec3 uLP[8]; uniform vec3 uLC[8];
      uniform vec3 uFlash; uniform float uFlashOn; uniform vec3 uFlashDir;
      attribute float isEnd; varying float vA; varying vec3 vC;
      void main(){
        vec3 fall = vec3(uWind.x, -uSpeed, uWind.y);
        vec3 p = position + fall * uTime;
        p = mod(p - uCam + uBox*0.5, uBox) - uBox*0.5 + uCam;
        p -= normalize(fall) * isEnd * 0.42;
        vec3 lit = vec3(0.0);
        for (int i = 0; i < 8; i++) { float d = distance(p, uLP[i]); lit += uLC[i] * 3.0 / (1.0 + d*d*0.35); }
        vec3 tf = p - uFlash; float fd = length(tf);
        float cone = smoothstep(0.85, 0.97, dot(tf / max(fd, 0.001), uFlashDir)) * uFlashOn * 6.0 / (1.0 + fd*fd*0.08);
        lit += vec3(1.0, 0.97, 0.9) * cone;
        float dc = distance(p, uCam);
        vA = smoothstep(0.4, 2.5, dc) * (1.0 - smoothstep(uBox*0.3, uBox*0.5, dc)) * (1.0 - isEnd*0.85);
        vC = lit;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vA; varying vec3 vC;
      void main(){ vec3 c = uColor * 0.5 + vC; float a = vA * uOpacity; gl_FragColor = vec4(c * a, a); }`,
  });
  const l = new THREE.LineSegments(g, m);
  l.frustumCulled = false;
  world.scene.add(l);
  world.onUpdate((dt, ctx) => {
    m.uniforms.uCam.value.copy(ctx.camera.position);
    if (ctx.flash) { m.uniforms.uFlash.value.copy(ctx.flash.pos); m.uniforms.uFlashDir.value.copy(ctx.flash.dir); m.uniforms.uFlashOn.value = ctx.flash.on; }
  });
  world.rain = l;
  return l;
}

/** snowfall points */
export function snowfall(world, { count = 7000, box = 30, speed = 0.9 } = {}) {
  const pos = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) { pos.set([Math.random() * box, Math.random() * box, Math.random() * box], i * 3); seed[i] = Math.random() * 100; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const lights = world.lampLights.slice(0, 8);
  const lp = Array.from({ length: 8 }, (_, i) => (lights[i] ? lights[i].pos.clone() : new THREE.Vector3(0, -999, 0)));
  const lc = Array.from({ length: 8 }, (_, i) => (lights[i] ? lights[i].color.clone() : new THREE.Color(0)));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: U.time, uCam: { value: new THREE.Vector3() }, uBox: { value: box }, uSpeed: { value: speed }, uTex: { value: card('flake') }, uLP: { value: lp }, uLC: { value: lc } },
    vertexShader: `uniform float uTime, uBox, uSpeed; uniform vec3 uCam; uniform vec3 uLP[8]; uniform vec3 uLC[8]; attribute float seed; varying float vA; varying vec3 vC;
      void main(){
        vec3 p = position + vec3(sin(uTime*0.4+seed)*0.6 + uTime*0.25, -uSpeed*uTime*(0.7+fract(seed)*0.6), cos(uTime*0.3+seed*1.3)*0.5);
        p = mod(p - uCam + uBox*0.5, uBox) - uBox*0.5 + uCam;
        vec3 lit = vec3(0.08, 0.085, 0.1);
        for (int i = 0; i < 8; i++) { float d = distance(p, uLP[i]); lit += uLC[i] * 2.2 / (1.0 + d*d*0.25); }
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float dc = -mv.z;
        vA = smoothstep(0.3, 1.5, dc) * (1.0 - smoothstep(uBox*0.3, uBox*0.5, dc));
        vC = lit;
        gl_PointSize = (40.0 + fract(seed*7.0)*30.0) / dc;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform sampler2D uTex; varying float vA; varying vec3 vC;
      void main(){ float a = texture2D(uTex, gl_PointCoord).a * vA; gl_FragColor = vec4(vC, a * 0.9); }`,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  world.scene.add(p);
  world.onUpdate((dt, ctx) => m.uniforms.uCam.value.copy(ctx.camera.position));
  return p;
}

/** ground mist: instanced camera-facing soft cards */
export function mist(world, { count = 60, area = 60, cx = 0, cz = 0, y = 0.6, size = [8, 16], color = 0x8a9096, opacity = 0.12, heightVar = 1.2, place = null } = {}) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const offs = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    let x, z;
    if (place) [x, z] = place(i);
    else { x = cx + (Math.random() - 0.5) * area; z = cz + (Math.random() - 0.5) * area; }
    offs.set([x, world.heightAt(x, z) + y + Math.random() * heightVar, z, size[0] + Math.random() * (size[1] - size[0])], i * 4);
  }
  const ig = new THREE.InstancedBufferGeometry();
  ig.index = geo.index; ig.attributes.position = geo.attributes.position; ig.attributes.uv = geo.attributes.uv;
  ig.setAttribute('offs', new THREE.InstancedBufferAttribute(offs, 4));
  ig.instanceCount = count;
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uTex: { value: card('fog') }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uTime: U.time },
    vertexShader: `attribute vec4 offs; uniform float uTime; varying vec2 vUv; varying float vA;
      void main(){
        vUv = uv;
        vec3 c = offs.xyz + vec3(sin(uTime*0.05 + offs.x)*1.5, 0.0, cos(uTime*0.04 + offs.z)*1.5);
        vec4 mv = viewMatrix * vec4(c, 1.0);
        float rot = uTime * 0.01 * (fract(offs.w*3.7)-0.5) + offs.w;
        vec2 q = vec2(position.x*cos(rot)-position.y*sin(rot), position.x*sin(rot)+position.y*cos(rot)) * offs.w;
        mv.xy += q * vec2(1.0, 0.45);
        float d = -mv.z;
        vA = smoothstep(1.0, 7.0, d) * (1.0 - smoothstep(60.0, 110.0, d));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform sampler2D uTex; uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv; varying float vA;
      void main(){ float a = texture2D(uTex, vUv).a * uOpacity * vA; gl_FragColor = vec4(uColor, a); }`,
  });
  const mesh = new THREE.Mesh(ig, m);
  mesh.frustumCulled = false; mesh.renderOrder = 5;
  world.scene.add(mesh);
  return mesh;
}

/** reflective water surface */
export function water(world, { size = 200, y = 0, color = 0x1a2226, sun = new THREE.Vector3(0.3, 0.6, -1), sunColor = 0x404850, distortion = 1.2, cx = 0, cz = 0, sizeZ = null } = {}) {
  const normals = pbrSet(256, (u, v) => {
    const h = fbm(u * 6, v * 6, 6, 5, 201);
    return { h, r: 0.5, g: 0.5, b: 1, rough: 0 };
  }, 6).normalMap;
  const w = new Water(new THREE.PlaneGeometry(size, sizeZ || size), {
    textureWidth: 512, textureHeight: 512, waterNormals: normals,
    sunDirection: sun.clone().normalize(), sunColor, waterColor: color, distortionScale: distortion, fog: true, alpha: 1,
  });
  w.rotation.x = -Math.PI / 2;
  w.position.set(cx, y, cz);
  w.material.uniforms.size.value = 4;
  world.scene.add(w);
  loadTex(TEX_BASE + 'waternormals.jpg', false).then((t) => { if (t) w.material.uniforms.normalSampler.value = t; });
  world.onUpdate((dt) => { w.material.uniforms.time.value += dt * 0.35; });
  world.waterLevel = y;
  world.waterMesh = w;
  return w;
}

/** invisible ring boundary */
export function boundary(world, cx, cz, radius, height = 30, segs = 48) {
  const g = new THREE.CylinderGeometry(radius, radius, height, segs, 1, true);
  // flip so faces point inward (raycasts from inside hit front faces)
  g.scale(-1, 1, 1);
  const n = norm(g); n.applyMatrix4(mat4(cx, height / 2 - 10, cz));
  for (const k of Object.keys(n.attributes)) if (k !== 'position') n.deleteAttribute(k);
  (world.boundGeoms = world.boundGeoms || []).push(n);
}

/** footprint decals (used on snow / mud) */
export function footprintSystem(world, { color = 0x6c7078, opacity = 0.55, max = 80 } = {}) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 64, 128); // alphaMap reads the green channel
  const gr = g.createRadialGradient(32, 40, 4, 32, 40, 26);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.beginPath(); g.ellipse(32, 40, 20, 30, 0, 0, Math.PI * 2); g.fill();
  const gr2 = g.createRadialGradient(32, 100, 2, 32, 100, 18);
  gr2.addColorStop(0, 'rgba(255,255,255,0.85)'); gr2.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr2; g.beginPath(); g.ellipse(32, 100, 15, 20, 0, 0, Math.PI * 2); g.fill();
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.MeshStandardMaterial({ color, transparent: true, opacity, alphaMap: tex, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 });
  mat.alphaMap = tex;
  const geo = new THREE.PlaneGeometry(0.16, 0.32); geo.rotateX(-Math.PI / 2);
  const im = new THREE.InstancedMesh(geo, mat, max);
  im.count = 0; im.receiveShadow = true; im.frustumCulled = false;
  world.scene.add(im);
  let i = 0, side = 0;
  world.onFootstep = (pos, yaw) => {
    side = 1 - side;
    const off = (side ? 0.12 : -0.12);
    const x = pos.x + Math.cos(yaw) * off, z = pos.z - Math.sin(yaw) * off;
    im.setMatrixAt(i % max, mat4(x, world.heightAt(x, z) + 0.02, z, yaw));
    i++; im.count = Math.min(i, max);
    im.instanceMatrix.needsUpdate = true;
  };
}

export { clamp, mix, smooth, fbm, vnoise, rng, card, pbrSet };

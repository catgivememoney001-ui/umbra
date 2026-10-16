import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PENDING } from './textures.js';
import { windSway, snowCover, translucent, foliageNormals, alphaShadow, dynInstances, mat4, mossTop } from './world.js';

/* =========================================================
   Poly Haven glTF models (CC0) — fetched at runtime, cached
   ========================================================= */
const API = 'https://api.polyhaven.com/files/';
const cache = {};

async function getJSON(url, ms = 9000) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { signal: ctl.signal }); return r.ok ? await r.json() : null; } finally { clearTimeout(to); }
}

function cleanGeometry(g) {
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.index) { const n = g.attributes.position.count; const idx = new (n > 65535 ? Uint32Array : Uint16Array)(n); for (let i = 0; i < n; i++) idx[i] = i; g.setIndex(new THREE.BufferAttribute(idx, 1)); }
  return g;
}

/** one object → [{geometry, material}] merged per material, base-centred */
function bake(root, base) {
  const byMat = new Map();
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(base).invert();
  root.traverse((o) => {
    if (!o.isMesh || /LOD[1-9]/i.test(o.name)) return;
    const g = cleanGeometry(o.geometry.clone());
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!byMat.has(m)) byMat.set(m, []);
    byMat.get(m).push(g);
  });
  const parts = [];
  const box = new THREE.Box3();
  for (const [m, list] of byMat) {
    const g = list.length > 1 ? mergeGeometries(list, false) : list[0];
    g.computeBoundingBox(); box.union(g.boundingBox);
    parts.push({ geometry: g, material: m });
  }
  // centre on x/z, base at y=0
  const c = box.getCenter(new THREE.Vector3());
  const shift = new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z);
  let tris = 0;
  for (const p of parts) {
    p.geometry.applyMatrix4(shift);
    p.geometry.computeBoundingBox(); p.geometry.computeBoundingSphere();
    p.geometry.userData.keep = true;
    tris += p.geometry.index.count / 3;
  }
  const size = box.getSize(new THREE.Vector3());
  return { parts, size, tris };
}

/**
 * Load a Poly Haven model. Resolves { variants:[{parts,size,tris}], whole:{...}, scene } or null.
 */
export function phModel(id) {
  if (cache[id]) return cache[id];
  cache[id] = (async () => {
    const j = await getJSON(API + id);
    const g = j && j.gltf && (j.gltf['1k'] || j.gltf['2k']);
    if (!g || !g.gltf) return null;
    const inc = {};
    for (const [k, v] of Object.entries(g.gltf.include || {})) inc[k] = v.url;
    const url = g.gltf.url, dir = url.slice(0, url.lastIndexOf('/') + 1);
    const mgr = new THREE.LoadingManager();
    mgr.setURLModifier((u) => {
      if (u.startsWith(dir)) { const rel = decodeURIComponent(u.slice(dir.length)); if (inc[rel]) return inc[rel]; }
      return u;
    });
    const gltf = await new GLTFLoader(mgr).loadAsync(url);
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);
    scene.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.material)) for (const k of Object.keys(m)) if (m[k] && m[k].isTexture) { m[k].userData.keep = true; m[k].anisotropy = 8; }
    });
    let root = scene;
    while (root.children.length === 1 && !root.children[0].isMesh) root = root.children[0];
    const kids = root.children.filter((o) => !/LOD[1-9]/i.test(o.name));
    const I = new THREE.Matrix4();
    let variants = null, whole = null;
    return {
      scene,
      get variants() {
        // keep each variant's own rotation, drop its offset within the set
        if (!variants) variants = kids.length ? kids.map((k) => bake(k, new THREE.Matrix4().makeTranslation(k.matrixWorld.elements[12], k.matrixWorld.elements[13], k.matrixWorld.elements[14]))) : [bake(root, I)];
        return variants;
      },
      get whole() { if (!whole) whole = bake(scene, I); return whole; },
    };
  })().catch((e) => { console.warn('[model]', id, e && e.message); return null; });
  return cache[id];
}

/* ---------- materials ---------- */
function prepMaterial(src, o) {
  const m = src.clone();
  const isAlpha = m.alphaTest > 0 || m.transparent || !!m.alphaMap;
  if (isAlpha && !m.name.includes('glass')) {
    m.transparent = false; m.alphaTest = Math.max(m.alphaTest, 0.45); m.side = THREE.DoubleSide; m.depthWrite = true;
  }
  if (o.tint) m.color.multiply(new THREE.Color(o.tint));
  if (o.rough !== undefined) m.roughness = o.rough;
  if (o.normalScale && m.normalMap) m.normalScale.multiplyScalar(o.normalScale);
  m.envMapIntensity = o.env ?? 0.6;
  if (o.wind && isAlpha) windSway(m, o.wind[0], o.wind[1]);
  if (o.foliage) foliageNormals(m, o.foliage);
  if (o.translucent) translucent(m, o.translucent, 1.4);
  if (o.moss) mossTop(m, o.moss);
  if (o.snow) snowCover(m, o.snow, o.snowThreshold ?? 0.3);
  m.userData.alpha = isAlpha;
  return m;
}

function hash(i, s = 0) { const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); }

/** simple collider from a model's bounds */
function addCollider(world, size, m, kind) {
  const sx = size.x, sy = size.y, sz = size.z;
  let g;
  if (kind === 'box') g = new THREE.BoxGeometry(sx * 0.92, sy, sz * 0.92).translate(0, sy / 2, 0);
  else if (kind === 'cyl') { const r = Math.max(sx, sz) * 0.42; g = new THREE.CylinderGeometry(r, r * 1.05, sy, 10).translate(0, sy / 2, 0); }
  else if (kind === 'log') {
    const along = sx > sz;
    const r = Math.min(sy, along ? sz : sx) * 0.45;
    g = new THREE.CylinderGeometry(r, r, (along ? sx : sz) * 0.94, 8).rotateZ(Math.PI / 2);
    if (!along) g.rotateY(Math.PI / 2);
    g.translate(0, r, 0);
  } else { g = new THREE.SphereGeometry(0.5, 10, 7).scale(sx * 0.9, sy * 1.6, sz * 0.9); }
  world.collide(g, m);
  g.dispose();
}

/**
 * Scatter instances of a Poly Haven model.
 * places: [{x,z,y?,s?,ry?,v?}]
 * o: { split, variants, scale, sink, tint, wind:[amt,base], foliage, translucent, snow, moss, collide:'auto'|'box'|'cyl'|'log'|false,
 *      minCollide, cast, receive, near, far, tilt, onFail, fit }
 */
export function modelInstances(world, id, places, o = {}) {
  if (!places.length) return Promise.resolve();
  const job = phModel(id).then((M) => {
    if (!M) { if (o.onFail) o.onFail(); return; }
    let vs = o.split === false ? [M.whole] : M.variants;
    if (o.variants) vs = o.variants.map((i) => vs[i % vs.length]).filter(Boolean);
    const groups = vs.map(() => []);
    places.forEach((p, i) => groups[(p.v ?? Math.floor(hash(i, o.seed || 1) * vs.length)) % vs.length].push(p));
    const mats = new Map();
    const getMat = (src) => { if (!mats.has(src)) mats.set(src, prepMaterial(src, o)); return mats.get(src); };
    const levels = [];
    groups.forEach((list, vi) => {
      if (!list.length) return;
      const V = vs[vi];
      const fit = o.fit ? o.fit / Math.max(V.size.y, 1e-3) : 1;
      const mats4 = [], pos = [];
      list.forEach((p, i) => {
        const s = (p.s ?? 1) * (o.scale ?? 1) * fit;
        const gy = p.y ?? world.heightAt(p.x, p.z);
        const y = gy - (o.sink ?? 0) * V.size.y * s + (o.lift ?? 0);
        const tilt = o.tilt ? [(hash(i, 7) - 0.5) * o.tilt, (hash(i, 9) - 0.5) * o.tilt] : [p.rx ?? 0, p.rz ?? 0];
        const m = mat4(p.x, y, p.z, p.ry ?? hash(i, 3) * 6.283, s * (p.sx ?? 1), s * (p.sy ?? 1), s * (p.sz ?? 1), tilt[0], tilt[1]);
        mats4.push(m); pos.push(new THREE.Vector3(p.x, y, p.z));
        const kind = o.collide === 'auto' ? 'ellipsoid' : o.collide;
        if (kind && !world.octree && s * Math.max(V.size.x, V.size.z) > (o.minCollide ?? 0.5)) addCollider(world, V.size, m, kind);
      });
      const meshes = V.parts.map((part) => {
        const mat = getMat(part.material);
        const im = new THREE.InstancedMesh(part.geometry, mat, list.length);
        im.castShadow = o.cast ?? true; im.receiveShadow = o.receive ?? true;
        if (mat.userData.alpha && im.castShadow) alphaShadow(im);
        world.scene.add(im);
        return im;
      });
      levels.push({ meshes, mats: mats4, pos });
    });
    for (const L of levels) dynInstances(world, L.mats, L.pos, [{ dist: o.far ?? Infinity, meshes: L.meshes }]);
  });
  world.pending.push(job);
  return job;
}

/** single placed model (whole), returns promise of the Group */
export function placeModel(world, id, { x = 0, y = null, z = 0, ry = 0, rx = 0, rz = 0, s = 1, fit = null, collide = false, parent = null, split = false, variant = 0, ...o } = {}) {
  const job = phModel(id).then((M) => {
    if (!M) { if (o.onFail) o.onFail(); return null; }
    const V = split ? M.variants[variant % M.variants.length] : M.whole;
    const k = fit ? fit / V.size.y : 1;
    const g = new THREE.Group();
    const gy = y ?? world.heightAt(x, z);
    g.position.set(x, gy - (o.sink ?? 0) * V.size.y * s * k, z);
    g.rotation.set(rx, ry, rz, 'YXZ'); g.scale.setScalar(s * k);
    for (const part of V.parts) {
      const mat = prepMaterial(part.material, o);
      const mesh = new THREE.Mesh(part.geometry, mat);
      mesh.castShadow = o.cast ?? true; mesh.receiveShadow = true;
      if (mat.userData.alpha) alphaShadow(mesh);
      mesh.name = part.material.name;
      g.add(mesh);
    }
    (parent || world.scene).add(g);
    g.updateMatrixWorld(true);
    if (collide && !world.octree) addCollider(world, V.size, g.matrixWorld, collide);
    g.userData.size = V.size.clone().multiplyScalar(s * k);
    return g;
  });
  world.pending.push(job);
  return job;
}

export { PENDING };

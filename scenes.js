import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  World, U, sky, terrain, pathSampler, ribbon, conifers, ferns, clumps, rocks, branchTree, streetLamp, glowSprite,
  rain, snowfall, mist, water, boundary, fireflies, footprintSystem, dustMotes, pbr, cardMat, Merger, mat4, taperedTube,
  wetRipples, snowCover, windSway, hangSway, clamp, mix, smooth, fbm, vnoise, rng, card,
} from './world.js';

/* ---------- helpers ---------- */
function bake(fn, size, res, cx = 0, cz = 0) {
  const n = Math.ceil(size / res) + 1;
  const g = new Float32Array(n * n);
  const x0 = cx - size / 2, z0 = cz - size / 2;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) g[j * n + i] = fn(x0 + i * res, z0 + j * res);
  return (x, z) => {
    const fx = clamp((x - x0) / res, 0, n - 1.001), fz = clamp((z - z0) / res, 0, n - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const a = g[j * n + i], b = g[j * n + i + 1], c = g[(j + 1) * n + i], d = g[(j + 1) * n + i + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

function scatter(n, seed, area, ok, cx = 0, cz = 0, tries = 30) {
  const R = rng(seed), out = [];
  for (let i = 0; i < n; i++) for (let t = 0; t < tries; t++) {
    const x = cx + (R() - 0.5) * area, z = cz + (R() - 0.5) * area;
    if (!ok || ok(x, z, R)) { out.push({ x, z, s: 0.75 + R() * 0.5, ry: R() * 6.28 }); break; }
  }
  return out;
}

function moon(world, { color = 0x9fb2c8, intensity = 0.4, dir = [-0.4, 1, 0.3], shadow = true }) {
  const l = new THREE.DirectionalLight(color, intensity);
  l.userData.dir = new THREE.Vector3(...dir).normalize();
  if (shadow) {
    l.castShadow = true;
    l.shadow.mapSize.set(2048, 2048);
    const c = l.shadow.camera; c.left = c.bottom = -32; c.right = c.top = 32; c.near = 1; c.far = 140;
    l.shadow.bias = -0.0004; l.shadow.normalBias = 0.04; l.shadow.radius = 3;
  }
  world.scene.add(l, l.target);
  world.sun = l;
  return l;
}

function hemi(world, sky, ground, intensity) {
  world.scene.add(new THREE.HemisphereLight(sky, ground, intensity * 2.2));
}

/** warm window light spilling outside */
function windowSpill(world, pos, dir, color = 0xffa560, intensity = 6, angle = 0.9) {
  const s = new THREE.SpotLight(color, intensity, 14, angle, 0.9, 1.6);
  s.position.copy(pos);
  s.target.position.copy(pos).add(dir);
  world.scene.add(s, s.target);
  return s;
}

function windowMat(seed = 0) {
  const m = new THREE.MeshStandardMaterial({ map: card('window'), emissiveMap: card('window'), emissive: 0xffffff, emissiveIntensity: 1.1 + (seed % 3) * 0.2, roughness: 0.2 });
  return m;
}

/* =========================================================
   1 · 雨林 — rain-soaked forest road & cabin
   ========================================================= */
function buildForest(world) {
  const S = world.scene;
  world.fogColor = 0x1a1f22;
  S.fog = new THREE.FogExp2(world.fogColor, 0.034);
  sky(world, { top: 0x0b0e10, horizon: 0x262c30, clouds: 0.8 });
  hemi(world, 0x6c7c88, 0x1a1612, 0.55);
  moon(world, { color: 0x8fa2b8, intensity: 0.32, dir: [-0.3, 1, -0.4] });

  const road = pathSampler([[-12, -70], [-6, -40], [1, -18], [6, 2], [4, 22], [-3, 40], [-15, 60], [-30, 78]]);
  const natural = (x, z) => (fbm(x * 0.012 + 50, z * 0.012 + 50, 64, 4, 5) - 0.5) * 9 + Math.max(0, -x - 6) * 0.12;
  const lowH = (x, z) => (fbm(x * 0.012 + 50, z * 0.012 + 50, 64, 2, 5) - 0.5) * 9 + Math.max(0, -x - 6) * 0.12;
  const H = bake((x, z) => {
    const [d, , px, pz] = road.dist(x, z);
    const rh = lowH(px, pz) * 0.6;
    const nat = natural(x, z) * 0.6 + (fbm(x * 0.15, z * 0.15, 64, 3, 9) - 0.5) * 0.35;
    // cabin pad
    const pad = smooth(9, 5, Math.hypot(x + 12, z - 4));
    const base = mix(nat, rh + 0.25, pad);
    return mix(rh, base, smooth(3.2, 7.5, d));
  }, 240, 1);
  world.heightAt = H;
  const groundMat = pbr('forestGround', 1, { color: 0xbab4aa }, 'forrest_ground_01');
  terrain(world, {
    size: 240, segs: 240, height: H, material: groundMat, collSegs: 120,
    colorFn: (x, z) => { const m = fbm(x * 0.05, z * 0.05, 64, 3, 3); const d = road.dist(x, z)[0]; const wet = smooth(6, 3, d); const c = 0.75 + m * 0.35 - wet * 0.25; return [c * 0.95, c, c * 0.9]; },
  });
  // asphalt road
  const asphalt = pbr('asphalt', 1, { color: 0x8a8e94, roughness: 0.85 });
  wetRipples(asphalt, 1.0, 1.4);
  ribbon(world, road.curve, 5.2, asphalt, H, { lift: 0.06, uvScale: 5 });
  // curb on outer side
  const curbMat = pbr('stone', 1, { color: 0x6a6a68 });
  const curbOff = [];
  road.pts.forEach((p, i) => {
    if (i % 2) return;
    const nxt = road.pts[Math.min(i + 1, road.pts.length - 1)], prv = road.pts[Math.max(i - 1, 0)];
    const tx = nxt.x - prv.x, tz = nxt.z - prv.z, l = Math.hypot(tx, tz) || 1;
    curbOff.push({ p, n: [tz / l, -tx / l], t: Math.atan2(tx, tz) });
  });
  // stone retaining wall on the right side
  const wallMat = pbr('stone', 1, { color: 0x77756f }, 'rock_wall_08');
  const mossTop = pbr('moss', 2, { color: 0x8a9a70 });
  const stoneGeo = new RoundedBoxGeometry(0.62, 0.36, 0.5, 2, 0.08);
  const stones = [];
  const R = rng(17);
  curbOff.forEach(({ p, n, t }, i) => {
    if (p.z < -55 || p.z > 62) return;
    const wx = p.x + n[0] * 3.25, wz = p.z + n[1] * 3.25;
    const gy = H(p.x, p.z) + 0.05;
    for (let row = 0; row < 3; row++) {
      for (let k = 0; k < 2; k++) {
        const off = (k - 0.5) * 0.62 + (row % 2) * 0.3;
        stones.push(mat4(wx + Math.sin(t) * off, gy + 0.18 + row * 0.34, wz + Math.cos(t) * off, t + (R() - 0.5) * 0.12, 0.9 + R() * 0.25, 0.9 + R() * 0.3, 0.9 + R() * 0.3, (R() - 0.5) * 0.08, (R() - 0.5) * 0.08));
      }
    }
    world.collideBox(wx, gy + 0.5, wz, 0.6, 1.0, 1.4, t);
  });
  const sim = new THREE.InstancedMesh(stoneGeo, wallMat, stones.length);
  stones.forEach((m, i) => sim.setMatrixAt(i, m));
  sim.castShadow = sim.receiveShadow = true;
  S.add(sim);
  // moss on top of the wall
  const mossPlaces = curbOff.filter(({ p }) => p.z > -55 && p.z < 62).map(({ p, n }) => ({ x: p.x + n[0] * 3.25, z: p.z + n[1] * 3.25, y: H(p.x, p.z) + 1.08, s: 0.8 }));
  clumps(world, mossPlaces, { tex: 'grass', color: 0x5a6a40, w: 1.2, h: 0.35 });

  /* cabin */
  buildCabin(world, -12.5, 4.5, H(-12.5, 4.5), 2.3);

  /* lamps */
  const lampAt = (t, side, opts = {}) => {
    const p = road.curve.getPointAt(t), tg = road.curve.getTangentAt(t);
    const x = p.x - tg.z * side * 3.2, z = p.z + tg.x * side * 3.2;
    return streetLamp(world, x, z, { y: H(x, z), ...opts });
  };
  lampAt(0.37, 1, { intensity: 30 });
  lampAt(0.52, 1, { intensity: 26, flicker: 0.15 });
  lampAt(0.72, 1, { intensity: 30 });
  lampAt(0.9, 1, { intensity: 34 });
  streetLamp(world, -7.2, 8.5, { y: H(-7.2, 8.5), height: 1.6, intensity: 9, distance: 10, cone: false });

  /* trees */
  const treeOk = (x, z) => road.dist(x, z)[0] > 5.5 && Math.hypot(x + 12.5, z - 4.5) > 7.5;
  const near = scatter(150, 3, 130, treeOk);
  near.forEach((p) => { p.s = 0.9 + (p.s - 0.75) * 1.2; });
  const far = scatter(160, 4, 230, (x, z) => treeOk(x, z) && Math.hypot(x, z) > 62);
  conifers(world, [...near, ...far], { variants: 3, collideR: 75, foliageColor: 0x7d8c76, seed: 2 });
  // big hero trunks framing the road
  conifers(world, [{ x: -6.6, z: -1.2, s: 1.35 }, { x: -9.5, z: -9, s: 1.25 }, { x: 9.5, z: 12, s: 1.3 }, { x: 11, z: -12, s: 1.2 }], { variants: 2, collideR: 999, seed: 9, h: 26 });
  ferns(world, scatter(520, 5, 140, (x, z) => { const d = road.dist(x, z)[0]; return d > 3.4 && Math.hypot(x + 12.5, z - 4.5) > 5.5; }), { color: 0x7a8c5e });
  clumps(world, scatter(500, 6, 120, (x, z) => { const d = road.dist(x, z)[0]; return d > 2.9 && d < 9; }), { tex: 'grass', color: 0x5d6b45, w: 0.7, h: 0.45 });
  rocks(world, scatter(40, 7, 120, (x, z) => road.dist(x, z)[0] > 6), { mossy: 0.7 });
  boundary(world, 0, 0, 70);

  rain(world, { count: 10000, opacity: 0.28 });
  mist(world, { count: 50, area: 120, y: 1.2, color: 0x7a8288, opacity: 0.1 });
  mist(world, { count: 30, area: 140, y: 8, size: [20, 34], color: 0x6c747a, opacity: 0.08, heightVar: 8 });

  const sp = road.curve.getPointAt(0.33), tg = road.curve.getTangentAt(0.33);
  world.spawn = { pos: new THREE.Vector3(sp.x - tg.z * 0.8, H(sp.x, sp.z) + 0.2, sp.z + tg.x * 0.8), yaw: Math.atan2(-tg.x, -tg.z), pitch: 0.02 };
  world.surface = (x, z) => { const d = road.dist(x, z)[0]; return d < 2.7 ? 'asphalt' : Math.hypot(x + 12.5, z - 4.5) < 4.5 ? 'wood' : 'leaves'; };
  world.ambience = { rain: 0.8, wind: 0.25 };
  world.extraSources = [{ type: 'drip', pos: new THREE.Vector3(-9, H(-9, 6) + 2.5, 6) }];
  world.tweak = { exposure: 1.15, bloom: 1 };
  world.wet = true;
}

function buildCabin(world, x, z, y, ry) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry;
  const M = new Merger();
  const wood = pbr('wood', [1.5, 1.5], { color: 0x6b5a4a }, 'wood_planks_dirt');
  const darkWood = pbr('wood', [1, 1], { color: 0x3a2e26 });
  const roofM = pbr('roof', [2, 2], { color: 0x8a8e94 }, 'roof_slates_02');
  const stone = pbr('stone', [1, 1.5], { color: 0x86827a }, 'rock_wall_08');
  const W = 6.4, D = 8, ridge = 6.6, eave = 0.6;
  // foundation
  M.add(new THREE.BoxGeometry(W + 0.4, 0.7, D + 0.4), mat4(0, 0.0, 0), stone);
  // gable walls (front & back)
  const shape = new THREE.Shape();
  shape.moveTo(-W / 2, 0); shape.lineTo(W / 2, 0); shape.lineTo(W / 2, 1.6); shape.lineTo(0, ridge - 0.3); shape.lineTo(-W / 2, 1.6); shape.closePath();
  const gable = new THREE.ExtrudeGeometry(shape, { depth: 0.22, bevelEnabled: false });
  const uvA = gable.attributes.uv; for (let i = 0; i < uvA.count; i++) uvA.setXY(i, uvA.getX(i) / 3, uvA.getY(i) / 3);
  M.add(gable, mat4(0, 0.35, D / 2 - 0.22), wood);
  M.add(gable, mat4(0, 0.35, -D / 2), wood);
  // side knee walls
  M.add(new THREE.BoxGeometry(0.22, 1.6, D), mat4(W / 2 - 0.11, 1.15, 0), wood);
  M.add(new THREE.BoxGeometry(0.22, 1.6, D), mat4(-W / 2 + 0.11, 1.15, 0), wood);
  // roof planes
  const slope = Math.atan2(ridge - 1.6, W / 2);
  const len = Math.hypot(W / 2 + eave, (ridge - 1.6) + eave * Math.tan(slope)) + 0.2;
  for (const s of [-1, 1]) {
    const rg = new THREE.BoxGeometry(len, 0.16, D + 1.2);
    M.add(rg, mat4(s * (W / 4 + 0.05), 0.35 + (1.6 + ridge) / 2 + 0.05, 0, 0, 1, 1, 1, 0, -s * slope), roofM);
  }
  M.add(new THREE.BoxGeometry(0.25, 0.22, D + 1.3), mat4(0, ridge + 0.4, 0), darkWood);
  // chimney
  M.add(new THREE.BoxGeometry(0.9, 7.4, 0.9), mat4(1.6, 3.7, -1.6), stone);
  M.add(new THREE.BoxGeometry(1.05, 0.18, 1.05), mat4(1.6, 7.45, -1.6), stone);
  // door + frame + porch
  M.add(new THREE.BoxGeometry(1.1, 2.1, 0.08), mat4(-1.4, 1.4, D / 2 + 0.02), darkWood);
  M.add(new THREE.BoxGeometry(1.35, 0.12, 0.14), mat4(-1.4, 2.5, D / 2 + 0.04), darkWood);
  M.add(new THREE.BoxGeometry(2.6, 0.18, 1.4), mat4(-1.0, 0.3, D / 2 + 0.75), wood);
  // window frames
  const wins = [[1.3, 1.9, 1.0, 1.5], [1.3, 3.8, 0.8, 1.1], [-1.4, 3.8, 0.8, 1.1]];
  wins.forEach(([wx, wy, ww, wh]) => {
    M.add(new THREE.BoxGeometry(ww + 0.16, 0.1, 0.12), mat4(wx, wy - wh / 2, D / 2 + 0.03), darkWood);
    M.add(new THREE.BoxGeometry(ww + 0.16, 0.1, 0.12), mat4(wx, wy + wh / 2, D / 2 + 0.03), darkWood);
    M.add(new THREE.BoxGeometry(0.1, wh, 0.12), mat4(wx - ww / 2, wy, D / 2 + 0.03), darkWood);
    M.add(new THREE.BoxGeometry(0.1, wh, 0.12), mat4(wx + ww / 2, wy, D / 2 + 0.03), darkWood);
  });
  // side window
  M.add(new THREE.BoxGeometry(0.12, 1.0, 1.2), mat4(-W / 2 - 0.02, 1.4, -1), darkWood);
  M.build(g);
  wins.forEach(([wx, wy, ww, wh], i) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh), windowMat(i));
    p.position.set(wx, wy, D / 2 + 0.005); g.add(p);
  });
  const sw = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.8), windowMat(4)); sw.position.set(-W / 2 - 0.09, 1.4, -1); sw.rotation.y = -Math.PI / 2; g.add(sw);
  world.scene.add(g);
  g.updateMatrixWorld(true);
  // colliders: prism body + chimney
  const prism = new THREE.Shape();
  prism.moveTo(-W / 2 - eave * 0.7, 0); prism.lineTo(W / 2 + eave * 0.7, 0); prism.lineTo(W / 2 + eave * 0.7, 1.4); prism.lineTo(0, ridge + 0.4); prism.lineTo(-W / 2 - eave * 0.7, 1.4); prism.closePath();
  const pg = new THREE.ExtrudeGeometry(prism, { depth: D + 0.2, bevelEnabled: false });
  pg.translate(0, 0, -D / 2 - 0.1);
  world.collide(pg, g.matrixWorld.clone().multiply(mat4(0, 0.35, 0)));
  world.collide(new THREE.BoxGeometry(0.9, 7.4, 0.9), g.matrixWorld.clone().multiply(mat4(1.6, 3.7, -1.6)));
  world.collide(new THREE.BoxGeometry(2.6, 0.18, 1.4), g.matrixWorld.clone().multiply(mat4(-1.0, 0.3, D / 2 + 0.75)));
  // window light spill
  const front = new THREE.Vector3(0, 0, 1).applyQuaternion(g.quaternion);
  const wp = new THREE.Vector3(1.3, 1.9, D / 2 + 0.3).applyMatrix4(g.matrixWorld);
  windowSpill(world, wp, front.clone().multiplyScalar(4).add(new THREE.Vector3(0, -2.2, 0)), 0xffa060, 9, 0.85);
  const wp2 = new THREE.Vector3(0, 3.8, D / 2 + 0.3).applyMatrix4(g.matrixWorld);
  windowSpill(world, wp2, front.clone().multiplyScalar(5).add(new THREE.Vector3(0, -3, 0)), 0xff9a50, 6, 0.9);
  // chimney smoke-ish mist
  const smokeTop = new THREE.Vector3(1.6, 7.6, -1.6).applyMatrix4(g.matrixWorld);
  mist(world, { count: 6, place: (i) => [smokeTop.x + i * 0.4, smokeTop.z - i * 0.3], y: smokeTop.y - world.heightAt(smokeTop.x, smokeTop.z), size: [2.5, 5], color: 0x8c8c8a, opacity: 0.12, heightVar: 4 });
}

/* =========================================================
   2 · 雾河 — misty river under moss-draped oaks
   ========================================================= */
function buildRiver(world) {
  const S = world.scene;
  world.fogColor = 0x8d9496;
  S.fog = new THREE.FogExp2(world.fogColor, 0.042);
  sky(world, { top: 0x6e767a, horizon: 0x9aa1a3, bottom: 0x8a9092, glow: 0x3a3c3a, glowDir: new THREE.Vector3(0.2, 0.15, -1), clouds: 0.2 });
  hemi(world, 0xb4bec4, 0x2a2a24, 0.9);
  moon(world, { color: 0xc8d0d4, intensity: 0.5, dir: [0.2, 0.7, -1] });
  const cX = (z) => Math.sin(z * 0.045) * 7 + Math.sin(z * 0.11) * 2;
  const H = bake((x, z) => {
    const d = Math.abs(x - cX(z));
    const bed = -0.75 + smooth(0, 7, d) * 0.4;
    const bank = 0.55 + (fbm(x * 0.05, z * 0.05, 64, 4, 21) - 0.5) * 2.2 + smooth(16, 40, d) * 2.5;
    return mix(bed, bank, smooth(6.5, 11, d)) + (fbm(x * 0.3, z * 0.3, 64, 2, 22) - 0.5) * 0.15;
  }, 200, 1);
  world.heightAt = H;
  const ground = pbr('mud', 1, { color: 0x8a8278 }, 'brown_mud_leaves_01');
  terrain(world, {
    size: 200, segs: 220, height: H, material: ground, collSegs: 110,
    colorFn: (x, z, y) => { const m = smooth(0.3, 1.2, y); const n = fbm(x * 0.08, z * 0.08, 64, 3, 4); return [0.7 + m * 0.15 + n * 0.2, 0.7 + m * 0.25 + n * 0.2, 0.62 + m * 0.1 + n * 0.15]; },
  });
  water(world, { size: 200, y: 0, color: 0x2a3234, sun: new THREE.Vector3(0.2, 0.3, -1), sunColor: 0x9aa0a0, distortion: 0.6 });
  // oaks along banks leaning over the water
  const R = rng(8);
  const oakSpots = [];
  for (let z = -50; z <= 50; z += 9 + R() * 5) {
    for (const side of [-1, 1]) {
      if (R() < 0.25) continue;
      const x = cX(z) + side * (10 + R() * 4);
      oakSpots.push([x, z, side]);
    }
  }
  oakSpots.forEach(([x, z, side], i) => {
    branchTree(world, x, z, {
      seed: 40 + i, height: 9 + R() * 4, trunkR: 0.5 + R() * 0.25, depth: 4, horizontal: 0.9, spread: 1.3, lean: -side * 0.35,
      leaves: true, moss: true, leafColor: 0x5e6a4c, mossColor: 0x8e8e86, barkColor: 0x6e6a64, ry: R() * 6,
    });
  });
  // the fallen branch across the water
  const logPts = [new THREE.Vector3(cX(6) - 10, 0.4, 3), new THREE.Vector3(cX(6) - 3, 0.25, 5.5), new THREE.Vector3(cX(6) + 3, 0.2, 7), new THREE.Vector3(cX(6) + 9, 0.55, 9.5)];
  const logG = taperedTube(logPts, 12, (t) => mix(0.42, 0.22, t), 2, 2.2, 3);
  const bark = pbr('bark', 1, { color: 0x5a5650 }, 'bark_brown_02');
  const log = new THREE.Mesh(logG, bark); log.castShadow = log.receiveShadow = true; S.add(log);
  world.collide(taperedTube(logPts, 8, (t) => mix(0.42, 0.22, t), 1, 1, 2));
  // twisting dead branch sticking up from water
  const twig = [new THREE.Vector3(cX(-8) + 3, -0.6, -8), new THREE.Vector3(cX(-8) + 1, 0.8, -9), new THREE.Vector3(cX(-8) - 1.5, 1.4, -8.6), new THREE.Vector3(cX(-8) - 4, 1.3, -9.4)];
  const tw = new THREE.Mesh(taperedTube(twig, 8, (t) => mix(0.16, 0.05, t), 1, 1, 4), bark); tw.castShadow = true; S.add(tw);
  // rock island
  rocks(world, [{ x: cX(-20) + 1, z: -20, s: 1.8, sy: 0.5, sink: 0.55, sx: 1.6 }], { mossy: 0.8, seed: 12 });
  rocks(world, scatter(40, 9, 120, (x, z) => { const d = Math.abs(x - cX(z)); return d > 5 && d < 14; }).map((p) => ({ ...p, s: p.s * 0.6 })), { mossy: 0.6 });
  // reeds & lily pads
  clumps(world, scatter(500, 10, 140, (x, z) => { const d = Math.abs(x - cX(z)); return d > 5.8 && d < 9.5; }), { tex: 'reed', color: 0x8a8a6a, w: 0.9, h: 1.5, sway: 0.08 });
  clumps(world, scatter(500, 11, 140, (x, z) => Math.abs(x - cX(z)) > 9), { tex: 'grass', color: 0x6a7258, w: 0.8, h: 0.55 });
  ferns(world, scatter(160, 12, 140, (x, z) => Math.abs(x - cX(z)) > 12), { color: 0x6e7a5a, scale: 0.8 });
  const pads = new THREE.InstancedMesh(new THREE.CircleGeometry(0.28, 14, 0.3, 5.9).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3a4a30, roughness: 0.35, side: THREE.DoubleSide }), 140);
  scatter(140, 13, 140, (x, z) => { const d = Math.abs(x - cX(z)); return d > 3.5 && d < 6.5; }).forEach((p, i) => pads.setMatrixAt(i, mat4(p.x, 0.015, p.z, p.ry, p.s)));
  S.add(pads);
  // distant tall trees as fog silhouettes
  conifers(world, scatter(120, 14, 200, (x, z) => Math.abs(x - cX(z)) > 22 && Math.hypot(x, z) > 30), { variants: 2, collideR: 0, foliageColor: 0x5a6058, seed: 21 });
  // small jetty with a hanging lantern
  const jx = cX(-30) + 9, jz = -30;
  const wood = pbr('wood', [1, 2], { color: 0x6a5c4e });
  const M = new Merger();
  for (let i = 0; i < 6; i++) M.add(new THREE.BoxGeometry(2.0, 0.08, 0.32), mat4(jx - i * 0.62, 0.45, jz, 0, 1, 1, 1, 0, (R() - 0.5) * 0.03), wood);
  for (const dz of [-0.9, 0.9]) for (let i = 0; i < 3; i++) M.add(new THREE.CylinderGeometry(0.08, 0.09, 2.2, 8), mat4(jx - i * 1.5, -0.4, jz + dz * 0.95), wood);
  M.build(S);
  world.collideBox(jx - 1.55, 0.42, jz, 3.8, 0.1, 2.0, Math.PI / 2);
  streetLamp(world, jx - 3, jz - 0.9, { y: 0.4, height: 2.0, intensity: 8, distance: 12, cone: false, arm: true, color: 0xffa050 });
  mist(world, { count: 70, area: 160, y: 0.35, size: [6, 14], color: 0xc4c8c8, opacity: 0.14, heightVar: 0.8, place: (i) => { const z = (Math.random() - 0.5) * 140; return [cX(z) + (Math.random() - 0.5) * 12, z]; } });
  mist(world, { count: 30, area: 160, y: 4, size: [24, 40], color: 0xb0b6b8, opacity: 0.1, heightVar: 6 });
  fireflies(world, new THREE.Vector3(cX(0) + 10, 0, 0), 40, 30, 0xe8ffa0);
  boundary(world, cX(0), 0, 60);
  const sx = cX(14) - 10.5;
  world.spawn = { pos: new THREE.Vector3(sx, H(sx, 14) + 0.2, 14), yaw: -1.3, pitch: -0.04 };
  world.surface = (x, z, y) => (y < 0.5 ? 'mud' : 'leaves');
  world.ambience = { river: 0.5, night: 0.35, wind: 0.2 };
  world.extraSources = [{ type: 'stream', pos: new THREE.Vector3(cX(6), 0.2, 6), ref: 3 }];
  world.tweak = { exposure: 0.95, bloom: 0.8 };
}

/* =========================================================
   3 · 雪径 — snowy footpath under a lone lamp
   ========================================================= */
function buildSnow(world) {
  const S = world.scene;
  world.fogColor = 0x2a221c;
  S.fog = new THREE.FogExp2(world.fogColor, 0.05);
  sky(world, { top: 0x15110f, horizon: 0x3a2c22, clouds: 0.4 });
  hemi(world, 0x8a7a6a, 0x3a3a40, 0.5);
  moon(world, { color: 0x8a8a9a, intensity: 0.15, dir: [0.3, 1, 0.2] });
  const path = pathSampler([[0, -60], [2, -35], [-1, -15], [1, 0], [-3, 18], [2, 36], [0, 60]]);
  const H = bake((x, z) => {
    const [d] = path.dist(x, z);
    const nat = (fbm(x * 0.02, z * 0.02, 64, 4, 31) - 0.5) * 5 + Math.abs(x) * 0.04;
    const prints = (vnoise(x * 6, z * 3.5, 64, 7) - 0.5) * 0.06 * smooth(1.4, 0.3, d);
    return nat - smooth(2.2, 0.4, d) * 0.12 + prints + (fbm(x * 0.4, z * 0.4, 64, 2, 32) - 0.5) * 0.12;
  }, 200, 0.8);
  world.heightAt = H;
  const snowM = pbr('snow', 1, { color: 0xe8e8ec }, 'snow_02');
  terrain(world, { size: 200, segs: 250, height: H, material: snowM, collSegs: 120, colorFn: (x, z) => { const d = path.dist(x, z)[0]; const c = 0.9 - smooth(1.6, 0.2, d) * 0.12; return [c, c, c * 1.02]; } });
  footprintSystem(world, { color: 0x5a5c66, opacity: 0.45 });
  // lamps along the path
  [0.38, 0.52, 0.68].forEach((t, i) => {
    const p = path.curve.getPointAt(t), tg = path.curve.getTangentAt(t);
    const side = i % 2 ? -1 : 1;
    const x = p.x - tg.z * side * 1.9, z = p.z + tg.x * side * 1.9;
    streetLamp(world, x, z, { y: H(x, z), height: 3.6, intensity: 34, distance: 24, color: 0xffa64e });
  });
  // shrubs and trees
  const off = (x, z) => path.dist(x, z)[0];
  clumps(world, scatter(700, 33, 130, (x, z) => off(x, z) > 1.7), { tex: 'twigs', color: 0xb0a89e, w: 2.4, h: 2.2, snow: 0.9, sway: 0.03, frost: true });
  clumps(world, scatter(500, 34, 100, (x, z) => off(x, z) > 1.3), { tex: 'twigs', color: 0xa0988e, w: 1.2, h: 1.1, snow: 1, sway: 0.03, frost: true });
  const R = rng(5);
  for (let i = 0; i < 26; i++) {
    const z = -55 + i * 4.3 + R() * 2, side = i % 2 ? 1 : -1;
    const p = path.dist(0, z);
    const x = p[2] + side * (3 + R() * 8);
    if (off(x, z) < 2.6) continue;
    branchTree(world, x, z, { seed: 70 + i, height: 6 + R() * 5, trunkR: 0.16 + R() * 0.12, depth: 4, horizontal: 0.1, spread: 0.8, twigs: true, snow: 1, barkColor: 0x5a5450, ry: R() * 6 });
  }
  conifers(world, scatter(140, 35, 160, (x, z) => off(x, z) > 5), { variants: 3, snow: 1, foliageColor: 0x5a6a5a, seed: 31, h: 14, crown: 3.2 });
  rocks(world, scatter(30, 36, 100, (x, z) => off(x, z) > 2.5), { snow: 1, mossy: 0, color: 0x7a7a7c });
  // wooden fence beside the path
  const wood = pbr('wood', [0.5, 1], { color: 0x5a4a3c });
  snowCover(wood, 1, 0.4);
  const M = new Merger();
  for (let t = 0.2; t < 0.85; t += 0.012) {
    const p = path.curve.getPointAt(t), tg = path.curve.getTangentAt(t);
    const x = p.x + tg.z * 2.6, z = p.z - tg.x * 2.6, y = H(x, z);
    const ang = Math.atan2(tg.x, tg.z);
    M.add(new THREE.BoxGeometry(0.1, 1.1, 0.1), mat4(x, y + 0.45, z, ang, 1, 1, 1, (R() - 0.5) * 0.08, (R() - 0.5) * 0.08), wood);
    M.add(new THREE.BoxGeometry(0.05, 0.08, 1.3), mat4(x, y + 0.75, z, ang, 1, 1, 1, 0, 0), wood);
    M.add(new THREE.BoxGeometry(0.05, 0.08, 1.3), mat4(x, y + 0.35, z, ang, 1, 1, 1, 0, 0), wood);
    world.collideBox(x, y + 0.5, z, 0.12, 1.2, 1.3, ang);
  }
  M.build(S);
  // a snow-covered bench under the middle lamp
  const bp = path.curve.getPointAt(0.53), bt = path.curve.getTangentAt(0.53);
  const bx = bp.x - bt.z * 1.6, bz = bp.z + bt.x * 1.6, by = H(bx, bz), ba = Math.atan2(bt.x, bt.z) + Math.PI / 2;
  const B = new Merger();
  const iron = pbr('metal', 1, { color: 0x2a2a2c, metalness: 0.7, roughness: 0.5 });
  for (let k = 0; k < 4; k++) B.add(new THREE.BoxGeometry(1.6, 0.04, 0.1), mat4(0, 0.45, -0.18 + k * 0.12), wood);
  for (let k = 0; k < 3; k++) B.add(new THREE.BoxGeometry(1.6, 0.1, 0.03), mat4(0, 0.62 + k * 0.13, 0.26, 0, 1, 1, 1, -0.2), wood);
  for (const sx of [-0.7, 0.7]) { B.add(new THREE.BoxGeometry(0.05, 0.45, 0.5), mat4(sx, 0.22, 0), iron); B.add(new THREE.BoxGeometry(0.05, 0.5, 0.05), mat4(sx, 0.7, 0.27, 0, 1, 1, 1, -0.2), iron); }
  const bench = new THREE.Group(); bench.position.set(bx, by, bz); bench.rotation.y = ba; B.build(bench); S.add(bench);
  bench.updateMatrixWorld(); world.collide(new THREE.BoxGeometry(1.7, 0.5, 0.6), bench.matrixWorld.clone().multiply(mat4(0, 0.25, 0)));

  snowfall(world, { count: 8000 });
  mist(world, { count: 40, area: 120, y: 1.5, size: [10, 20], color: 0x5a4a3c, opacity: 0.12, heightVar: 3 });
  boundary(world, 0, 0, 62);
  const sp = path.curve.getPointAt(0.3), tg = path.curve.getTangentAt(0.3);
  world.spawn = { pos: new THREE.Vector3(sp.x, H(sp.x, sp.z) + 0.2, sp.z), yaw: Math.atan2(-tg.x, -tg.z), pitch: 0.05 };
  world.surface = () => 'snow';
  world.ambience = { hush: 0.6, wind: 0.18 };
  world.tweak = { exposure: 1.1, bloom: 1.1 };
}

/* =========================================================
   4 · 雨巷 — narrow cobbled lane in the rain
   ========================================================= */
function buildAlley(world) {
  const S = world.scene;
  world.fogColor = 0x1a1d22;
  S.fog = new THREE.FogExp2(world.fogColor, 0.045);
  sky(world, { top: 0x0c0e12, horizon: 0x2a2e36, clouds: 0.9 });
  hemi(world, 0x6a7686, 0x1a1816, 0.5);
  moon(world, { color: 0x8090a8, intensity: 0.2, dir: [0.25, 1, 0.15] });
  const ground = (x, z) => (z > 34 ? 2.6 : z > 28 ? (z - 28) / 6 * 2.6 : 0) - Math.max(0, 0.06 - Math.abs(Math.abs(x) - 1.85) * 0.2) ;
  world.heightAt = (x, z) => ground(x, z);
  const cob = pbr('cobble', [1, 1], { color: 0xa09a94, roughness: 0.6 }, 'cobblestone_floor_08');
  wetRipples(cob, 1.2, 2);
  const gplane = new THREE.PlaneGeometry(12, 80, 24, 160); gplane.rotateX(-Math.PI / 2);
  const gp = gplane.attributes.position;
  for (let i = 0; i < gp.count; i++) gp.setY(i, ground(gp.getX(i), gp.getZ(i)));
  gplane.computeVertexNormals();
  const guv = gplane.attributes.uv; for (let i = 0; i < guv.count; i++) guv.setXY(i, gp.getX(i) / 2.5, gp.getZ(i) / 2.5);
  const gm = new THREE.Mesh(gplane, cob); gm.receiveShadow = true; S.add(gm);
  world.collide(gplane);
  // stair steps (visual) over the ramp
  const stoneStep = pbr('stone', [1, 0.3], { color: 0x8a8680 });
  wetRipples(stoneStep, 0.8, 2);
  for (let i = 0; i < 16; i++) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.17, 0.4), stoneStep);
    st.position.set(0, (i + 0.5) * 0.1625, 28 + i * 0.375 + 0.2); st.receiveShadow = st.castShadow = true; S.add(st);
  }
  // puddles
  const pudM = new THREE.MeshStandardMaterial({ color: 0x0e1012, roughness: 0.02, metalness: 0.1, transparent: true, opacity: 0.7, polygonOffset: true, polygonOffsetFactor: -2 });
  wetRipples(pudM, 2.0, 2.4);
  const R = rng(44);
  for (let i = 0; i < 14; i++) {
    const g = new THREE.CircleGeometry(0.5 + R() * 1.1, 24); g.rotateX(-Math.PI / 2); g.scale(1, 1, 0.5 + R() * 0.8);
    const p = new THREE.Mesh(g, pudM); const z = -36 + R() * 62; p.position.set((R() - 0.5) * 2.4, ground(0, z) + 0.012, z); p.rotation.y = R() * 3; S.add(p);
  }
  // buildings
  const plaster = pbr('plaster', [1, 1], { color: 0x8a8278 }, 'painted_plaster_wall');
  const plaster2 = pbr('plaster', [1, 1], { color: 0x6e7476 });
  const brick = pbr('brick', [2.5, 2.5], { color: 0x9a8a80 }, 'red_brick_03');
  const trim = pbr('stone', [1, 1], { color: 0x6a6660 });
  const darkWood = pbr('wood', [1, 1], { color: 0x2e2620 });
  const iron = pbr('metal', 1, { color: 0x2a2b2d, metalness: 0.8, roughness: 0.45 });
  const glassDark = new THREE.MeshStandardMaterial({ color: 0x0c1014, roughness: 0.05, metalness: 0.6 });
  const M = new Merger();
  const wins = [];
  const addBuilding = (side, z0, z1, h, mat) => {
    const depth = 10, W = z1 - z0;
    const fx = side * 2.1; // facade plane x
    const cx = fx + side * depth / 2, cz = (z0 + z1) / 2;
    const base = ground(0, cz) - 0.3;
    const box = new THREE.BoxGeometry(depth, h, W);
    const uv = box.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(W, depth) / 4, uv.getY(i) * h / 4);
    M.add(box, mat4(cx, base + h / 2, cz), mat);
    world.collideBox(cx, base + h / 2, cz, depth, h, W);
    // cornice & base course
    M.add(new THREE.BoxGeometry(0.35, 0.3, W), mat4(fx - side * 0.12, base + h - 0.2, cz), trim);
    M.add(new THREE.BoxGeometry(0.2, 0.7, W), mat4(fx - side * 0.08, base + 0.35, cz), trim);
    M.add(new THREE.BoxGeometry(0.25, 0.9, W), mat4(fx + side * 0.15, base + h + 0.45, cz), trim); // parapet
    // windows per floor
    const floors = Math.floor((h - 1) / 3);
    const cols = Math.max(1, Math.floor(W / 2.6));
    for (let f = 1; f < floors; f++) for (let c = 0; c < cols; c++) {
      const wz = z0 + (c + 0.5) * (W / cols), wy = base + 0.6 + f * 3 + 0.4;
      const lit = R() < 0.32;
      const ww = 1.0, wh = 1.55;
      const ox = fx - side * 0.04;
      M.add(new THREE.BoxGeometry(0.14, 0.1, ww + 0.25), mat4(ox, wy - wh / 2 - 0.05, wz), trim);
      M.add(new THREE.BoxGeometry(0.1, 0.12, ww + 0.2), mat4(ox, wy + wh / 2 + 0.06, wz), trim);
      M.add(new THREE.BoxGeometry(0.08, wh, 0.07), mat4(ox, wy, wz - ww / 2), darkWood);
      M.add(new THREE.BoxGeometry(0.08, wh, 0.07), mat4(ox, wy, wz + ww / 2), darkWood);
      M.add(new THREE.BoxGeometry(0.06, 0.05, ww), mat4(ox, wy + 0.25, wz), darkWood);
      M.add(new THREE.BoxGeometry(0.06, wh, 0.04), mat4(ox, wy, wz), darkWood);
      if (R() < 0.35) for (const sd of [-1, 1]) M.add(new THREE.BoxGeometry(0.05, wh + 0.1, ww * 0.5), mat4(ox - side * 0.06, wy, wz + sd * (ww * 0.75), sd * side * 0.25), darkWood);
      wins.push({ x: fx - side * 0.012, y: wy, z: wz, w: ww, h: wh, lit, side });
      if (f === 2 && R() < 0.3) { // balcony
        M.add(new THREE.BoxGeometry(0.9, 0.12, ww + 0.8), mat4(fx - side * 0.45, wy - wh / 2 - 0.1, wz), trim);
        for (let b = 0; b < 9; b++) M.add(new THREE.CylinderGeometry(0.012, 0.012, 0.9, 6), mat4(fx - side * 0.85, wy - wh / 2 + 0.38, wz - (ww + 0.7) / 2 + b * (ww + 0.7) / 8), iron);
        M.add(new THREE.BoxGeometry(0.04, 0.04, ww + 0.8), mat4(fx - side * 0.85, wy - wh / 2 + 0.85, wz), iron);
        world.collideBox(fx - side * 0.45, wy - wh / 2 - 0.1, wz, 0.9, 0.15, ww + 0.8);
      }
    }
    // door
    const dz = z0 + W * (0.25 + R() * 0.5);
    M.add(new THREE.BoxGeometry(0.1, 2.3, 1.15), mat4(fx - side * 0.0, base + 0.3 + 1.15, dz), darkWood);
    M.add(new THREE.BoxGeometry(0.2, 0.18, 1.5), mat4(fx - side * 0.08, base + 0.3 + 2.4, dz), trim);
    M.add(new THREE.BoxGeometry(0.5, 0.15, 1.4), mat4(fx - side * 0.25, base + 0.37, dz), trim);
    // drainpipe
    const pz = z1 - 0.3;
    M.add(new THREE.CylinderGeometry(0.06, 0.06, h, 10), mat4(fx - side * 0.12, base + h / 2, pz), iron);
    world.sources.push({ type: 'drip', pos: new THREE.Vector3(fx - side * 0.2, ground(0, pz) + 0.1, pz) });
    return { fx, base };
  };
  let z = -40;
  while (z < 30) { const w = 5 + R() * 5; addBuilding(-1, z, Math.min(z + w, 30), 8 + R() * 6, [plaster, brick, plaster2][Math.floor(R() * 3)]); z += w; }
  z = -40;
  while (z < 30) { const w = 5 + R() * 5; addBuilding(1, z, Math.min(z + w, 30), 8 + R() * 6, [brick, plaster, plaster2][Math.floor(R() * 3)]); z += w; }
  // upper terrace buildings & end wall
  addBuilding(-1, 30, 42, 9, plaster); addBuilding(1, 30, 42, 10, brick);
  world.collideBox(0, 6, 41.5, 6, 12, 1); M.add(new THREE.BoxGeometry(6, 12, 1), mat4(0, 6, 41.6), plaster2);
  world.collideBox(0, 6, -40.5, 6, 14, 1); M.add(new THREE.BoxGeometry(6, 14, 1), mat4(0, 7, -40.6), brick);
  M.build(S);
  // windows: lit or dark glass
  const litMats = [windowMat(0), windowMat(1), windowMat(2)];
  wins.forEach((w, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w.w, w.h), w.lit ? litMats[i % 3] : glassDark);
    m.position.set(w.x - w.side * 0.02, w.y, w.z); m.rotation.y = -w.side * Math.PI / 2; S.add(m);
  });
  // a couple of lit windows spill light into the lane
  wins.filter((w) => w.lit && w.y < 6).slice(0, 3).forEach((w) => windowSpill(world, new THREE.Vector3(w.x - w.side * 0.3, w.y, w.z), new THREE.Vector3(-w.side * 2, -3, 0), 0xffa060, 2.5, 1.1));
  // wall lanterns
  [[-1, -28], [1, -14], [-1, 0], [1, 14], [-1, 26], [1, 36]].forEach(([side, lz], i) => {
    streetLamp(world, side * 1.98, lz, { y: ground(0, lz) + 2.6, height: 0.7, arm: true, ry: side > 0 ? Math.PI : 0, intensity: 16 + (i % 2) * 6, distance: 16, cone: true, flicker: i === 3 ? 0.25 : 0, color: i % 3 === 2 ? 0xffc890 : 0xffa858 });
  });
  // string lights across the lane
  const bulbM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb060).multiplyScalar(5) });
  const wireM = new THREE.MeshBasicMaterial({ color: 0x0a0a0a });
  [-20, -6, 8, 20].forEach((wz) => {
    const pts = []; for (let k = 0; k <= 10; k++) { const t = k / 10; pts.push(new THREE.Vector3(-2.1 + t * 4.2, ground(0, wz) + 6.2 - Math.sin(t * Math.PI) * 0.6, wz + Math.sin(t * 3) * 0.2)); }
    S.add(new THREE.Mesh(taperedTube(pts, 4, () => 0.008, 1, 1, 6), wireM));
    for (let k = 1; k < 10; k++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), bulbM); b.position.copy(pts[k]).y -= 0.06; S.add(b); }
  });
  // clutter
  const crate = pbr('wood', [0.6, 0.6], { color: 0x5a4a3a });
  [[-1.5, -10], [1.4, 5], [-1.5, 18]].forEach(([x, cz], i) => {
    const s = 0.6 + (i % 2) * 0.2;
    const c = new THREE.Mesh(new RoundedBoxGeometry(s, s, s, 2, 0.03), crate); c.position.set(x, s / 2, cz); c.rotation.y = i; c.castShadow = c.receiveShadow = true; S.add(c);
    world.collideBox(x, s / 2, cz, s, s, s, i);
  });
  const potM = pbr('stone', 1, { color: 0x7a5a4a });
  ferns(world, [{ x: -1.6, z: -2 }, { x: 1.55, z: 11 }, { x: -1.6, z: 23 }].map((p) => { const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.2, 0.45, 16), potM); pot.position.set(p.x, 0.22, p.z); S.add(pot); world.collideCyl(p.x, 0, p.z, 0.28, 0.45); return { ...p, y: 0.42, s: 0.6 }; }), { color: 0x6a7a50 });
  // heights for ferns sit on pots
  rain(world, { count: 9000, box: 22, opacity: 0.3 });
  mist(world, { count: 30, area: 0, place: () => [(Math.random() - 0.5) * 3, -36 + Math.random() * 72], y: 0.4, size: [4, 9], color: 0x8a8e94, opacity: 0.08, heightVar: 2 });
  // steam from a grate
  mist(world, { count: 8, place: () => [1.2 + Math.random() * 0.3, -18 + Math.random() * 0.5], y: 0.2, size: [1.5, 3.5], color: 0xb0b0b0, opacity: 0.12, heightVar: 2.5 });
  world.spawn = { pos: new THREE.Vector3(0, 0.2, -34), yaw: Math.PI, pitch: 0.03 };
  world.surface = () => 'stone';
  world.ambience = { rain: 0.9, city: 0.45 };
  world.tweak = { exposure: 1.05, bloom: 1.1 };
  world.wet = true;
}

/* =========================================================
   5 · 湖畔 — moonlit lake & wooden dock
   ========================================================= */
function buildLake(world) {
  const S = world.scene;
  world.fogColor = 0x182028;
  S.fog = new THREE.FogExp2(world.fogColor, 0.016);
  const moonDir = new THREE.Vector3(-0.15, 0.13, -1);
  sky(world, { top: 0x080c12, horizon: 0x2c3540, clouds: 0.55, moon: moonDir, stars: 0.8, glow: 0x223040, glowDir: moonDir });
  hemi(world, 0x6a7a90, 0x141618, 0.45);
  moon(world, { color: 0xa8b8d0, intensity: 0.55, dir: [0.15, 0.4, 1] });
  const H = bake((x, z) => {
    const shore = 4 + Math.sin(x * 0.06) * 3 + Math.sin(x * 0.17) * 1;
    const land = 0.4 + (z - shore) * 0.07 + (fbm(x * 0.03, z * 0.03, 64, 4, 51) - 0.5) * 3 * smooth(shore, shore + 15, z);
    const bed = -1.05 + (fbm(x * 0.1, z * 0.1, 64, 2, 52) - 0.5) * 0.2;
    return z > shore ? land : mix(bed, land, smooth(shore - 8, shore, z));
  }, 220, 1);
  world.heightAt = H;
  const ground = pbr('forestGround', 1, { color: 0x9a948a }, 'forrest_ground_01');
  terrain(world, { size: 220, segs: 220, height: H, material: ground, collSegs: 110, colorFn: (x, z, y) => { const w = smooth(0.8, 0.0, y); const c = 0.8 - w * 0.3; return [c, c * 0.98, c * 0.92]; } });
  water(world, { size: 1400, y: 0, color: 0x101820, sun: new THREE.Vector3(-0.15, 0.13, -1), sunColor: 0xc8d4e8, distortion: 0.5 });
  // distant mountains (no collision)
  const mg = new THREE.PlaneGeometry(1400, 500, 160, 40); mg.rotateX(-Math.PI / 2);
  const mp = mg.attributes.position;
  for (let i = 0; i < mp.count; i++) { const x = mp.getX(i), zz = mp.getZ(i); const t = smooth(-250, 250, -zz); mp.setY(i, (fbm(x * 0.004 + 3, zz * 0.004, 64, 5, 53) * 140 - 30) * t - 3); }
  mg.computeVertexNormals();
  const mm = new THREE.Mesh(mg, new THREE.MeshStandardMaterial({ color: 0x1a2028, roughness: 1 }));
  mm.position.z = -560; S.add(mm);
  // dock
  const wood = pbr('wood', [1, 1], { color: 0x7a6a5a }, 'wood_planks_dirt');
  const M = new Merger();
  const R = rng(61);
  const dockY = 0.62, dockL = 26;
  for (let i = 0; i < dockL / 0.32; i++) {
    const zz = 5 - i * 0.32;
    if (R() < 0.03) continue;
    M.add(new THREE.BoxGeometry(2.2 + (R() - 0.5) * 0.1, 0.07, 0.29), mat4((R() - 0.5) * 0.05, dockY + (R() - 0.5) * 0.02, zz, (R() - 0.5) * 0.02, 1, 1, 1, 0, (R() - 0.5) * 0.03), wood);
  }
  for (let i = 0; i <= dockL / 2.2; i++) for (const sx of [-1.05, 1.05]) {
    const zz = 5 - i * 2.2;
    M.add(new THREE.CylinderGeometry(0.1, 0.11, 2.6, 10), mat4(sx, dockY - 1.0, zz, 0, 1, 1, 1, (R() - 0.5) * 0.05, (R() - 0.5) * 0.05), wood);
    world.collideCyl(sx, -1.5, zz, 0.12, 2.6);
  }
  M.add(new THREE.BoxGeometry(0.12, 0.16, dockL), mat4(-1.0, dockY - 0.12, 5 - dockL / 2), wood);
  M.add(new THREE.BoxGeometry(0.12, 0.16, dockL), mat4(1.0, dockY - 0.12, 5 - dockL / 2), wood);
  // end posts + bollard
  M.add(new THREE.CylinderGeometry(0.1, 0.1, 1.4, 10), mat4(1.0, dockY + 0.5, 5 - dockL + 0.3), wood);
  M.build(S);
  world.collideBox(0, dockY - 0.05, 5 - dockL / 2, 2.25, 0.14, dockL);
  // ramp from shore onto the dock
  world.collide(new THREE.BoxGeometry(2.2, 0.1, 5), mat4(0, (H(0, 7.5) + dockY) / 2 - 0.05, 7.5, 0, 1, 1, 1, Math.atan2(dockY - H(0, 10), 5)));
  const rampMesh = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 5), wood); rampMesh.position.set(0, (H(0, 7.5) + dockY) / 2 - 0.02, 7.5); rampMesh.rotation.x = Math.atan2(dockY - H(0, 10), 5); rampMesh.receiveShadow = true; S.add(rampMesh);
  streetLamp(world, 1.0, 5 - dockL + 0.3, { y: dockY + 1.2, height: 0.25, intensity: 10, distance: 14, cone: false, color: 0xffa04a, flicker: 0.1 });
  // rowboat
  const hull = new THREE.LatheGeometry(Array.from({ length: 10 }, (_, i) => new THREE.Vector2(Math.sin((i / 9) * Math.PI * 0.5) * 0.7 + 0.02, (i / 9) * 0.5 - 0.25)), 20);
  hull.scale(1, 1, 3.2);
  const boatM = pbr('wood', [2, 1], { color: 0x5a4434, side: THREE.DoubleSide });
  const boat = new THREE.Mesh(hull, boatM); boat.position.set(2.1, 0.12, -9); boat.rotation.x = Math.PI; boat.castShadow = true; S.add(boat);
  world.onUpdate(() => { boat.position.y = 0.16 + Math.sin(U.time.value * 0.8) * 0.03; boat.rotation.z = Math.sin(U.time.value * 0.6) * 0.03; });
  world.collideBox(2.1, 0.1, -9, 1.3, 0.6, 4.2);
  // boathouse
  buildBoathouse(world, -10, 9, H);
  conifers(world, scatter(170, 62, 200, (x, z) => z > H(x, z) * 0 + 10 && Math.hypot(x + 10, z - 9) > 7 && Math.abs(x) > 3), { variants: 3, foliageColor: 0x6a786a, seed: 41, collideR: 70 });
  clumps(world, scatter(500, 63, 160, (x, z) => { const y = H(x, z); return y > -0.5 && y < 0.6 && Math.abs(x) > 1.6; }), { tex: 'reed', color: 0x7a7a5a, w: 0.9, h: 1.6, sway: 0.06 });
  clumps(world, scatter(500, 64, 160, (x, z) => H(x, z) > 0.6), { tex: 'grass', color: 0x5a6448, w: 0.8, h: 0.5 });
  ferns(world, scatter(160, 65, 160, (x, z) => H(x, z) > 1.5 && Math.hypot(x + 10, z - 9) > 6), { color: 0x6a7a58 });
  rocks(world, scatter(30, 66, 120, (x, z) => { const y = H(x, z); return y > -0.6 && y < 1.5 && Math.abs(x) > 3; }), { mossy: 0.4 });
  mist(world, { count: 60, area: 140, cz: -40, y: 0.2, size: [10, 22], color: 0x8a96a4, opacity: 0.1, heightVar: 0.8 });
  fireflies(world, new THREE.Vector3(0, 0, 8), 50, 50, 0xd8ff90);
  boundary(world, 0, -10, 68);
  world.spawn = { pos: new THREE.Vector3(0.3, H(0.3, 16) + 0.2, 16), yaw: 0.0, pitch: -0.03 };
  world.surface = (x, z, y) => (Math.abs(x) < 1.15 && z < 10.5 && z > 5 - dockL - 0.2 && y > 0.3 ? 'wood' : y < 0.6 ? 'mud' : 'leaves');
  world.ambience = { lake: 0.55, night: 0.5, wind: 0.2 };
  world.tweak = { exposure: 1.05, bloom: 1 };
}

function buildBoathouse(world, x, z, H) {
  const y = H(x, z);
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = 0.5;
  const M = new Merger();
  const wood = pbr('wood', [1.2, 1.2], { color: 0x5a4a3e });
  const roofM = pbr('roof', [1.5, 1.5], { color: 0x6a6e74 });
  M.add(new THREE.BoxGeometry(4.5, 2.8, 5.5), mat4(0, 1.4, 0), wood);
  for (const s of [-1, 1]) M.add(new THREE.BoxGeometry(3.0, 0.12, 6.3), mat4(s * 1.2, 3.35, 0, 0, 1, 1, 1, 0, -s * 0.6), roofM);
  const tri = new THREE.Shape(); tri.moveTo(-2.25, 0); tri.lineTo(2.25, 0); tri.lineTo(0, 1.45); tri.closePath();
  M.add(new THREE.ExtrudeGeometry(tri, { depth: 5.5, bevelEnabled: false }), mat4(0, 2.8, -2.75), wood);
  M.add(new THREE.BoxGeometry(1.0, 2.0, 0.06), mat4(-0.8, 1.0, -2.78), pbr('wood', 1, { color: 0x2a2018 }));
  M.build(g);
  const win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.7), windowMat(1)); win.position.set(1.0, 1.6, -2.76); win.rotation.y = Math.PI; g.add(win);
  world.scene.add(g); g.updateMatrixWorld(true);
  world.collide(new THREE.BoxGeometry(4.6, 4.3, 5.6), g.matrixWorld.clone().multiply(mat4(0, 2.1, 0)));
  const wp = new THREE.Vector3(1.0, 1.6, -3.2).applyMatrix4(g.matrixWorld);
  const out = new THREE.Vector3(0, -0.6, -1).applyQuaternion(g.quaternion).multiplyScalar(4);
  windowSpill(world, wp, out, 0xffa060, 6, 0.9);
  streetLamp(world, x + 1.5, z - 3.4, { y: y, height: 2.2, intensity: 10, distance: 12, cone: true, color: 0xffb060 });
}

/* =========================================================
   6 · 温室 — overgrown glasshouse in the woods
   ========================================================= */
function buildGreenhouse(world) {
  const S = world.scene;
  world.fogColor = 0x161c1c;
  S.fog = new THREE.FogExp2(world.fogColor, 0.04);
  sky(world, { top: 0x0a0d0e, horizon: 0x222a2a, clouds: 0.7 });
  hemi(world, 0x667a7a, 0x161410, 0.5);
  moon(world, { color: 0x9ab0b0, intensity: 0.3, dir: [-0.5, 1, 0.3] });
  const H = bake((x, z) => {
    const r = Math.hypot(x, z);
    return (fbm(x * 0.03, z * 0.03, 64, 4, 71) - 0.5) * 4 * smooth(10, 28, r) + (fbm(x * 0.3, z * 0.3, 64, 2, 72) - 0.5) * 0.15 * smooth(7, 9, r);
  }, 180, 1);
  world.heightAt = H;
  const ground = pbr('forestGround', 1, { color: 0x9a948a }, 'forrest_ground_01');
  terrain(world, { size: 180, segs: 180, height: H, material: ground, collSegs: 90 });
  const W = 8, L = 16, wallH = 3.2, ridge = 5.8;
  const iron = pbr('metal', 1, { color: 0x2a2e2c, metalness: 0.8, roughness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9ab0a8, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
  const grime = new THREE.MeshStandardMaterial({ color: 0x5a6a5a, roughness: 0.4, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
  const M = new Merger(), G = new Merger();
  const R = rng(81);
  // floor tiles
  const tiles = pbr('cobble', [1, 4], { color: 0x8a8680 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.2, L), tiles); floor.position.y = 0.05; floor.receiveShadow = true; S.add(floor);
  world.collideBox(0, 0.05, 0, W, 0.2, L);
  // brick knee wall
  const brick = pbr('brick', [2, 0.4], { color: 0x8a7a70 });
  for (const s of [-1, 1]) {
    M.add(new THREE.BoxGeometry(0.3, 0.7, L), mat4(s * W / 2, 0.45, 0), brick);
  }
  M.add(new THREE.BoxGeometry(W, 0.7, 0.3), mat4(0, 0.45, -L / 2), brick);
  M.add(new THREE.BoxGeometry(2.6, 0.7, 0.3), mat4(-2.7, 0.45, L / 2), brick); M.add(new THREE.BoxGeometry(2.6, 0.7, 0.3), mat4(2.7, 0.45, L / 2), brick);
  // frame
  const bay = 2;
  for (let i = 0; i <= L / bay; i++) {
    const zz = -L / 2 + i * bay;
    for (const s of [-1, 1]) {
      M.add(new THREE.BoxGeometry(0.08, wallH - 0.8, 0.08), mat4(s * W / 2, 0.8 + (wallH - 0.8) / 2, zz), iron);
      const rl = Math.hypot(W / 2, ridge - wallH);
      M.add(new THREE.BoxGeometry(rl, 0.08, 0.08), mat4(s * W / 4, (wallH + ridge) / 2, zz, 0, 1, 1, 1, 0, -s * Math.atan2(ridge - wallH, W / 2)), iron);
    }
  }
  M.add(new THREE.BoxGeometry(0.12, 0.12, L), mat4(0, ridge, 0), iron);
  for (const s of [-1, 1]) M.add(new THREE.BoxGeometry(0.1, 0.1, L), mat4(s * W / 2, wallH, 0), iron);
  // glass panes (side walls, roof, ends)
  for (let i = 0; i < L / bay; i++) {
    const zz = -L / 2 + (i + 0.5) * bay;
    for (const s of [-1, 1]) {
      const mat = R() < 0.2 ? grime : glass;
      if (R() > 0.1) G.add(new THREE.PlaneGeometry(bay - 0.08, wallH - 0.85), mat4(s * W / 2, 0.8 + (wallH - 0.8) / 2, zz, Math.PI / 2), mat);
      const rl = Math.hypot(W / 2, ridge - wallH);
      if (R() > 0.12) G.add(new THREE.PlaneGeometry(rl - 0.1, bay - 0.08), mat4(s * W / 4, (wallH + ridge) / 2 + 0.03, zz, 0, 1, 1, 1, -Math.PI / 2, -s * Math.atan2(ridge - wallH, W / 2)), R() < 0.25 ? grime : glass);
    }
  }
  const gable = new THREE.Shape(); gable.moveTo(-W / 2, 0.8); gable.lineTo(W / 2, 0.8); gable.lineTo(W / 2, wallH); gable.lineTo(0, ridge); gable.lineTo(-W / 2, wallH); gable.closePath();
  const gab = new THREE.ShapeGeometry(gable);
  G.add(gab, mat4(0, 0, -L / 2), glass);
  const front = new THREE.Shape(); front.moveTo(-W / 2, 0.8); front.lineTo(-1.4, 0.8); front.lineTo(-1.4, 3.0); front.lineTo(1.4, 3.0); front.lineTo(1.4, 0.8); front.lineTo(W / 2, 0.8); front.lineTo(W / 2, wallH); front.lineTo(0, ridge); front.lineTo(-W / 2, wallH); front.closePath();
  G.add(new THREE.ShapeGeometry(front), mat4(0, 0, L / 2), glass);
  M.add(new THREE.BoxGeometry(0.1, 3.0, 0.1), mat4(-1.4, 1.5, L / 2), iron); M.add(new THREE.BoxGeometry(0.1, 3.0, 0.1), mat4(1.4, 1.5, L / 2), iron); M.add(new THREE.BoxGeometry(2.9, 0.1, 0.1), mat4(0, 3.0, L / 2), iron);
  // open door leaf
  G.add(new THREE.PlaneGeometry(1.35, 2.2), mat4(-1.4 + 0.2, 1.3, L / 2 + 0.65, -1.2), glass);
  // tables, pots, candles
  const wood = pbr('wood', [0.6, 2], { color: 0x5a4a3c });
  const potM = pbr('stone', [0.5, 0.5], { color: 0x8a5a44 });
  const plantSpots = [], candles = [];
  for (const s of [-1, 1]) {
    const tx = s * 2.6;
    M.add(new THREE.BoxGeometry(1.4, 0.08, L - 3), mat4(tx, 0.92, -0.5), wood);
    for (let k = 0; k < 6; k++) for (const o of [-0.6, 0.6]) M.add(new THREE.BoxGeometry(0.07, 0.86, 0.07), mat4(tx + o, 0.5, -L / 2 + 1.5 + k * 2.4), wood);
    world.collideBox(tx, 0.55, -0.5, 1.4, 0.9, L - 3);
    for (let k = 0; k < 9; k++) {
      const pz = -L / 2 + 2 + k * 1.4 + (R() - 0.5) * 0.3;
      const px = tx + (R() - 0.5) * 0.7;
      const ps = 0.12 + R() * 0.08;
      M.add(new THREE.CylinderGeometry(ps, ps * 0.75, ps * 1.6, 14), mat4(px, 0.96 + ps * 0.8, pz), potM);
      plantSpots.push({ x: px, z: pz, y: 0.96 + ps * 1.5, s: 0.35 + R() * 0.3 });
    }
    candles.push([tx + 0.3, -4], [tx - 0.2, 1.5], [tx + 0.1, 5]);
  }
  M.build(S); G.build(S, { cast: false, receive: false });
  // glass colliders
  for (const s of [-1, 1]) world.collideBox(s * W / 2, wallH / 2 + 0.2, 0, 0.2, wallH, L);
  world.collideBox(0, wallH / 2 + 0.2, -L / 2, W, wallH, 0.2);
  world.collideBox(-2.7, wallH / 2 + 0.2, L / 2, 2.6, wallH, 0.2); world.collideBox(2.7, wallH / 2 + 0.2, L / 2, 2.6, wallH, 0.2);
  world.collideBox(0, 4.2, L / 2, 2.8, 2.4, 0.2);
  const roof = new THREE.Shape(); roof.moveTo(-W / 2 - 0.05, wallH); roof.lineTo(0, ridge + 0.05); roof.lineTo(W / 2 + 0.05, wallH); roof.lineTo(W / 2 + 0.05, wallH - 0.2); roof.lineTo(0, ridge - 0.15); roof.lineTo(-W / 2 - 0.05, wallH - 0.2); roof.closePath();
  const rg = new THREE.ExtrudeGeometry(roof, { depth: L, bevelEnabled: false }); rg.translate(0, 0, -L / 2);
  world.collide(rg);
  // plants on tables
  const plantPlaces = plantSpots.map((p) => ({ ...p }));
  const fm = ferns(world, plantPlaces, { color: 0x6e8a58, scale: 1 });
  plantPlaces.forEach((p, i) => fm.setMatrixAt(i, mat4(p.x, p.y, p.z, i * 1.3, p.s)));
  // big potted plants on the floor
  ferns(world, [{ x: -3.4, z: 6.8, s: 1.3 }, { x: 3.4, z: -6.8, s: 1.4 }, { x: 3.3, z: 6.5, s: 1.1 }].map((p) => ({ ...p })), { color: 0x5e7a4c });
  // hanging vines from the roof
  const vineM = cardMat('mossStrand', { color: 0x7a9a5a, alphaTest: 0.3 });
  hangSway(vineM, 0.08);
  const V = new Merger();
  for (let i = 0; i < 40; i++) {
    const zz = -L / 2 + 0.5 + R() * (L - 1), xx = (R() - 0.5) * (W - 1.5);
    const top = wallH + (ridge - wallH) * (1 - Math.abs(xx) / (W / 2)) - 0.1;
    const l = 0.8 + R() * 1.8;
    const g = new THREE.PlaneGeometry(0.5, l, 1, 4); g.translate(0, -l / 2, 0);
    V.add(g, mat4(xx, top, zz, R() * 6), vineM);
  }
  V.build(S);
  // candles
  const wax = new THREE.MeshStandardMaterial({ color: 0xe8dcc8, roughness: 0.6 });
  const flameM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa040).multiplyScalar(8) });
  candles.forEach(([cx, cz], i) => {
    const h = 0.12 + R() * 0.12;
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.032, h, 14), wax); c.position.set(cx, 0.96 + h / 2, cz); S.add(c);
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), flameM); f.scale.y = 2.4; f.position.set(cx, 0.96 + h + 0.025, cz); S.add(f);
    const gl = glowSprite(0xff9a40, 0.5, 0.6); gl.position.copy(f.position); S.add(gl);
    if (i % 2 === 0) {
      const l = new THREE.PointLight(0xff9040, 2.2, 7, 1.8); l.position.copy(f.position).y += 0.05; S.add(l);
      const base = 2.2 + R();
      world.onUpdate(() => { const t = U.time.value; const k = 0.82 + 0.18 * Math.sin(t * 11 + i) * Math.sin(t * 5.3 + i * 2); l.intensity = base * k; f.scale.y = 2.4 * k; gl.material.opacity = 0.6 * k; });
      world.lampLights.push({ pos: f.position.clone(), color: new THREE.Color(0xff9040).multiplyScalar(0.4) });
      world.sources.push({ type: 'fire', pos: f.position.clone() });
    }
  });
  // exterior
  conifers(world, scatter(140, 82, 170, (x, z) => Math.hypot(x, z) > 14), { variants: 3, seed: 51, foliageColor: 0x6e7c6a, collideR: 70 });
  ferns(world, scatter(400, 83, 110, (x, z) => (Math.abs(x) > W / 2 + 0.6 || Math.abs(z) > L / 2 + 0.6) && !(Math.abs(x) < 1.6 && z > L / 2 && z < L / 2 + 8)), { color: 0x6e8258 });
  clumps(world, scatter(500, 84, 100, (x, z) => Math.abs(x) > W / 2 + 0.3 || Math.abs(z) > L / 2 + 0.3), { tex: 'grass', color: 0x5a6a48, w: 0.8, h: 0.5 });
  rocks(world, scatter(20, 85, 80, (x, z) => Math.hypot(x, z) > 12), { mossy: 0.7 });
  streetLamp(world, 3.8, L / 2 + 2.5, { y: H(3.8, L / 2 + 2.5), height: 2.6, intensity: 12, distance: 14, color: 0xffb060 });
  { const hl = new THREE.PointLight(0xffa860, 7, 14, 1.8); hl.position.set(0, ridge - 0.9, -1); S.add(hl);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb060).multiplyScalar(6) })); bulb.position.copy(hl.position); S.add(bulb);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.85, 4), new THREE.MeshBasicMaterial({ color: 0x111111 })); cord.position.set(0, ridge - 0.45, -1); S.add(cord);
    const gs = glowSprite(0xffa860, 2.2, 0.35); gs.position.copy(hl.position); S.add(gs); world.lampLights.push({ pos: hl.position.clone(), color: new THREE.Color(0xffa860) }); }
  fireflies(world, new THREE.Vector3(0, 0, 0), 30, 50, 0xd0ff80, [0.5, 3]);
  rain(world, { count: 5000, opacity: 0.18, speed: 10 });
  mist(world, { count: 40, area: 100, y: 1, color: 0x6a7676, opacity: 0.1 });
  boundary(world, 0, 0, 55);
  world.spawn = { pos: new THREE.Vector3(0.5, H(0.5, L / 2 + 9) + 0.2, L / 2 + 9), yaw: 0, pitch: 0.02 };
  world.surface = (x, z) => (Math.abs(x) < W / 2 && Math.abs(z) < L / 2 ? 'stone' : 'leaves');
  world.ambience = { glass: 0.35, rain: 0.35, night: 0.35 };
  world.tweak = { exposure: 1.05, bloom: 1.1 };
}

export const SCENES = [
  { id: 'forest', name: '雨林', build: buildForest, tint: ['#20282a', '#3a3328', '#c9934f'] },
  { id: 'river', name: '雾河', build: buildRiver, tint: ['#9aa1a2', '#4c524e', '#2a2e2c'] },
  { id: 'snow', name: '雪径', build: buildSnow, tint: ['#2a221c', '#6a5038', '#e0b070'] },
  { id: 'alley', name: '雨巷', build: buildAlley, tint: ['#1a1d22', '#3a3a40', '#d8a060'] },
  { id: 'lake', name: '湖畔', build: buildLake, tint: ['#0e141a', '#2c3540', '#a8b8d0'] },
  { id: 'glass', name: '温室', build: buildGreenhouse, tint: ['#141a1a', '#3a4a40', '#e09a50'] },
];

export function buildScene(index, renderer) {
  const world = new World(renderer);
  SCENES[index].build(world);
  world.buildOctree();
  return world;
}

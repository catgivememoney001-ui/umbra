import * as THREE from 'three';
import { U } from './world.js';
import { PENDING } from './textures.js';
import { SCENES, buildScene } from './scenes.js';
import { Post } from './post.js';
import { Player } from './player.js';
import { Audio } from './audio.js';
import { Menu, loadSettings, saveSettings } from './ui.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#c');
const settings = loadSettings();

/* ---------- renderer ---------- */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
renderer.shadowMap.enabled = settings.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.05, 1200);
const audio = new Audio();
const player = new Player(camera, audio);
let post = null, world = null, current = 0;

function pixelRatio() { return Math.min(devicePixelRatio, 2) * settings.scale; }
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  if (post) post.setSize(w, h, pixelRatio());
}
addEventListener('resize', resize);

/* ---------- state ---------- */
let state = 'loading'; // loading | landing | intro | playing | menu | switching
const ui = { xh: $('#xh'), landing: $('#landing'), veil: $('#veil'), bar: $('#bar') };
let intro = null;
let menuOpenedAt = 0;

/* ---------- settings ---------- */
function applySettings() {
  saveSettings(settings);
  if (post) { post.setStyle(settings.style); post.dofEnabled = settings.dof; }
  if (renderer.shadowMap.enabled !== settings.shadows) {
    renderer.shadowMap.enabled = settings.shadows;
    world && world.scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.needsUpdate = true)); });
  }
  if (Math.abs(renderer.getPixelRatio() - pixelRatio()) > 0.001) resize();
  camera.fov = settings.fov; camera.updateProjectionMatrix();
  player.sens = settings.sens; player.invertY = settings.invertY; player.shake = settings.shake;
  ui.xh.dataset.type = settings.crosshair;
  audio.vol = { ...settings.vol }; audio.applyVolume();
}

const menu = new Menu(settings, SCENES, {
  resume: () => resume(),
  scene: (i) => { audio.ui(); if (i === current) { resume(); return; } switchTo(i); },
  change: () => applySettings(),
  hover: () => audio.ui(),
  current: () => current,
});

/* ---------- landing ---------- */
const tilesRow = $('#tiles');
SCENES.forEach((_, i) => {
  const t = menu.sceneTile(i, (k) => enter(k));
  tilesRow.appendChild(t);
});

/* ---------- input ---------- */
const actionOf = (code) => Object.keys(settings.binds).find((a) => settings.binds[a] === code);
addEventListener('keydown', (e) => {
  if (menu.capturing) return;
  if (e.code === 'Escape') {
    if (state === 'menu' && performance.now() - menuOpenedAt > 350) resume();
    else if (state === 'playing' && !document.pointerLockElement) openMenu();
    return;
  }
  const a = actionOf(e.code);
  if (!a) return;
  if (state === 'playing') e.preventDefault();
  if (a === 'light' && !e.repeat && state === 'playing') player.cycleLight();
  else if (a === 'climb' && !e.repeat && state === 'playing') player.tryClimb();
  else player.actions[a] = true;
});
addEventListener('keyup', (e) => { const a = actionOf(e.code); if (a) player.actions[a] = false; });
addEventListener('blur', () => { player.actions = {}; });

let dragging = false;
document.addEventListener('mousemove', (e) => {
  if (state !== 'playing' && state !== 'intro') return;
  if (document.pointerLockElement === canvas) player.look(e.movementX, e.movementY);
  else if (dragging) player.look(e.movementX * 1.2, e.movementY * 1.2);
});
canvas.addEventListener('mousedown', () => {
  if (state === 'playing') { if (!document.pointerLockElement) lock(); dragging = true; }
});
addEventListener('mouseup', () => (dragging = false));
// touch: drag to look
let lastTouch = null;
canvas.addEventListener('touchmove', (e) => {
  if (state !== 'playing') return;
  const t = e.touches[0];
  if (lastTouch) player.look((t.clientX - lastTouch.x) * 2, (t.clientY - lastTouch.y) * 2);
  lastTouch = { x: t.clientX, y: t.clientY };
}, { passive: true });
canvas.addEventListener('touchend', () => (lastTouch = null));

function lock() {
  try {
    const p = canvas.requestPointerLock({ unadjustedMovement: true });
    if (p && p.catch) p.catch(() => { try { const q = canvas.requestPointerLock(); if (q && q.catch) q.catch(() => {}); } catch (e) { } });
  } catch (e) { try { canvas.requestPointerLock(); } catch (e2) { } }
}
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (!locked && state === 'playing') openMenu();
});

function openMenu() {
  state = 'menu'; menuOpenedAt = performance.now();
  player.enabled = false; player.actions = {};
  menu.open();
  document.body.classList.add('paused');
  ui.xh.classList.add('hide');
}
function resume() {
  if (state !== 'menu') return;
  menu.close();
  document.body.classList.remove('paused');
  state = 'playing'; player.enabled = true;
  ui.xh.classList.remove('hide');
  lock();
}

/* ---------- world management ---------- */
async function loadWorld(i, onProgress = null) {
  PENDING.length = 0;
  let w;
  try { w = buildScene(i, renderer); } catch(e) { console.error('buildScene failed:', e); throw e; }
  // wait for scanned models & textures (bounded) so nothing pops in
  const jobs = [...w.pending, ...PENDING];
  let done = 0;
  jobs.forEach((j) => Promise.resolve(j).finally(() => { done++; if (onProgress) onProgress(done / jobs.length); }));
  await Promise.race([Promise.allSettled(jobs), new Promise((r) => setTimeout(r, 30000))]);
  await Promise.race([Promise.allSettled([...PENDING]), new Promise((r) => setTimeout(r, 8000))]);
  w.buildOctree();
  if (world) { world.scene.remove(camera); world.dispose(); }
  world = w;
  current = i;
  world.scene.add(camera);
  player.setWorld(world);
  audio.wet = !!world.wet;
  if (!post) { post = new Post(renderer, world.scene, camera); resize(); post.setStyle(settings.style, true); post.dofEnabled = settings.dof; }
  post.setScene(world.scene);
  // positional sources: nearest few lamp hums + all others
  const hums = world.sources.filter((s) => s.type === 'hum').sort((a, b) => a.pos.distanceTo(world.spawn.pos) - b.pos.distanceTo(world.spawn.pos)).slice(0, 5);
  const rest = world.sources.filter((s) => s.type !== 'hum').slice(0, 6);
  audio.setAmbience(world.ambience, [...hums, ...rest, ...(world.extraSources || [])]);
  renderer.compile(world.scene, camera);
}

const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const tmpQ = new THREE.Quaternion(), tmpP = new THREE.Vector3();

function startIntro(fromPos, fromQuat, dur = 3.2) {
  state = 'intro';
  player.enabled = false;
  intro = { t: 0, dur, fromPos: fromPos.clone(), fromQuat: fromQuat.clone() };
  ui.xh.classList.add('hide');
}

function enter(i) {
  try { enterInner(i); } catch (e) { reportError(e); }
}
function enterInner(i) {
  audio.start();
  audio.whoosh();
  lock();
  ui.landing.classList.add('gone');
  document.body.classList.remove('landing');
  if (i === current && world) {
    startIntro(camera.position, camera.quaternion, 3.0);
  } else {
    fadeSwitch(i, true);
  }
}

function switchTo(i) {
  menu.close();
  document.body.classList.remove('paused');
  fadeSwitch(i, false);
  lock();
}

function captureThumb() {
  const c = document.createElement('canvas'); c.width = 320; c.height = 200;
  const g = c.getContext('2d');
  const sw = canvas.width, sh = canvas.height, ar = 320 / 200;
  let w = sw, h = sw / ar; if (h > sh) { h = sh; w = sh * ar; }
  g.drawImage(canvas, (sw - w) / 2, (sh - h) / 2, w, h, 0, 0, 320, 200);
  menu.setThumb(current, c);
}

function fadeSwitch(i, fromLanding) {
  state = 'switching';
  ui.xh.classList.add('hide');
  audio.whoosh && audio.whoosh();
  const t0 = performance.now();
  const fadeOut = () => {
    const k = Math.min(1, (performance.now() - t0) / 700);
    post.black = ease(k); post.extraBlur = ease(k) * 1.2; post.letterAnim = ease(k) * 0.08;
    if (k < 1) requestAnimationFrame(fadeOut);
    else {
      ui.veil.classList.add('on');
      setTimeout(async () => {
        document.body.classList.add('loading');
        try { await loadWorld(i, (k) => { ui.bar.style.transform = `scaleX(${k})`; }); } catch (e) { reportError(e); document.body.classList.remove('loading'); return; }
        document.body.classList.remove('loading');
        ui.bar.style.transform = 'scaleX(0)';
        const s = world.spawn;
        const back = new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw)).multiplyScalar(3.5);
        const from = s.pos.clone().add(back).add(new THREE.Vector3(0, 2.6, 0));
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.18, s.yaw + 0.25, 0.04, 'YXZ'));
        startIntro(from, q, 3.4);
        ui.veil.classList.remove('on');
      }, 60);
    }
  };
  fadeOut();
}

function reportError(e) {
  console.error(e);
  const d = document.getElementById('dbg2');
  if (d) d.textContent = 'BOOT ' + (e && e.stack || e);
}

/* ---------- landing drift camera ---------- */
function landingCamera(t) {
  const s = world.spawn;
  const a = s.yaw + Math.sin(t * 0.05) * 0.25 + 0.2;
  const r = 5 + Math.sin(t * 0.07) * 1.2;
  camera.position.set(s.pos.x + Math.sin(a) * r, s.pos.y + 2.4 + Math.sin(t * 0.09) * 0.3, s.pos.z + Math.cos(a) * r);
  camera.rotation.set(-0.12 + Math.sin(t * 0.11) * 0.03, a - 0.1, Math.sin(t * 0.06) * 0.015, 'YXZ');
}

/* ---------- loop ---------- */
const clock = new THREE.Clock();
let focusAccum = 0, captured = new Set();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 1 / 20);
  U.time.value += dt;
  const t = U.time.value;
  if (!world) return;

  if (state === 'landing') {
    landingCamera(t);
    post.extraBlur += (1.1 - post.extraBlur) * (1 - Math.exp(-dt * 2));
    post.focusTarget = 4;
  } else if (state === 'intro') {
    player.update(dt);
    tmpP.copy(camera.position); tmpQ.copy(camera.quaternion);
    intro.t += dt;
    const k = Math.min(1, intro.t / intro.dur), e = ease(k);
    camera.position.lerpVectors(intro.fromPos, tmpP, e);
    camera.quaternion.slerpQuaternions(intro.fromQuat, tmpQ, e);
    post.black = Math.max(0, 1 - k * 2.2);
    post.extraBlur = Math.max(0, 1.2 * (1 - ease(Math.min(1, k * 1.25))));
    post.letterAnim = 0.08 * (1 - ease(Math.min(1, k * 1.1)));
    post.focusTarget = player.aim();
    if (k >= 1) {
      state = document.pointerLockElement === canvas || !('pointerLockElement' in document) ? 'playing' : 'playing';
      player.enabled = true;
      ui.xh.classList.remove('hide');
      post.black = 0; post.extraBlur = 0; post.letterAnim = 0;
      if (!captured.has(current)) { captured.add(current); setTimeout(() => { captureNext = true; }, 1500); }
    }
  } else if (state === 'playing' || state === 'menu') {
    player.update(dt);
    focusAccum += dt;
    post.focusTarget = player.aim();
    ui.xh.classList.toggle('climb', player.climbable);
    ui.xh.classList.toggle('gripping', player.mode !== 'walk');
    if (state === 'menu') post.extraBlur += (0.9 - post.extraBlur) * (1 - Math.exp(-dt * 5));
    else post.extraBlur += (0 - post.extraBlur) * (1 - Math.exp(-dt * 6));
  }

  // moon shadow follows the viewer
  if (world.sun) {
    const c = camera.position;
    world.sun.position.copy(c).addScaledVector(world.sun.userData.dir, 70);
    world.sun.target.position.copy(c);
  }
  const flashPos = new THREE.Vector3(); player.spot.getWorldPosition(flashPos);
  const flashDir = new THREE.Vector3(); camera.getWorldDirection(flashDir);
  world.update(dt, { camera, flash: { pos: flashPos, dir: flashDir, on: player.hold[0] } });
  audio.listener(camera);
  post.update(dt, t, world.tweak);
  post.render(dt);
  if (captureNext && state === 'playing') { captureNext = false; captureThumb(); }
}
let captureNext = false;

/* ---------- boot ---------- */
async function boot() {
  applySettings();
  ui.bar.style.transform = 'scaleX(0.15)';
  await new Promise((r) => setTimeout(r, 30));
  ui.bar.style.transform = 'scaleX(0.4)';
  await new Promise((r) => setTimeout(r, 30));
  const hm = /^#s(\d)$/.exec(location.hash);
  await loadWorld(hm ? Math.min(+hm[1], SCENES.length - 1) : 0, (k) => { ui.bar.style.transform = `scaleX(${0.4 + k * 0.6})`; });
  ui.bar.style.transform = 'scaleX(1)';
  state = 'landing';
  post.extraBlur = 1.1;
  post.black = 1;
  frame();
  // fade in from black
  const t0 = performance.now();
  const fade = () => { const k = Math.min(1, (performance.now() - t0) / 1800); post.black = 1 - ease(k); if (k < 1) requestAnimationFrame(fade); };
  fade();
  setTimeout(() => document.body.classList.add('ready'), 300);
  window.__umbra = { renderer, camera, player, get world() { return world; }, get state() { return state; }, enter, switchTo, post, skip: () => { if (intro) intro.t = intro.dur; } };
}
boot().catch((e) => { console.error(e); document.body.classList.add('ready'); });

import * as THREE from 'three';
import { Capsule } from 'three/addons/math/Capsule.js';
import { card } from './textures.js';

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _ray = new THREE.Ray();

export class Player {
  constructor(camera, audio) {
    this.camera = camera;
    this.audio = audio;
    this.R = 0.32;
    this.standH = 1.12; // capsule segment length
    this.capsule = new Capsule(new THREE.Vector3(0, this.R, 0), new THREE.Vector3(0, this.R + this.standH, 0), this.R);
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.yawT = 0; this.pitchT = 0;
    this.onFloor = false; this.grounded = 0; this.floorNormal = new THREE.Vector3(0, 1, 0);
    this.mode = 'walk';
    this.crouch = 0;
    this.bob = 0; this.bobAmp = 0; this.landDip = 0; this.landVel = 0; this.roll = 0;
    this.lastStep = 0;
    this.sens = 1; this.invertY = false; this.shake = 1;
    this.enabled = false;
    this.actions = {};
    this.lightMode = 0; // 0 off, 1 flashlight, 2 lantern
    this.climbable = false;
    this.aimDist = 30;
    this.buildHeld();
  }

  /* ---------- held light sources ---------- */
  buildHeld() {
    const cam = this.camera;
    this.held = new THREE.Group();
    cam.add(this.held);
    const metal = new THREE.MeshStandardMaterial({ color: 0x1d1f22, metalness: 0.85, roughness: 0.38 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    // flashlight
    const fl = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.2, 20), metal); body.rotation.x = Math.PI / 2;
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.019, 0.06, 24), metal); head.rotation.x = Math.PI / 2; head.position.z = -0.12;
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.0195, 0.0195, 0.07, 20), rubber); grip.rotation.x = Math.PI / 2; grip.position.z = 0.04;
    this.lensMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.027, 24), this.lensMat); lens.position.z = -0.151; lens.rotation.y = Math.PI;
    fl.add(body, head, grip, lens);
    fl.position.set(0.17, -0.16, -0.32);
    this.spot = new THREE.SpotLight(0xfff1dc, 0, 50, 0.45, 0.6, 1.5);
    this.spot.map = card('cookie');
    this.spot.castShadow = true;
    this.spot.shadow.mapSize.set(1024, 1024);
    this.spot.shadow.bias = -0.0008; this.spot.shadow.camera.near = 0.2; this.spot.shadow.camera.far = 40;
    this.spot.position.set(0, 0, -0.15);
    this.spot.target.position.set(0, 0, -5);
    fl.add(this.spot, this.spot.target);
    this.flash = fl;
    // oil lantern
    const ln = new THREE.Group();
    const brass = new THREE.MeshStandardMaterial({ color: 0x6a5233, metalness: 0.9, roughness: 0.35 });
    const glass = new THREE.MeshStandardMaterial({ color: 0xfff2d8, transparent: true, opacity: 0.22, roughness: 0.05, depthWrite: false });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.03, 24), brass);
    const glob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 24, 16), glass); glob.scale.y = 1.35; glob.position.y = 0.07;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.04, 24), brass); cap.position.y = 0.14;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.003, 6, 24, Math.PI), brass); handle.position.y = 0.16;
    for (let i = 0; i < 4; i++) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.12, 6), brass);
      const a = (i / 4) * Math.PI * 2; bar.position.set(Math.cos(a) * 0.05, 0.075, Math.sin(a) * 0.05); ln.add(bar);
    }
    this.flame = new THREE.Mesh(new THREE.SphereGeometry(0.009, 12, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa040).multiplyScalar(8) }));
    this.flame.scale.set(1, 2.2, 1); this.flame.position.y = 0.065;
    const fglow = new THREE.Sprite(new THREE.SpriteMaterial({ map: card('glow'), color: 0xff9a3a, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    fglow.scale.setScalar(0.18); fglow.position.y = 0.07;
    this.fglow = fglow;
    ln.add(base, glob, cap, handle, this.flame, fglow);
    this.lamp = new THREE.PointLight(0xff9a48, 0, 14, 1.8);
    this.lamp.position.y = 0.07;
    this.lamp.castShadow = false;
    ln.add(this.lamp);
    ln.position.set(-0.2, -0.27, -0.42);
    this.lantern = ln;
    this.held.add(fl, ln);
    this.hold = [0, 0]; // raise amount for flashlight / lantern
    this.flash.visible = this.lantern.visible = false;
  }

  cycleLight() {
    this.lightMode = (this.lightMode + 1) % 3;
    this.audio.click(this.lightMode !== 0);
  }

  setWorld(world) {
    this.world = world;
    const s = world.spawn;
    this.teleport(s.pos, s.yaw, s.pitch);
  }
  teleport(pos, yaw = 0, pitch = 0) {
    this.capsule.start.set(pos.x, pos.y + this.R, pos.z);
    this.capsule.end.set(pos.x, pos.y + this.R + this.standH, pos.z);
    this.vel.set(0, 0, 0);
    this.yaw = this.yawT = yaw; this.pitch = this.pitchT = pitch;
    this.mode = 'walk';
    this.settle();
  }
  settle() {
    // drop onto ground
    for (let i = 0; i < 60; i++) {
      this.capsule.translate(_v.set(0, -0.05, 0));
      const r = this.world.octree.capsuleIntersect(this.capsule);
      if (r) { this.capsule.translate(r.normal.multiplyScalar(r.depth)); if (r.normal.y > 0.5) break; }
    }
  }
  eyePos(out) {
    return out.copy(this.capsule.end).add(_v2.set(0, 0.18, 0));
  }

  look(dx, dy) {
    const k = 0.0021 * this.sens;
    this.yawT -= dx * k;
    this.pitchT -= dy * k * (this.invertY ? -1 : 1);
    this.pitchT = Math.max(-1.52, Math.min(1.52, this.pitchT));
  }

  ray(origin, dir, max) {
    _ray.origin.copy(origin); _ray.direction.copy(dir);
    const r = this.world.octree.rayIntersect(_ray);
    return r && r.distance <= max ? r : null;
  }

  wallProbe(maxDist = 1.15) {
    // horizontal forward probe from chest height
    const dir = _v.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const o = new THREE.Vector3().copy(this.capsule.start).lerp(this.capsule.end, 0.6);
    // look-direction probe too (so aiming at trunk works)
    const ld = new THREE.Vector3(); this.camera.getWorldDirection(ld);
    const eye = this.eyePos(new THREE.Vector3());
    const tries = [[o, dir], [eye, ld]];
    for (const [org, d] of tries) {
      const hit = this.ray(org, d, maxDist + this.R);
      if (hit) {
        const n = hit.triangle.getNormal(new THREE.Vector3());
        if (Math.abs(n.y) < 0.65) { n.y = 0; n.normalize(); return { hit, n }; }
      }
    }
    return null;
  }

  tryClimb() {
    if (this.mode === 'climb') { this.release(false); return; }
    const p = this.wallProbe();
    if (!p) return;
    this.mode = 'climb';
    this.wallN = p.n.clone();
    this.vel.set(0, 0, 0);
    this.audio.grip();
    this.climbPhase = 0;
  }
  release(jump) {
    this.mode = 'walk';
    if (jump && this.wallN) this.vel.copy(this.wallN).multiplyScalar(3.2).add(_v.set(0, 4.2, 0));
  }

  update(dt, input) {
    const a = this.actions;
    const t = 1 - Math.exp(-dt * 28);
    this.yaw += (this.yawT - this.yaw) * t;
    this.pitch += (this.pitchT - this.pitch) * t;
    const lookVel = (this.yawT - this.yaw) * 60;

    if (this.mode === 'climb') this.updateClimb(dt);
    else if (this.mode === 'mantle') this.updateMantle(dt);
    else this.updateWalk(dt);

    // camera
    const eye = this.eyePos(_v);
    const amp = this.bobAmp * this.shake;
    const bobY = Math.sin(this.bob * 2) * 0.045 * amp;
    const bobX = Math.sin(this.bob) * 0.03 * amp;
    // spring for landing dip
    this.landVel += (-this.landDip * 90 - this.landVel * 12) * dt;
    this.landDip += this.landVel * dt;
    const strafe = (a.right ? 1 : 0) - (a.left ? 1 : 0);
    this.roll += ((-strafe * 0.018 - lookVel * 0.0025) * this.shake + Math.sin(this.bob) * 0.006 * amp - this.roll) * (1 - Math.exp(-dt * 6));
    const breathe = Math.sin(performance.now() * 0.0011) * 0.006 * this.shake;
    this.camera.position.set(eye.x + Math.cos(this.yaw) * bobX, eye.y + bobY + this.landDip + breathe - this.crouch * 0.55, eye.z - Math.sin(this.yaw) * bobX);
    this.camera.rotation.set(this.pitch + breathe * 0.3, this.yaw, this.roll, 'YXZ');

    // held lights
    const wantF = this.lightMode === 1 ? 1 : 0, wantL = this.lightMode === 2 ? 1 : 0;
    this.hold[0] += (wantF - this.hold[0]) * (1 - Math.exp(-dt * 7));
    this.hold[1] += (wantL - this.hold[1]) * (1 - Math.exp(-dt * 7));
    const swayX = -lookVel * 0.0015, swayY = (this.pitchT - this.pitch) * 0.2;
    this.flash.visible = this.hold[0] > 0.01;
    this.lantern.visible = this.hold[1] > 0.01;
    this.flash.position.set(0.17 + swayX + bobX * 0.4, -0.16 - (1 - this.hold[0]) * 0.35 + bobY * 0.5 + swayY, -0.32);
    this.flash.rotation.set((1 - this.hold[0]) * -0.6 + bobY * 0.4, swayX * 2, 0);
    this.lantern.position.set(-0.2 + swayX * 1.4, -0.27 - (1 - this.hold[1]) * 0.4 + bobY * 0.8 + swayY, -0.42);
    this.lantern.rotation.set(0, 0, -swayX * 4 + Math.sin(this.bob) * 0.06 * amp);
    const flick = 0.85 + 0.15 * Math.sin(performance.now() * 0.013) * Math.sin(performance.now() * 0.0071 + 1);
    this.spot.intensity = 140 * Math.pow(this.hold[0], 2);
    this.lensMat.color.setScalar(0.15 + this.hold[0] * 1.3);
    this.lamp.intensity = 2.6 * this.hold[1] * flick;
    this.flame.scale.set(1, 2.2 * flick, 1);
    this.fglow.material.opacity = 0.5 * this.hold[1] * flick;
  }

  updateWalk(dt) {
    const a = this.actions, w = this.world;
    const fwd = _v.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = _v2.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = new THREE.Vector3();
    if (this.enabled) {
      if (a.forward) wish.add(fwd); if (a.back) wish.sub(fwd);
      if (a.right) wish.add(right); if (a.left) wish.sub(right);
    }
    if (wish.lengthSq() > 0) wish.normalize();
    // crouch
    const wantCrouch = this.enabled && a.crouch ? 1 : 0;
    if (!wantCrouch && this.crouch > 0.05) {
      // check headroom
      const head = this.ray(this.capsule.end, UP, 0.7);
      if (!head) this.crouch += (0 - this.crouch) * (1 - Math.exp(-dt * 8));
    } else this.crouch += (wantCrouch - this.crouch) * (1 - Math.exp(-dt * 8));

    const feetY = this.capsule.start.y - this.R;
    const wading = feetY < w.waterLevel - 0.15;
    let speed = (this.enabled && a.sprint && !wantCrouch ? 4.8 : 2.5) * (1 - this.crouch * 0.5) * (wading ? 0.55 : 1);
    if (this.grounded > 0) {
      const target = wish.multiplyScalar(speed);
      const k = 1 - Math.exp(-dt * (wish.lengthSq() ? 10 : 12));
      this.vel.x += (target.x - this.vel.x) * k;
      this.vel.z += (target.z - this.vel.z) * k;
      if (this.vel.y <= 0) this.vel.y = -1.5; // keep contact on slopes
      if (this.enabled && a.jump && !this.jumpHeld) { this.vel.y = 5.4; this.onFloor = false; this.grounded = 0; this.jumpHeld = true; }
    } else {
      this.vel.addScaledVector(wish, dt * 4);
      this.vel.y -= 18 * dt;
      this.vel.x *= 1 - dt * 0.2; this.vel.z *= 1 - dt * 0.2;
    }
    if (!a.jump) this.jumpHeld = false;

    const steps = 4, h = dt / steps;
    const wasFloor = this.onFloor; const vyBefore = this.vel.y;
    let floorHit = false;
    for (let i = 0; i < steps; i++) {
      this.capsule.translate(_v.copy(this.vel).multiplyScalar(h));
      this.collide();
      if (this.onFloor) floorHit = true;
    }
    this.onFloor = floorHit;
    this.grounded = floorHit ? 0.12 : Math.max(0, (this.grounded || 0) - dt);
    if (floorHit && this.vel.y < 0) this.vel.y = 0;
    // crouch shortens capsule
    this.capsule.end.y = this.capsule.start.y + this.standH * (1 - this.crouch * 0.42);
    if (!wasFloor && this.onFloor && vyBefore < -3) {
      const k = Math.min(1, (-vyBefore - 3) / 9);
      this.landVel -= 1.2 + k * 3;
      this.audio.land(this.surfaceHere(), k);
    }
    // fall reset
    if (this.capsule.start.y < -60) this.teleport(w.spawn.pos, this.yaw, 0);

    // bob & steps
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const moving = this.grounded > 0 && hs > 0.3;
    this.bobAmp += ((moving ? Math.min(hs / 2.5, 1.6) : 0) - this.bobAmp) * (1 - Math.exp(-dt * 6));
    if (moving) {
      const prev = this.bob;
      this.bob += dt * hs * 2.35;
      // a step when sin(2*bob) crosses its trough
      if (Math.floor((prev * 2 + Math.PI / 2) / (Math.PI * 2)) !== Math.floor((this.bob * 2 + Math.PI / 2) / (Math.PI * 2))) this.step(hs);
    }
  }

  surfaceHere() {
    const p = this.capsule.start;
    if (p.y - this.R < this.world.waterLevel - 0.05) return 'water';
    return this.world.surface(p.x, p.z, p.y - this.R);
  }
  step(hs) {
    const s = this.surfaceHere();
    this.audio.footstep(s, Math.min(1.3, 0.6 + hs * 0.15) * (1 - this.crouch * 0.5));
    if (this.world.onFootstep && (s === 'snow' || s === 'mud')) this.world.onFootstep(this.capsule.start, this.yaw);
  }

  collide() {
    const b = this.world.bounds && this.world.bounds.capsuleIntersect(this.capsule);
    if (b) { this.capsule.translate(b.normal.multiplyScalar(b.depth)); this.vel.addScaledVector(b.normal.normalize(), -Math.min(0, b.normal.dot(this.vel))); }
    const r = this.world.octree.capsuleIntersect(this.capsule);
    this.onFloor = false;
    if (r) {
      this.onFloor = r.normal.y > 0.55;
      if (this.onFloor) this.floorNormal.copy(r.normal);
      if (!this.onFloor) this.vel.addScaledVector(r.normal, -r.normal.dot(this.vel));
      else if (this.vel.y < 0) this.vel.y = 0;
      // keep horizontal position on slopes (stop sliding when idle)
      if (r.normal.y > 0.85) this.capsule.translate(_v2.set(0, r.depth / r.normal.y, 0));
      else this.capsule.translate(r.normal.multiplyScalar(r.depth));
    }
  }

  updateClimb(dt) {
    const a = this.actions;
    if (!this.enabled) return;
    if (a.jump && !this.jumpHeld) { this.jumpHeld = true; this.release(true); return; }
    if (!a.jump) this.jumpHeld = false;
    const n = this.wallN;
    const tangent = _v.crossVectors(UP, n).normalize(); // screen-right when facing the wall
    let up = (a.forward ? 1 : 0) - (a.back ? 1 : 0);
    let side = (a.right ? 1 : 0) - (a.left ? 1 : 0);
    const speed = a.sprint ? 2.0 : 1.3;
    const move = new THREE.Vector3().addScaledVector(UP, up * speed * dt).addScaledVector(tangent, side * speed * 0.8 * dt);
    // top-out check: is there wall above the head?
    if (up > 0) {
      const headO = this.eyePos(new THREE.Vector3()).add(_v2.set(0, 0.25, 0));
      const above = this.ray(headO, n.clone().negate(), this.R + 0.9);
      if (!above) {
        // look for a ledge to stand on
        const probe = this.capsule.end.clone().addScaledVector(n, -0.75).add(_v2.set(0, 1.4, 0));
        const floor = this.ray(probe, new THREE.Vector3(0, -1, 0), 2.6);
        if (floor && floor.triangle.getNormal(new THREE.Vector3()).y > 0.6) {
          this.startMantle(floor.position);
          return;
        }
        move.y = Math.min(move.y, 0); // can't go higher (thin trunk top)
      }
    }
    this.capsule.translate(move);
    // stick to the surface
    const c = new THREE.Vector3().copy(this.capsule.start).lerp(this.capsule.end, 0.5);
    const hit = this.ray(c, n.clone().negate(), this.R + 1.0);
    if (hit) {
      const nn = hit.triangle.getNormal(new THREE.Vector3());
      if (Math.abs(nn.y) < 0.75) { nn.y = 0; nn.normalize(); n.lerp(nn, 0.35).normalize(); }
      const want = hit.distance - (this.R + 0.06);
      this.capsule.translate(n.clone().multiplyScalar(-want * 0.5));
    } else {
      // lost the wall (went around an edge)
      this.release(false); return;
    }
    const r = this.world.octree.capsuleIntersect(this.capsule);
    if (r) {
      this.capsule.translate(r.normal.clone().multiplyScalar(r.depth));
      if (r.normal.y > 0.6 && up < 0) { this.release(false); return; }
    }
    const moving = Math.abs(up) + Math.abs(side) > 0;
    this.bobAmp += ((moving ? 0.6 : 0) - this.bobAmp) * (1 - Math.exp(-dt * 6));
    if (moving) {
      const prev = this.climbPhase;
      this.climbPhase += dt * 3.2;
      this.bob += dt * 2.2;
      if (Math.floor(prev) !== Math.floor(this.climbPhase)) this.audio.grip();
    }
  }

  startMantle(target) {
    this.mode = 'mantle';
    this.mantleT = 0;
    this.mantleFrom = this.capsule.start.clone();
    this.mantleTo = target.clone().add(_v.set(0, this.R + 0.05, 0));
    this.audio.grip();
  }
  updateMantle(dt) {
    this.mantleT = Math.min(1, this.mantleT + dt / 0.75);
    const e = this.mantleT;
    const up = Math.min(1, e * 1.6), fw = Math.max(0, (e - 0.35) / 0.65);
    const ease = (x) => x * x * (3 - 2 * x);
    const p = new THREE.Vector3(
      this.mantleFrom.x + (this.mantleTo.x - this.mantleFrom.x) * ease(fw),
      this.mantleFrom.y + (this.mantleTo.y - this.mantleFrom.y) * ease(up),
      this.mantleFrom.z + (this.mantleTo.z - this.mantleFrom.z) * ease(fw));
    const d = p.sub(this.capsule.start);
    this.capsule.translate(d);
    this.landDip = -Math.sin(e * Math.PI) * 0.12;
    if (this.mantleT >= 1) { this.mode = 'walk'; this.vel.set(0, 0, 0); }
  }

  // per-frame aim query: focus distance + climb affordance
  aim() {
    const eye = this.eyePos(new THREE.Vector3());
    const d = new THREE.Vector3(); this.camera.getWorldDirection(d);
    const hit = this.ray(eye, d, 120);
    this.aimDist = hit ? Math.max(0.4, hit.distance) : 60;
    this.climbable = this.mode === 'climb' || !!this.wallProbe();
    return this.aimDist;
  }
}

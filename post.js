import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

/* ---------------- depth of field (reads the render target's depth) ---------------- */
class DofPass extends Pass {
  constructor(camera) {
    super();
    this.camera = camera;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null }, tDepth: { value: null },
        uNear: { value: 0.05 }, uFar: { value: 1000 }, uFocus: { value: 10 }, uAperture: { value: 1 },
        uMaxBlur: { value: 9 }, uRes: { value: new THREE.Vector2(1, 1) }, uExtra: { value: 0 }, uEnabled: { value: 1 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `
        #include <packing>
        uniform sampler2D tColor, tDepth; uniform float uNear, uFar, uFocus, uAperture, uMaxBlur, uExtra, uEnabled; uniform vec2 uRes;
        varying vec2 vUv;
        float dist(vec2 uv){ float d = texture2D(tDepth, uv).x; return -perspectiveDepthToViewZ(d, uNear, uFar); }
        float coc(float z){
          float c = abs(z - uFocus) / max(z, 0.001) * uAperture;
          // near objects blur faster (eye-like), far ones saturate
          c *= z < uFocus ? 1.15 : 0.8;
          return clamp(c, 0.0, 1.0);
        }
        void main(){
          vec4 base = texture2D(tColor, vUv);
          if (uEnabled < 0.5 && uExtra <= 0.001) { gl_FragColor = base; return; }
          float z = dist(vUv);
          float c = (uEnabled > 0.5 ? coc(z) : 0.0);
          float r = clamp(c + uExtra, 0.0, 1.6) * uMaxBlur;
          if (r < 0.5) { gl_FragColor = base; return; }
          vec3 acc = base.rgb; float wsum = 1.0;
          const float GA = 2.39996323;
          for (int i = 1; i < 40; i++) {
            float fi = float(i);
            float rr = sqrt(fi / 40.0) * r;
            vec2 o = vec2(cos(fi * GA), sin(fi * GA)) * rr / uRes;
            vec2 suv = vUv + o;
            float sz = dist(suv);
            float sc = (uEnabled > 0.5 ? coc(sz) : 0.0) + uExtra;
            // sharp foreground shouldn't receive background bleed; blurred bg fine
            float w = sz < z ? clamp(sc * uMaxBlur / max(rr, 0.001), 0.0, 1.0) : 1.0;
            vec3 s = texture2D(tColor, suv).rgb;
            w *= 1.0 + min(dot(s, vec3(0.3,0.5,0.2)), 1.5) * 0.35; // slight bokeh highlight weighting
            acc += s * w; wsum += w;
          }
          gl_FragColor = vec4(acc / wsum, base.a);
        }`,
    });
    this.fsQuad = new FullScreenQuad(this.material);
  }
  render(renderer, writeBuffer, readBuffer) {
    const u = this.material.uniforms;
    u.tColor.value = readBuffer.texture;
    u.tDepth.value = readBuffer.depthTexture;
    u.uNear.value = this.camera.near; u.uFar.value = this.camera.far;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(renderer);
  }
  setSize(w, h) { this.material.uniforms.uRes.value.set(w, h); }
}

/* ---------------- final grade (display space) ---------------- */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
    uExposure: { value: 1 }, uContrast: { value: 1.06 }, uSat: { value: 0.78 }, uSatVar: { value: 0.6 },
    uShadow: { value: new THREE.Vector3(0, 0, 0) }, uHigh: { value: new THREE.Vector3(0, 0, 0) },
    uVignette: { value: 0.35 }, uGrain: { value: 0.035 }, uGrainSize: { value: 1.0 }, uAberr: { value: 0.6 },
    uLetter: { value: 0 }, uHalation: { value: 0.15 }, uFade: { value: 0.0 }, uWeave: { value: 0 }, uFlicker: { value: 0 },
    uBlack: { value: 0 }, uWarm: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes;
    uniform float uExposure, uContrast, uSat, uSatVar, uVignette, uGrain, uGrainSize, uAberr, uLetter, uHalation, uFade, uWeave, uFlicker, uBlack, uWarm;
    uniform vec3 uShadow, uHigh;
    varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
    void main(){
      vec2 uv = vUv;
      if (uWeave > 0.0) uv += vec2(n(vec2(uTime*3.0, 1.0)) - 0.5, n(vec2(2.0, uTime*2.3)) - 0.5) * 0.0012 * uWeave;
      vec2 cd = uv - 0.5;
      float r2 = dot(cd, cd);
      vec2 ao = cd * r2 * 0.012 * uAberr;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + ao).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - ao).b;
      // halation: red bloom around bright areas
      if (uHalation > 0.0) {
        vec3 hl = vec3(0.0);
        for (int i = 0; i < 8; i++) {
          float a = float(i) * 0.785398;
          vec3 s = texture2D(tDiffuse, uv + vec2(cos(a), sin(a)) * 7.0 / uRes).rgb;
          hl += max(s - 0.62, 0.0);
        }
        col += vec3(1.0, 0.35, 0.18) * hl * 0.12 * uHalation;
      }
      col *= uExposure;
      float L = dot(col, vec3(0.2126, 0.7152, 0.0722));
      // split toning
      col += uShadow * (1.0 - smoothstep(0.0, 0.45, L)) * 0.12;
      col += uHigh * smoothstep(0.35, 1.0, L) * 0.12;
      col.r += uWarm * 0.5; col.b -= uWarm * 0.5;
      // local saturation: warm highlights keep colour, cool shadows recede, slow spatial drift
      float warm = clamp((col.r - col.b) * 3.0, 0.0, 1.0);
      float drift = n(uv * 2.2 + vec2(uTime * 0.02, -uTime * 0.015)) - 0.5;
      float sat = uSat * (1.0 + uSatVar * (smoothstep(0.25, 0.85, L) * warm * 0.9 - (1.0 - smoothstep(0.0, 0.25, L)) * 0.35 + drift * 0.35));
      L = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(L), col, sat);
      // contrast around mid grey
      col = (col - 0.5) * uContrast + 0.5;
      col = mix(col, vec3(0.06, 0.065, 0.07) + col * 0.94, uFade);
      // vignette
      float vig = smoothstep(0.85, 0.2, length(cd * vec2(1.0, 0.85)));
      col *= mix(1.0, vig, uVignette);
      if (uFlicker > 0.0) col *= 1.0 + (n(vec2(uTime * 18.0, 0.0)) - 0.5) * uFlicker;
      // grain (luma weighted, animated)
      vec2 gp = floor(gl_FragCoord.xy / uGrainSize);
      float g = h(gp + fract(uTime * 7.31) * 113.0) + h(gp * 1.7 + fract(uTime * 3.7) * 71.0) - 1.0;
      col += g * uGrain * (0.4 + 0.6 * (1.0 - abs(L - 0.45) * 1.6));
      // letterbox
      float lb = uLetter;
      float edge = smoothstep(lb, lb + 0.002, vUv.y) * smoothstep(lb, lb + 0.002, 1.0 - vUv.y);
      col *= edge;
      col *= 1.0 - uBlack;
      // dither
      col += (h(gl_FragCoord.xy + uTime) - 0.5) / 255.0;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

export const STYLES = {
  default: { sat: 0.8, satVar: 0.65, contrast: 1.07, vignette: 0.38, grain: 0.03, grainSize: 1, aberr: 0.6, letter: 0, halation: 0.18, fade: 0.02, weave: 0, flicker: 0, shadow: [-0.1, 0.05, 0.25], high: [0.3, 0.12, -0.15], warm: 0, bloom: 0.55, aperture: 1.0, exposure: 1.0 },
  vivid: { sat: 1.18, satVar: 0.35, contrast: 1.1, vignette: 0.3, grain: 0.02, grainSize: 1, aberr: 0.4, letter: 0, halation: 0.12, fade: 0, weave: 0, flicker: 0, shadow: [-0.05, 0.05, 0.2], high: [0.25, 0.1, -0.1], warm: 0, bloom: 0.6, aperture: 1.0, exposure: 1.05 },
  muted: { sat: 0.45, satVar: 0.9, contrast: 1.0, vignette: 0.42, grain: 0.035, grainSize: 1, aberr: 0.5, letter: 0, halation: 0.12, fade: 0.06, weave: 0, flicker: 0, shadow: [-0.05, 0.05, 0.15], high: [0.15, 0.08, 0.0], warm: 0, bloom: 0.5, aperture: 1.0, exposure: 1.0 },
  film: { sat: 0.72, satVar: 0.6, contrast: 1.04, vignette: 0.55, grain: 0.085, grainSize: 1.6, aberr: 0.8, letter: 0, halation: 0.6, fade: 0.08, weave: 1, flicker: 0.025, shadow: [-0.05, 0.25, 0.12], high: [0.35, 0.18, -0.05], warm: 0.012, bloom: 0.65, aperture: 1.1, exposure: 1.02 },
  cinema: { sat: 0.7, satVar: 0.8, contrast: 1.16, vignette: 0.5, grain: 0.035, grainSize: 1.2, aberr: 1.0, letter: 0.11, halation: 0.3, fade: 0.03, weave: 0, flicker: 0, shadow: [-0.25, 0.1, 0.4], high: [0.45, 0.18, -0.25], warm: 0, bloom: 0.75, aperture: 1.35, exposure: 1.0 },
  real: { sat: 0.95, satVar: 0.15, contrast: 1.02, vignette: 0.15, grain: 0.01, grainSize: 1, aberr: 0.15, letter: 0, halation: 0.0, fade: 0, weave: 0, flicker: 0, shadow: [0, 0, 0.05], high: [0.05, 0.02, 0], warm: 0, bloom: 0.4, aperture: 0.6, exposure: 1.0 },
};

export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer; this.camera = camera;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType });
    rt.depthTexture = new THREE.DepthTexture(size.x, size.y);
    rt.depthTexture.type = THREE.UnsignedIntType;
    this.composer = new EffectComposer(renderer, rt);
    this.ensureDepth();
    this.renderPass = new RenderPass(scene, camera);
    this.dof = new DofPass(camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.55, 0.65, 0.82);
    this.output = new OutputPass();
    this.fxaa = new ShaderPass(FXAAShader);
    this.grade = new ShaderPass(GradeShader);
    for (const p of [this.renderPass, this.dof, this.bloom, this.output, this.fxaa, this.grade]) this.composer.addPass(p);
    this.focus = 10; this.focusTarget = 10;
    this.extraBlur = 0;
    this.styleCur = { ...STYLES.default };
    this.styleTarget = { ...STYLES.default };
    this.letterAnim = 0;
    this.dofEnabled = true;
  }
  ensureDepth() {
    for (const t of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      const w = t.width, h = t.height;
      // each target needs its own depth texture (clones share a GPU source → feedback loop)
      if (!t._ownDepth || t.depthTexture.image.width !== w || t.depthTexture.image.height !== h) {
        t._ownDepth = true;
        if (t.depthTexture) t.depthTexture.dispose();
        t.depthTexture = new THREE.DepthTexture(w, h);
        t.depthTexture.type = THREE.UnsignedIntType;
        t.dispose();
      }
    }
  }
  setScene(scene) { this.renderPass.scene = scene; }
  setStyle(name, instant = false) {
    this.styleTarget = { ...(STYLES[name] || STYLES.default) };
    if (instant) this.styleCur = JSON.parse(JSON.stringify(this.styleTarget));
  }
  setSize(w, h, pr) {
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.ensureDepth();
    const W = w * pr, H = h * pr;
    this.fxaa.material.uniforms.resolution.value.set(1 / W, 1 / H);
    this.grade.uniforms.uRes.value.set(W, H);
    this.dof.setSize(W, H);
    this.dof.material.uniforms.uMaxBlur.value = 7 * (H / 1080);
  }
  update(dt, t, sceneTweaks = {}) {
    // smooth style blend
    const k = 1 - Math.exp(-dt * 3);
    const c = this.styleCur, s = this.styleTarget;
    for (const key in s) {
      if (Array.isArray(s[key])) c[key] = c[key].map((v, i) => v + (s[key][i] - v) * k);
      else c[key] += (s[key] - c[key]) * k;
    }
    const u = this.grade.uniforms;
    u.uTime.value = t;
    u.uExposure.value = c.exposure * (sceneTweaks.exposure ?? 1);
    u.uContrast.value = c.contrast; u.uSat.value = c.sat * (sceneTweaks.sat ?? 1); u.uSatVar.value = c.satVar;
    u.uVignette.value = c.vignette; u.uGrain.value = c.grain; u.uGrainSize.value = c.grainSize; u.uAberr.value = c.aberr;
    u.uHalation.value = c.halation; u.uFade.value = c.fade; u.uWeave.value = c.weave; u.uFlicker.value = c.flicker;
    u.uShadow.value.set(...c.shadow); u.uHigh.value.set(...c.high); u.uWarm.value = c.warm;
    // letterbox expressed as fraction of height for 2.39:1 when enabled
    const aspect = this.grade.uniforms.uRes.value.x / this.grade.uniforms.uRes.value.y;
    const want = c.letter > 0.001 ? Math.max(0, (1 - aspect / 2.39) / 2) * (c.letter / 0.11) : 0;
    u.uLetter.value = Math.max(want, this.letterAnim);
    this.bloom.strength = c.bloom * (sceneTweaks.bloom ?? 1);
    // focus pull
    this.focus += (this.focusTarget - this.focus) * (1 - Math.exp(-dt * 5));
    const d = this.dof.material.uniforms;
    d.uFocus.value = this.focus;
    d.uAperture.value = c.aperture * 0.32;
    d.uExtra.value = this.extraBlur;
    d.uEnabled.value = this.dofEnabled ? 1 : 0;
  }
  set black(v) { this.grade.uniforms.uBlack.value = v; }
  render(dt) { this.composer.render(dt); }
}

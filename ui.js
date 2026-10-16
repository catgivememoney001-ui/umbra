// Menu, landing tiles, settings persistence and key bindings.
export const DEFAULTS = {
  binds: { forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sprint: 'ShiftLeft', crouch: 'KeyC', climb: 'KeyE', light: 'KeyF' },
  crosshair: 'dot',
  vol: { master: 0.8, ambience: 0.75, sfx: 0.8 },
  sens: 1, invertY: false,
  style: 'default', dof: true, shadows: true, scale: 1, shake: 1, fov: 72,
};

const ACTION_NAMES = { forward: '前进', back: '后退', left: '左移', right: '右移', jump: '跳跃', sprint: '奔跑', crouch: '蹲伏', climb: '攀爬', light: '光源' };
const STYLE_NAMES = [['default', '默认'], ['vivid', '高饱和'], ['muted', '低饱和'], ['film', '胶卷'], ['cinema', '电影'], ['real', '真实']];

export function keyName(code) {
  if (!code) return '—';
  const map = { Space: '空格', ShiftLeft: '左 Shift', ShiftRight: '右 Shift', ControlLeft: '左 Ctrl', ControlRight: '右 Ctrl', AltLeft: '左 Alt', AltRight: '右 Alt', Tab: 'Tab', CapsLock: 'Caps', Enter: '回车', Backspace: '退格', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Mouse0: '左键', Mouse2: '右键' };
  if (map[code]) return map[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}

export function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem('umbra.settings') || '{}'); } catch (e) { s = {}; }
  return {
    ...DEFAULTS, ...s,
    binds: { ...DEFAULTS.binds, ...(s.binds || {}) },
    vol: { ...DEFAULTS.vol, ...(s.vol || {}) },
  };
}
export function saveSettings(s) { try { localStorage.setItem('umbra.settings', JSON.stringify(s)); } catch (e) { /* storage unavailable */ } }

/* ---------- painted thumbnails until a real frame is captured ---------- */
export function paintThumb(canvas, id, tint) {
  const g = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  const R = (() => { let s = id.length * 977; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, tint[0]); sky.addColorStop(1, tint[1]);
  g.fillStyle = sky; g.fillRect(0, 0, w, h);
  const glow = (x, y, r, c, a = 1) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, c); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.globalAlpha = a; g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); g.globalAlpha = 1; };
  const tree = (x, base, hh, ww, c) => { g.fillStyle = c; g.beginPath(); g.moveTo(x, base - hh); g.lineTo(x + ww, base); g.lineTo(x - ww, base); g.fill(); g.fillRect(x - ww * 0.06, base - hh * 0.2, ww * 0.12, hh * 0.3); };
  if (id === 'forest') {
    for (let i = 0; i < 14; i++) tree(R() * w, h * (0.75 + R() * 0.1), h * (0.6 + R() * 0.4), 12 + R() * 14, `rgba(12,16,16,${0.5 + R() * 0.5})`);
    g.fillStyle = '#0c0e0e'; g.beginPath(); g.moveTo(w * 0.55, h); g.quadraticCurveTo(w * 0.6, h * 0.7, w * 0.72, h * 0.62); g.lineTo(w * 0.76, h * 0.62); g.quadraticCurveTo(w * 0.75, h * 0.75, w * 0.95, h); g.fill();
    glow(w * 0.2, h * 0.62, 30, tint[2], 0.9); glow(w * 0.74, h * 0.58, 14, tint[2], 0.8); glow(w * 0.33, h * 0.72, 16, tint[2]);
  } else if (id === 'river') {
    glow(w * 0.6, h * 0.55, w * 0.6, 'rgba(230,232,230,0.9)');
    g.fillStyle = 'rgba(60,64,62,0.9)'; g.fillRect(0, h * 0.68, w, h * 0.32);
    g.strokeStyle = '#1a1c1c'; g.lineWidth = 9; g.beginPath(); g.moveTo(-10, h * 0.1); g.quadraticCurveTo(w * 0.5, -h * 0.05, w * 0.9, h * 0.25); g.stroke();
    for (let i = 0; i < 24; i++) { g.strokeStyle = 'rgba(30,32,30,0.7)'; g.lineWidth = 1.5; const x = R() * w * 0.9; g.beginPath(); g.moveTo(x, h * 0.08 + Math.sin(x / w * 3) * 10); g.lineTo(x + (R() - 0.5) * 6, h * (0.25 + R() * 0.3)); g.stroke(); }
    g.lineWidth = 5; g.beginPath(); g.moveTo(w * 0.2, h * 0.8); g.quadraticCurveTo(w * 0.6, h * 0.7, w, h * 0.66); g.stroke();
    g.fillStyle = '#2a2e2c'; g.beginPath(); g.ellipse(w * 0.45, h * 0.66, 24, 7, 0, 0, Math.PI * 2); g.fill();
  } else if (id === 'snow') {
    glow(w * 0.6, h * 0.38, 60, tint[2], 0.9);
    g.fillStyle = '#d8ccbc'; g.beginPath(); g.moveTo(0, h * 0.72); g.quadraticCurveTo(w * 0.5, h * 0.6, w, h * 0.7); g.lineTo(w, h); g.lineTo(0, h); g.fill();
    g.fillStyle = 'rgba(160,140,120,0.4)'; g.beginPath(); g.moveTo(w * 0.35, h); g.lineTo(w * 0.56, h * 0.62); g.lineTo(w * 0.62, h * 0.62); g.lineTo(w * 0.8, h); g.fill();
    g.fillStyle = '#1a1612'; g.fillRect(w * 0.595, h * 0.4, 2, h * 0.24);
    for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(240,225,200,${R() * 0.6})`; g.fillRect(R() * w, R() * h * 0.8, 1.5, 1.5); }
    for (let i = 0; i < 8; i++) { g.strokeStyle = 'rgba(220,210,195,0.5)'; g.lineWidth = 1; const x = i < 4 ? R() * w * 0.3 : w * 0.7 + R() * w * 0.3; g.beginPath(); g.moveTo(x, h * 0.7); g.lineTo(x + (R() - 0.5) * 30, h * 0.3); g.stroke(); }
  } else if (id === 'alley') {
    g.fillStyle = '#121418'; g.beginPath(); g.moveTo(0, 0); g.lineTo(w * 0.42, h * 0.3); g.lineTo(w * 0.42, h * 0.7); g.lineTo(0, h); g.fill();
    g.beginPath(); g.moveTo(w, 0); g.lineTo(w * 0.58, h * 0.3); g.lineTo(w * 0.58, h * 0.7); g.lineTo(w, h); g.fill();
    for (let i = 0; i < 10; i++) { const f = 0.12 + R() * 0.25; g.fillStyle = R() < 0.4 ? 'rgba(220,150,80,0.8)' : 'rgba(40,46,54,0.9)'; g.fillRect(w * f, h * (0.25 + R() * 0.3), 6, 9); }
    glow(w * 0.38, h * 0.48, 18, tint[2]); glow(w * 0.62, h * 0.52, 12, tint[2]); glow(w * 0.47, h * 0.56, 8, tint[2]);
    g.fillStyle = 'rgba(200,140,80,0.25)'; g.fillRect(w * 0.42, h * 0.72, w * 0.16, 3);
  } else if (id === 'lake') {
    for (let i = 0; i < 50; i++) { g.fillStyle = `rgba(255,255,255,${R() * 0.6})`; g.fillRect(R() * w, R() * h * 0.45, 1, 1); }
    glow(w * 0.5, h * 0.3, 40, 'rgba(200,215,235,0.9)'); g.fillStyle = '#dfe6f0'; g.beginPath(); g.arc(w * 0.5, h * 0.3, 5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#141a20'; g.beginPath(); g.moveTo(0, h * 0.55); for (let x = 0; x <= w; x += 10) g.lineTo(x, h * (0.5 - Math.sin(x * 0.03) * 0.04 - R() * 0.03)); g.lineTo(w, h * 0.56); g.lineTo(0, h * 0.56); g.fill();
    g.fillStyle = '#0e1418'; g.fillRect(0, h * 0.56, w, h);
    g.fillStyle = 'rgba(170,190,215,0.35)'; for (let i = 0; i < 14; i++) g.fillRect(w * 0.5 - 4 - R() * 10, h * (0.58 + i * 0.03), 8 + R() * 20, 1.5);
    g.fillStyle = '#2a2420'; g.beginPath(); g.moveTo(w * 0.42, h); g.lineTo(w * 0.47, h * 0.66); g.lineTo(w * 0.53, h * 0.66); g.lineTo(w * 0.6, h); g.fill();
    glow(w * 0.53, h * 0.64, 10, tint[2] === '#a8b8d0' ? 'rgba(255,170,90,0.9)' : tint[2]);
  } else {
    for (let i = 0; i < 12; i++) tree(R() * w, h * 0.8, h * (0.5 + R() * 0.4), 14, 'rgba(10,14,14,0.8)');
    glow(w * 0.5, h * 0.6, 80, 'rgba(200,140,70,0.35)');
    g.strokeStyle = 'rgba(180,200,190,0.5)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(w * 0.28, h * 0.8); g.lineTo(w * 0.28, h * 0.52); g.lineTo(w * 0.5, h * 0.36); g.lineTo(w * 0.72, h * 0.52); g.lineTo(w * 0.72, h * 0.8); g.closePath(); g.stroke();
    for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(w * (0.28 + i * 0.073), h * 0.8); g.lineTo(w * (0.28 + i * 0.073), h * (0.52 - Math.min(i, 6 - i) * 0.05)); g.stroke(); }
    glow(w * 0.44, h * 0.68, 8, tint[2]); glow(w * 0.58, h * 0.7, 8, tint[2]);
  }
  // grain
  const id2 = g.getImageData(0, 0, w, h);
  for (let i = 0; i < id2.data.length; i += 4) { const n = (Math.random() - 0.5) * 6; id2.data[i] += n; id2.data[i + 1] += n; id2.data[i + 2] += n; }
  g.putImageData(id2, 0, 0);
}

/* ---------- menu ---------- */
export class Menu {
  constructor(settings, scenes, handlers) {
    this.s = settings; this.scenes = scenes; this.h = handlers;
    this.root = document.getElementById('menu');
    this.thumbs = {};
    this.build();
  }

  el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }

  build() {
    const r = this.root;
    r.innerHTML = '';
    const panel = this.el('div', 'panel glass');
    const tabs = this.el('nav', 'tabs');
    const body = this.el('div', 'tabbody');
    const pages = { scene: '场景', look: '画面', control: '操作', sound: '声音' };
    this.pages = {};
    Object.entries(pages).forEach(([k, label], i) => {
      const b = this.el('button', 'tab' + (i === 0 ? ' on' : ''), label);
      b.style.setProperty('--i', i);
      b.onclick = () => this.show(k);
      b.onmouseenter = () => this.h.hover?.();
      tabs.appendChild(b);
      const p = this.el('section', 'page' + (i === 0 ? ' on' : ''));
      p.dataset.k = k;
      body.appendChild(p);
      this.pages[k] = { b, p };
    });
    const resume = this.el('button', 'resume', '继续');
    resume.onclick = () => this.h.resume();
    tabs.appendChild(this.el('div', 'grow'));
    tabs.appendChild(resume);
    panel.append(tabs, body);
    r.appendChild(panel);
    this.buildScenes(); this.buildLook(); this.buildControl(); this.buildSound();
  }

  show(k) {
    for (const [key, { b, p }] of Object.entries(this.pages)) { b.classList.toggle('on', key === k); p.classList.toggle('on', key === k); }
    this.h.hover?.();
  }

  sceneTile(i, onclick) {
    const sc = this.scenes[i];
    const t = this.el('button', 'tile');
    t.style.setProperty('--i', i);
    const cv = document.createElement('canvas'); cv.width = 320; cv.height = 200;
    paintThumb(cv, sc.id, sc.tint);
    const img = this.el('div', 'thumb');
    img.appendChild(cv);
    t.appendChild(img);
    t.appendChild(this.el('span', 'tname', sc.name));
    t.onclick = () => onclick(i);
    t.onmouseenter = () => this.h.hover?.();
    (this.thumbs[i] = this.thumbs[i] || []).push(cv);
    return t;
  }

  setThumb(i, srcCanvas) {
    (this.thumbs[i] || []).forEach((cv) => { const g = cv.getContext('2d'); g.drawImage(srcCanvas, 0, 0, cv.width, cv.height); });
  }

  buildScenes() {
    const p = this.pages.scene.p;
    const grid = this.el('div', 'tiles');
    this.sceneTiles = this.scenes.map((_, i) => { const t = this.sceneTile(i, (k) => this.h.scene(k)); grid.appendChild(t); return t; });
    p.appendChild(grid);
  }
  markScene(i) { this.sceneTiles.forEach((t, k) => t.classList.toggle('cur', k === i)); }

  row(label, control) { const r = this.el('div', 'row'); r.appendChild(this.el('label', '', label)); r.appendChild(control); return r; }
  slider(min, max, step, val, fn, fmt = (v) => v) {
    const w = this.el('div', 'slider');
    const inp = document.createElement('input'); inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = val;
    const out = this.el('span', 'val', fmt(val));
    const paint = () => w.style.setProperty('--p', ((inp.value - min) / (max - min)) * 100 + '%');
    inp.oninput = () => { out.textContent = fmt(+inp.value); paint(); fn(+inp.value); };
    paint();
    w.append(inp, out);
    return w;
  }
  toggle(val, fn) {
    const b = this.el('button', 'toggle' + (val ? ' on' : ''));
    b.appendChild(this.el('i'));
    b.onclick = () => { b.classList.toggle('on'); fn(b.classList.contains('on')); this.h.hover?.(); };
    return b;
  }
  chips(options, val, fn) {
    const w = this.el('div', 'chips');
    options.forEach(([k, label]) => {
      const c = this.el('button', 'chip' + (k === val ? ' on' : ''), label);
      c.onclick = () => { w.querySelectorAll('.chip').forEach((x) => x.classList.remove('on')); c.classList.add('on'); fn(k); this.h.hover?.(); };
      w.appendChild(c);
    });
    return w;
  }

  buildLook() {
    const p = this.pages.look.p, s = this.s, ch = () => this.h.change();
    p.appendChild(this.row('画面效果', this.chips(STYLE_NAMES, s.style, (v) => { s.style = v; ch(); })));
    p.appendChild(this.row('景深', this.toggle(s.dof, (v) => { s.dof = v; ch(); })));
    p.appendChild(this.row('阴影', this.toggle(s.shadows, (v) => { s.shadows = v; ch(); })));
    p.appendChild(this.row('渲染精度', this.slider(0.5, 1, 0.05, s.scale, (v) => { s.scale = v; ch(); }, (v) => Math.round(v * 100) + '%')));
    p.appendChild(this.row('视野', this.slider(55, 100, 1, s.fov, (v) => { s.fov = v; ch(); }, (v) => v + '°')));
    p.appendChild(this.row('镜头晃动', this.slider(0, 1.5, 0.05, s.shake, (v) => { s.shake = v; ch(); }, (v) => Math.round(v * 100) + '%')));
  }

  buildControl() {
    const p = this.pages.control.p, s = this.s, ch = () => this.h.change();
    p.appendChild(this.row('鼠标灵敏度', this.slider(0.2, 3, 0.05, s.sens, (v) => { s.sens = v; ch(); }, (v) => v.toFixed(2))));
    p.appendChild(this.row('反转 Y 轴', this.toggle(s.invertY, (v) => { s.invertY = v; ch(); })));
    p.appendChild(this.row('准心', this.chips([['dot', '白点'], ['cross', '十字']], s.crosshair, (v) => { s.crosshair = v; ch(); })));
    const binds = this.el('div', 'binds');
    this.bindBtns = {};
    Object.keys(ACTION_NAMES).forEach((a) => {
      const r = this.el('div', 'bind');
      r.appendChild(this.el('label', '', ACTION_NAMES[a]));
      const b = this.el('button', 'key', keyName(s.binds[a]));
      b.onclick = (e) => { e.stopPropagation(); this.capture(a, b); };
      r.appendChild(b);
      binds.appendChild(r);
      this.bindBtns[a] = b;
    });
    p.appendChild(binds);
    const reset = this.el('button', 'ghost', '恢复默认');
    reset.onclick = () => { s.binds = { ...DEFAULTS.binds }; for (const a in this.bindBtns) this.bindBtns[a].textContent = keyName(s.binds[a]); ch(); };
    p.appendChild(reset);
  }

  capture(action, btn) {
    if (this.capturing) this.capturing.btn.classList.remove('wait');
    btn.classList.add('wait'); btn.textContent = '···';
    this.capturing = { action, btn };
    const onKey = (e) => {
      e.preventDefault(); e.stopPropagation();
      window.removeEventListener('keydown', onKey, true);
      btn.classList.remove('wait');
      if (e.code !== 'Escape') {
        // swap if already used
        for (const a in this.s.binds) if (this.s.binds[a] === e.code && a !== action) { this.s.binds[a] = this.s.binds[action]; this.bindBtns[a].textContent = keyName(this.s.binds[a]); }
        this.s.binds[action] = e.code;
      }
      btn.textContent = keyName(this.s.binds[action]);
      this.capturing = null;
      this.h.change();
    };
    window.addEventListener('keydown', onKey, true);
  }

  buildSound() {
    const p = this.pages.sound.p, s = this.s, ch = () => this.h.change();
    const pct = (v) => Math.round(v * 100) + '%';
    p.appendChild(this.row('主音量', this.slider(0, 1, 0.01, s.vol.master, (v) => { s.vol.master = v; ch(); }, pct)));
    p.appendChild(this.row('环境', this.slider(0, 1, 0.01, s.vol.ambience, (v) => { s.vol.ambience = v; ch(); }, pct)));
    p.appendChild(this.row('音效', this.slider(0, 1, 0.01, s.vol.sfx, (v) => { s.vol.sfx = v; ch(); }, pct)));
  }

  open() { this.root.classList.add('open'); this.markScene(this.h.current()); }
  close() { this.root.classList.remove('open'); }
  get isOpen() { return this.root.classList.contains('open'); }
}

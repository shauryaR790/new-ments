// ══ nomad · the canvas of work ══════════════════════════════════════════
// An endless plane of films you drag through. No cursor grid, no trackers.

import { WORKS, CARDS } from './data.js';

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

/* ── the repeating block ────────────────────────────────────────────────
   Four columns, three rows, two slots deliberately left empty so the plane
   breathes. Per-column vertical offsets break the rows without breaking the
   tiling — a constant offset per column repeats cleanly. */
const COLS = 4, ROWS = 3;
const COL_GAP = 0.34, ROW_GAP = 0.42;
const TILE_AR = 9 / 16;
const COL_OFF = [0, 0.30, 0.12, 0.44];

const SLOTS = [
  { c:0, r:0, kind:'work', i:0 },
  { c:1, r:0, kind:'work', i:1 },
  { c:2, r:0, kind:'card', i:0 },
  { c:3, r:0, kind:'work', i:2 },
  { c:0, r:1, kind:'work', i:3 },
  { c:1, r:1, kind:'card', i:1 },
  { c:2, r:1, kind:'work', i:4 },
  { c:3, r:1, kind:'work', i:5 },
  { c:0, r:2, kind:'work', i:6 },
  { c:2, r:2, kind:'work', i:7 }
];

const BLUR_SCALE = 0.34;
const BLUR_PX    = 3.3;
const BLUR_START = 0.50;

export class WorkCanvas {
  constructor(canvas, opts = {}){
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.buf = document.createElement('canvas');
    this.bctx = this.buf.getContext('2d');
    this.onRoute = opts.onRoute || (() => {});
    this.onFirstDrag = opts.onFirstDrag || (() => {});
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.x = 0; this.y = 0;
    this.tx = 0; this.ty = 0;
    this.vx = 0; this.vy = 0;
    this.drag = null;
    this.dragged = false;

    this.videos = WORKS.map(w => {
      const v = document.createElement('video');
      v.src = w.src; v.muted = true; v.loop = true; v.playsInline = true;
      v.preload = 'auto'; v.setAttribute('playsinline','');
      v.addEventListener('loadeddata', () => { this.ready = true; });
      return v;
    });
    this.playing = new Array(this.videos.length).fill(false);

    this.blurCv = document.createElement('canvas');
    this.bl = this.blurCv.getContext('2d');
    this.maskCv = document.createElement('canvas');
    this.running = false;
    this._bind();
    this.resize();
  }

  resize(){
    const w = window.innerWidth, h = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const c of [this.cv, this.buf]){
      c.width = Math.round(w * this.dpr);
      c.height = Math.round(h * this.dpr);
    }
    this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px';
    this.w = w; this.h = h;

    const narrow = w < 640;
    this.tileW = narrow ? clamp(w * 0.66, 180, 320) : clamp(w * 0.30, 230, 460);
    this.tileH = this.tileW * TILE_AR;
    const cg = narrow ? 0.24 : COL_GAP, rg = narrow ? 0.30 : ROW_GAP;
    this.colPitch = this.tileW * (1 + cg);
    this.rowPitch = this.tileH + this.tileW * rg;
    this.blockW = COLS * this.colPitch;
    this.blockH = ROWS * this.rowPitch;

    const bw = Math.max(2, Math.round(w * BLUR_SCALE));
    const bh = Math.max(2, Math.round(h * BLUR_SCALE));
    this.blurCv.width = this.maskCv.width = bw;
    this.blurCv.height = this.maskCv.height = bh;
    const m = this.maskCv.getContext('2d');
    const half = Math.hypot(bw, bh) / 2;
    const g = m.createRadialGradient(bw / 2, bh / 2, half * BLUR_START, bw / 2, bh / 2, half);
    g.addColorStop(0.00, 'rgba(0,0,0,0)');
    g.addColorStop(0.45, 'rgba(0,0,0,0.30)');
    g.addColorStop(0.78, 'rgba(0,0,0,0.74)');
    g.addColorStop(1.00, 'rgba(0,0,0,1)');
    m.clearRect(0, 0, bw, bh);
    m.fillStyle = g; m.fillRect(0, 0, bw, bh);
  }

  _bind(){
    const cv = this.cv;
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId);
      this.drag = { x:e.clientX, y:e.clientY, ox:this.tx, oy:this.ty, moved:0, t:performance.now() };
      cv.classList.add('is-drag');
    });
    cv.addEventListener('pointermove', e => {
      if (this.drag){
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
        this.drag.moved = Math.max(this.drag.moved, Math.hypot(dx, dy));
        this.tx = this.drag.ox + dx;
        this.ty = this.drag.oy + dy;
        if (this.drag.moved > 8 && !this.dragged){ this.dragged = true; this.onFirstDrag(); }
      } else {
        this._hover(e.clientX, e.clientY);
      }
    });
    const end = (e) => {
      if (!this.drag) return;
      const d = this.drag; this.drag = null;
      cv.classList.remove('is-drag');
      const dt = Math.max(16, performance.now() - d.t);
      if (d.moved > 8){
        this.tx += this.vx * 90 / dt * 4;
        this.ty += this.vy * 90 / dt * 4;
      } else {
        const card = this._cardAt(e.clientX, e.clientY);
        if (card) this.onRoute(card.route);
      }
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', () => { this.drag = null; cv.classList.remove('is-drag'); });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      this.tx -= e.deltaX; this.ty -= e.deltaY;
      if (!this.dragged){ this.dragged = true; this.onFirstDrag(); }
    }, { passive:false });

    window.addEventListener('keydown', e => {
      if (!this.running) return;
      const step = this.tileW * 0.6;
      if (e.key === 'ArrowLeft')  { this.tx += step; e.preventDefault(); }
      if (e.key === 'ArrowRight') { this.tx -= step; e.preventDefault(); }
      if (e.key === 'ArrowUp')    { this.ty += step; e.preventDefault(); }
      if (e.key === 'ArrowDown')  { this.ty -= step; e.preventDefault(); }
    });
  }

  _hover(x, y){
    const card = this._cardAt(x, y);
    const hot = !!card;
    if (hot !== this._hot){ this._hot = hot; this.cv.classList.toggle('is-hot', hot); }
  }

  _cardAt(x, y){
    for (const r of (this._cardRects || [])){
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
    }
    return null;
  }

  start(){
    if (this.running) return;
    this.running = true;
    this._last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    this._raf = requestAnimationFrame(loop);
    document.addEventListener('visibilitychange', this._vis = () => {
      if (document.hidden) this.videos.forEach(v => v.pause());
      else this.playing.forEach((p, i) => { if (p) this.videos[i].play().catch(()=>{}); });
    });
  }

  stop(){
    this.running = false;
    cancelAnimationFrame(this._raf);
    this.videos.forEach(v => v.pause());
    this.playing.fill(false);
    if (this._vis) document.removeEventListener('visibilitychange', this._vis);
  }

  frame(now){
    const dt = Math.min(64, now - this._last); this._last = now;
    const k = 1 - Math.pow(0.0009, dt / 1000);
    const nx = this.x + (this.tx - this.x) * k;
    const ny = this.y + (this.ty - this.y) * k;
    this.vx = nx - this.x; this.vy = ny - this.y;
    this.x = nx; this.y = ny;

    this.drawPlane();
    this.present();
    this.softenEdges();
  }

  drawPlane(){
    const c = this.bctx, dpr = this.dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, this.w, this.h);

    const need = new Array(this.videos.length).fill(false);
    const cards = [];

    const i0 = Math.floor((-this.x - this.blockW) / this.blockW);
    const i1 = Math.ceil((-this.x + this.w + this.blockW) / this.blockW);
    const j0 = Math.floor((-this.y - this.blockH) / this.blockH);
    const j1 = Math.ceil((-this.y + this.h + this.blockH) / this.blockH);

    for (let i = i0; i <= i1; i++){
      for (let j = j0; j <= j1; j++){
        const ox = this.x + i * this.blockW;
        const oy = this.y + j * this.blockH;
        for (const s of SLOTS){
          const x = ox + s.c * this.colPitch;
          const y = oy + s.r * this.rowPitch + COL_OFF[s.c] * this.rowPitch;
          if (x > this.w || x + this.tileW < 0 || y > this.h || y + this.tileH < 0) continue;
          if (s.kind === 'work'){
            need[s.i] = true;
            this.paintWork(c, s.i, x, y);
          } else {
            const r = this.paintCard(c, CARDS[s.i], x, y);
            cards.push({ ...r, route: CARDS[s.i].route });
          }
        }
      }
    }
    this._cardRects = cards;

    for (let n = 0; n < this.videos.length; n++){
      const v = this.videos[n];
      if (need[n] && !this.playing[n]){ this.playing[n] = true; v.play().catch(()=>{}); }
      else if (!need[n] && this.playing[n]){ this.playing[n] = false; v.pause(); }
    }
  }

  paintWork(c, i, x, y){
    const v = this.videos[i];
    const w = this.tileW, h = this.tileH;
    if (v.readyState >= 2 && v.videoWidth){
      const ar = v.videoWidth / v.videoHeight, tr = w / h;
      let sw = v.videoWidth, sh = v.videoHeight, sx = 0, sy = 0;
      if (ar > tr){ sw = v.videoHeight * tr; sx = (v.videoWidth - sw) / 2; }
      else { sh = v.videoWidth / tr; sy = (v.videoHeight - sh) / 2; }
      c.drawImage(v, sx, sy, sw, sh, x, y, w, h);
    } else {
      c.fillStyle = '#f2f1f4';
      c.fillRect(x, y, w, h);
    }
  }

  paintCard(c, card, x, y){
    const w = this.tileW, h = this.tileH;
    const size = Math.round(clamp(this.tileW * 0.115, 17, 34));
    c.fillStyle = '#111014';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `500 ${size}px "SF Pro Display", -apple-system, Helvetica, Arial, sans-serif`;
    const cx = x + w / 2, cy = y + h / 2;
    c.fillText(card.text, cx, cy);
    c.font = `400 ${Math.round(size * 0.8)}px "SF Pro Display", Helvetica, Arial, sans-serif`;
    c.fillText('*', cx, cy - size * 1.35);

    const tw = Math.max(size * 4.2, c.measureText(card.text).width);
    return { x: cx - tw / 2 - 12, y: cy - size * 2.1, w: tw + 24, h: size * 3.4 };
  }

  present(){
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.cv.width, this.cv.height);
    ctx.drawImage(this.buf, 0, 0);
  }

  softenEdges(){
    const ctx = this.ctx, b = this.bl;
    const bw = this.blurCv.width, bh = this.blurCv.height;
    if (bw < 4 || bh < 4) return;

    b.setTransform(1, 0, 0, 1, 0, 0);
    b.globalCompositeOperation = 'copy';
    if ('filter' in b) b.filter = `blur(${BLUR_PX}px)`;
    b.drawImage(this.cv, 0, 0, bw, bh);
    if ('filter' in b) b.filter = 'none';

    b.globalCompositeOperation = 'destination-in';
    b.drawImage(this.maskCv, 0, 0);
    b.globalCompositeOperation = 'source-over';

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.blurCv, 0, 0, this.cv.width, this.cv.height);
  }
}

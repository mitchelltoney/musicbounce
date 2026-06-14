import type { ChoreoEngine, DanceTrack } from './ChoreoEngine';

/**
 * ChoreoStage — renders the hand-choreography on a 2D canvas. Each track is an
 * element parked at its own spot; on every recorded tap it performs its style's
 * "dance move", which plays out over the time AFTER the tap. Trails come from a
 * per-frame fade; glows are additive. Driven entirely by the audio clock.
 */
const TAU = Math.PI * 2;
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const easeOut = (x: number) => 1 - (1 - x) * (1 - x);
const hash = (i: number, salt = 0) => {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

interface TapInfo { idx: number; last: number; dt: number; next: number; }
function tapPhase(taps: number[], t: number): TapInfo {
  let lo = 0, hi = taps.length - 1, idx = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (taps[m] <= t) { idx = m; lo = m + 1; } else hi = m - 1; }
  if (idx < 0) return { idx: -1, last: -1e9, dt: 1e9, next: taps[0] ?? Infinity };
  return { idx, last: taps[idx], dt: t - taps[idx], next: taps[idx + 1] ?? Infinity };
}

export class ChoreoStage {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;

  constructor(private canvas: HTMLCanvasElement, private engine: ChoreoEngine) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = this.canvas.clientWidth || window.innerWidth;
    this.h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = this.w * this.dpr;
    this.canvas.height = this.h * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.fillStyle = '#06070e';
    this.ctx.fillRect(0, 0, this.w, this.h);
  }

  private centerFor(i: number, n: number): { cx: number; cy: number; r: number } {
    if (n <= 1) return { cx: this.w / 2, cy: this.h / 2, r: Math.min(this.w, this.h) * 0.34 };
    const ringR = Math.min(this.w, this.h) * 0.32;
    const a = (i / n) * TAU - Math.PI / 2;
    return { cx: this.w / 2 + Math.cos(a) * ringR, cy: this.h / 2 + Math.sin(a) * ringR, r: Math.min(this.w, this.h) * 0.16 };
  }

  /** Render one frame at audio time t. `live` flashes the active track's last tap. */
  render(t: number) {
    const ctx = this.ctx;
    // trail fade
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(6,7,14,0.22)';
    ctx.fillRect(0, 0, this.w, this.h);

    ctx.globalCompositeOperation = 'lighter';
    const tracks = this.engine.tracks;
    tracks.forEach((tr, i) => {
      if (tr.muted) return;
      const home = this.centerFor(i, tracks.length);
      const active = tr.id === this.engine.activeId;
      this.drawElement(ctx, t, tr, home, active);
    });
    ctx.globalCompositeOperation = 'source-over';
  }

  private glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, hue: number, light: number, alpha: number) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(1, r));
    g.addColorStop(0, `hsla(${hue}, 95%, ${light}%, ${alpha})`);
    g.addColorStop(0.5, `hsla(${hue}, 95%, ${light * 0.7}%, ${alpha * 0.5})`);
    g.addColorStop(1, `hsla(${hue}, 95%, 50%, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }

  private drawElement(ctx: CanvasRenderingContext2D, t: number, tr: DanceTrack, home: { cx: number; cy: number; r: number }, active: boolean) {
    const { taps, hue } = tr;
    const { cx, cy, r } = home;
    const info = tapPhase(taps, t);
    const boost = active ? 1.25 : 1.0;

    // a faint home marker so empty/idle tracks are still visible
    this.glow(ctx, cx, cy, r * 0.18, hue, 55, 0.06 * boost);
    if (info.idx < 0) return;

    const moveDur = Math.min(0.3, Math.max(0.08, (info.next - info.last) * 0.6));
    const p = easeOut(clamp(info.dt / moveDur, 0, 1));
    const hit = Math.exp(-info.dt / 0.12);              // 1 at the tap, decays
    const baseR = r * 0.16;

    switch (tr.style) {
      case 'stepper': {
        const tgt = this.stepTarget(info.idx, tr, home);
        const prev = info.idx > 0 ? this.stepTarget(info.idx - 1, tr, home) : { x: cx, y: cy };
        const x = prev.x + (tgt.x - prev.x) * p;
        const y = prev.y + (tgt.y - prev.y) * p;
        this.glow(ctx, x, y, baseR * (1 + 1.6 * hit) * boost, hue, 68, 0.9);
        break;
      }
      case 'pulser': {
        const s = baseR * (0.7 + 2.0 * hit) * boost;
        this.glow(ctx, cx, cy, s, hue, 70, 0.85);
        // a quick expanding ring on the hit
        ctx.strokeStyle = `hsla(${hue},95%,70%,${0.5 * hit})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, baseR + (1 - hit) * r * 0.9, 0, TAU);
        ctx.stroke();
        break;
      }
      case 'spinner': {
        const ang = info.idx * 0.7 + p * 0.7 + t * 0.2;
        const arms = 4;
        for (let k = 0; k < arms; k++) {
          const a = ang + (k / arms) * TAU;
          const rad = r * 0.7;
          this.glow(ctx, cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, baseR * (0.6 + 1.2 * hit) * boost, hue, 66, 0.8);
        }
        break;
      }
      case 'comet': {
        const a = hash(info.idx, hue) * TAU;
        const reach = r * 1.1 * easeOut(clamp(info.dt / 0.4, 0, 1));
        const x = cx + Math.cos(a) * reach;
        const y = cy + Math.sin(a) * reach;
        const fade = Math.exp(-info.dt / 0.5);
        this.glow(ctx, x, y, baseR * (1 + 1.2 * hit) * boost, hue, 70, 0.9 * Math.max(fade, 0.15));
        break;
      }
      case 'orbit': {
        const a = info.idx * 1.3 + t * (1.2 + hash(info.idx, hue));
        const rad = r * (0.4 + 0.6 * hash(info.idx, hue + 9));
        this.glow(ctx, cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, baseR * (0.8 + 1.4 * hit) * boost, hue, 68, 0.85);
        break;
      }
    }
  }

  private stepTarget(idx: number, tr: DanceTrack, home: { cx: number; cy: number; r: number }) {
    const a = hash(idx, tr.hue) * TAU;
    const rr = (0.25 + 0.75 * hash(idx, tr.hue + 5)) * home.r;
    return { x: home.cx + Math.cos(a) * rr, y: home.cy + Math.sin(a) * rr };
  }
}

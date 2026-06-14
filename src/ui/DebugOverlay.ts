import { BANDS, type LiveFrame } from '../features/LiveFeatures';
import type { VisualState } from '../types/contracts';

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const W = 300;
const H = 488;
const BAND_COLORS = ['#5b8cff', '#5bb8ff', '#7df0a0', '#ffd56b', '#ff9a6b', '#ff6b9a', '#d96bff'];

/** Imperative 2D-canvas inspector: live features (Phase 2) + VisualState (Phase 3).
 *  Updated every frame from the render loop, never via React. Toggle with `d`. */
export class DebugOverlay {
  visible = true;
  private ctx: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    this.ctx = ctx;
  }

  toggle() {
    this.visible = !this.visible;
    this.canvas.style.display = this.visible ? 'block' : 'none';
  }

  draw(live: LiveFrame, vs: VisualState | null) {
    if (!this.visible) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, W, H);
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'middle';

    let y = 14;
    const hbar = (label: string, val: number, color: string) => {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText(label, 8, y);
      const x0 = 76;
      const bw = W - x0 - 12;
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x0, y - 4, bw, 9);
      ctx.fillStyle = color;
      ctx.fillRect(x0, y - 4, bw * clamp01(val), 9);
      y += 15;
    };

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText('live features', 8, y);
    y += 16;
    BANDS.forEach((b, i) => hbar(b, live.band[b], BAND_COLORS[i]));
    y += 2;
    hbar('rms', live.rms, '#ffffff');
    hbar('bright', live.brightness, '#9ad6ff');
    hbar('flux', live.flux, '#ffc488');

    // chroma strip
    y += 2;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('chroma', 8, y);
    const cx = 76;
    const cw = (W - cx - 12) / 12;
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = `hsl(${i * 30}, 70%, ${28 + clamp01(live.chroma[i]) * 50}%)`;
      ctx.fillRect(cx + i * cw, y - 6, cw - 1.5, 12);
    }
    y += 16;

    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.moveTo(8, y);
    ctx.lineTo(W - 8, y);
    ctx.stroke();
    y += 14;

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText('director · visualstate', 8, y);
    y += 16;

    if (!vs) {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText('(no Score yet — drop a track)', 8, y);
      return;
    }

    // impulses as vertical bars
    const imp: [string, number, string][] = [
      ['beat', vs.beat, '#ffffff'], ['kick', vs.kick, '#ff6b6b'], ['snr', vs.snare, '#ffd56b'],
      ['hat', vs.hat, '#7df0a0'], ['bass', vs.bass, '#5b8cff'], ['mel', vs.melody, '#ff9a6b'],
      ['db', vs.downbeat, '#d96bff'],
    ];
    const bw = 26;
    const bh = 34;
    imp.forEach(([label, val, color], i) => {
      const x = 12 + i * (bw + 8);
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(x, y, bw, bh);
      ctx.fillStyle = color;
      const hh = bh * clamp01(val);
      ctx.fillRect(x, y + bh - hh, bw, hh);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText(label, x + 2, y + bh + 8);
    });
    y += bh + 22;

    hbar('energy', vs.energy, '#9be15d');
    hbar('intensity', vs.intensity, '#ffd56b');
    hbar('lead', vs.leadPresence, '#ff9a6b');
    hbar('vocal', vs.vocalPresence, '#9ad6ff');
    hbar('dropProx', vs.dropProximity, '#ff6b9a');
    hbar('beatPhase', vs.beatPhase, '#88bbdd');
    hbar('barPhase', vs.barPhase, '#88bbdd');

    y += 2;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(`section: ${vs.section}  ${Math.round(vs.sectionProgress * 100)}%`, 8, y);
    y += 14;
    ctx.fillText(`mood: ${vs.mood}   ${vs.bpm.toFixed(0)} BPM   sinceDrop ${vs.sinceDrop.toFixed(1)}s`, 8, y);
    y += 16;

    const swatches = [vs.palette.primary, vs.palette.secondary, vs.palette.accent, vs.palette.bg];
    swatches.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(8 + i * 30, y, 26, 15);
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.strokeRect(8 + i * 30, y, 26, 15);
    });
  }
}

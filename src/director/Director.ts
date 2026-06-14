import {
  smooth,
  decayImpulse,
  type BandName,
  type Palette,
  type Score,
  type SectionLabel,
  type VisualState,
} from '../types/contracts';
import type { LiveFrame } from '../features/LiveFeatures';

const BANDS: BandName[] = ['sub', 'bass', 'lowMid', 'mid', 'highMid', 'presence', 'air'];
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const NOTE_PC: Record<string, number> = {
  C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11,
};

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

/** Fires when the playhead crosses an onset time. Cursor-based; handles seeks. */
class OnsetTrigger {
  private cursor = 0;
  constructor(private times: number[], private strengths?: number[]) {}
  /** Strength (0..1) of the strongest onset crossed since prevT, or 0 if none. */
  crossed(prevT: number, tSec: number): number {
    if (tSec < prevT) this.reseek(tSec);
    let strength = 0;
    while (this.cursor < this.times.length && this.times[this.cursor] <= tSec) {
      if (this.times[this.cursor] > prevT) {
        const s = this.strengths ? (this.strengths[this.cursor] ?? 1) : 1;
        if (s > strength) strength = s;
      }
      this.cursor++;
    }
    return strength;
  }
  private reseek(tSec: number) {
    let lo = 0, hi = this.times.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.times[m] <= tSec) lo = m + 1; else hi = m; }
    this.cursor = lo;
  }
}

/** Linear-interpolated sampler over an Envelope (timesSec/values). */
class EnvelopeSampler {
  private i = 0;
  constructor(private t: number[], private v: number[]) {}
  sample(tSec: number): number {
    const { t, v } = this;
    const n = t.length;
    if (n === 0) return 0;
    if (tSec <= t[0]) return v[0];
    if (tSec >= t[n - 1]) return v[n - 1];
    if (tSec < t[this.i]) this.i = 0;
    while (this.i < n - 1 && t[this.i + 1] <= tSec) this.i++;
    const f = (tSec - t[this.i]) / Math.max(t[this.i + 1] - t[this.i], 1e-6);
    return v[this.i] + (v[this.i + 1] - v[this.i]) * f;
  }
}

function lastIndexAtOrBefore(times: number[], t: number): number {
  let lo = 0, hi = times.length - 1, res = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (times[m] <= t) { res = m; lo = m + 1; } else hi = m - 1; }
  return res;
}

function hslHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360; s = clamp01(s); l = clamp01(l);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  const to = (val: number) => `0${Math.round((val + m) * 255).toString(16)}`.slice(-2);
  return `#${to(r)}${to(g)}${to(b)}`;
}

/* ------------------------------------------------------------------ */
/* Director — the only brain                                           */
/* ------------------------------------------------------------------ */

export class Director {
  private vs: VisualState = freshState();
  private score: Score | null = null;
  private prevT = 0;

  // built from the Score
  private triggers: Record<string, OnsetTrigger> = {};
  private energyEnv: EnvelopeSampler | null = null;
  private vocalEnv: EnvelopeSampler | null = null;
  private leadEnv: EnvelopeSampler | null = null;
  private brightEnv: EnvelopeSampler | null = null;
  private dropTimes: number[] = [];
  private lastDropTime = -1e9;
  private secEMin = 0;
  private secEMax = 1;

  // smoothing time constants (sec)
  private tau = {
    energy: 0.12, band: 0.05, vocal: 0.18, bright: 0.12,
    intensity: 0.25, drop: 0.15, hue: 0.4,
  };
  // impulse decay constants (sec) — snappy
  private decay = { beat: 0.12, kick: 0.09, snare: 0.10, hat: 0.06, bass: 0.13, melody: 0.14, downbeat: 0.18 };

  // live-tunable params (bound by the tuning panel)
  readonly params = { impulseDecay: 1.0, intensityGain: 1.0, dropLeadBars: 8 };

  /** The most recent VisualState (the inspector overlay + tests read this). */
  get state(): VisualState { return this.vs; }

  setScore(score: Score | null) {
    this.score = score;
    this.triggers = {};
    this.energyEnv = this.vocalEnv = this.leadEnv = this.brightEnv = null;
    this.dropTimes = [];
    this.lastDropTime = -1e9;
    if (!score) return;

    const dh = score.drumHits;
    const stem = score.onsetsByStem ?? {};
    const band = score.onsetsByBand;
    const os = score.onsetStrength ?? {};
    this.triggers = {
      beat: new OnsetTrigger(score.beatTimesSec),
      downbeat: new OnsetTrigger(score.downbeatTimesSec),
      kick: dh?.kick ? new OnsetTrigger(dh.kick, os.kick) : new OnsetTrigger(band.bass ?? []),
      snare: dh?.snare ? new OnsetTrigger(dh.snare, os.snare) : new OnsetTrigger(band.mid ?? []),
      hat: dh?.hat ? new OnsetTrigger(dh.hat, os.hat) : new OnsetTrigger(band.air ?? []),
      bass: stem.bass ? new OnsetTrigger(stem.bass, os.bass) : new OnsetTrigger(band.bass ?? []),
      melody: stem.other ? new OnsetTrigger(stem.other, os.melody) : new OnsetTrigger(band.highMid ?? []),
    };
    const es = score.sections.map((x) => x.energy);
    this.secEMin = es.length ? Math.min(...es) : 0;
    this.secEMax = es.length ? Math.max(...es) : 1;
    this.energyEnv = new EnvelopeSampler(score.energyEnvelope.timesSec, score.energyEnvelope.values);
    const vocals = score.stemEnergy?.vocals;
    if (vocals) this.vocalEnv = new EnvelopeSampler(vocals.timesSec, vocals.values);
    const other = score.stemEnergy?.other;
    if (other) this.leadEnv = new EnvelopeSampler(other.timesSec, other.values);
    if (score.spectral) this.brightEnv = new EnvelopeSampler(score.spectral.timesSec, score.spectral.centroid);
    this.dropTimes = score.sections.filter((s) => s.isDrop).map((s) => s.startSec);
  }

  /** Produce the VisualState for this frame. The only output Scenes may read. */
  update(tSec: number, dtSec: number, live: LiveFrame): VisualState {
    const vs = this.vs;
    vs.tSec = tSec;
    vs.dtSec = dtSec;
    const s = this.score;

    // ---- continuous (offline = choreography, blended with live = texture) ----
    const liveLow = live.low, liveMid = live.mid, liveHigh = live.high;
    const scoreEnergy = this.energyEnv ? this.energyEnv.sample(tSec) : live.rms;
    const energyTarget = s ? 0.7 * scoreEnergy + 0.3 * live.rms : live.rms;
    vs.energy = smooth(vs.energy, clamp01(energyTarget), dtSec, this.tau.energy);

    for (const b of BANDS) vs.band[b] = smooth(vs.band[b], live.band[b], dtSec, this.tau.band);
    vs.low = smooth(vs.low, liveLow, dtSec, this.tau.band);
    vs.mid = smooth(vs.mid, liveMid, dtSec, this.tau.band);
    vs.high = smooth(vs.high, liveHigh, dtSec, this.tau.band);

    const vocalTarget = this.vocalEnv ? this.vocalEnv.sample(tSec) : 0;
    vs.vocalPresence = smooth(vs.vocalPresence, clamp01(vocalTarget), dtSec, this.tau.vocal);
    const leadTarget = this.leadEnv ? this.leadEnv.sample(tSec) : 0;
    vs.leadPresence = smooth(vs.leadPresence, clamp01(leadTarget), dtSec, this.tau.vocal);

    const brightTarget = this.brightEnv ? 0.6 * this.brightEnv.sample(tSec) + 0.4 * live.brightness : live.brightness;
    vs.brightness = smooth(vs.brightness, clamp01(brightTarget), dtSec, this.tau.bright);

    // ---- impulses (instant attack on Score onsets, exp decay) ----
    const prevT = this.prevT;
    const fire = (name: keyof typeof this.decay, key: string) => {
      const trig = this.triggers[key];
      const s = trig ? trig.crossed(prevT, tSec) : 0;
      vs[name] = s > 0 ? s : decayImpulse(vs[name], dtSec, this.decay[name] * this.params.impulseDecay);
    };
    fire('beat', 'beat');
    fire('downbeat', 'downbeat');
    fire('kick', 'kick');
    fire('snare', 'snare');
    fire('hat', 'hat');
    fire('bass', 'bass');
    fire('melody', 'melody');

    // ---- musical phase ----
    vs.bpm = s?.bpm ?? vs.bpm;
    this.updatePhase(tSec, s);

    // ---- structure ----
    this.updateStructure(tSec, dtSec, s);

    // ---- dropProximity / sinceDrop (THE anticipation signal) ----
    this.updateDrop(tSec, dtSec, s);

    // ---- intensity (master "how big") — preserves dynamic range ----
    const glow = Math.exp(-vs.sinceDrop / 2.5);
    const intensityTarget = clamp01((0.7 * vs.energy + 0.55 * vs.dropProximity + 0.35 * glow) * this.params.intensityGain);
    vs.intensity = smooth(vs.intensity, intensityTarget, dtSec, this.tau.intensity);

    // ---- aesthetics ----
    this.updateAesthetics(dtSec, live);

    this.prevT = tSec;
    return vs;
  }

  private updatePhase(tSec: number, s: Score | null) {
    const vs = this.vs;
    if (!s || s.beatTimesSec.length < 2) { vs.beatPhase = 0; vs.barPhase = 0; vs.beatsUntilDownbeat = 0; return; }
    const beats = s.beatTimesSec;
    const bi = lastIndexAtOrBefore(beats, tSec);
    if (bi >= 0 && bi < beats.length - 1) {
      vs.beatPhase = clamp01((tSec - beats[bi]) / Math.max(beats[bi + 1] - beats[bi], 1e-6));
    } else vs.beatPhase = 0;

    const downs = s.downbeatTimesSec;
    if (downs.length >= 2) {
      const di = lastIndexAtOrBefore(downs, tSec);
      if (di >= 0 && di < downs.length - 1) {
        const span = Math.max(downs[di + 1] - downs[di], 1e-6);
        vs.barPhase = clamp01((tSec - downs[di]) / span);
        const beatsPerBar = s.timeSignature || 4;
        vs.beatsUntilDownbeat = (1 - vs.barPhase) * beatsPerBar;
      } else if (di < 0 && downs.length) {
        vs.beatsUntilDownbeat = Math.max(0, (downs[0] - tSec) / (60 / Math.max(s.bpm, 1)));
      }
    }
  }

  private updateStructure(tSec: number, dtSec: number, s: Score | null) {
    const vs = this.vs;
    if (!s || !s.sections.length) {
      vs.section = 'unknown'; vs.sectionProgress = 0;
      vs.sectionEnergy = smooth(vs.sectionEnergy, 0, dtSec, 0.5);
      return;
    }
    let sec = s.sections[s.sections.length - 1];
    for (const x of s.sections) { if (tSec >= x.startSec && tSec < x.endSec) { sec = x; break; } }
    vs.section = sec.label as SectionLabel;
    vs.sectionProgress = clamp01((tSec - sec.startSec) / Math.max(sec.endSec - sec.startSec, 1e-6));
    // current section's mean energy, normalized across the song's sections, eased
    const range = Math.max(this.secEMax - this.secEMin, 1e-6);
    vs.sectionEnergy = smooth(vs.sectionEnergy, clamp01((sec.energy - this.secEMin) / range), dtSec, 0.5);
  }

  private updateDrop(tSec: number, dtSec: number, s: Score | null) {
    const vs = this.vs;
    // record crossing a drop onset
    for (const dt of this.dropTimes) {
      if (dt > this.prevT && dt <= tSec) this.lastDropTime = dt;
    }
    vs.sinceDrop = this.lastDropTime > -1e8 ? Math.max(0, tSec - this.lastDropTime) : 999;

    // ramp toward the next upcoming drop over a lead window of ~8 beats
    let target = 0;
    const next = this.dropTimes.find((dt) => dt > tSec);
    if (next !== undefined) {
      const leadSec = (this.params.dropLeadBars * 60) / Math.max(s?.bpm ?? 120, 1);
      target = clamp01((tSec - (next - leadSec)) / leadSec);
    }
    // snap to 0 right after a drop fires (released), then let it stay low
    if (vs.sinceDrop < dtSec * 2) vs.dropProximity = 0;
    else vs.dropProximity = smooth(vs.dropProximity, target, dtSec, this.tau.drop);
  }

  private updateAesthetics(dtSec: number, live: LiveFrame) {
    const vs = this.vs;
    const s = this.score;
    const pc = s?.key ? (NOTE_PC[s.key.tonic] ?? 0) : argmax(live.chroma);
    const minor = s?.key?.mode === 'minor';
    const baseHue = (pc / 12) * 360;

    // hueShift driven by harmony (key pc), nudged by the live dominant pitch class
    const liveHue = (argmax(live.chroma) / 12);
    vs.hueShift = smooth(vs.hueShift, clamp01(0.7 * (pc / 12) + 0.3 * liveHue), dtSec, this.tau.hue);

    const lift = vs.energy * 0.15 + vs.dropProximity * 0.1;
    const sat = minor ? 0.5 : 0.66;
    vs.palette = {
      primary: hslHex(baseHue, sat, 0.46 + lift),
      secondary: hslHex(baseHue + (minor ? -34 : 42), sat * 0.9, 0.4 + lift),
      accent: hslHex(baseHue + 180, 0.82, 0.6),
      bg: hslHex(baseHue, 0.4, 0.05 + vs.intensity * 0.04),
    };

    vs.mood = minor && vs.energy < 0.4 ? 'dark'
      : vs.energy > 0.7 && live.flux > 0.55 ? 'tense'
        : vs.brightness > 0.6 ? 'bright'
          : 'warm';
  }
}

function argmax(arr: number[]): number {
  let bi = 0, bv = -Infinity;
  for (let i = 0; i < arr.length; i++) if (arr[i] > bv) { bv = arr[i]; bi = i; }
  return bi;
}

function freshState(): VisualState {
  const band = { sub: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, presence: 0, air: 0 } as Record<BandName, number>;
  const palette: Palette = { primary: '#6b3aa0', secondary: '#23123a', accent: '#ffbf5e', bg: '#05030a' };
  return {
    tSec: 0, dtSec: 0,
    energy: 0, band, low: 0, mid: 0, high: 0, vocalPresence: 0, leadPresence: 0, brightness: 0,
    beat: 0, kick: 0, snare: 0, hat: 0, bass: 0, melody: 0, downbeat: 0,
    beatPhase: 0, barPhase: 0, beatsUntilDownbeat: 0, bpm: 120,
    section: 'unknown', sectionProgress: 0, sectionEnergy: 0, dropProximity: 0, sinceDrop: 999, intensity: 0,
    palette, hueShift: 0, mood: 'warm',
  };
}

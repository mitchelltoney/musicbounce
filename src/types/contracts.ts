/**
 * SYNESTHETE — DATA CONTRACTS  (canonical, law)
 * ------------------------------------------------------------------
 * Two contracts define the whole system:
 *
 *   1. Score      — produced ONCE per track by the Python analyzer (offline).
 *                   Serialized to JSON and returned by POST /analyze.
 *                   The Python side MUST emit this exact shape (mirror it with a
 *                   pydantic model; keep them in sync).
 *
 *   2. VisualState — produced EVERY FRAME at runtime by the Director.
 *                   The ONLY thing Scenes are allowed to read. Scenes never see
 *                   the Score or raw audio — all musical intelligence lives in the Director.
 *
 * These shapes do not drift. If a phase needs a new field, add it here first,
 * flag it, and update both sides. Never let the analyzer and the renderer disagree.
 */

/* ------------------------------------------------------------------ */
/* Shared vocabulary                                                   */
/* ------------------------------------------------------------------ */

/** Frequency bands for full-mix spectral analysis (always available). */
export type BandName =
  | 'sub'      // ~20–60 Hz    rumble / sub-bass
  | 'bass'     // ~60–160 Hz   kick body / bassline fundamentals
  | 'lowMid'   // ~160–400 Hz  warmth / low instruments
  | 'mid'      // ~400–1k Hz   body of most instruments
  | 'highMid'  // ~1k–3k Hz    presence / vocal intelligibility
  | 'presence' // ~3k–8k Hz    attack / clarity
  | 'air';     // ~8k–20k Hz   cymbals / sparkle / hiss

/** Demucs (htdemucs) stems. Present when the analyzer demixes (it does, via allin1). */
export type StemName = 'drums' | 'bass' | 'vocals' | 'other';

/**
 * Functional section labels. Superset of allin1's labels, normalized for choreography.
 * allin1 emits: start | end | intro | outro | break | bridge | inst | solo | verse | chorus
 * See ALLIN1_LABEL_MAP below for the normalization.
 */
export type SectionLabel =
  | 'intro'
  | 'verse'
  | 'build'      // <- allin1 'inst' / pre-drop instrumental ramps
  | 'drop'       // <- not labeled by allin1; inferred from energy jump into a high-energy section
  | 'chorus'     // <- allin1 'chorus' (the main hook; in EDM often coincident with a drop)
  | 'breakdown'  // <- allin1 'break'
  | 'bridge'     // <- allin1 'bridge' / 'solo'
  | 'outro'
  | 'silence'    // <- allin1 'start' / 'end' (leading/trailing markers)
  | 'unknown';

/** Maps raw allin1 labels onto our normalized SectionLabel. */
export const ALLIN1_LABEL_MAP: Record<string, SectionLabel> = {
  start: 'silence',
  end: 'silence',
  intro: 'intro',
  outro: 'outro',
  break: 'breakdown',
  bridge: 'bridge',
  solo: 'bridge',
  inst: 'build',
  verse: 'verse',
  chorus: 'chorus',
};

/** Reference band edges in Hz. The analyzer is the source of truth; this is for the renderer/UI. */
export const BAND_EDGES_HZ: Record<BandName, [number, number]> = {
  sub: [20, 60],
  bass: [60, 160],
  lowMid: [160, 400],
  mid: [400, 1000],
  highMid: [1000, 3000],
  presence: [3000, 8000],
  air: [8000, 20000],
};

/* ------------------------------------------------------------------ */
/* 1. SCORE  — analyzer output / POST /analyze response                */
/* ------------------------------------------------------------------ */

export interface KeyInfo {
  tonic: string;                 // e.g. "F#"
  mode: 'major' | 'minor';
  chroma12: number[];            // length-12 mean chroma vector (pitch-class energy), normalized 0..1
  confidence: number;            // 0..1
}

export interface Section {
  startSec: number;
  endSec: number;
  label: SectionLabel;
  energy: number;                // mean normalized loudness over the section, 0..1
  isDrop: boolean;               // inferred: sharp energy jump at this section's onset
}

export interface Envelope {
  timesSec: number[];            // frame times (monotonic)
  values: number[];              // same length; normalized 0..1 (peak / 99th-percentile normalized)
}

export interface Score {
  schemaVersion: 1;
  analyzedBy: 'python-allin1+librosa' | 'python-beatthis+librosa' | 'essentia-wasm';
  generatedAtISO: string;
  sourceHash: string;            // content hash of the decoded audio (cache key)

  durationSec: number;
  sampleRate: number;

  // --- rhythm (allin1 / beat_this) ---
  bpm: number;
  tempoConfidence: number;       // 0..1
  timeSignature: number;         // beats per bar (downbeat period). default 4
  beatTimesSec: number[];        // every beat
  downbeatTimesSec: number[];    // bar starts (drives phrase quantization). may be [] if unavailable
  beatPositions: number[];       // 1..timeSignature, parallel to beatTimesSec (which beat-in-bar)

  // --- onsets (librosa) ---
  // Always available: per-band onset times from the full mix.
  onsetsByBand: Record<BandName, number[]>;
  // Preferred when demixed: per-stem onset times. drums->kick/snare/hat precision.
  onsetsByStem?: Partial<Record<StemName, number[]>>;
  // Derived by band-splitting the drums stem into kick (low) / snare (mid) /
  // hat (high) onset times. The Director's kick/snare/hat impulses read these
  // (fallback: onsetsByBand). Present only when stems are available.
  drumHits?: { kick: number[]; snare: number[]; hat: number[] };
  // Per-onset normalized strength (0..1, gamma-shaped, RELATIVE to the loudest
  // onset across ALL layers in the track). Parallel to the layer onset-time arrays
  // (kick/snare/hat ← drumHits; bass/melody ← onsetsByStem). The Director scales
  // each impulse by how hard the hit was.
  onsetStrength?: {
    kick?: number[]; snare?: number[]; hat?: number[]; bass?: number[]; melody?: number[];
  };

  // --- energy ---
  energyEnvelope: Envelope;                 // overall loudness, normalized 0..1
  bandEnergy?: Partial<Record<BandName, Envelope>>;   // optional per-band envelopes
  stemEnergy?: Partial<Record<StemName, Envelope>>;   // optional per-stem envelopes (vocals -> presence)

  // --- spectral texture (librosa) ---
  spectral?: {
    timesSec: number[];
    centroid: number[];          // brightness, normalized 0..1
    flux: number[];              // spectral change / novelty, normalized 0..1
  };

  // --- structure (allin1) ---
  sections: Section[];           // contiguous, cover [0, durationSec], functionally labeled

  // --- harmony (librosa) ---
  key?: KeyInfo;
}

/* ------------------------------------------------------------------ */
/* 2. VISUAL STATE — Director output / scene input (per frame)         */
/* ------------------------------------------------------------------ */
/**
 * Conventions:
 *   - "continuous" channels are smoothed (one-pole low-pass), 0..1. Use for texture.
 *   - "impulse" channels snap to ~1 on an event then exp-decay, 0..1. Use for hits.
 *     attack is instantaneous; never strobe a continuous channel to fake a hit.
 *   - all timing derives from `tSec` (audioContext.currentTime, latency-compensated).
 */
export interface VisualState {
  /** Latency-compensated playback time. THE single source of truth for timing. */
  tSec: number;
  dtSec: number;                 // frame delta (for decay/lerp math)

  // --- continuous drivers (smoothed, 0..1) ---
  energy: number;                // overall loudness, smoothed
  band: Record<BandName, number>;
  low: number;                   // convenience: sub+bass aggregate
  mid: number;                   // convenience: mid bands aggregate
  high: number;                  // convenience: presence+air aggregate
  vocalPresence: number;         // from vocals stem energy (0 if no stem)
  leadPresence: number;          // from the 'other' stem (lead/synth/melody), smoothed
  brightness: number;            // spectral centroid, smoothed

  // --- impulses (instant attack, exp decay, 0..1) ---
  beat: number;                  // global beat impulse
  kick: number;                  // from drums-stem onsets (fallback: bass band)
  snare: number;                 // from drums-stem onsets (fallback: mid band)
  hat: number;                   // from drums-stem onsets (fallback: air band)
  bass: number;                  // from bass-stem onsets (fallback: bass band)
  melody: number;                // from the 'other'/lead stem onsets — the melodic pattern
  downbeat: number;              // fires on bar starts

  // --- musical phase ---
  beatPhase: number;             // 0..1 within the current beat
  barPhase: number;              // 0..1 within the current bar
  beatsUntilDownbeat: number;    // float; how far to the next bar start
  bpm: number;                   // current bpm (may drift if tempo curve added)

  // --- structure / choreography ---
  section: SectionLabel;
  sectionProgress: number;       // 0..1 through the current section
  sectionEnergy: number;         // 0..1, current section's mean energy RELATIVE to the song's sections
  dropProximity: number;         // 0..1, ramps as a detected drop approaches. THE anticipation signal.
  sinceDrop: number;             // seconds since the last drop onset (for release/afterglow)
  intensity: number;             // master "how big is this moment" — preserves dynamic range

  // --- aesthetics ---
  palette: Palette;
  hueShift: number;              // 0..1, driven by harmony/chroma
  mood: 'dark' | 'warm' | 'bright' | 'tense'; // derived from key/mode/energy; presets may use or ignore
}

export interface Palette {
  primary: string;   // hex
  secondary: string; // hex
  accent: string;    // hex
  bg: string;        // hex
}

/* ------------------------------------------------------------------ */
/* Smoothing helpers (reference impls — put real ones in src/director) */
/* ------------------------------------------------------------------ */

/** One-pole low-pass toward target. tau in seconds; larger tau = smoother/slower. */
export function smooth(current: number, target: number, dtSec: number, tauSec: number): number {
  const k = 1 - Math.exp(-dtSec / Math.max(tauSec, 1e-4));
  return current + (target - current) * k;
}

/** Exponential decay of an impulse. decayTau in seconds; smaller = snappier. */
export function decayImpulse(current: number, dtSec: number, decayTauSec: number): number {
  return current * Math.exp(-dtSec / Math.max(decayTauSec, 1e-4));
}

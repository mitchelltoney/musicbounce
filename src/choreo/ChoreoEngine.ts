/**
 * ChoreoEngine — a multi-track tap recorder for hand-choreography. Each track is a
 * visual ELEMENT whose rhythm you record by tapping the spacebar in time with the
 * music; every tap is stamped with the latency-compensated audio clock. Record one
 * element, then another. Pause and restart recording from a chosen phrase to fix
 * mistakes. Persists to localStorage.
 */
export type ElementStyle = 'stepper' | 'pulser' | 'spinner' | 'comet' | 'orbit';
export const ELEMENT_STYLES: ElementStyle[] = ['stepper', 'pulser', 'spinner', 'comet', 'orbit'];

export interface DanceTrack {
  id: string;
  name: string;
  style: ElementStyle;
  hue: number;        // 0..360
  taps: number[];     // sorted timestamps (sec)
  muted: boolean;
}

export interface Choreography {
  version: 1;
  song: string;
  tracks: DanceTrack[];
}

const STORAGE_PREFIX = 'synesthete.choreo.';
let _seq = 0;
const newId = () => `t${Date.now().toString(36)}${(_seq++).toString(36)}`;

export class ChoreoEngine {
  choreo: Choreography;
  activeId: string | null = null;
  recording = false;

  private onChange?: () => void;

  constructor(song: string, onChange?: () => void) {
    this.onChange = onChange;
    this.choreo = this.load(song) ?? { version: 1, song, tracks: [] };
    this.activeId = this.choreo.tracks[0]?.id ?? null;
  }

  get tracks(): DanceTrack[] { return this.choreo.tracks; }
  get active(): DanceTrack | null { return this.find(this.activeId); }

  addTrack(style: ElementStyle = 'stepper'): DanceTrack {
    const n = this.choreo.tracks.length;
    const t: DanceTrack = {
      id: newId(), name: `element ${n + 1}`, style, hue: (n * 67 + 200) % 360, taps: [], muted: false,
    };
    this.choreo.tracks.push(t);
    this.activeId = t.id;
    this.changed();
    return t;
  }

  removeTrack(id: string) {
    this.choreo.tracks = this.choreo.tracks.filter((t) => t.id !== id);
    if (this.activeId === id) this.activeId = this.choreo.tracks[0]?.id ?? null;
    this.changed();
  }

  setActive(id: string) { this.activeId = id; this.onChange?.(); }
  rename(id: string, name: string) { const t = this.find(id); if (t) { t.name = name; this.changed(); } }
  setStyle(id: string, style: ElementStyle) { const t = this.find(id); if (t) { t.style = style; this.changed(); } }
  setHue(id: string, hue: number) { const t = this.find(id); if (t) { t.hue = hue; this.changed(); } }
  toggleMute(id: string) { const t = this.find(id); if (t) { t.muted = !t.muted; this.changed(); } }
  clearTaps(id: string) { const t = this.find(id); if (t) { t.taps = []; this.changed(); } }

  /** Arm recording for the active track. If fromSec given, drop that track's taps at
   *  or after it so you re-record from there (a few may be lost — that's fine). */
  startRecording(fromSec?: number) {
    const t = this.active;
    if (!t) return;
    if (fromSec != null) t.taps = t.taps.filter((x) => x < fromSec - 1e-3);
    this.recording = true;
    this.onChange?.();
  }

  stopRecording() {
    this.recording = false;
    const t = this.active;
    if (t) t.taps.sort((a, b) => a - b);
    this.changed();
  }

  /** Record a tap (called from the spacebar handler with the audio clock time). */
  recordTap(timeSec: number) {
    if (!this.recording) return;
    const t = this.active;
    if (t) t.taps.push(timeSec);
  }

  private find(id: string | null) { return this.choreo.tracks.find((t) => t.id === id) ?? null; }
  private changed() { this.save(); this.onChange?.(); }

  // --- persistence ---
  save() {
    try { localStorage.setItem(STORAGE_PREFIX + this.choreo.song, JSON.stringify(this.choreo)); } catch { /* ignore */ }
  }
  private load(song: string): Choreography | null {
    try {
      const s = localStorage.getItem(STORAGE_PREFIX + song);
      return s ? (JSON.parse(s) as Choreography) : null;
    } catch { return null; }
  }
  exportJSON(): string { return JSON.stringify(this.choreo, null, 2); }
}

import Meyda from 'meyda';
import { BAND_EDGES_HZ, smooth } from '../types/contracts';
import type { BandName } from '../types/contracts';

export const BANDS: BandName[] = ['sub', 'bass', 'lowMid', 'mid', 'highMid', 'presence', 'air'];

export interface LiveFrame {
  rms: number;
  band: Record<BandName, number>;
  low: number;
  mid: number;
  high: number;
  brightness: number;
  flux: number;
  chroma: number[];
}

// Meyda has uneven type coverage across builds; access through a thin typed shim.
const M = Meyda as unknown as {
  sampleRate: number;
  bufferSize: number;
  extract: (features: string[], signal: Float32Array<ArrayBufferLike>) => Record<string, unknown> | null;
};

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

function emptyFrame(): LiveFrame {
  return {
    rms: 0,
    band: { sub: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, presence: 0, air: 0 },
    low: 0, mid: 0, high: 0, brightness: 0, flux: 0,
    chroma: new Array(12).fill(0),
  };
}

/**
 * LiveFeatures — the "alive texture" the offline Score can't provide. Reads the
 * AudioEngine's AnalyserNode each frame (pull, not push), extracts spectral
 * features via Meyda, maps them to our 7 BandName bands, auto-gains each channel
 * into 0..1, and one-pole smooths per channel (fast for transients, slow for
 * harmony). Nothing pops.
 */
export class LiveFeatures {
  readonly frame: LiveFrame = emptyFrame();

  private buf: Float32Array<ArrayBuffer>;
  private prevSpectrum: Float32Array | null = null;
  private peak: Record<string, number> = {};
  private binHz: number;

  // per-channel smoothing time constants (seconds)
  private tau = { rms: 0.05, band: 0.045, bright: 0.08, flux: 0.025, chroma: 0.2 };

  constructor(private analyser: AnalyserNode, sampleRate: number) {
    this.buf = new Float32Array(analyser.fftSize);
    M.sampleRate = sampleRate;
    M.bufferSize = analyser.fftSize;
    this.binHz = sampleRate / analyser.fftSize;
  }

  update(dtSec: number): void {
    this.analyser.getFloatTimeDomainData(this.buf);

    let spectrum: number[] = [];
    let chroma: number[] | null = null;
    let centroidBin = 0;
    let rms = 0;
    try {
      const f = M.extract(['rms', 'spectralCentroid', 'chroma', 'amplitudeSpectrum'], this.buf);
      if (f) {
        spectrum = (f.amplitudeSpectrum as number[]) ?? [];
        chroma = (f.chroma as number[]) ?? null;
        centroidBin = (f.spectralCentroid as number) ?? 0;
        rms = (f.rms as number) ?? 0;
      }
    } catch {
      rms = this.timeRms();
    }

    const rawBand = this.bandEnergies(spectrum);
    const flux = this.spectralFlux(spectrum);
    const brightnessHz = centroidBin * this.binHz;

    const decay = Math.exp(-dtSec / 3.0); // ~3 s adaptive peak memory
    const fr = this.frame;

    // One SHARED auto-gain across all bands preserves the relative spectral shape
    // (per-band gain saturates every band to ~1 and erases which band is loud).
    let maxBand = 0;
    for (const b of BANDS) if (rawBand[b] > maxBand) maxBand = rawBand[b];
    const bandPeak = this.updatePeak('band', maxBand, decay);
    for (const b of BANDS) {
      fr.band[b] = smooth(fr.band[b], clamp01(rawBand[b] / bandPeak), dtSec, this.tau.band);
    }
    fr.rms = smooth(fr.rms, clamp01(rms / this.updatePeak('rms', rms, decay)), dtSec, this.tau.rms);
    fr.flux = smooth(fr.flux, clamp01(flux / this.updatePeak('flux', flux, decay)), dtSec, this.tau.flux);
    fr.brightness = smooth(fr.brightness, clamp01(brightnessHz / 8000), dtSec, this.tau.bright);
    fr.low = (fr.band.sub + fr.band.bass) / 2;
    fr.mid = (fr.band.lowMid + fr.band.mid + fr.band.highMid) / 3;
    fr.high = (fr.band.presence + fr.band.air) / 2;
    if (chroma && chroma.length === 12) {
      for (let i = 0; i < 12; i++) fr.chroma[i] = smooth(fr.chroma[i], chroma[i], dtSec, this.tau.chroma);
    }
  }

  private updatePeak(key: string, value: number, decay: number): number {
    const peak = Math.max((this.peak[key] ?? 1e-6) * decay, value, 1e-6);
    this.peak[key] = peak;
    return peak;
  }

  private bandEnergies(spectrum: number[]): Record<BandName, number> {
    const out = { sub: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, presence: 0, air: 0 } as Record<BandName, number>;
    const n = spectrum.length;
    if (!n) return out;
    for (const b of BANDS) {
      const [lo, hi] = BAND_EDGES_HZ[b];
      const i0 = Math.max(0, Math.floor(lo / this.binHz));
      const i1 = Math.min(n - 1, Math.ceil(hi / this.binHz));
      let sum = 0;
      for (let i = i0; i <= i1; i++) sum += spectrum[i] * spectrum[i];
      out[b] = Math.sqrt(sum / Math.max(1, i1 - i0 + 1));
    }
    return out;
  }

  private spectralFlux(spectrum: number[]): number {
    const n = spectrum.length;
    if (!n) return 0;
    let flux = 0;
    const prev = this.prevSpectrum;
    if (prev && prev.length === n) {
      for (let i = 0; i < n; i++) {
        const d = spectrum[i] - prev[i];
        if (d > 0) flux += d;
      }
    }
    if (!this.prevSpectrum || this.prevSpectrum.length !== n) this.prevSpectrum = new Float32Array(n);
    this.prevSpectrum.set(spectrum);
    return flux / n;
  }

  private timeRms(): number {
    let s = 0;
    for (let i = 0; i < this.buf.length; i++) s += this.buf[i] * this.buf[i];
    return Math.sqrt(s / this.buf.length);
  }
}

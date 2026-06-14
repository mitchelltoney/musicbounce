import { describe, it, expect } from 'vitest';
import { Director } from './Director';
import type { BandName, Score } from '../types/contracts';
import type { LiveFrame } from '../features/LiveFeatures';

function emptyLive(): LiveFrame {
  const band = { sub: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, presence: 0, air: 0 } as Record<BandName, number>;
  return { rms: 0, band, low: 0, mid: 0, high: 0, brightness: 0, flux: 0, chroma: new Array(12).fill(0) };
}

// 120 BPM (beat every 0.5 s), downbeats every 2 s, one drop section at t=10 s.
function synthScore(): Score {
  const beats: number[] = [];
  const downs: number[] = [];
  for (let t = 0; t < 20; t += 0.5) beats.push(Number(t.toFixed(3)));
  for (let t = 0; t < 20; t += 2) downs.push(t);
  const empty = { sub: [], bass: [], lowMid: [], mid: [], highMid: [], presence: [], air: [] };
  return {
    schemaVersion: 1, analyzedBy: 'python-beatthis+librosa', generatedAtISO: '', sourceHash: 'test',
    durationSec: 20, sampleRate: 44100, bpm: 120, tempoConfidence: 1, timeSignature: 4,
    beatTimesSec: beats, downbeatTimesSec: downs, beatPositions: beats.map((_, i) => (i % 4) + 1),
    onsetsByBand: empty,
    drumHits: { kick: beats.slice(), snare: [], hat: [] },
    energyEnvelope: { timesSec: [0, 6, 10, 20], values: [0.2, 0.3, 0.9, 0.3] },
    sections: [
      { startSec: 0, endSec: 10, label: 'build', energy: 0.35, isDrop: false },
      { startSec: 10, endSec: 20, label: 'drop', energy: 0.9, isDrop: true },
    ],
  } as Score;
}

describe('Director', () => {
  it('fires the beat impulse right after a Score beat time, then decays', () => {
    const d = new Director();
    d.setScore(synthScore());
    const live = emptyLive();
    d.update(0.0, 0.016, live);
    d.update(0.48, 0.016, live);            // just before the beat at 0.5
    const vs = d.update(0.51, 0.016, live); // just crossed it
    expect(vs.beat).toBeGreaterThan(0.8);
    expect(vs.kick).toBeGreaterThan(0.8);   // kick onset also at 0.5

    let cur = vs.beat;
    for (let t = 0.52; t < 0.95; t += 0.016) cur = d.update(t, 0.016, live).beat;
    expect(cur).toBeLessThan(0.4);          // decayed before the next beat
  });

  it('beatPhase sweeps 0->1 within a beat', () => {
    const d = new Director();
    d.setScore(synthScore());
    const live = emptyLive();
    const a = d.update(2.05, 0.016, live).beatPhase; // just after a beat
    const b = d.update(2.45, 0.016, live).beatPhase; // near the next
    expect(a).toBeLessThan(0.3);
    expect(b).toBeGreaterThan(0.7);
  });

  it('dropProximity ramps toward a drop and releases on it', () => {
    const d = new Director();
    d.setScore(synthScore());
    const live = emptyLive();
    let vs = d.update(0, 0.05, live);
    for (let t = 0; t <= 9.9; t += 0.05) vs = d.update(t, 0.05, live);
    expect(vs.dropProximity).toBeGreaterThan(0.4); // wound up before the drop

    for (let t = 9.9; t <= 10.6; t += 0.05) vs = d.update(t, 0.05, live);
    expect(vs.dropProximity).toBeLessThan(0.2);     // released on the drop
    expect(vs.sinceDrop).toBeLessThan(1.0);
  });

  it('keeps continuous + impulse channels within [0,1]', () => {
    const d = new Director();
    d.setScore(synthScore());
    const live = emptyLive();
    const keys = ['energy', 'intensity', 'dropProximity', 'beat', 'kick', 'snare', 'hat', 'bass', 'melody', 'leadPresence', 'vocalPresence', 'downbeat', 'beatPhase', 'barPhase'] as const;
    for (let t = 0; t < 20; t += 0.05) {
      const vs = d.update(t, 0.05, live);
      for (const k of keys) {
        expect(vs[k]).toBeGreaterThanOrEqual(0);
        expect(vs[k]).toBeLessThanOrEqual(1.0001);
      }
    }
  });
});

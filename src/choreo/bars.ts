/** The bundled bar grid for a song (from its slim Score). */
export interface SongGrid {
  bpm: number;
  timeSignature: number;
  durationSec: number;
  beatTimesSec: number[];
  downbeatTimesSec: number[];
}

export interface BarGrid {
  bpm: number;
  beatsPerBar: number;
  durationSec: number;
  bars: number[];   // bar start times (sec), covering [0, duration]
  barLen: number;   // median seconds per bar
}

export interface Phrase {
  index: number;
  startSec: number;
  endSec: number;
  firstBar: number; // 1-based bar number
  bars: number;
}

/** Build a robust bar grid from downbeats (filling any gaps with the median bar length). */
export function buildBarGrid(g: SongGrid): BarGrid {
  const beatsPerBar = g.timeSignature || 4;
  let downs = (g.downbeatTimesSec ?? []).slice().sort((a, b) => a - b);
  let barLen = 60 / Math.max(g.bpm, 1) * beatsPerBar;
  if (downs.length >= 2) {
    const diffs = downs.slice(1).map((d, i) => d - downs[i]).sort((a, b) => a - b);
    barLen = diffs[Math.floor(diffs.length / 2)] || barLen;
  }
  // Synthesize a uniform grid from the first downbeat so bars are evenly spaced.
  const start = downs.length ? downs[0] % barLen : 0;
  const bars: number[] = [];
  for (let t = start; t < g.durationSec; t += barLen) bars.push(Number(t.toFixed(3)));
  if (!bars.length) bars.push(0);
  return { bpm: g.bpm, beatsPerBar, durationSec: g.durationSec, bars, barLen };
}

/** Group bars into phrases for the restart selector (bars are short; a phrase is a handle). */
export function phrases(grid: BarGrid, barsPerPhrase = 4): Phrase[] {
  const out: Phrase[] = [];
  for (let i = 0; i < grid.bars.length; i += barsPerPhrase) {
    const startSec = grid.bars[i];
    const endIdx = Math.min(i + barsPerPhrase, grid.bars.length);
    const endSec = endIdx < grid.bars.length ? grid.bars[endIdx] : grid.durationSec;
    out.push({ index: out.length, startSec, endSec, firstBar: i + 1, bars: endIdx - i });
  }
  return out;
}

export function barIndexAt(grid: BarGrid, t: number): number {
  let lo = 0, hi = grid.bars.length - 1, res = 0;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (grid.bars[m] <= t) { res = m; lo = m + 1; } else hi = m - 1; }
  return res;
}

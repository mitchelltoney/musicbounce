import { describe, it, expect } from 'vitest';
import { smooth, decayImpulse } from './contracts';

// Objective tests of the contract math helpers (the smoothing/impulse primitives
// every continuous channel and impulse in VisualState depends on).
describe('smooth() — one-pole low-pass', () => {
  it('converges toward the target', () => {
    let v = 0;
    for (let i = 0; i < 1000; i++) v = smooth(v, 1, 1 / 60, 0.1);
    expect(v).toBeGreaterThan(0.99);
    expect(v).toBeLessThanOrEqual(1);
  });

  it('moves monotonically toward a step target', () => {
    const a = smooth(0, 1, 1 / 60, 0.2);
    const b = smooth(a, 1, 1 / 60, 0.2);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
  });

  it('larger tau ⇒ slower approach', () => {
    const fast = smooth(0, 1, 1 / 60, 0.05);
    const slow = smooth(0, 1, 1 / 60, 0.5);
    expect(fast).toBeGreaterThan(slow);
  });
});

describe('decayImpulse() — instant attack, exponential decay', () => {
  it('decays a unit impulse toward zero', () => {
    let v = 1;
    const after = decayImpulse(v, 0.1, 0.08);
    expect(after).toBeLessThan(1);
    expect(after).toBeGreaterThan(0);
    for (let i = 0; i < 240; i++) v = decayImpulse(v, 1 / 60, 0.08);
    expect(v).toBeLessThan(0.01);
  });
});

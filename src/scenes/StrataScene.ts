import { FullscreenScene } from './Scene';

// Strata — instrument-separated light. Each element locks to a DIFFERENT rhythmic
// layer so the picture reads like the arrangement: a core that punches on the kick,
// a ring that breathes with the bass, a flash on the snare, nodes that pop outward
// on the MELODY pattern (the 'other'/lead stem — a different rhythm from the kick),
// outer sparkle on hats, and a soft halo on vocals/lead presence.
const FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec2 uResolution;
  uniform float uTime, uEnergy, uIntensity, uLow, uMid, uHigh;
  uniform float uKick, uSnare, uHat, uBass, uMelody, uDrop, uLead, uVocal;
  uniform vec3 uPrimary, uSecondary, uAccent;

  float ringMask(float r, float radius, float thick) {
    return smoothstep(thick, 0.0, abs(r - radius));
  }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec2 p = (vUv - 0.5) * vec2(uResolution.x / max(uResolution.y, 1.0), 1.0);
    float r = length(p);
    float a = atan(p.y, p.x);
    vec3 col = vec3(0.0);

    // CORE — kick
    col += uAccent * smoothstep(0.12 + 0.06 * uKick, 0.0, r) * (0.4 + 1.7 * uKick + 0.5 * uLow);

    // BASS ring — radius breathes with the bass
    float br = 0.24 + 0.06 * uBass + 0.02 * sin(uTime * 0.6);
    col += uPrimary * ringMask(r, br, 0.012 + 0.02 * uBass) * (0.4 + 1.3 * uBass + 0.4 * uLow);

    // SNARE ring — flashes on the snare backbeat
    col += uSecondary * 2.0 * ringMask(r, 0.40, 0.01) * (0.08 + 1.6 * uSnare);

    // MELODY nodes — pop OUTWARD on each melody onset (its own syncopated pattern)
    float nodeR = 0.54 + 0.12 * uMelody;
    float seg = 8.0;
    float ang = a + uTime * 0.15;
    float cell = fract((ang / 6.2831853 + 0.5) * seg) - 0.5;
    float node = smoothstep(0.06, 0.0, abs(r - nodeR)) * smoothstep(0.2, 0.0, abs(cell));
    col += uAccent * node * (0.3 + 2.0 * uMelody + 0.5 * uLead);

    // HAT sparkle — fine outer twinkle
    float sp = hash(floor(vUv * 70.0) + floor(uTime * 14.0));
    col += vec3(1.0) * step(0.86, sp) * smoothstep(0.45, 0.9, r) * (0.2 + 1.3 * uHat + 0.5 * uHigh);

    // VOCAL / LEAD halo — soft foreground swell
    col += uAccent * uVocal * smoothstep(0.85, 0.0, r) * 0.45;

    // DROP swell
    col += uPrimary * uDrop * smoothstep(0.7, 0.0, r) * 0.5;

    // restraint
    col *= 0.4 + 0.9 * uIntensity + 0.4 * uEnergy;
    col *= 1.0 - 0.25 * r;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class StrataScene extends FullscreenScene {
  readonly name = 'Strata';
  constructor(w: number, h: number) {
    super(w, h, FRAG);
  }
}

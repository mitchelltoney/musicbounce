import { FullscreenScene } from './Scene';

// Fluid / Plasma — domain-warped FBM advected by bass/low, colored from the
// palette, ignited by kicks, leveled by intensity (restraint). Reads only VisualState.
const FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec2 uResolution;
  uniform float uTime, uEnergy, uIntensity, uLow, uMid, uHigh, uKick, uBass, uDrop, uHue;
  uniform vec3 uPrimary, uSecondary, uAccent;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
    return v;
  }

  void main(){
    vec2 uv = vUv;
    vec2 p = (uv - 0.5) * vec2(uResolution.x / max(uResolution.y, 1.0), 1.0);
    float t = uTime * 0.15;

    // two-level domain warp; advection speed rides bass/low
    vec2 q = vec2(fbm(p * 1.6 + t), fbm(p * 1.6 + vec2(5.2, 1.3) - t));
    vec2 r = vec2(fbm(p * 1.6 + 3.0 * q + vec2(1.7, 9.2) + (0.25 + uBass) * t),
                  fbm(p * 1.6 + 3.0 * q + vec2(8.3, 2.8) - (0.25 + uLow) * t));
    float f = fbm(p * 1.6 + 2.5 * r);

    vec3 col = mix(uSecondary, uPrimary, smoothstep(0.15, 0.8, f));
    col = mix(col, uAccent, smoothstep(0.62, 1.0, f + 0.25 * uMid));
    col += uKick * 0.45 * uAccent;          // ignite on kick
    col += uDrop * 0.3 * uPrimary;          // pre-drop swell
    col += uHigh * 0.12 * vec3(1.0);        // sparkle

    // restraint: overall level tracks intensity + energy
    col *= 0.35 + 1.1 * uIntensity + 0.5 * uEnergy;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class PlasmaScene extends FullscreenScene {
  readonly name = 'Plasma';
  constructor(w: number, h: number) {
    super(w, h, FRAG);
  }
}

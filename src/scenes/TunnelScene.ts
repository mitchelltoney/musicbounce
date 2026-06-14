import * as THREE from 'three';
import { applyCommon, commonUniforms, FS_VERT, type Scene } from './Scene';
import { FeedbackBuffer } from './FeedbackBuffer';
import type { VisualState } from '../types/contracts';

// Geometric Tunnel — feedback trails ("the screen remembers"): each frame samples
// the previous frame zoomed + rotated toward center (the infinite-tunnel pull),
// faded, with fresh rings emitted on beats/kicks. Bass deepens the zoom; a drop
// tightens it. Reads only VisualState.
const FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec2 uResolution;
  uniform float uTime, uEnergy, uIntensity, uMid, uHigh, uKick, uBeat, uBass, uDrop;
  uniform vec3 uPrimary, uSecondary, uAccent;
  uniform sampler2D uPrev;

  mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

  void main() {
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 c = vUv - 0.5; c.x *= aspect;

    // feedback transform: zoom toward center + slow rotation
    float zoom = 0.975 - 0.02 * uBass - 0.03 * uDrop;
    float rotA = 0.012 + 0.04 * uHigh + 0.015 * sin(uTime * 0.3);
    vec2 fuv = rot(rotA) * (c * zoom);
    fuv.x /= aspect; fuv += 0.5;
    vec3 prev = texture2D(uPrev, fuv).rgb * 0.94; // fade trails

    // new content
    float r = length(c);
    float ring = smoothstep(0.025, 0.0, abs(r - (0.16 + 0.14 * uKick)));
    float ang = atan(c.y, c.x);
    float spokes = 0.5 + 0.5 * sin(ang * 6.0 + uTime * 1.2);
    vec3 newc = uPrimary * ring * (0.5 + uBeat);
    newc += uAccent * uKick * smoothstep(0.34, 0.0, r) * 0.5;
    newc += uSecondary * spokes * 0.04 * uMid;
    newc += uAccent * uDrop * smoothstep(0.5, 0.0, r) * 0.4;
    newc *= 0.28 + 0.6 * uIntensity + 0.3 * uEnergy; // restraint on new energy

    gl_FragColor = vec4(min(prev + newc, vec3(1.4)), 1.0);
  }
`;

export class TunnelScene implements Scene {
  readonly name = 'Tunnel';
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private fb: FeedbackBuffer;
  private material: THREE.ShaderMaterial;

  constructor(w: number, h: number) {
    this.fb = new FeedbackBuffer(w, h);
    this.material = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: FRAG,
      uniforms: { ...commonUniforms(w, h), uPrev: { value: null } },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  render(renderer: THREE.WebGLRenderer, vs: VisualState): THREE.Texture {
    applyCommon(this.material.uniforms, vs);
    this.material.uniforms.uPrev.value = this.fb.read.texture;
    renderer.setRenderTarget(this.fb.write);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(null);
    this.fb.swap();
    return this.fb.read.texture; // after swap, read = the frame just written
  }

  setSize(w: number, h: number) {
    this.fb.setSize(w, h);
    (this.material.uniforms.uResolution.value as THREE.Vector2).set(w, h);
  }

  dispose() { this.fb.dispose(); this.material.dispose(); }
}

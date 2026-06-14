import * as THREE from 'three';
import type { VisualState } from '../types/contracts';

/** A visual world. Reads ONLY VisualState; renders to an offscreen texture that
 *  the Compositor displays + blooms. */
export interface Scene {
  readonly name: string;
  render(renderer: THREE.WebGLRenderer, vs: VisualState): THREE.Texture;
  setSize(w: number, h: number): void;
  dispose(): void;
}

export const FS_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export function makeRT(w: number, h: number, depth = false): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: depth,
  });
}

const _c = new THREE.Color();
function hexToVec(hex: string, out: THREE.Vector3): void {
  _c.set(hex);
  out.set(_c.r, _c.g, _c.b);
}

/** Standard uniform block exposing the VisualState channels scenes care about. */
export function commonUniforms(w: number, h: number): Record<string, THREE.IUniform> {
  return {
    uTime: { value: 0 }, uResolution: { value: new THREE.Vector2(w, h) },
    uEnergy: { value: 0 }, uIntensity: { value: 0 },
    uLow: { value: 0 }, uMid: { value: 0 }, uHigh: { value: 0 },
    uBeat: { value: 0 }, uKick: { value: 0 }, uSnare: { value: 0 },
    uHat: { value: 0 }, uBass: { value: 0 }, uMelody: { value: 0 }, uDownbeat: { value: 0 },
    uDrop: { value: 0 }, uHue: { value: 0 }, uVocal: { value: 0 }, uLead: { value: 0 },
    uPrimary: { value: new THREE.Vector3(0.42, 0.22, 0.62) },
    uSecondary: { value: new THREE.Vector3(0.10, 0.07, 0.20) },
    uAccent: { value: new THREE.Vector3(1.0, 0.75, 0.35) },
  };
}

export function applyCommon(u: Record<string, THREE.IUniform>, vs: VisualState): void {
  u.uTime.value = vs.tSec;
  u.uEnergy.value = vs.energy; u.uIntensity.value = vs.intensity;
  u.uLow.value = vs.low; u.uMid.value = vs.mid; u.uHigh.value = vs.high;
  u.uBeat.value = vs.beat; u.uKick.value = vs.kick; u.uSnare.value = vs.snare;
  u.uHat.value = vs.hat; u.uBass.value = vs.bass; u.uMelody.value = vs.melody; u.uDownbeat.value = vs.downbeat;
  u.uDrop.value = vs.dropProximity; u.uHue.value = vs.hueShift;
  u.uVocal.value = vs.vocalPresence; u.uLead.value = vs.leadPresence;
  hexToVec(vs.palette.primary, u.uPrimary.value as THREE.Vector3);
  hexToVec(vs.palette.secondary, u.uSecondary.value as THREE.Vector3);
  hexToVec(vs.palette.accent, u.uAccent.value as THREE.Vector3);
}

/** Base for scenes that are a single fullscreen fragment shader. */
export abstract class FullscreenScene implements Scene {
  abstract readonly name: string;
  protected scene = new THREE.Scene();
  protected camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  protected target: THREE.WebGLRenderTarget;
  protected material: THREE.ShaderMaterial;

  constructor(w: number, h: number, frag: string, extra: Record<string, THREE.IUniform> = {}) {
    this.target = makeRT(w, h);
    this.material = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: frag,
      uniforms: { ...commonUniforms(w, h), ...extra },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  /** Hook for scene-specific uniforms beyond the common block. */
  protected updateExtra(_vs: VisualState): void {}

  render(renderer: THREE.WebGLRenderer, vs: VisualState): THREE.Texture {
    applyCommon(this.material.uniforms, vs);
    this.updateExtra(vs);
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(null);
    return this.target.texture;
  }

  setSize(w: number, h: number): void {
    this.target.setSize(Math.max(1, w), Math.max(1, h));
    (this.material.uniforms.uResolution.value as THREE.Vector2).set(w, h);
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
  }
}

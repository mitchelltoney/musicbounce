import * as THREE from 'three';
import { applyCommon, commonUniforms, makeRT, type Scene } from './Scene';
import type { VisualState } from '../types/contracts';

// Particle Field — a 3D point cloud; turbulence rides low/bass, kicks punch the
// cloud outward and flare point size, color from the palette. Additive.
const VERT = /* glsl */ `
  attribute float aSeed;
  uniform float uTime, uEnergy, uKick, uLow, uSize;
  varying float vGlow;
  void main() {
    vec3 p = position;
    float t = uTime * 0.4 + aSeed * 6.2831;
    p += 0.3 * vec3(sin(t + p.y), cos(t * 1.1 + p.z), sin(t * 0.9 + p.x)) * (0.5 + uLow);
    p *= 1.0 + 0.18 * uKick;                    // kick pushes the cloud outward
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = uSize * (0.4 + 1.6 * uEnergy + 2.2 * uKick * aSeed);
    gl_PointSize = size / max(-mv.z, 0.1);
    vGlow = 0.4 + 0.8 * uEnergy + aSeed * 0.3;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uPrimary, uAccent;
  varying float vGlow;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    if (r > 0.5) discard;
    float a = smoothstep(0.5, 0.0, r);
    vec3 col = mix(uPrimary, uAccent, clamp(vGlow * 0.6, 0.0, 1.0)) * vGlow;
    gl_FragColor = vec4(col, a);
  }
`;

export class ParticleFieldScene implements Scene {
  readonly name = 'Particles';
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private target: THREE.WebGLRenderTarget;
  private points: THREE.Points;
  private material: THREE.ShaderMaterial;
  private uniforms: Record<string, THREE.IUniform>;

  constructor(w: number, h: number) {
    this.target = makeRT(w, h, true);
    this.camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 100);
    this.camera.position.z = 5;

    const N = 5000;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() * 2 - 1) * 4;
      pos[i * 3 + 1] = (Math.random() * 2 - 1) * 4;
      pos[i * 3 + 2] = (Math.random() * 2 - 1) * 4;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));

    this.uniforms = { ...commonUniforms(w, h), uSize: { value: h / 28 } };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  render(renderer: THREE.WebGLRenderer, vs: VisualState): THREE.Texture {
    applyCommon(this.uniforms, vs);
    this.points.rotation.y = vs.tSec * 0.05;
    this.points.rotation.x = Math.sin(vs.tSec * 0.03) * 0.3;
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(null);
    return this.target.texture;
  }

  setSize(w: number, h: number) {
    this.target.setSize(Math.max(1, w), Math.max(1, h));
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    (this.uniforms.uResolution.value as THREE.Vector2).set(w, h);
    this.uniforms.uSize.value = h / 28;
  }

  dispose() {
    this.target.dispose();
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

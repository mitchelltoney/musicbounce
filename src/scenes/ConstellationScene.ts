import * as THREE from 'three';
import { FS_VERT, type Scene } from './Scene';
import { FeedbackBuffer } from './FeedbackBuffer';
import type { VisualState } from '../types/contracts';

/**
 * Constellation — each confidently-isolated layer is an AGENT: a distinctly-colored
 * dot that lives in its own region and ONLY moves on a perturbation (an onset of
 * its layer). Both the step distance and the pulse (size flare) are proportional to
 * how hard that hit was, relative to the rest of the song. Fading trails + faint
 * graph edges. The backdrop is tinted by the current SECTION's energy tier (calm &
 * dark in quiet sections, brighter in energetic ones). Reads only VisualState.
 */
type ImpulseKey = 'kick' | 'snare' | 'hat' | 'bass' | 'melody' | 'beat';

interface AgentDef { key: ImpulseKey; color: [number, number, number]; }

// 6 maximally-distinct hues so every dot is unmistakable.
const AGENT_DEFS: AgentDef[] = [
  { key: 'kick', color: [1.0, 0.20, 0.20] },   // red
  { key: 'snare', color: [1.0, 0.85, 0.18] },  // yellow
  { key: 'hat', color: [0.30, 1.0, 0.40] },    // green
  { key: 'bass', color: [0.28, 0.50, 1.0] },   // blue
  { key: 'melody', color: [1.0, 0.30, 0.88] }, // magenta
  { key: 'beat', color: [0.25, 0.95, 0.95] },  // cyan
];

const REGION = 0.17; // how far an agent may wander from its home

const FADE_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uPrev;
  uniform float uFade;
  uniform vec3 uBg;
  void main() {
    vec3 prev = texture2D(uPrev, vUv).rgb;
    gl_FragColor = vec4(mix(uBg, prev, uFade), 1.0); // trails decay toward the energy-tier backdrop
  }
`;

const POINT_VERT = /* glsl */ `
  attribute float aGlow;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vGlow;
  uniform float uSize;
  void main() {
    vColor = aColor; vGlow = aGlow;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * (2.0 + aGlow * 16.0); // pulse size proportional to hit strength
  }
`;

const POINT_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vColor;
  varying float vGlow;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    if (r > 0.5) discard;
    float a = smoothstep(0.5, 0.26, r);     // crisp disk so each dot stays distinct
    gl_FragColor = vec4(vColor * (0.55 + vGlow * 1.05), a); // keep hue (don't blow to white)
  }
`;

const _col = new THREE.Color();

export class ConstellationScene implements Scene {
  readonly name = 'Constellation';
  private fb: FeedbackBuffer;
  private fadeScene = new THREE.Scene();
  private fadeMat: THREE.ShaderMaterial;
  private agentScene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);

  private points: THREE.Points;
  private edges: THREE.LineSegments;
  private posAttr: THREE.BufferAttribute;
  private glowAttr: THREE.BufferAttribute;
  private edgeAttr: THREE.BufferAttribute;
  private pointMat: THREE.ShaderMaterial;
  private aspect = 1;

  private agents = AGENT_DEFS.map((d) => ({
    ...d, homeX: 0, homeY: 0, posX: 0, posY: 0, walkAngle: 0, last: 0,
  }));

  constructor(w: number, h: number) {
    this.aspect = h / Math.max(1, w);
    this.fb = new FeedbackBuffer(w, h);

    this.fadeMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: FADE_FRAG,
      uniforms: { uPrev: { value: null }, uFade: { value: 0.9 }, uBg: { value: new THREE.Vector3() } },
    });
    const fq = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.fadeMat);
    fq.frustumCulled = false;
    this.fadeScene.add(fq);

    const n = this.agents.length;
    const col = new Float32Array(n * 3);
    this.agents.forEach((a, i) => { col[i * 3] = a.color[0]; col[i * 3 + 1] = a.color[1]; col[i * 3 + 2] = a.color[2]; });
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    this.glowAttr = new THREE.BufferAttribute(new Float32Array(n), 1);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aGlow', this.glowAttr);
    this.pointMat = new THREE.ShaderMaterial({
      vertexShader: POINT_VERT, fragmentShader: POINT_FRAG,
      uniforms: { uSize: { value: 4 } },
      transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.pointMat);
    this.points.frustumCulled = false;
    this.agentScene.add(this.points);

    const egeo = new THREE.BufferGeometry();
    this.edgeAttr = new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3);
    egeo.setAttribute('position', this.edgeAttr);
    this.edges = new THREE.LineSegments(egeo, new THREE.LineBasicMaterial({
      color: new THREE.Color(0.35, 0.42, 0.6), transparent: true, opacity: 0.28,
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
    }));
    this.edges.frustumCulled = false;
    this.agentScene.add(this.edges);

    this.placeHomes(h);
  }

  private placeHomes(h: number) {
    this.pointMat.uniforms.uSize.value = Math.max(3, Math.min(h / 220, 8));
    this.agents.forEach((a, i) => {
      const ang = (i / this.agents.length) * Math.PI * 2 - Math.PI / 2;
      a.homeX = 0.6 * Math.cos(ang) * this.aspect;
      a.homeY = 0.6 * Math.sin(ang);
      a.posX = a.homeX; a.posY = a.homeY; a.walkAngle = ang;
    });
  }

  render(renderer: THREE.WebGLRenderer, vs: VisualState): THREE.Texture {
    const pos = this.posAttr.array as Float32Array;
    const glow = this.glowAttr.array as Float32Array;
    const epos = this.edgeAttr.array as Float32Array;
    const n = this.agents.length;

    this.agents.forEach((a, i) => {
      const imp = vs[a.key];
      if (imp > a.last + 0.04) {            // a perturbation: step (only then)
        const strength = imp;               // 0..1, relative to the song
        a.walkAngle += 0.7 + strength * 1.6;
        const step = 0.02 + strength * 0.13; // movement distance proportional to strength
        a.posX += Math.cos(a.walkAngle) * step;
        a.posY += Math.sin(a.walkAngle) * step;
        const dx = a.posX - a.homeX, dy = a.posY - a.homeY, d = Math.hypot(dx, dy);
        if (d > REGION) { a.posX = a.homeX + (dx / d) * REGION; a.posY = a.homeY + (dy / d) * REGION; }
      }
      a.last = imp;
      pos[i * 3] = a.posX; pos[i * 3 + 1] = a.posY; pos[i * 3 + 2] = 0;
      glow[i] = imp;                         // pulse size proportional to strength
    });
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      epos[i * 6] = pos[i * 3]; epos[i * 6 + 1] = pos[i * 3 + 1]; epos[i * 6 + 2] = 0;
      epos[i * 6 + 3] = pos[j * 3]; epos[i * 6 + 4] = pos[j * 3 + 1]; epos[i * 6 + 5] = 0;
    }
    this.posAttr.needsUpdate = this.glowAttr.needsUpdate = this.edgeAttr.needsUpdate = true;

    // energy-tier backdrop: the song's palette colour, brightened by the current
    // section's (normalized) energy — calm/dark when quiet, brighter when energetic.
    _col.set(vs.palette.primary);
    const k = 0.04 + vs.sectionEnergy * 0.2;
    (this.fadeMat.uniforms.uBg.value as THREE.Vector3).set(_col.r * k + 0.008, _col.g * k + 0.008, _col.b * k + 0.015);
    this.fadeMat.uniforms.uPrev.value = this.fb.read.texture;

    renderer.setRenderTarget(this.fb.write);
    renderer.render(this.fadeScene, this.cam);
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.agentScene, this.cam);
    renderer.autoClear = ac;
    renderer.setRenderTarget(null);
    this.fb.swap();
    return this.fb.read.texture;
  }

  setSize(w: number, h: number) {
    this.aspect = h / Math.max(1, w);
    this.fb.setSize(w, h);
    this.placeHomes(h);
  }

  dispose() {
    this.fb.dispose();
    this.fadeMat.dispose();
    this.pointMat.dispose();
    this.points.geometry.dispose();
    this.edges.geometry.dispose();
    (this.edges.material as THREE.Material).dispose();
  }
}

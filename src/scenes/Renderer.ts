import * as THREE from 'three';
import {
  BlendFunction, BloomEffect, EffectComposer, EffectPass, RenderPass,
  ToneMappingEffect, ToneMappingMode,
} from 'postprocessing';
import type { VisualState, SectionLabel } from '../types/contracts';
import { FS_VERT, type Scene } from './Scene';
import { ConstellationScene } from './ConstellationScene';
import { StrataScene } from './StrataScene';
import { PlasmaScene } from './PlasmaScene';
import { ParticleFieldScene } from './ParticleFieldScene';
import { TunnelScene } from './TunnelScene';

export type ProduceState = (tSec: number, dtSec: number) => VisualState;
export type OnFps = (fps: number) => void;

const PRESENT_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTexA, uTexB;
  uniform float uMix;
  void main() { gl_FragColor = mix(texture2D(uTexA, vUv), texture2D(uTexB, vUv), uMix); }
`;

/**
 * Compositor — owns the WebGLRenderer + post chain + scenes + choreography.
 * Each scene renders to its own texture; a present quad cross-fades the outgoing
 * and incoming scene, then bloom + ACES tone-mapping. In auto mode the active
 * scene follows the song's SECTION (boundaries are downbeat-aligned, so scene
 * changes land on phrase boundaries). Bloom strength tracks intensity.
 */
export class Renderer {
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private bloom: BloomEffect | null = null;
  private presentScene = new THREE.Scene();
  private presentCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private presentMat: THREE.ShaderMaterial;
  private scenes: Scene[];

  private activeIndex = 0;
  private prevIndex: number | null = null;
  private mixT = 1;
  private fadeDur = 1.2;
  private auto = true;
  private lastSection: SectionLabel | '' = '';

  private raf = 0;
  private running = false;
  private lastMs = 0;
  private fpsAccumMs = 0;
  private fpsFrames = 0;

  // live-tunable params (exposed to the tuning panel)
  readonly params = { bloom: 0.8, autoChoreo: true, crossfadeSec: 1.2 };

  constructor(private canvas: HTMLCanvasElement, private getTime: () => number, private onFps?: OnFps) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    this.presentMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: PRESENT_FRAG,
      uniforms: { uTexA: { value: null }, uTexB: { value: null }, uMix: { value: 1 } },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.presentMat);
    quad.frustumCulled = false;
    this.presentScene.add(quad);

    const s = this.drawSize();
    this.scenes = [
      new ConstellationScene(s.x, s.y),
      new StrataScene(s.x, s.y),
      new PlasmaScene(s.x, s.y),
      new ParticleFieldScene(s.x, s.y),
      new TunnelScene(s.x, s.y),
    ];

    try {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.presentScene, this.presentCamera));
      this.bloom = new BloomEffect({
        blendFunction: BlendFunction.ADD,
        intensity: 0.8, luminanceThreshold: 0.5, luminanceSmoothing: 0.4, mipmapBlur: true, radius: 0.7,
      });
      const effects: import('postprocessing').Effect[] = [this.bloom];
      try { effects.push(new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })); } catch { /* bloom only */ }
      this.composer.addPass(new EffectPass(this.presentCamera, ...effects));
    } catch (e) {
      console.warn('[compositor] post unavailable; direct present:', e);
      this.composer = null;
    }

    this.resize();
    window.addEventListener('resize', this.resize);
  }

  get activeName(): string { return this.scenes[this.activeIndex]?.name ?? ''; }
  get sceneNames(): string[] { return this.scenes.map((s) => s.name); }
  get isAuto(): boolean { return this.auto; }

  setAuto(on: boolean) { this.auto = on; this.params.autoChoreo = on; }

  /** Manual selection (turns off auto choreography). */
  next(): string { this.setAuto(false); this.requestScene((this.activeIndex + 1) % this.scenes.length); return this.activeName; }
  setScene(i: number): string { this.setAuto(false); this.requestScene(i); return this.activeName; }

  private requestScene(i: number, fadeSec = this.params.crossfadeSec) {
    if (i < 0 || i >= this.scenes.length || i === this.activeIndex) return;
    this.prevIndex = this.activeIndex;
    this.activeIndex = i;
    this.mixT = 0;
    this.fadeDur = Math.max(0.05, fadeSec);
  }

  private idxOf(name: string): number {
    const i = this.scenes.findIndex((s) => s.name === name);
    return i < 0 ? this.activeIndex : i;
  }

  /** Map the current section + intensity to a scene (genre-agnostic energy tiers). */
  private sceneForSection(section: SectionLabel, intensity: number): number {
    switch (section) {
      case 'silence': case 'intro': case 'outro': case 'breakdown':
        return this.idxOf('Plasma');
      case 'verse':
        return this.idxOf('Constellation');
      case 'bridge': case 'build':
        return this.idxOf('Strata');
      case 'chorus': case 'drop':
        return intensity > 0.66 ? this.idxOf('Tunnel') : this.idxOf('Particles');
      default:
        return this.activeIndex;
    }
  }

  private autoChoreograph(vs: VisualState) {
    if (!this.auto) return;
    if (vs.section !== this.lastSection) {
      this.lastSection = vs.section;
      const target = this.sceneForSection(vs.section, vs.intensity);
      if (target !== this.activeIndex && this.prevIndex === null) this.requestScene(target);
    }
  }

  private drawSize(): THREE.Vector2 {
    const v = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(v);
    return new THREE.Vector2(Math.max(1, v.x), Math.max(1, v.y));
  }

  private resize = () => {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    const s = this.drawSize();
    for (const sc of this.scenes) sc.setSize(s.x, s.y);
  };

  start(produce: ProduceState) {
    if (this.running) return;
    this.running = true;
    this.lastMs = performance.now();
    const loop = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const now = performance.now();
      const frameMs = now - this.lastMs;
      this.lastMs = now;
      const dtSec = Math.min(frameMs / 1000, 0.1);
      const tSec = this.getTime();
      const vs = produce(tSec, dtSec);

      this.auto = this.params.autoChoreo;
      this.autoChoreograph(vs);

      const u = this.presentMat.uniforms;
      const texB = this.scenes[this.activeIndex].render(this.renderer, vs);
      if (this.prevIndex !== null) {
        const texA = this.scenes[this.prevIndex].render(this.renderer, vs);
        u.uTexA.value = texA;
        u.uTexB.value = texB;
        this.mixT = Math.min(1, this.mixT + dtSec / this.fadeDur);
        u.uMix.value = this.mixT * this.mixT * (3 - 2 * this.mixT); // smoothstep ease
        if (this.mixT >= 1) this.prevIndex = null;
      } else {
        u.uTexA.value = texB;
        u.uTexB.value = texB;
        u.uMix.value = 1;
      }

      if (this.bloom) this.bloom.intensity = this.params.bloom * (0.4 + vs.intensity * 1.3);
      if (this.composer) this.composer.render();
      else this.renderer.render(this.presentScene, this.presentCamera);

      this.fpsAccumMs += frameMs;
      this.fpsFrames += 1;
      if (this.fpsAccumMs >= 500) {
        this.onFps?.(Math.round((this.fpsFrames * 1000) / this.fpsAccumMs));
        this.fpsAccumMs = 0;
        this.fpsFrames = 0;
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() { this.running = false; if (this.raf) cancelAnimationFrame(this.raf); }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this.resize);
    for (const s of this.scenes) s.dispose();
    this.composer?.dispose();
    this.presentMat.dispose();
    this.renderer.dispose();
  }
}

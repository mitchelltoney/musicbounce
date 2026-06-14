import { Pane } from 'tweakpane';
import type { Renderer } from '../scenes/Renderer';
import type { Director } from '../director/Director';

/** Live tuning panel (Tweakpane) — the human-in-the-loop aesthetic interface.
 *  Binds compositor + Director params so feel can be dialed in real time.
 *  (Tweakpane's bundled types are uneven across builds, so the fluent API is
 *  driven through a loosely-typed handle.) */
export class TuningPanel {
  private pane: Pane;

  constructor(container: HTMLElement, renderer: Renderer, director: Director) {
    const pane = new Pane({ container, title: 'tuning · press t to hide' });
    this.pane = pane;
    const p = pane as unknown as {
      addFolder: (cfg: { title: string }) => Folder;
      refresh: () => void;
    };

    const scene = p.addFolder({ title: 'scene' });
    scene.addBinding(renderer.params, 'autoChoreo', { label: 'auto-choreograph' });
    scene.addBinding(renderer.params, 'crossfadeSec', { min: 0.1, max: 4, label: 'crossfade (s)' });
    scene.addBinding(renderer.params, 'bloom', { min: 0, max: 2, label: 'bloom' });
    const pick = { scene: 0 };
    scene
      .addBinding(pick, 'scene', {
        label: 'pick (manual)',
        options: Object.fromEntries(renderer.sceneNames.map((n, i) => [n, i])),
      })
      .on('change', (ev) => renderer.setScene(ev.value));

    const dir = p.addFolder({ title: 'director' });
    dir.addBinding(director.params, 'impulseDecay', { min: 0.3, max: 2.5, label: 'impulse decay' });
    dir.addBinding(director.params, 'intensityGain', { min: 0.3, max: 2.0, label: 'intensity' });
    dir.addBinding(director.params, 'dropLeadBars', { min: 2, max: 16, step: 1, label: 'drop lead (bars)' });
  }

  refresh() { (this.pane as unknown as { refresh: () => void }).refresh(); }
  dispose() { this.pane.dispose(); }
}

// minimal structural types for the Tweakpane fluent API we use
interface Binding { on(ev: 'change', cb: (e: { value: number }) => void): void; }
interface Folder {
  addBinding(obj: object, key: string, opts?: Record<string, unknown>): Binding;
}

import * as THREE from 'three';
import { makeRT } from './Scene';

/** Ping-pong render targets — the substrate for feedback trails ("the screen
 *  remembers"). Read the previous frame, write the next, swap. */
export class FeedbackBuffer {
  private a: THREE.WebGLRenderTarget;
  private b: THREE.WebGLRenderTarget;

  constructor(w: number, h: number) {
    this.a = makeRT(w, h);
    this.b = makeRT(w, h);
  }

  get read() { return this.a; }
  get write() { return this.b; }

  swap() { const t = this.a; this.a = this.b; this.b = t; }

  setSize(w: number, h: number) {
    this.a.setSize(Math.max(1, w), Math.max(1, h));
    this.b.setSize(Math.max(1, w), Math.max(1, h));
  }

  dispose() { this.a.dispose(); this.b.dispose(); }
}

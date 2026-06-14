/**
 * AudioEngine — decode, transport, and the latency-compensated MASTER CLOCK.
 *
 * HARD RULE (CLAUDE.md): musical time comes ONLY from audioContext.currentTime,
 * latency-compensated:  t = ctx.currentTime - startedAt - ctx.outputLatency + seekOffset.
 * NEVER rAF timestamps or Date.now() for musical timing. This module is imperative
 * and lives OUTSIDE React's render loop (driven via refs).
 */
export type TransportState = 'empty' | 'stopped' | 'playing' | 'paused';

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly analyser: AnalyserNode;
  private gain: GainNode;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;

  private state: TransportState = 'empty';
  private startedAtCtx = 0; // ctx.currentTime at the moment the current play() began
  private startOffset = 0;  // playback position (sec) at that moment
  private pausedAt = 0;     // last known playback position while not playing

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
    // side-tap for live feature analysis (Meyda reads this AnalyserNode; it does
    // not alter the audio path — the gain still drives destination directly).
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.gain.connect(this.analyser);
  }

  get transport(): TransportState { return this.state; }
  get durationSec(): number { return this.buffer?.duration ?? 0; }
  get isPlaying(): boolean { return this.state === 'playing'; }
  get sampleRate(): number { return this.ctx.sampleRate; }
  get audioBuffer(): AudioBuffer | null { return this.buffer; }

  /** Latency-compensated playback time — THE master clock everything reads. */
  getTime(): number {
    if (this.state === 'playing') {
      const t = this.ctx.currentTime - this.startedAtCtx - this.outputLatency() + this.startOffset;
      const dur = this.durationSec;
      return dur > 0 ? Math.min(Math.max(t, 0), dur) : Math.max(t, 0);
    }
    return this.pausedAt;
  }

  private outputLatency(): number {
    const c = this.ctx as AudioContext & { outputLatency?: number };
    if (typeof c.outputLatency === 'number' && Number.isFinite(c.outputLatency)) return c.outputLatency;
    if (typeof c.baseLatency === 'number' && Number.isFinite(c.baseLatency)) return c.baseLatency;
    return 0;
  }

  async loadFile(file: File): Promise<void> {
    await this.loadArrayBuffer(await file.arrayBuffer());
  }

  async loadArrayBuffer(data: ArrayBuffer): Promise<void> {
    this.stop();
    // decodeAudioData detaches the buffer; pass a copy so callers keep theirs.
    this.buffer = await this.ctx.decodeAudioData(data.slice(0));
    this.pausedAt = 0;
    this.startOffset = 0;
    this.state = 'stopped';
  }

  async play(): Promise<void> {
    if (!this.buffer || this.state === 'playing') return;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const from = this.pausedAt >= this.durationSec ? 0 : this.pausedAt;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.gain);
    src.onended = () => {
      if (this.source === src && this.state === 'playing') {
        this.state = 'stopped';
        this.pausedAt = this.durationSec;
        this.source = null;
      }
    };
    this.startedAtCtx = this.ctx.currentTime;
    this.startOffset = from;
    src.start(0, from);
    this.source = src;
    this.state = 'playing';
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.pausedAt = this.getTime();
    this.teardownSource();
    this.state = 'paused';
  }

  togglePlay(): void {
    if (this.state === 'playing') this.pause();
    else void this.play();
  }

  seek(sec: number): void {
    const clamped = Math.min(Math.max(sec, 0), this.durationSec);
    const wasPlaying = this.state === 'playing';
    this.teardownSource();
    this.pausedAt = clamped;
    if (this.buffer && this.state !== 'empty') this.state = wasPlaying ? 'paused' : this.state;
    if (wasPlaying) void this.play();
  }

  stop(): void {
    this.teardownSource();
    this.pausedAt = 0;
    this.startOffset = 0;
    if (this.buffer) this.state = 'stopped';
  }

  private teardownSource(): void {
    if (this.source) {
      try { this.source.onended = null; this.source.stop(); } catch { /* already stopped */ }
      try { this.source.disconnect(); } catch { /* noop */ }
      this.source = null;
    }
  }

  dispose(): void {
    this.teardownSource();
    void this.ctx.close();
  }
}

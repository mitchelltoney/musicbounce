import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { AudioEngine } from './audio/AudioEngine';
import { Renderer } from './scenes/Renderer';
import { LiveFeatures } from './features/LiveFeatures';
import { Director } from './director/Director';
import { DebugOverlay } from './ui/DebugOverlay';
import { TuningPanel } from './ui/TuningPanel';
import { analyzeFile } from './analyze/analyzeClient';
import type { Score } from './types/contracts';

/**
 * AutoMode — the analysis-driven instrument. React chrome only; audio, live
 * features, the Director, the scenes/compositor, and the render loop are
 * imperative modules in refs.
 */
type Analysis =
  | { status: 'idle' }
  | { status: 'analyzing' }
  | { status: 'done'; score: Score }
  | { status: 'error'; msg: string };

export default function AutoMode() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const tuningRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<AudioEngine | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const directorRef = useRef<Director | null>(null);
  const fpsRef = useRef<HTMLSpanElement | null>(null);
  const scoreRef = useRef<Score | null>(null);
  const sceneNameRef = useRef('');

  const [fileName, setFileName] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sceneName, setSceneName] = useState('');
  const [analysis, setAnalysis] = useState<Analysis>({ status: 'idle' });

  useEffect(() => {
    const canvas = canvasRef.current!;
    const audio = new AudioEngine();
    const live = new LiveFeatures(audio.analyser, audio.sampleRate);
    const director = new Director();
    const overlay = new DebugOverlay(overlayRef.current!);
    const renderer = new Renderer(
      canvas,
      () => audio.getTime(),
      (fps) => { if (fpsRef.current) fpsRef.current.textContent = String(fps); },
    );
    const tuning = new TuningPanel(tuningRef.current!, renderer, director);
    audioRef.current = audio;
    rendererRef.current = renderer;
    directorRef.current = director;
    setSceneName(renderer.activeName);
    (window as unknown as { __synesthete?: object }).__synesthete = { audio, renderer, live, director, overlay, scoreRef };

    renderer.start((tSec, dtSec) => {
      live.update(dtSec);
      const vs = director.update(tSec, dtSec, live.frame);
      overlay.draw(live.frame, vs);
      if (renderer.isAuto && renderer.activeName !== sceneNameRef.current) {
        sceneNameRef.current = renderer.activeName;
        setSceneName(renderer.activeName);
      }
      return vs;
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'd') overlay.toggle();
      else if (e.key === 't') { const el = tuningRef.current; if (el) el.style.display = el.style.display === 'none' ? '' : 'none'; }
      else if (e.key === 'a') { renderer.setAuto(!renderer.isAuto); tuning.refresh(); }
      else if (e.key === 'n') { setSceneName(renderer.next()); tuning.refresh(); }
      else if (e.key >= '1' && e.key <= '9') { setSceneName(renderer.setScene(Number(e.key) - 1)); tuning.refresh(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      tuning.dispose();
      renderer.dispose();
      audio.dispose();
      audioRef.current = null;
      rendererRef.current = null;
      directorRef.current = null;
    };
  }, []);

  const onFiles = useCallback(async (files: FileList | null) => {
    const file = files?.[0];
    if (!file || !audioRef.current) return;

    setLoading(true);
    try {
      await audioRef.current.loadFile(file);
      setFileName(file.name);
      setDuration(audioRef.current.durationSec);
      setPlaying(false);
    } catch (err) {
      console.error('decode failed', err);
      alert('Could not decode that audio file.');
      setLoading(false);
      return;
    }
    setLoading(false);

    setAnalysis({ status: 'analyzing' });
    scoreRef.current = null;
    directorRef.current?.setScore(null);
    try {
      const score = await analyzeFile(file);
      scoreRef.current = score;
      directorRef.current?.setScore(score);
      setAnalysis({ status: 'done', score });
    } catch (err) {
      setAnalysis({ status: 'error', msg: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  const onDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    void onFiles(e.dataTransfer.files);
  }, [onFiles]);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.isPlaying) { a.pause(); setPlaying(false); }
    else { void a.play(); setPlaying(true); }
  }, []);

  const stop = useCallback(() => {
    audioRef.current?.stop();
    setPlaying(false);
  }, []);

  return (
    <div className="app" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      <canvas ref={canvasRef} className="stage" />
      <canvas ref={overlayRef} className="overlay" />
      <div ref={tuningRef} className="tuning" />
      <div className="hud">
        <span className="badge">Synesthete</span>
        <span className="badge">fps&nbsp;<span ref={fpsRef}>–</span></span>
        {sceneName && <span className="badge">scene: {sceneName}</span>}
        {fileName && <span className="badge">{fileName} · {duration.toFixed(1)}s</span>}
        <AnalysisBadge analysis={analysis} />
      </div>
      <div className="transport">
        <label className="btn">
          {loading ? 'decoding…' : fileName ? 'load other' : 'choose audio'}
          <input type="file" accept="audio/*" hidden onChange={(e) => onFiles(e.target.files)} />
        </label>
        <button className="btn" onClick={toggle} disabled={!fileName}>{playing ? 'pause' : 'play'}</button>
        <button className="btn" onClick={stop} disabled={!fileName}>stop</button>
      </div>
      {!fileName && <div className="drop-hint">drop audio anywhere · n: scene · a: auto · d: inspector · t: tuning</div>}
    </div>
  );
}

function AnalysisBadge({ analysis }: { analysis: Analysis }) {
  if (analysis.status === 'idle') return null;
  if (analysis.status === 'analyzing') return <span className="badge">analyzing…</span>;
  if (analysis.status === 'error') {
    return <span className="badge badge-err" title={analysis.msg}>⚠ {analysis.msg}</span>;
  }
  const s = analysis.score;
  const key = s.key ? ` · ${s.key.tonic}${s.key.mode === 'minor' ? 'm' : ''}` : '';
  const drops = s.sections.filter((x) => x.isDrop).length;
  return (
    <span className="badge">
      {s.bpm.toFixed(0)} BPM{key} · {s.sections.length} sections
      {drops ? ` · ${drops} drop${drops > 1 ? 's' : ''}` : ''}
    </span>
  );
}

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { AudioEngine } from '../audio/AudioEngine';
import { ChoreoEngine, ELEMENT_STYLES, type ElementStyle } from './ChoreoEngine';
import { ChoreoStage } from './ChoreoStage';
import { barIndexAt, buildBarGrid, phrases, type BarGrid, type Phrase } from './bars';

/**
 * ChoreographyMode — hand-choreograph the bundled Trillium track. Pick an element,
 * hit Record, and tap the SPACEBAR in time; each tap drives that element's dance.
 * Record one element then another. Pause and Record again from any phrase to fix
 * mistakes. Everything autosaves.
 */
export default function ChoreographyMode() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<AudioEngine | null>(null);
  const choreoRef = useRef<ChoreoEngine | null>(null);
  const stageRef = useRef<ChoreoStage | null>(null);
  const gridRef = useRef<BarGrid | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const clockRef = useRef<HTMLSpanElement | null>(null);

  const [, forceUpdate] = useReducer((x) => x + 1, 0);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [phraseList, setPhraseList] = useState<Phrase[]>([]);
  const [duration, setDuration] = useState(1);

  useEffect(() => {
    const audio = new AudioEngine();
    const choreo = new ChoreoEngine('trillium', forceUpdate);
    const stage = new ChoreoStage(canvasRef.current!, choreo);
    audioRef.current = audio;
    choreoRef.current = choreo;
    stageRef.current = stage;
    if (choreo.tracks.length === 0) choreo.addTrack('stepper');

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const t = audio.getTime();
      stage.render(t);
      const grid = gridRef.current;
      if (playheadRef.current) playheadRef.current.style.left = `${(t / Math.max(duration, 1)) * 100}%`;
      if (clockRef.current) clockRef.current.textContent = grid ? `${t.toFixed(1)}s · bar ${barIndexAt(grid, t) + 1}` : `${t.toFixed(1)}s`;
    };

    (async () => {
      try {
        const [buf, scoreRes] = await Promise.all([
          fetch('/trillium.mp3').then((r) => r.arrayBuffer()),
          fetch('/trillium.score.json').then((r) => r.json()),
        ]);
        await audio.loadArrayBuffer(buf);
        const grid = buildBarGrid(scoreRes);
        gridRef.current = grid;
        setDuration(audio.durationSec || grid.durationSec);
        setPhraseList(phrases(grid, 4));
        setReady(true);
      } catch (err) {
        console.error('choreo load failed', err);
      }
      raf = requestAnimationFrame(loop);
    })();

    const onResize = () => stage.resize();
    window.addEventListener('resize', onResize);
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (choreo.recording) choreo.recordTap(audio.getTime());
      }
    };
    window.addEventListener('keydown', onKey);

    // refresh the UI a few times a second while recording so tap ticks appear
    const poll = window.setInterval(() => { if (choreo.recording) forceUpdate(); }, 200);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
      window.clearInterval(poll);
      audio.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choreo = choreoRef.current;

  const record = useCallback(() => {
    const a = audioRef.current, c = choreoRef.current;
    if (!a || !c || !c.active) return;
    c.startRecording(a.getTime()); // record from the current playhead, re-recording from here
    void a.play();
    setRecording(true);
    setPlaying(true);
  }, []);

  const play = useCallback(() => {
    const a = audioRef.current; if (!a) return;
    void a.play(); setPlaying(true);
  }, []);

  const pause = useCallback(() => {
    const a = audioRef.current, c = choreoRef.current; if (!a) return;
    if (c?.recording) c.stopRecording();
    a.pause(); setRecording(false); setPlaying(false);
  }, []);

  const stop = useCallback(() => {
    const a = audioRef.current, c = choreoRef.current; if (!a) return;
    if (c?.recording) c.stopRecording();
    a.stop(); setRecording(false); setPlaying(false);
  }, []);

  const seekTo = useCallback((sec: number) => {
    const a = audioRef.current, c = choreoRef.current; if (!a) return;
    if (c?.recording) { c.stopRecording(); setRecording(false); }
    a.seek(sec); a.pause(); setPlaying(false);
  }, []);

  const onRulerClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    seekTo(((e.clientX - rect.left) / rect.width) * duration);
  }, [duration, seekTo]);

  return (
    <div className="app">
      <canvas ref={canvasRef} className="stage" />

      <div className="hud">
        <span className="badge">Choreograph · Trillium</span>
        <span className="badge"><span ref={clockRef}>0.0s</span></span>
        {recording && <span className="badge badge-rec">● REC — tap SPACE</span>}
        {!ready && <span className="badge">loading…</span>}
      </div>

      {choreo && <TrackPanel choreo={choreo} onChange={forceUpdate} recording={recording} />}

      <div className="ruler-wrap">
        <div className="ruler" onClick={onRulerClick}>
          {phraseList.map((ph) => (
            <div
              key={ph.index}
              className="phrase"
              style={{ left: `${(ph.startSec / duration) * 100}%`, width: `${((ph.endSec - ph.startSec) / duration) * 100}%` }}
              title={`bar ${ph.firstBar} · ${ph.startSec.toFixed(1)}s`}
              onClick={(e) => { e.stopPropagation(); seekTo(ph.startSec); }}
            >
              <span className="phrase-label">{ph.firstBar}</span>
            </div>
          ))}
          {choreo?.active?.taps.map((tp, i) => (
            <div key={i} className="tap-tick" style={{ left: `${(tp / duration) * 100}%`, background: `hsl(${choreo.active!.hue},90%,65%)` }} />
          ))}
          <div ref={playheadRef} className="playhead" />
        </div>
        <div className="ruler-hint">click a phrase to jump there, then Record to re-record from it</div>
      </div>

      <div className="transport">
        {playing
          ? <button className="btn" onClick={pause} disabled={!ready}>pause</button>
          : <button className="btn" onClick={play} disabled={!ready}>play</button>}
        <button className={`btn ${recording ? 'btn-rec-on' : ''}`} onClick={record} disabled={!ready || !choreo?.active}>
          {recording ? 'recording…' : '● record'}
        </button>
        <button className="btn" onClick={stop} disabled={!ready}>stop</button>
      </div>
    </div>
  );
}

function TrackPanel({ choreo, onChange, recording }: { choreo: ChoreoEngine; onChange: () => void; recording: boolean }) {
  return (
    <div className="track-panel">
      <div className="track-panel-head">elements</div>
      {choreo.tracks.map((tr) => {
        const isActive = tr.id === choreo.activeId;
        return (
          <div key={tr.id} className={`track-row ${isActive ? 'track-active' : ''}`} onClick={() => { choreo.setActive(tr.id); onChange(); }}>
            <span className="track-dot" style={{ background: `hsl(${tr.hue},90%,60%)` }} />
            <input
              className="track-name" value={tr.name}
              onChange={(e) => { choreo.rename(tr.id, e.target.value); onChange(); }}
              onClick={(e) => e.stopPropagation()}
            />
            <select
              className="track-style" value={tr.style}
              onChange={(e) => { choreo.setStyle(tr.id, e.target.value as ElementStyle); onChange(); }}
              onClick={(e) => e.stopPropagation()}
            >
              {ELEMENT_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input
              className="track-hue" type="range" min={0} max={359} value={tr.hue}
              onChange={(e) => { choreo.setHue(tr.id, Number(e.target.value)); onChange(); }}
              onClick={(e) => e.stopPropagation()}
            />
            <span className="track-count">{tr.taps.length}</span>
            <button className="track-btn" title="mute" onClick={(e) => { e.stopPropagation(); choreo.toggleMute(tr.id); onChange(); }}>{tr.muted ? '🔇' : '🔊'}</button>
            <button className="track-btn" title="clear taps" onClick={(e) => { e.stopPropagation(); if (confirm(`Clear taps for ${tr.name}?`)) { choreo.clearTaps(tr.id); onChange(); } }}>⌫</button>
            <button className="track-btn" title="delete" onClick={(e) => { e.stopPropagation(); choreo.removeTrack(tr.id); onChange(); }}>✕</button>
          </div>
        );
      })}
      <button className="btn track-add" disabled={recording} onClick={() => { choreo.addTrack('stepper'); onChange(); }}>+ add element</button>
    </div>
  );
}

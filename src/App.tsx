import { useState } from 'react';
import AutoMode from './AutoMode';
import ChoreographyMode from './choreo/ChoreographyMode';

const MODES = ['choreo', 'auto'] as const;
type Mode = (typeof MODES)[number];
const LABEL: Record<Mode, string> = { choreo: 'Choreograph', auto: 'Auto scenes' };

export default function App() {
  const param = new URLSearchParams(window.location.search).get('mode');
  const initial: Mode = param === 'auto' ? 'auto' : 'choreo';
  const [mode, setMode] = useState<Mode>(initial);
  const next = MODES[(MODES.indexOf(mode) + 1) % MODES.length];

  return (
    <>
      {mode === 'choreo' ? <ChoreographyMode /> : <AutoMode />}
      <button className="mode-toggle" onClick={() => setMode(next)} title="switch mode">→ {LABEL[next]}</button>
    </>
  );
}

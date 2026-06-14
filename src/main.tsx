import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// No StrictMode: the audio + render engine is imperative and must mount exactly
// once (StrictMode's double-invoke would create two AudioContexts/Renderers).
createRoot(document.getElementById('root')!).render(<App />);

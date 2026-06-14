import type { Score } from '../types/contracts';

/** Local Python analyzer service. Override with VITE_ANALYZER_URL if needed. */
const ANALYZER_URL =
  (import.meta.env.VITE_ANALYZER_URL as string | undefined) || 'http://127.0.0.1:8000';

/** POST an audio file to the analyzer and get back its Score. */
export async function analyzeFile(file: File, signal?: AbortSignal): Promise<Score> {
  const form = new FormData();
  form.append('file', file, file.name);

  let res: Response;
  try {
    res = await fetch(`${ANALYZER_URL}/analyze`, { method: 'POST', body: form, signal });
  } catch {
    throw new Error('analyzer offline — start it with `make analyzer`');
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`analyze failed (${res.status}): ${detail.slice(0, 160)}`);
  }
  return (await res.json()) as Score;
}

export async function checkAnalyzerHealth(): Promise<boolean> {
  try {
    return (await fetch(`${ANALYZER_URL}/health`)).ok;
  } catch {
    return false;
  }
}

import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

// End-to-end: drop a real track -> frontend POSTs to the analyzer -> Score comes
// back -> the HUD shows BPM/key/sections. Requires the analyzer running on :8000
// (the orchestration script starts it). The S3RL track is already cached, so fast.
test('drop a track -> analyzer -> Score shown in HUD', async ({ page, request }) => {
  let up = false;
  try { up = (await request.get('http://127.0.0.1:8000/health')).ok(); } catch { /* offline */ }
  test.skip(!up, 'analyzer not running on :8000');

  await page.goto('/?mode=auto');
  const mp3 = path.resolve('fixtures/real/Trillium - S3RL feat Sara.mp3');
  await page.locator('input[type=file]').setInputFiles(mp3);

  const hud = page.locator('.hud');
  await expect(hud).toContainText('BPM', { timeout: 60_000 });

  mkdirSync('test/screenshots', { recursive: true });
  await page.screenshot({ path: 'test/screenshots/analyzed.png' });
});

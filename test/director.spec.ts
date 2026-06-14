import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

// Phase 3 visual + integration: a real Score drives the Director; seek into a
// high-energy section and confirm the VisualState is sane, then screenshot the
// inspector. Requires the analyzer on :8000 (orchestration starts it).
test('director drives VisualState from a real Score', async ({ page, request }) => {
  let up = false;
  try { up = (await request.get('http://127.0.0.1:8000/health')).ok(); } catch { /* offline */ }
  test.skip(!up, 'analyzer not running on :8000');

  await page.goto('/?mode=auto');
  await page.locator('input[type=file]').setInputFiles(path.resolve('fixtures/real/Trillium - S3RL feat Sara.mp3'));
  await expect(page.locator('.hud')).toContainText('BPM', { timeout: 60_000 }); // Score arrived

  await page.evaluate(() => (window as any).__synesthete.audio.seek(60)); // into the first chorus
  await page.getByRole('button', { name: 'play' }).click(); // user gesture -> resume
  await page.waitForTimeout(2500);

  const st = await page.evaluate(() => (window as any).__synesthete.director.state);
  expect(st.bpm).toBeGreaterThan(150);          // ~176 from the Score
  expect(typeof st.section).toBe('string');
  expect(st.beatPhase).toBeGreaterThanOrEqual(0);
  expect(st.beatPhase).toBeLessThanOrEqual(1.0001);
  expect(st.energy).toBeGreaterThan(0);          // mid-chorus -> energy present

  mkdirSync('test/screenshots', { recursive: true });
  await page.screenshot({ path: 'test/screenshots/director.png' });
});

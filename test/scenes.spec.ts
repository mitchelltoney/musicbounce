import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

// Phase 4: a real Score plays; switch through every scene and screenshot each.
// Requires the analyzer on :8000 (orchestration starts it).
test('each scene renders a musical frame', async ({ page, request }) => {
  let up = false;
  try { up = (await request.get('http://127.0.0.1:8000/health')).ok(); } catch { /* offline */ }
  test.skip(!up, 'analyzer not running on :8000');

  await page.goto('/?mode=auto');
  await page.locator('input[type=file]').setInputFiles(path.resolve('fixtures/real/Trillium - S3RL feat Sara.mp3'));
  await expect(page.locator('.hud')).toContainText('BPM', { timeout: 60_000 });

  await page.evaluate(() => (window as any).__synesthete.audio.seek(60));
  await page.getByRole('button', { name: 'play' }).click();

  const names: string[] = await page.evaluate(() => (window as any).__synesthete.renderer.sceneNames);
  expect(names.length).toBeGreaterThanOrEqual(3);

  mkdirSync('test/screenshots', { recursive: true });
  for (let i = 0; i < names.length; i++) {
    await page.evaluate((idx) => (window as any).__synesthete.renderer.setScene(idx), i);
    await page.waitForTimeout(1600); // let feedback trails build
    await page.screenshot({ path: `test/screenshots/scene-${names[i].toLowerCase()}.png` });
  }
});

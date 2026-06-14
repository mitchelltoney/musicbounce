import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

// Phase 2: the live Meyda features track the music. A sustained 440 Hz tone must
// light the 'mid' band (400-1k) above all others, and the meters must render.
test('live features: 440 Hz tone lights the mid band', async ({ page }) => {
  await page.goto('/?mode=auto');
  await page.locator('input[type=file]').setInputFiles(path.resolve('fixtures/tone-440.wav'));
  await page.getByRole('button', { name: 'play' }).click();
  await page.waitForTimeout(1500);

  const band = await page.evaluate(
    () => (window as any).__synesthete.live.frame.band as Record<string, number>,
  );
  const top = Object.entries(band).sort((a, b) => b[1] - a[1])[0][0];
  expect(top, `mid should dominate; got ${JSON.stringify(band)}`).toBe('mid');
  expect(band.mid).toBeGreaterThan(0.4);

  mkdirSync('test/screenshots', { recursive: true });
  await page.screenshot({ path: 'test/screenshots/live-meters.png' });
});

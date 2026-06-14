import { test, expect } from '@playwright/test';
import path from 'node:path';

// Objective proof of the Phase-0 checkpoint "an audio file plays and the canvas
// animates on the audio clock": load a fixture, play it, and assert the
// latency-compensated master clock advances during playback and FREEZES on pause.
// (Requires fixtures/ — run `make fixtures` first.)
test('audio plays → master clock advances, and freezes on pause', async ({ page }) => {
  await page.goto('/?mode=auto');

  const wav = path.resolve('fixtures/click-120bpm.wav');
  await page.locator('input[type=file]').setInputFiles(wav);

  // wait for decode to finish (durationSec becomes known)
  await expect
    .poll(() => page.evaluate(() => (window as any).__synesthete?.audio?.durationSec ?? 0), {
      timeout: 10_000,
    })
    .toBeGreaterThan(1);

  const playBtn = page.getByRole('button', { name: 'play' });
  await expect(playBtn).toBeEnabled();
  await playBtn.click(); // user gesture → AudioContext resumes

  await page.waitForTimeout(700);
  const t1 = await page.evaluate(() => (window as any).__synesthete.audio.getTime());
  expect(t1, 'clock should advance during playback').toBeGreaterThan(0.2);

  await page.getByRole('button', { name: 'pause' }).click();
  const a = await page.evaluate(() => (window as any).__synesthete.audio.getTime());
  await page.waitForTimeout(400);
  const b = await page.evaluate(() => (window as any).__synesthete.audio.getTime());
  expect(Math.abs(b - a), 'clock should be frozen while paused').toBeLessThan(0.02);
});

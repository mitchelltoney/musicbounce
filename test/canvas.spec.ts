import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// Phase-0 visual checkpoint: the canvas mounts, sizes, and renders a frame that
// is captured to disk for review.
test('canvas mounts and renders a frame', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('canvas.stage');
  await expect(canvas).toBeVisible();

  // let the imperative render loop run for a beat
  await page.waitForTimeout(1500);

  const box = await canvas.boundingBox();
  expect(box, 'canvas should have a layout box').not.toBeNull();
  expect(box!.width).toBeGreaterThan(100);
  expect(box!.height).toBeGreaterThan(100);

  mkdirSync('test/screenshots', { recursive: true });
  await page.screenshot({ path: 'test/screenshots/canvas.png' });
});

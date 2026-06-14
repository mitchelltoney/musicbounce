import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// Choreograph mode is the default view. Confirm it loads the bundled Trillium,
// shows the recorder (track panel + phrase ruler), and the record button arms.
test('choreograph mode loads + shows the recorder', async ({ page }) => {
  await page.goto('/?mode=choreo');
  await expect(page.locator('.track-panel')).toBeVisible();
  await expect(page.locator('.ruler')).toBeVisible();
  await expect(page.getByRole('button', { name: /record/ })).toBeEnabled({ timeout: 20_000 });

  // a default element exists and the phrase ruler is populated
  expect(await page.locator('.track-row').count()).toBeGreaterThan(0);
  expect(await page.locator('.phrase').count()).toBeGreaterThan(4);

  await page.waitForTimeout(400);
  mkdirSync('test/screenshots', { recursive: true });
  await page.screenshot({ path: 'test/screenshots/choreograph.png' });
});

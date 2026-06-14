import { defineConfig, devices } from '@playwright/test';

// Headless render-screenshot harness. Boots the Vite dev server, loads the app,
// and captures the rendered canvas so a frame can be reviewed (CLAUDE.md: we are
// deaf — visual correctness is verified by screenshot + human review).
//
// SwiftShader gives software WebGL headlessly (see docs/SETUP §4).
export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    launchOptions: {
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
      ],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});

// L4/L5: UI tests in a real browser against the Vite dev server, where the
// labelled mock backend answers. Electron renders with Chromium, so chromium
// is the one engine; CI runs it on all three OS runners.
import { defineConfig, devices } from "@playwright/test";

// TALLY_UI_PORT moves the dev server off 1420 when another project on the
// same machine uses it. An already running server is reused only when asked
// (PW_REUSE_SERVER=1): reusing whatever answers on the port can test the
// wrong app.
const port = Number(process.env.TALLY_UI_PORT ?? 1420);

export default defineConfig({
  testDir: "tests/ui",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  // One template for every snapshot kind. Pixel snapshots put the engine and
  // OS into their own name; ARIA and geometry snapshots are shared by design.
  snapshotPathTemplate: "{testDir}/__snapshots__/{testFileName}/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      // Per-OS baselines still see antialiasing noise; allow a little.
      maxDiffPixelRatio: 0.002,
      animations: "disabled",
      caret: "hide",
    },
  },
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1024, height: 700 },
    deviceScaleFactor: 1,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 700 } } },
  ],
  webServer: {
    command: `npm run dev:web -- --strictPort --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: process.env.PW_REUSE_SERVER === "1",
    timeout: 60_000,
  },
});

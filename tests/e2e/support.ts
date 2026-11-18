// Launching the built app for the real-shell suites: a temp ledger
// directory (TALLY_DATA_DIR), optional preset dialog answers, console errors
// collected, and a restart that waits for the old process to be gone.
import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class Tally {
  app!: ElectronApplication;
  win!: Page;
  readonly consoleErrors: string[] = [];
  readonly dataDir = mkdtempSync(join(tmpdir(), "tally-e2e-"));

  readonly env: Record<string, string>;

  constructor(env: Record<string, string> = {}) {
    this.env = env;
  }

  async launch(): Promise<void> {
    this.app = await electron.launch({
      args: ["."],
      cwd: process.cwd(),
      env: { ...process.env, ...this.env, TALLY_DATA_DIR: this.dataDir },
    });
    this.win = await this.app.firstWindow();
    this.win.on("console", (m) => {
      if (m.type() === "error") this.consoleErrors.push(m.text());
    });
    await this.win.waitForLoadState("domcontentloaded");
    await expect(this.win.getByTestId("backend-badge")).toHaveText("native");
  }

  async restart(): Promise<void> {
    await this.close();
    await this.launch();
  }

  async close(): Promise<void> {
    if (!this.app) return;
    const proc = this.app.process();
    const closed = proc.exitCode !== null ? Promise.resolve() : new Promise<void>((r) => proc.once("close", () => r()));
    await this.app.close();
    // The old process and its pipes are gone before anything else starts.
    await closed;
  }

  async dispose(): Promise<void> {
    await this.close();
    rmSync(this.dataDir, { recursive: true, force: true });
  }

  /** Clicks a section in the top navigation. */
  async go(section: "Transactions" | "Import" | "Categories" | "Settings"): Promise<void> {
    await this.win.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: section }).click();
  }
}

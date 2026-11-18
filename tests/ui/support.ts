// Shared setup for the browser suite: a frozen clock (so "today" and the
// default month never move a baseline), an optional seeded ledger for the
// labelled mock, and the check that the mock really is answering.
import { expect, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { TestInfo } from "@playwright/test";
import { assertGeometry, captureGeometry } from "./geometry";

export const FROZEN_NOW = new Date("2026-03-15T10:00:00");

export async function openApp(page: Page, seed?: unknown): Promise<void> {
  await page.clock.setFixedTime(FROZEN_NOW);
  if (seed !== undefined) {
    await page.addInitScript((s) => {
      (window as unknown as { __TALLY_MOCK__: unknown }).__TALLY_MOCK__ = { seed: s };
    }, seed);
  }
  await page.goto("/");
  await expect(page.getByTestId("backend-badge")).toHaveText("mock");
  await expect(page.getByTestId("platform")).toHaveText("mock / mock");
}

/** A small ledger used by the visual tiers and the list tests. */
export const seedLedger = {
  format: "tally-ledger",
  version: 1,
  settings: { currency: "USD" },
  categories: [
    { id: "c1", name: "Groceries" },
    { id: "c2", name: "Housing" },
    { id: "c3", name: "Salary" },
  ],
  transactions: [
    { id: "t4", date: "2026-03-01", payee: "Landlord", amount: -95000, categoryId: "c2", note: "March rent" },
    { id: "t5", date: "2026-03-02", payee: "Employer Ltd", amount: 312050, categoryId: "c3", note: "" },
    { id: "t6", date: "2026-03-09", payee: "Corner Shop", amount: -1250, categoryId: "c1", note: "milk, bread" },
    { id: "t7", date: "2026-03-12", payee: "Farmers Market", amount: -4320, categoryId: "c1", note: "" },
    { id: "t8", date: "2026-02-27", payee: "Water Utility", amount: -3875, categoryId: null, note: "quarterly" },
  ],
  nextId: 9,
};

/** Tier 2: the shared geometry baseline for a screen. */
export async function checkGeometry(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const actual = await captureGeometry(page);
  assertGeometry(join(testInfo.project.testDir, "__snapshots__", testInfo.file.split(/[\\/]/).pop()!, `${name}.geometry.json`), actual);
}

/** Tier 3: the per-OS pixel baseline, captured only by the snapshots workflow. */
export async function checkPixels(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const file = `${name}-${testInfo.project.name}-${process.platform}.png`;
  const baseline = join(testInfo.project.testDir, "__snapshots__", testInfo.file.split(/[\\/]/).pop()!, file);
  testInfo.skip(!process.env.CI && !existsSync(baseline), "no local pixel baseline; the snapshots workflow captures them on the runners");
  await expect(page).toHaveScreenshot(file, { fullPage: true });
}

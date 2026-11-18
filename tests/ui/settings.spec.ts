// L4 and L5 for the Settings screen: the one currency and where the ledger lives.
import { expect, test } from "@playwright/test";
import { checkGeometry, checkPixels, openApp, seedLedger } from "./support";

test.beforeEach(async ({ page }) => {
  await openApp(page, seedLedger);
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
});

test("changing the currency relabels amounts and never converts them", async ({ page }) => {
  await expect(page.getByLabel("Currency for every amount")).toHaveValue("USD");
  await page.getByLabel("Currency for every amount").selectOption("EUR");
  await expect(page.getByTestId("settings-status")).toHaveText("Currency set to EUR.");
  await page.getByRole("button", { name: "Transactions" }).click();
  await expect(page.getByRole("columnheader", { name: "Amount (EUR)" })).toBeVisible();
  await expect(page.getByLabel("Amount (EUR)")).toBeVisible();
  const corner = page.locator("tbody tr", { hasText: "Corner Shop" });
  await expect(corner.locator("td.num")).toHaveText("-12.50");
});

test("says the mock keeps the ledger in memory", async ({ page }) => {
  await expect(page.getByTestId("ledger-location")).toHaveText("In-memory mock ledger: nothing is saved to disk.");
  await expect(page.getByRole("button", { name: "Settings" })).toHaveAttribute("aria-current", "page");
});

test("tier 1: accessibility structure is identical everywhere", async ({ page }) => {
  await expect(page.locator("body")).toMatchAriaSnapshot({ name: "settings.aria.yml" });
});

test("tier 2: layout geometry stays within tolerance everywhere", async ({ page }, testInfo) => {
  await checkGeometry(page, testInfo, "settings");
});

test("tier 3: pixels match the per-OS baseline", async ({ page }, testInfo) => {
  await checkPixels(page, testInfo, "settings");
});

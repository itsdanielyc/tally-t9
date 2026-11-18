// L4 (recording transactions against the labelled mock) and L5 (the three
// visual tiers) for the Transactions screen. Chromium; in CI on three OSes.
import { expect, test, type Page } from "@playwright/test";
import { checkGeometry, checkPixels, openApp, seedLedger } from "./support";

const rows = (page: Page) => page.getByRole("table", { name: "Transactions, newest first" }).locator("tbody tr");

async function add(page: Page, t: { date?: string; payee: string; amount: string; income?: boolean; category?: string; note?: string }) {
  if (t.date) await page.getByLabel("Date").fill(t.date);
  await page.getByLabel("Payee").fill(t.payee);
  await page.getByLabel(t.income ? "Income" : "Spending").check();
  await page.getByLabel(/^Amount/).fill(t.amount);
  await page.getByLabel("Category").fill(t.category ?? "");
  await page.getByLabel("Note").fill(t.note ?? "");
  await page.getByRole("button", { name: "Add", exact: true }).click();
}

test.describe("recording transactions", () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  test("starts empty with today's date in the form", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Transactions", level: 1 })).toBeVisible();
    await expect(page.getByText("No transactions yet.")).toBeVisible();
    await expect(page.getByLabel("Date")).toHaveValue("2026-03-15");
    await expect(page.getByLabel("Spending")).toBeChecked();
  });

  test("adds transactions and lists them newest first, spending negative and income positive", async ({ page }) => {
    await add(page, { date: "2026-03-10", payee: "Corner Shop", amount: "12.50", category: "Groceries", note: "milk" });
    await expect(page.getByTestId("tx-status")).toHaveText("Added Corner Shop.");
    await add(page, { date: "2026-03-14", payee: "Employer Ltd", amount: "3,120.50", income: true });
    await add(page, { date: "2026-03-01", payee: "Landlord", amount: "950" });

    await expect(rows(page)).toHaveCount(3);
    await expect(rows(page).nth(0)).toContainText("2026-03-14Employer Ltd");
    await expect(rows(page).nth(0).locator("td.num")).toHaveText("3,120.50");
    await expect(rows(page).nth(1)).toContainText("Corner Shop");
    await expect(rows(page).nth(1)).toContainText("Groceries");
    await expect(rows(page).nth(1)).toContainText("milk");
    await expect(rows(page).nth(1).locator("td.num")).toHaveText("-12.50");
    await expect(rows(page).nth(2).locator("td.num")).toHaveText("-950.00");
    // The form keeps the date and type for the next entry and clears the rest.
    await expect(page.getByLabel("Payee")).toHaveValue("");
    await expect(page.getByLabel("Payee")).toBeFocused();
  });

  test("on the same date the one added last comes first", async ({ page }) => {
    await add(page, { date: "2026-03-10", payee: "First", amount: "1" });
    await add(page, { date: "2026-03-10", payee: "Second", amount: "2" });
    await expect(rows(page).nth(0)).toContainText("Second");
    await expect(rows(page).nth(1)).toContainText("First");
  });

  test("explains a bad entry and saves nothing", async ({ page }) => {
    await add(page, { payee: "", amount: "5" });
    await expect(page.getByRole("alert").filter({ hasText: "Enter a payee." })).toBeVisible();
    await expect(page.getByLabel("Payee")).toHaveAttribute("aria-invalid", "true");
    await add(page, { payee: "Shop", amount: "12.345" });
    await expect(page.getByRole("alert").filter({ hasText: "more than 2 decimal places" })).toBeVisible();
    await add(page, { payee: "Shop", amount: "0" });
    await expect(page.getByRole("alert").filter({ hasText: "cannot be zero" })).toBeVisible();
    await expect(page.getByText("No transactions yet.")).toBeVisible();
  });

  test("edits a transaction in place", async ({ page }) => {
    await add(page, { date: "2026-03-10", payee: "Corner Shop", amount: "12.50", category: "Groceries" });
    await page.getByRole("button", { name: "Edit Corner Shop on 2026-03-10" }).click();
    await expect(page.getByRole("heading", { name: "Edit transaction" })).toBeVisible();
    await expect(page.getByLabel(/^Amount/)).toHaveValue("12.50");
    await expect(page.getByLabel("Category")).toHaveValue("Groceries");
    await page.getByLabel(/^Amount/).fill("13.75");
    await page.getByLabel("Note").fill("corrected");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByTestId("tx-status")).toHaveText("Saved Corner Shop.");
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first().locator("td.num")).toHaveText("-13.75");
    await expect(rows(page).first()).toContainText("corrected");
    await expect(page.getByRole("heading", { name: "Add a transaction" })).toBeVisible();
  });

  test("cancel leaves an edit unsaved", async ({ page }) => {
    await add(page, { date: "2026-03-10", payee: "Corner Shop", amount: "12.50" });
    await page.getByRole("button", { name: "Edit Corner Shop on 2026-03-10" }).click();
    await page.getByLabel("Payee").fill("Changed");
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(rows(page).first()).toContainText("Corner Shop");
    await expect(page.getByLabel("Payee")).toHaveValue("");
  });

  test("deletes only after confirming", async ({ page }) => {
    await add(page, { date: "2026-03-10", payee: "Corner Shop", amount: "12.50" });
    await add(page, { date: "2026-03-11", payee: "Bakery", amount: "3" });
    await page.getByRole("button", { name: "Delete Corner Shop on 2026-03-10" }).click();
    await page.getByRole("button", { name: "Keep Corner Shop on 2026-03-10" }).click();
    await expect(rows(page)).toHaveCount(2);
    await page.getByRole("button", { name: "Delete Corner Shop on 2026-03-10" }).click();
    await page.getByRole("button", { name: "Confirm delete Corner Shop on 2026-03-10" }).click();
    await expect(page.getByTestId("tx-status")).toHaveText("Deleted Corner Shop.");
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText("Bakery");
  });

  test("suggests existing categories and reuses them whatever the case", async ({ page }) => {
    await add(page, { payee: "Corner Shop", amount: "1", category: "Groceries" });
    await expect(page.locator("#tx-category-options option")).toHaveAttribute("value", "Groceries");
    await add(page, { payee: "Market", amount: "2", category: "groceries" });
    await expect(page.locator("#tx-category-options option")).toHaveCount(1);
    await expect(rows(page).nth(0)).toContainText("Groceries");
  });
});

test.describe("transactions screen visuals", () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page, seedLedger);
    await expect(rows(page)).toHaveCount(5);
  });

  test("tier 1: accessibility structure is identical everywhere", async ({ page }) => {
    await expect(page.locator("body")).toMatchAriaSnapshot({ name: "transactions.aria.yml" });
  });

  test("tier 2: layout geometry stays within tolerance everywhere", async ({ page }, testInfo) => {
    await checkGeometry(page, testInfo, "transactions");
  });

  test("tier 3: pixels match the per-OS baseline", async ({ page }, testInfo) => {
    await checkPixels(page, testInfo, "transactions");
  });
});

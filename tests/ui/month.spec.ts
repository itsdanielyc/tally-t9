// L4 (the monthly summary and budgets against the labelled mock) and L5
// (visual tiers of the Month screen).
import { expect, test, type Page } from "@playwright/test";
import { checkGeometry, checkPixels, openApp, seedLedger } from "./support";

const catRow = (page: Page, name: string) => page.getByRole("table", { name: "Categories this month" }).locator("tbody tr", { hasText: name });
const txRows = (page: Page) => page.getByRole("table", { name: "Transactions this month" }).locator("tbody tr");

/** "-1,234.56" to minor units, the way a person adds up what they see. */
const cents = (text: string) => Math.round(Number(text.replace(/[^\d.-]/g, "")) * 100);

async function openMonth(page: Page, seed: unknown = seedLedger): Promise<void> {
  await openApp(page, seed);
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Month" }).click();
  await expect(page.getByRole("heading", { name: "Month", level: 1 })).toBeVisible();
}

test("opens on the current month with income against spending", async ({ page }) => {
  await openMonth(page);
  await expect(page.getByRole("heading", { name: "March 2026" })).toBeVisible();
  await expect(page.getByTestId("month-income")).toHaveText("3,120.50");
  await expect(page.getByTestId("month-spending")).toHaveText("1,005.70");
  await expect(page.getByTestId("month-net")).toHaveText("2,114.80");
  await expect(catRow(page, "Groceries").locator("td").nth(1)).toHaveText("-55.70");
  await expect(catRow(page, "Housing").locator("td").nth(1)).toHaveText("-950.00");
  await expect(catRow(page, "Salary").locator("td").nth(1)).toHaveText("3,120.50");
  await expect(txRows(page)).toHaveCount(4);
});

test("the totals equal the sum of the transactions shown, to the cent", async ({ page }) => {
  await openMonth(page);
  const amounts = (await txRows(page).locator("td.num").allTextContents()).map(cents);
  const income = amounts.filter((a) => a > 0).reduce((a, b) => a + b, 0);
  const spending = -amounts.filter((a) => a < 0).reduce((a, b) => a + b, 0);
  expect(cents(await page.getByTestId("month-income").innerText())).toBe(income);
  expect(cents(await page.getByTestId("month-spending").innerText())).toBe(spending);
  expect(cents(await page.getByTestId("month-net").innerText())).toBe(income - spending);
  const categoryTotals = (await page.getByRole("table", { name: "Categories this month" }).locator("tbody tr td:nth-child(2)").allTextContents()).map(cents);
  expect(categoryTotals.reduce((a, b) => a + b, 0)).toBe(income - spending);
});

test("moves to the previous and next month, across a year end too", async ({ page }) => {
  await openMonth(page);
  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(page.getByRole("heading", { name: "February 2026" })).toBeVisible();
  await expect(txRows(page)).toHaveCount(1);
  await expect(catRow(page, "Uncategorised").locator("td").nth(1)).toHaveText("-38.75");
  await page.getByRole("button", { name: "Next month" }).click();
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(page.getByRole("heading", { name: "April 2026" })).toBeVisible();
  await expect(page.getByText("Nothing recorded this month.")).toBeVisible();
  await expect(page.getByTestId("month-net")).toHaveText("0.00");
  await page.getByLabel("Month", { exact: true }).fill("2026-01");
  await expect(page.getByRole("heading", { name: "January 2026" })).toBeVisible();
  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(page.getByRole("heading", { name: "December 2025" })).toBeVisible();
});

test("sets a budget and shows what is left, or how much over", async ({ page }) => {
  await openMonth(page);
  await page.getByRole("button", { name: "Set budget for Groceries" }).click();
  await page.getByLabel("Monthly budget for Groceries").fill("200");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("month-status")).toHaveText("Budget for Groceries set to 200.00.");
  await expect(catRow(page, "Groceries").locator("td").nth(2)).toHaveText("200.00");
  await expect(catRow(page, "Groceries").locator("td").nth(3)).toHaveText("144.30");
  await expect(catRow(page, "Groceries").getByRole("img")).toHaveAttribute("aria-label", "28% of budget spent");

  await page.getByRole("button", { name: "Set budget for Housing" }).click();
  await page.getByLabel("Monthly budget for Housing").fill("900");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(catRow(page, "Housing").locator("td").nth(3)).toHaveText("50.00 over");
  await expect(catRow(page, "Housing").getByRole("img")).toHaveAttribute("aria-label", "106% of budget spent");

  // The budget is monthly: February shows it too, against February's spending.
  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(catRow(page, "Groceries").locator("td").nth(3)).toHaveText("200.00");
});

test("removes a budget by saving it empty, and refuses a bad amount", async ({ page }) => {
  await openMonth(page, { ...seedLedger, budgets: { c1: 20000 } });
  await page.getByRole("button", { name: "Change budget for Groceries" }).click();
  await page.getByLabel("Monthly budget for Groceries").fill("abc");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("month-error")).toContainText("Budget:");
  await page.getByLabel("Monthly budget for Groceries").fill("");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("month-status")).toHaveText("Removed the budget for Groceries.");
  await expect(catRow(page, "Groceries").locator("td").nth(2)).toHaveText("");
});

test.describe("month screen visuals", () => {
  test.beforeEach(async ({ page }) => {
    await openMonth(page, { ...seedLedger, budgets: { c1: 20000, c2: 90000 } });
    await expect(txRows(page)).toHaveCount(4);
  });

  test("tier 1: accessibility structure is identical everywhere", async ({ page }) => {
    await expect(page.locator("body")).toMatchAriaSnapshot({ name: "month.aria.yml" });
  });

  test("tier 2: layout geometry stays within tolerance everywhere", async ({ page }, testInfo) => {
    await checkGeometry(page, testInfo, "month");
  });

  test("tier 3: pixels match the per-OS baseline", async ({ page }, testInfo) => {
    await checkPixels(page, testInfo, "month");
  });
});

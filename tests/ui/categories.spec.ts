// L4 (categories and rules against the labelled mock) and L5 (visual tiers
// of the Categories screen).
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { checkGeometry, checkPixels, openApp, seedLedger } from "./support";

const catRows = (page: Page) => page.getByRole("table", { name: "Categories" }).locator("tbody tr");
const ruleRows = (page: Page) => page.getByRole("table", { name: "Rules" }).locator("tbody tr");
const txRow = (page: Page, payee: string) => page.getByRole("table", { name: "Transactions, newest first" }).locator("tbody tr", { hasText: payee });

async function go(page: Page, section: string): Promise<void> {
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: section }).click();
}

test.beforeEach(async ({ page }) => {
  await openApp(page, seedLedger);
  await go(page, "Categories");
  await expect(page.getByRole("heading", { name: "Categories", level: 1 })).toBeVisible();
});

test("lists categories with their transaction counts", async ({ page }) => {
  await expect(catRows(page)).toHaveCount(3);
  await expect(catRows(page).nth(0)).toContainText("Groceries");
  await expect(catRows(page).nth(0).locator("td.col-count")).toHaveText("2");
  await expect(catRows(page).nth(1)).toContainText("Housing");
});

test("creates a category and refuses a name already taken", async ({ page }) => {
  await page.getByLabel("New category name").fill("Eating out");
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByTestId("categories-status")).toHaveText("Added Eating out.");
  await expect(catRows(page)).toHaveCount(4);
  await page.getByLabel("New category name").fill("groceries");
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByTestId("categories-error")).toHaveText("There is already a category called Groceries. Merge them instead.");
});

test("renames a category everywhere it is shown", async ({ page }) => {
  await page.getByRole("button", { name: "Rename Groceries" }).click();
  await page.getByLabel("New name for Groceries").fill("Food");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("categories-status")).toHaveText("Renamed Groceries to Food.");
  await go(page, "Transactions");
  await expect(txRow(page, "Corner Shop")).toContainText("Food");
});

test("deleting a category leaves its transactions uncategorised", async ({ page }) => {
  await page.getByRole("button", { name: "Delete Groceries" }).click();
  await expect(page.getByTestId("categories-status")).toHaveText("Deleting Groceries leaves 2 transactions uncategorised and removes its rules.");
  await page.getByRole("button", { name: "Keep Groceries" }).click();
  await expect(catRows(page)).toHaveCount(3);
  await page.getByRole("button", { name: "Delete Groceries" }).click();
  await page.getByRole("button", { name: "Confirm delete Groceries" }).click();
  await expect(page.getByTestId("categories-status")).toHaveText("Deleted Groceries: 2 transactions now uncategorised.");
  await expect(catRows(page)).toHaveCount(2);
  await go(page, "Transactions");
  await expect(txRow(page, "Corner Shop").locator("td").nth(2)).toHaveText("");
  await expect(txRow(page, "Farmers Market").locator("td").nth(2)).toHaveText("");
});

test("merges one category into another", async ({ page }) => {
  await page.getByRole("button", { name: "Merge Housing" }).click();
  await page.getByLabel("Merge Housing into").selectOption({ label: "Groceries" });
  await page.getByRole("button", { name: "Merge", exact: true }).click();
  await expect(page.getByTestId("categories-status")).toHaveText("Merged Housing into Groceries: 1 transaction moved.");
  await expect(catRows(page)).toHaveCount(2);
  await expect(catRows(page).nth(0).locator("td.col-count")).toHaveText("3");
  await go(page, "Transactions");
  await expect(txRow(page, "Landlord")).toContainText("Groceries");
});

test("a rule categorises uncategorised transactions on request and only those", async ({ page }) => {
  await page.getByLabel("Payee contains").fill("utility");
  await page.getByLabel("Category", { exact: true }).selectOption({ label: "Housing" });
  await page.getByRole("button", { name: "Add rule" }).click();
  await expect(page.getByTestId("rules-status")).toHaveText('Added the rule for "utility".');
  await expect(ruleRows(page)).toHaveCount(1);
  await expect(ruleRows(page).first()).toHaveText(/utilityHousing/);
  await page.getByLabel("Payee contains").fill("utility");
  await page.getByRole("button", { name: "Add rule" }).click();
  await expect(page.getByTestId("rules-error")).toHaveText("That rule already exists.");

  await page.getByRole("button", { name: "Apply rules to uncategorised transactions" }).click();
  await expect(page.getByTestId("rules-status")).toHaveText("Categorised 1 transaction.");
  await expect(catRows(page).nth(1).locator("td.col-count")).toHaveText("2");
  await go(page, "Transactions");
  await expect(txRow(page, "Water Utility")).toContainText("Housing");
});

test("rules give imported rows their category, shown in the preview", async ({ page }) => {
  await page.getByLabel("Payee contains").fill("corner shop");
  await page.getByLabel("Category", { exact: true }).selectOption({ label: "Groceries" });
  await page.getByRole("button", { name: "Add rule" }).click();
  await page.evaluate((t) => {
    const w = window as unknown as { __TALLY_MOCK__: { files?: unknown[] } };
    (w.__TALLY_MOCK__.files ??= []).push({ name: "us-comma.csv", text: t });
  }, readFileSync("tests/fixtures/csv/us-comma.csv", "utf8"));
  await go(page, "Import");
  await page.getByRole("button", { name: "Choose CSV file…" }).click();
  const preview = page.getByRole("table", { name: "Preview of the first rows" }).locator("tbody tr");
  await expect(preview.nth(2)).toContainText("Corner ShopGroceries");
  await expect(preview.nth(0)).not.toContainText("Groceries");
});

test("deleting a rule", async ({ page }) => {
  await page.getByLabel("Payee contains").fill("shop");
  await page.getByRole("button", { name: "Add rule" }).click();
  await page.getByRole("button", { name: "Delete rule shop" }).click();
  await expect(page.getByTestId("rules-status")).toHaveText("Rule deleted.");
  await expect(page.getByText("No rules yet.")).toBeVisible();
});

test.describe("categories screen visuals", () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page, { ...seedLedger, rules: [{ id: "r9", contains: "utility", categoryId: "c2" }], nextId: 10 });
    await go(page, "Categories");
    await expect(ruleRows(page)).toHaveCount(1);
  });

  test("tier 1: accessibility structure is identical everywhere", async ({ page }) => {
    await expect(page.locator("body")).toMatchAriaSnapshot({ name: "categories.aria.yml" });
  });

  test("tier 2: layout geometry stays within tolerance everywhere", async ({ page }, testInfo) => {
    await checkGeometry(page, testInfo, "categories");
  });

  test("tier 3: pixels match the per-OS baseline", async ({ page }, testInfo) => {
    await checkPixels(page, testInfo, "categories");
  });
});

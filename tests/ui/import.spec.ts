// L4 (importing a bank CSV against the labelled mock; the open-file dialog
// answers from the mock's file queue) and L5 (visual tiers of the Import
// screen with a file loaded).
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { checkGeometry, checkPixels, openApp } from "./support";

const fixture = (name: string) => readFileSync(`tests/fixtures/csv/${name}`, "utf8").replace(/^\ufeff/, "");

async function queueFile(page: Page, name: string, text = fixture(name)): Promise<void> {
  await page.evaluate(
    ([n, t]) => {
      const w = window as unknown as { __TALLY_MOCK__?: { files?: { name: string; text: string }[] } };
      w.__TALLY_MOCK__ ??= {};
      (w.__TALLY_MOCK__.files ??= []).push({ name: n, text: t });
    },
    [name, text] as const,
  );
}

async function openImport(page: Page): Promise<void> {
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Import" }).click();
  await expect(page.getByRole("heading", { name: "Import", level: 1 })).toBeVisible();
}

const previewRows = (page: Page) => page.getByRole("table", { name: "Preview of the first rows" }).locator("tbody tr");
const importButton = (page: Page) => page.getByRole("button", { name: /^Import \d+ transactions?$/ });

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await openImport(page);
});

test("imports a bank CSV after checking the detected columns and the preview", async ({ page }) => {
  await queueFile(page, "us-comma.csv");
  await page.getByRole("button", { name: "Choose CSV file…" }).click();
  await expect(page.getByTestId("import-file")).toHaveText("us-comma.csv: 9 rows");

  await expect(page.getByLabel("Delimiter")).toHaveValue(",");
  await expect(page.getByLabel("First row is a header")).toBeChecked();
  await expect(page.getByLabel("Date column")).toHaveValue("0");
  await expect(page.getByLabel("Payee column")).toHaveValue("1");
  await expect(page.getByLabel("Amount column")).toHaveValue("2");
  await expect(page.getByLabel("Date order")).toHaveValue("MDY");
  await expect(page.getByLabel("Decimal separator")).toHaveValue(".");

  await expect(page.getByTestId("import-summary")).toHaveText("6 rows will be imported. 0 duplicates will be skipped. 3 rows cannot be read.");
  await expect(previewRows(page)).toHaveCount(6);
  await expect(previewRows(page).first()).toContainText("2026-03-01");
  await expect(previewRows(page).first()).toContainText("Landlord, Inc.");
  await expect(previewRows(page).first()).toContainText("-950.00");
  await expect(previewRows(page).first()).toContainText("New");
  const rejected = page.getByRole("table", { name: "Rows that cannot be read" });
  await expect(rejected.locator("tbody tr")).toHaveCount(3);
  await expect(rejected.locator("tbody tr").nth(0)).toHaveText(/^7date "13\/45\/2026" is not a valid month-day-year date$/);
  await expect(rejected.locator("tbody tr").nth(1)).toHaveText("8payee is empty");

  await importButton(page).click();
  await expect(page.getByTestId("import-status")).toHaveText("Imported 6 transactions. Skipped 0 duplicates. 3 rows could not be read.");
  await expect(page.getByTestId("import-file")).toHaveText("No file chosen.");
  await page.getByRole("button", { name: "Transactions" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(6);
  await expect(page.locator("tbody tr").first()).toContainText("Multi line payee");
});

test("importing the same file twice adds nothing the second time", async ({ page }) => {
  await queueFile(page, "us-comma.csv");
  await queueFile(page, "us-comma.csv");
  await page.getByRole("button", { name: "Choose CSV file…" }).click();
  await importButton(page).click();
  await page.getByRole("button", { name: "Choose CSV file…" }).click();
  await expect(page.getByTestId("import-summary")).toHaveText("0 rows will be imported. 6 duplicates will be skipped. 3 rows cannot be read.");
  await expect(previewRows(page).first()).toContainText("Duplicate, skipped");
  await expect(page.getByRole("button", { name: "Import 0 transactions" })).toBeDisabled();
});

test("reads a semicolon export with day-month-year dates and decimal commas", async ({ page }) => {
  await queueFile(page, "de-semicolon.csv");
  await page.getByRole("button", { name: "Choose CSV file…" }).click();
  await expect(page.getByLabel("Delimiter")).toHaveValue(";");
  await expect(page.getByLabel("Date order")).toHaveValue("DMY");
  await expect(page.getByLabel("Decimal separator")).toHaveValue(",");
  await expect(page.getByLabel("Payee column")).toHaveValue("1");
  await expect(page.getByLabel("Amount column")).toHaveValue("3");
  await expect(previewRows(page).nth(1)).toContainText("Arbeitgeber AG");
  await expect(previewRows(page).nth(1)).toContainText("3,120.50");
  await expect(previewRows(page).nth(2)).toContainText("Bäckerei Müller");
  await importButton(page).click();
  await expect(page.getByTestId("import-status")).toHaveText("Imported 4 transactions. Skipped 0 duplicates. 0 rows could not be read.");
});

test("reads separate debit and credit columns", async ({ page }) => {
  await queueFile(page, "debit-credit.csv");
  await page.getByRole("button", { name: "Choose CSV file…" }).click();
  await expect(page.getByLabel("Separate debit and credit columns")).toBeChecked();
  await expect(page.getByLabel("Debit column (money out)")).toHaveValue("2");
  await expect(page.getByLabel("Credit column (money in)")).toHaveValue("3");
  await expect(previewRows(page).nth(0)).toContainText("-950.00");
  await expect(previewRows(page).nth(1)).toContainText("3,120.50");
  await expect(page.getByTestId("import-summary")).toHaveText("4 rows will be imported. 0 duplicates will be skipped. 2 rows cannot be read.");
});

test("changing the mapping changes the preview", async ({ page }) => {
  await queueFile(page, "us-comma.csv");
  await page.getByRole("button", { name: "Choose CSV file…" }).click();
  await page.getByLabel("Date order").selectOption("DMY");
  // 03/14 and similar are not day-month dates; 03/01 becomes 3 January.
  await expect(previewRows(page).first()).toContainText("2026-01-03");
  await page.getByLabel("Payee column").selectOption("0");
  await expect(page.getByRole("alert").filter({ hasText: "Each of date, payee and amount needs its own column." })).toBeVisible();
  await expect(importButton(page)).toHaveCount(0);
  await page.getByLabel("Payee column").selectOption("1");
  await page.getByLabel("Date order").selectOption("MDY");
  await expect(page.getByTestId("import-summary")).toContainText("6 rows will be imported.");
});

test("a header switched off becomes a row of its own", async ({ page }) => {
  await queueFile(page, "debit-credit.csv");
  await page.getByRole("button", { name: "Choose CSV file…" }).click();
  await page.getByLabel("First row is a header").uncheck();
  await expect(page.getByLabel("Date column").locator("option").first()).toHaveText("Column 1");
  await expect(page.getByTestId("import-summary")).toContainText("3 rows cannot be read.");
});

test("cancelling the file dialog changes nothing", async ({ page }) => {
  await page.getByRole("button", { name: "Choose CSV file…" }).click();
  await expect(page.getByTestId("import-file")).toHaveText("No file chosen.");
  await expect(page.getByRole("heading", { name: "2. Match the columns" })).toBeHidden();
});

test("explains a file with no rows", async ({ page }) => {
  await queueFile(page, "empty.csv", "Date,Payee,Amount\n");
  await page.getByRole("button", { name: "Choose CSV file…" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "The file has no rows to import." })).toBeVisible();
});

test.describe("import screen visuals", () => {
  test.beforeEach(async ({ page }) => {
    await queueFile(page, "us-comma.csv");
    await page.getByRole("button", { name: "Choose CSV file…" }).click();
    await expect(previewRows(page)).toHaveCount(6);
  });

  test("tier 1: accessibility structure is identical everywhere", async ({ page }) => {
    await expect(page.locator("body")).toMatchAriaSnapshot({ name: "import.aria.yml" });
  });

  test("tier 2: layout geometry stays within tolerance everywhere", async ({ page }, testInfo) => {
    await checkGeometry(page, testInfo, "import");
  });

  test("tier 3: pixels match the per-OS baseline", async ({ page }, testInfo) => {
    await checkPixels(page, testInfo, "import");
  });
});

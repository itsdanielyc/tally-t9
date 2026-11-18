// L4: find, export and undo against the labelled mock. The save dialog
// answers from the mock, which keeps what it "saved" for the test to read.
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { openApp, seedLedger } from "./support";

const rows = (page: Page) => page.getByRole("table", { name: "Transactions, newest first" }).locator("tbody tr");
const payees = async (page: Page) => (await rows(page).locator("td:nth-child(2)").allTextContents()).map((s) => s.trim());
const exports = (page: Page) =>
  page.evaluate(() => (window as unknown as { __TALLY_MOCK__: { exports?: { name: string; text: string }[] } }).__TALLY_MOCK__.exports ?? []);

async function go(page: Page, section: string): Promise<void> {
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: section }).click();
}

test.beforeEach(async ({ page }) => {
  await openApp(page, seedLedger);
  await expect(rows(page)).toHaveCount(5);
  await expect(page.getByTestId("tx-count")).toHaveText("5 transactions");
});

test.describe("find", () => {
  test("searches payee and note text", async ({ page }) => {
    await page.getByLabel("Search payee and note").fill("rent");
    await expect(page.getByTestId("tx-count")).toHaveText("Showing 1 of 5");
    expect(await payees(page)).toEqual(["Landlord"]);
    await page.getByLabel("Search payee and note").fill("MARKET");
    expect(await payees(page)).toEqual(["Farmers Market"]);
  });

  test("filters by category, including uncategorised", async ({ page }) => {
    await page.getByLabel("Show category").selectOption({ label: "Groceries" });
    await expect(page.getByTestId("tx-count")).toHaveText("Showing 2 of 5");
    expect(await payees(page)).toEqual(["Farmers Market", "Corner Shop"]);
    await page.getByLabel("Show category").selectOption({ label: "Uncategorised" });
    expect(await payees(page)).toEqual(["Water Utility"]);
  });

  test("filters by date range and amount range, and clears", async ({ page }) => {
    await page.getByLabel("From").fill("2026-03-02");
    await page.getByLabel("To").fill("2026-03-12");
    await expect(page.getByTestId("tx-count")).toHaveText("Showing 3 of 5");
    await page.getByLabel("Smallest amount").fill("20");
    await page.getByLabel("Largest amount").fill("100");
    await expect(page.getByTestId("tx-count")).toHaveText("Showing 1 of 5");
    expect(await payees(page)).toEqual(["Farmers Market"]);
    await page.getByLabel("Largest amount").fill("abc");
    await expect(page.getByLabel("Largest amount")).toHaveAttribute("aria-invalid", "true");
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.getByTestId("tx-count")).toHaveText("5 transactions");
  });

  test("says when nothing matches", async ({ page }) => {
    await page.getByLabel("Search payee and note").fill("zzz");
    await expect(page.getByText("No transactions match these filters.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Export shown…" })).toBeDisabled();
  });
});

test.describe("export", () => {
  test("exports exactly the transactions shown, oldest first", async ({ page }) => {
    await page.getByLabel("Show category").selectOption({ label: "Groceries" });
    await page.getByRole("button", { name: "Export shown…" }).click();
    await expect(page.getByTestId("tx-status")).toHaveText(/^Exported 2 transactions to mock:tally-export-2026-03-15\.csv\.$/);
    const saved = await exports(page);
    expect(saved).toEqual([
      {
        name: "tally-export-2026-03-15.csv",
        text: 'Date,Payee,Amount,Category,Note\r\n2026-03-09,Corner Shop,-12.50,Groceries,"milk, bread"\r\n2026-03-12,Farmers Market,-43.20,Groceries,\r\n',
      },
    ]);
  });

  test("cancelling the save dialog writes nothing", async ({ page }) => {
    await page.evaluate(() => {
      (window as unknown as { __TALLY_MOCK__: { cancelSave?: boolean } }).__TALLY_MOCK__.cancelSave = true;
    });
    await page.getByRole("button", { name: "Export shown…" }).click();
    await expect(page.getByTestId("tx-status")).toHaveText("");
    expect(await exports(page)).toEqual([]);
  });

  test("the export reads back through Tally's own import with every column detected", async ({ page }) => {
    await page.getByRole("button", { name: "Export shown…" }).click();
    const [file] = await exports(page);
    await page.evaluate((f) => {
      const w = window as unknown as { __TALLY_MOCK__: { files?: unknown[] } };
      (w.__TALLY_MOCK__.files ??= []).push(f);
    }, file);
    await go(page, "Import");
    await page.getByRole("button", { name: "Choose CSV file…" }).click();
    await expect(page.getByLabel("Category column (optional)")).toHaveValue("3");
    await expect(page.getByLabel("Note column (optional)")).toHaveValue("4");
    // Into the same ledger every row is a duplicate: nothing changed on the way out and back.
    await expect(page.getByTestId("import-summary")).toHaveText("0 rows will be imported. 5 duplicates will be skipped. 0 rows cannot be read.");
  });
});

test.describe("undo", () => {
  test("undoes a delete once", async ({ page }) => {
    await page.getByRole("button", { name: "Delete Corner Shop on 2026-03-09" }).click();
    await page.getByRole("button", { name: "Confirm delete Corner Shop on 2026-03-09" }).click();
    await expect(rows(page)).toHaveCount(4);
    await expect(page.getByTestId("undo-bar")).toContainText("Deleted Corner Shop.");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByTestId("undo-bar")).toHaveText(/Undone: Deleted Corner Shop\./);
    await expect(page.getByRole("button", { name: "Undo" })).toBeHidden();
    await expect(rows(page)).toHaveCount(5);
    await expect(rows(page).filter({ hasText: "Corner Shop" })).toContainText("milk, bread");
  });

  test("any other change takes the undo away", async ({ page }) => {
    await page.getByRole("button", { name: "Delete Corner Shop on 2026-03-09" }).click();
    await page.getByRole("button", { name: "Confirm delete Corner Shop on 2026-03-09" }).click();
    await page.getByLabel("Payee", { exact: true }).fill("Bakery");
    await page.getByLabel(/^Amount/).fill("3");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByTestId("undo-bar")).toBeHidden();
  });

  test("undoes a category merge from the Categories screen", async ({ page }) => {
    await go(page, "Categories");
    await page.getByRole("button", { name: "Merge Housing" }).click();
    await page.getByLabel("Merge Housing into").selectOption({ label: "Groceries" });
    await page.getByRole("button", { name: "Merge", exact: true }).click();
    await expect(page.getByTestId("undo-bar")).toContainText("Merged Housing into Groceries.");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("table", { name: "Categories" }).locator("tbody tr")).toHaveCount(3);
    await go(page, "Transactions");
    await expect(rows(page).filter({ hasText: "Landlord" })).toContainText("Housing");
  });

  test("undoes an import in one step", async ({ page }) => {
    await page.evaluate((t) => {
      const w = window as unknown as { __TALLY_MOCK__: { files?: unknown[] } };
      (w.__TALLY_MOCK__.files ??= []).push({ name: "us-comma.csv", text: t });
    }, readFileSync("tests/fixtures/csv/us-comma.csv", "utf8"));
    await go(page, "Import");
    await page.getByRole("button", { name: "Choose CSV file…" }).click();
    // Employer Ltd and one of the two Corner Shop rows are already in the ledger.
    await page.getByRole("button", { name: "Import 4 transactions" }).click();
    await expect(page.getByTestId("undo-bar")).toContainText("Imported 4 transactions.");
    await page.getByRole("button", { name: "Undo" }).click();
    await go(page, "Transactions");
    await expect(page.getByTestId("tx-count")).toHaveText("5 transactions");
  });
});

// L6: importing a bank CSV in the real shell. A native file dialog cannot
// be driven by any test tool, so this journey uses the TALLY_TEST_IMPORT_FILE
// bypass (unpackaged builds only): the open dialog answers with the fixture,
// and everything after it (reading the bytes, decoding the BOM and umlauts
// in the main process, detection, the preview, the save) is the real thing.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Tally } from "./support";

const fixture = resolve("tests/fixtures/csv/de-semicolon.csv");
const tally = new Tally({ TALLY_TEST_IMPORT_FILE: fixture });
const preview = () => tally.win.getByRole("table", { name: "Preview of the first rows" }).locator("tbody tr");

test.describe.configure({ mode: "serial" });
test.beforeAll(() => tally.launch());
test.afterAll(() => tally.dispose());

test.describe("bank CSV import in the real shell", () => {
  test("imports a semicolon, decimal-comma export through the main process", async () => {
    await tally.go("Import");
    await tally.win.getByRole("button", { name: "Choose CSV file…" }).click();
    await expect(tally.win.getByTestId("import-file")).toHaveText("de-semicolon.csv: 4 rows");
    await expect(tally.win.getByLabel("Delimiter")).toHaveValue(";");
    await expect(tally.win.getByLabel("Date order")).toHaveValue("DMY");
    await expect(tally.win.getByLabel("Decimal separator")).toHaveValue(",");
    await expect(preview().nth(2)).toContainText("Bäckerei Müller");
    await expect(preview().nth(2)).toContainText("-4.35");
    await tally.win.getByRole("button", { name: "Import 4 transactions" }).click();
    await expect(tally.win.getByTestId("import-status")).toHaveText("Imported 4 transactions. Skipped 0 duplicates. 0 rows could not be read.");

    const onDisk = JSON.parse(readFileSync(join(tally.dataDir, "ledger.json"), "utf8"));
    expect(onDisk.transactions.map((t: { date: string; payee: string; amount: number }) => [t.date, t.payee, t.amount])).toEqual([
      ["2026-03-01", "Vermieter GmbH", -95000],
      ["2026-03-02", "Arbeitgeber AG", 312050],
      ["2026-03-09", "Bäckerei Müller", -435],
      ["2026-03-12", "Wochenmarkt", -4320],
    ]);
  });

  test("importing the same file again adds nothing, also after a restart", async () => {
    await tally.restart();
    await tally.go("Import");
    await tally.win.getByRole("button", { name: "Choose CSV file…" }).click();
    await expect(tally.win.getByTestId("import-summary")).toHaveText("0 rows will be imported. 4 duplicates will be skipped. 0 rows cannot be read.");
    await expect(tally.win.getByRole("button", { name: "Import 0 transactions" })).toBeDisabled();
    await tally.go("Transactions");
    await expect(tally.win.locator("tbody tr")).toHaveCount(4);
  });

  test("logged no console errors", async () => {
    expect(tally.consoleErrors).toEqual([]);
  });
});

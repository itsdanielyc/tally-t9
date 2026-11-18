// L6: find, export and undo in the real shell. The save and open dialogs
// answer from TALLY_TEST_EXPORT_FILE and TALLY_TEST_IMPORT_FILE (unpackaged
// builds only); the main process writes and reads the real file. The
// exported file is imported into a second app with an empty ledger.
import { expect, test } from "@playwright/test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Transaction } from "../../contracts/ledger";
import { Tally } from "./support";

const exchange = mkdtempSync(join(tmpdir(), "tally-exchange-"));
const exportFile = join(exchange, "export.csv");
const first = new Tally({ TALLY_TEST_EXPORT_FILE: exportFile });
const second = new Tally({ TALLY_TEST_IMPORT_FILE: exportFile });

type Shaped = { date: string; payee: string; amount: number; note: string; category: string | null };
async function shaped(t: Tally): Promise<Shaped[]> {
  return t.win.evaluate(async () => {
    const b = window.electronBridge!;
    const ledger = await b.getLedger();
    const names = new Map(ledger.categories.map((c) => [c.id, c.name]));
    return (await b.listTransactions()).map((x: Transaction) => ({
      date: x.date,
      payee: x.payee,
      amount: x.amount,
      note: x.note,
      category: x.categoryId ? (names.get(x.categoryId) ?? null) : null,
    }));
  });
}

test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  await first.dispose();
  await second.dispose();
  rmSync(exchange, { recursive: true, force: true });
});

test("undo in the real shell restores a deleted transaction, and the restore is saved", async () => {
  await first.launch();
  await first.win.evaluate(async () => {
    const b = window.electronBridge!;
    await b.addTransaction({ date: "2026-03-01", payee: "Landlord", amount: -95000, category: "Housing", note: "March rent" });
    await b.addTransaction({ date: "2026-03-01", payee: "Café Zürich", amount: -455, category: "Eating out", note: 'with "friends", late' });
    await b.addTransaction({ date: "2026-03-02", payee: "Employer Ltd", amount: 312050, category: "", note: "" });
    await b.addTransaction({ date: "2026-02-27", payee: "Shop, Inc", amount: -1250, category: "Groceries", note: "" });
  });
  await first.restart();
  await first.win.getByRole("button", { name: "Delete Landlord on 2026-03-01" }).click();
  await first.win.getByRole("button", { name: "Confirm delete Landlord on 2026-03-01" }).click();
  await expect(first.win.getByTestId("undo-bar")).toContainText("Deleted Landlord.");
  await first.win.getByRole("button", { name: "Undo" }).click();
  await expect(first.win.getByTestId("undo-bar")).toContainText("Undone: Deleted Landlord.");
  await first.restart();
  await expect(first.win.getByTestId("tx-count")).toHaveText("4 transactions");
});

test("exports the filtered list to a file through the main process", async () => {
  await first.win.getByLabel("Search payee and note").fill("rent");
  await first.win.getByRole("button", { name: "Export shown…" }).click();
  await expect(first.win.getByTestId("tx-status")).toHaveText(`Exported 1 transaction to ${exportFile}.`);
  expect(readFileSync(exportFile, "utf8")).toBe("Date,Payee,Amount,Category,Note\r\n2026-03-01,Landlord,-950.00,Housing,March rent\r\n");

  await first.win.getByRole("button", { name: "Clear filters" }).click();
  await first.win.getByRole("button", { name: "Export shown…" }).click();
  await expect(first.win.getByTestId("tx-status")).toHaveText(`Exported 4 transactions to ${exportFile}.`);
  expect(existsSync(`${exportFile}.tmp`)).toBe(false);
});

test("the exported file imports into an empty ledger as the same transactions", async () => {
  const expected = await shaped(first);
  await first.close();
  await second.launch();
  await second.go("Import");
  await second.win.getByRole("button", { name: "Choose CSV file…" }).click();
  await expect(second.win.getByLabel("Category column (optional)")).toHaveValue("3");
  await expect(second.win.getByLabel("Note column (optional)")).toHaveValue("4");
  await second.win.getByRole("button", { name: "Import 4 transactions" }).click();
  await expect(second.win.getByTestId("import-status")).toHaveText("Imported 4 transactions. Skipped 0 duplicates. 0 rows could not be read.");
  expect(await shaped(second)).toEqual(expected);
  await second.restart();
  expect(await shaped(second)).toEqual(expected);
});

test("logged no console errors", async () => {
  expect([...first.consoleErrors, ...second.consoleErrors]).toEqual([]);
});

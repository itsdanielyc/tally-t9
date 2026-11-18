// L6: categories and rules in the real shell, kept across a restart.
import { expect, test } from "@playwright/test";
import type { Transaction } from "../../contracts/ledger";
import { Tally } from "./support";

const tally = new Tally();
const list = () => tally.win.evaluate(() => window.electronBridge!.listTransactions()) as Promise<Transaction[]>;

test.describe.configure({ mode: "serial" });
test.beforeAll(() => tally.launch());
test.afterAll(() => tally.dispose());

test("a rule applied to uncategorised transactions is still applied after a restart", async () => {
  await tally.win.evaluate(async () => {
    const b = window.electronBridge!;
    await b.addTransaction({ date: "2026-03-01", payee: "Water Utility", amount: -3875, category: "", note: "" });
    await b.addTransaction({ date: "2026-03-02", payee: "Bakery", amount: -350, category: "", note: "" });
  });
  await tally.go("Categories");
  await tally.win.getByLabel("New category name").fill("Housing");
  await tally.win.getByRole("button", { name: "Add category" }).click();
  await tally.win.getByLabel("Payee contains").fill("utility");
  await tally.win.getByRole("button", { name: "Add rule" }).click();
  await tally.win.getByRole("button", { name: "Apply rules to uncategorised transactions" }).click();
  await expect(tally.win.getByTestId("rules-status")).toHaveText("Categorised 1 transaction.");

  const before = await list();
  await tally.restart();
  expect(await list()).toEqual(before);
  const ledger = await tally.win.evaluate(() => window.electronBridge!.getLedger());
  expect(ledger.categories.map((c) => c.name)).toEqual(["Housing"]);
  expect(ledger.rules.map((r) => r.contains)).toEqual(["utility"]);
  expect(before.find((t) => t.payee === "Water Utility")?.categoryId).toBe(ledger.categories[0].id);
  expect(before.find((t) => t.payee === "Bakery")?.categoryId).toBe(null);
});

test("deleting the category in the real shell leaves the transaction uncategorised", async () => {
  await tally.go("Categories");
  await tally.win.getByRole("button", { name: "Delete Housing" }).click();
  await tally.win.getByRole("button", { name: "Confirm delete Housing" }).click();
  await expect(tally.win.getByTestId("categories-status")).toHaveText("Deleted Housing: 1 transaction now uncategorised.");
  await tally.restart();
  expect((await list()).every((t) => t.categoryId === null)).toBe(true);
  expect((await tally.win.evaluate(() => window.electronBridge!.getLedger())).rules).toEqual([]);
});

test("logged no console errors", async () => {
  expect(tally.consoleErrors).toEqual([]);
});

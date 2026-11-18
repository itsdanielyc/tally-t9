// L6: the Month screen in the real shell, and a budget kept across a restart.
import { expect, test } from "@playwright/test";
import { Tally } from "./support";

const tally = new Tally();
const catRow = (name: string) => tally.win.getByRole("table", { name: "Categories this month" }).locator("tbody tr", { hasText: name });

test.describe.configure({ mode: "serial" });
test.beforeAll(() => tally.launch());
test.afterAll(() => tally.dispose());

test("a monthly budget set in the real shell is kept after a restart", async () => {
  await tally.win.evaluate(async () => {
    const b = window.electronBridge!;
    await b.addTransaction({ date: "2026-03-09", payee: "Corner Shop", amount: -1250, category: "Groceries", note: "" });
    await b.addTransaction({ date: "2026-03-10", payee: "Refund", amount: 499, category: "Groceries", note: "" });
    await b.addTransaction({ date: "2026-03-31", payee: "Employer Ltd", amount: 312050, category: "Salary", note: "" });
  });
  await tally.go("Month");
  await tally.win.getByLabel("Month", { exact: true }).fill("2026-03");
  await expect(tally.win.getByRole("heading", { name: "March 2026" })).toBeVisible();
  await tally.win.getByRole("button", { name: "Set budget for Groceries" }).click();
  await tally.win.getByLabel("Monthly budget for Groceries").fill("200");
  await tally.win.getByRole("button", { name: "Save" }).click();
  await expect(catRow("Groceries").locator("td").nth(3)).toHaveText("192.49");

  await tally.restart();
  await tally.go("Month");
  await tally.win.getByLabel("Month", { exact: true }).fill("2026-03");
  await expect(tally.win.getByTestId("month-income")).toHaveText("3,125.49");
  await expect(tally.win.getByTestId("month-spending")).toHaveText("12.50");
  await expect(tally.win.getByTestId("month-net")).toHaveText("3,112.99");
  await expect(catRow("Groceries").locator("td").nth(2)).toHaveText("200.00");
  await expect(catRow("Groceries").locator("td").nth(3)).toHaveText("192.49");
  const summary = await tally.win.evaluate(() => window.electronBridge!.monthSummary("2026-03"));
  expect(summary.ok && summary.value.net).toBe(311299);
});

test("logged no console errors", async () => {
  expect(tally.consoleErrors).toEqual([]);
});

// L1: the monthly summary and budgets. Totals are exact sums of the
// transactions shown, for any mix of income and spending, at every month
// boundary; budgets show the amount left or over.
import { describe, expect, it } from "vitest";
import type { Category, Transaction } from "../../contracts/ledger";
import { addMonths, monthLabel } from "../../core/dates";
import { createLedgerService, memoryStore } from "../../core/service";
import { summarise, UNCATEGORISED } from "../../core/summary";
import { int, pick, seeded } from "../support/random";

const t = (id: string, date: string, amount: number, categoryId: string | null = null): Transaction => ({
  id,
  date,
  payee: id,
  amount,
  categoryId,
  note: "",
});
const cats: Category[] = [
  { id: "c1", name: "Groceries" },
  { id: "c2", name: "Housing" },
  { id: "c3", name: "Salary" },
  { id: "c4", name: "Eating out" },
];

describe("summarise", () => {
  const ledger = [
    t("rent", "2026-03-01", -95000, "c2"),
    t("pay", "2026-03-31", 312050, "c3"),
    t("shop", "2026-03-09", -1250, "c1"),
    t("refund", "2026-03-10", 499, "c1"),
    t("water", "2026-03-15", -3875),
    t("feb", "2026-02-28", -100, "c1"),
    t("apr", "2026-04-01", -100, "c1"),
  ];

  it("totals per category, income against spending, uncategorised last", () => {
    const s = summarise("2026-03", ledger, cats, { c1: 20000, c4: 5000 });
    expect(s.income).toBe(312549);
    expect(s.spending).toBe(100125);
    expect(s.net).toBe(212424);
    expect(s.categories).toEqual([
      // Eating out has a budget but nothing spent: it is listed with all of it left.
      { categoryId: "c4", name: "Eating out", income: 0, spending: 0, net: 0, budget: 5000, left: 5000 },
      // A refund reduces what was spent: 12.50 - 4.99 = 7.51 of 200.00.
      { categoryId: "c1", name: "Groceries", income: 499, spending: 1250, net: -751, budget: 20000, left: 19249 },
      { categoryId: "c2", name: "Housing", income: 0, spending: 95000, net: -95000, budget: null, left: null },
      { categoryId: "c3", name: "Salary", income: 312050, spending: 0, net: 312050, budget: null, left: null },
      { categoryId: null, name: UNCATEGORISED, income: 0, spending: 3875, net: -3875, budget: null, left: null },
    ]);
    expect(s.transactions.map((x) => x.id)).toEqual(["pay", "water", "refund", "shop", "rent"]);
  });

  it("shows a budget overspent as a negative amount left", () => {
    const s = summarise("2026-03", ledger, cats, { c2: 90000 });
    expect(s.categories.find((c) => c.categoryId === "c2")).toMatchObject({ budget: 90000, left: -5000 });
  });

  it("keeps the first and last day of a month inside it and the neighbours out", () => {
    expect(summarise("2026-02", ledger, cats, {}).transactions.map((x) => x.id)).toEqual(["feb"]);
    expect(summarise("2026-04", ledger, cats, {}).transactions.map((x) => x.id)).toEqual(["apr"]);
    const leap = [t("a", "2024-02-29", -1), t("b", "2024-03-01", -2), t("c", "2023-12-31", -4), t("d", "2024-01-01", -8)];
    expect(summarise("2024-02", leap, cats, {}).spending).toBe(1);
    expect(summarise("2024-01", leap, cats, {}).spending).toBe(8);
    expect(summarise("2023-12", leap, cats, {}).spending).toBe(4);
  });

  it("an empty month is all zeros", () => {
    expect(summarise("2030-01", ledger, cats, {})).toEqual({ month: "2030-01", income: 0, spending: 0, net: 0, categories: [], transactions: [] });
  });

  it("totals equal the sum of the transactions shown, to the cent, randomized (seed 4)", () => {
    const rand = seeded(4);
    const months = ["2024-02", "2024-12", "2025-01", "2025-06", "2026-03"];
    for (let round = 0; round < 200; round++) {
      const list: Transaction[] = [];
      const n = int(rand, 0, 200);
      for (let i = 0; i < n; i++) {
        const month = pick(rand, months);
        const y = Number(month.slice(0, 4));
        const m = Number(month.slice(5));
        const last = new Date(y, m, 0).getDate();
        const day = pick(rand, [1, last, int(rand, 1, last)]);
        const amount = int(rand, 1, 99_999_999) * (rand() < 0.7 ? -1 : 1);
        list.push(t(`t${i}`, `${month}-${String(day).padStart(2, "0")}`, amount, pick(rand, ["c1", "c2", "c3", null])));
      }
      for (const month of months) {
        const s = summarise(month, list, cats, {});
        const shown = s.transactions;
        const sum = shown.reduce((a, x) => a + x.amount, 0);
        expect(s.net, `round ${round} ${month}`).toBe(sum);
        expect(s.income - s.spending).toBe(sum);
        expect(s.income).toBe(shown.filter((x) => x.amount > 0).reduce((a, x) => a + x.amount, 0));
        expect(s.categories.reduce((a, c) => a + c.net, 0)).toBe(sum);
        expect(shown).toHaveLength(list.filter((x) => x.date.startsWith(month + "-")).length);
      }
    }
  });
});

describe("month navigation", () => {
  it("moves across year ends", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-03", 0)).toBe("2026-03");
    expect(addMonths("2026-03", -15)).toBe("2024-12");
    expect(monthLabel("2026-03")).toBe("March 2026");
  });
});

describe("budgets through the service", () => {
  const draft = (payee: string, category: string, amount: number) => ({ date: "2026-03-10", payee, amount, category, note: "" });

  it("sets, changes and removes a budget, and refuses a bad one", () => {
    const store = memoryStore();
    const s = createLedgerService(store);
    s.addTransaction(draft("Shop", "Groceries", -1250));
    const g = s.getLedger().categories[0];
    expect(s.setBudget(g.id, 30000)).toEqual({ ok: true, value: { categoryId: g.id, amount: 30000 } });
    expect(store.current().budgets).toEqual({ [g.id]: 30000 });
    expect(s.monthSummary("2026-03")).toMatchObject({ ok: true, value: { categories: [{ name: "Groceries", budget: 30000, left: 28750 }] } });
    expect(s.setBudget(g.id, 12.5)).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(s.setBudget(g.id, -100)).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(s.setBudget("c99", 100)).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(s.setBudget(g.id, null)).toEqual({ ok: true, value: { categoryId: g.id, amount: null } });
    expect(s.getLedger().budgets).toEqual({});
    expect(s.monthSummary("2026-13")).toMatchObject({ ok: false, error: { code: "invalid" } });
  });

  it("deleting a category removes its budget; merging keeps the target's", () => {
    const s = createLedgerService(memoryStore());
    s.addTransaction(draft("Shop", "Groceries", -1250));
    s.addTransaction(draft("Cafe", "Eating out", -800));
    s.addTransaction(draft("Bar", "Drinks", -600));
    const id = (n: string) => s.getLedger().categories.find((c) => c.name === n)!.id;
    s.setBudget(id("Groceries"), 30000);
    s.setBudget(id("Eating out"), 10000);
    s.setBudget(id("Drinks"), 5000);
    const drinks = id("Drinks");
    s.deleteCategory(drinks);
    s.mergeCategories(id("Eating out"), id("Groceries"));
    expect(s.getLedger().budgets).toEqual({ [id("Groceries")]: 30000 });
    expect(s.monthSummary("2026-03")).toMatchObject({
      ok: true,
      value: { categories: [{ name: "Groceries", spending: 2050, budget: 30000, left: 27950 }, { name: UNCATEGORISED, spending: 600 }] },
    });
  });
});

// L1: categories and payee rules, in the core and through the service.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ImportMapping, Rule } from "../../contracts/ledger";
import { categoryFor, checkCategoryName, checkRuleText } from "../../core/categories";
import { decodeCsvBytes } from "../../core/csv";
import { createLedgerService, memoryStore } from "../../core/service";

const draft = (payee: string, category = "", amount = -100) => ({ date: "2026-03-14", payee, amount, category, note: "" });

describe("category names and rule text", () => {
  const cats = [{ id: "c1", name: "Groceries" }];

  it("cleans a name and refuses an empty, overlong or taken one", () => {
    expect(checkCategoryName("  Eating   out ", cats)).toEqual({ ok: true, value: "Eating out" });
    expect(checkCategoryName("", cats)).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(checkCategoryName("x".repeat(61), cats)).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(checkCategoryName("groceries", cats)).toMatchObject({ ok: false, error: { code: "conflict", message: expect.stringContaining("Merge") } });
    // Renaming a category to a different case of its own name is fine.
    expect(checkCategoryName("GROCERIES", cats, "c1")).toEqual({ ok: true, value: "GROCERIES" });
  });

  it("cleans rule text and refuses empty or overlong text", () => {
    expect(checkRuleText(" tesco ")).toEqual({ ok: true, value: "tesco" });
    expect(checkRuleText(" ").ok).toBe(false);
    expect(checkRuleText("x".repeat(101)).ok).toBe(false);
  });

  it("matches payee text ignoring case, first rule created wins", () => {
    const rules: Rule[] = [
      { id: "r1", contains: "shell", categoryId: "fuel" },
      { id: "r2", contains: "Shell Cafe", categoryId: "food" },
      { id: "r3", contains: "market", categoryId: "food" },
    ];
    expect(categoryFor("SHELL Cafe Main St", rules)).toBe("fuel");
    expect(categoryFor("Farmers  Market", rules)).toBe("food");
    expect(categoryFor("Bakery", rules)).toBe(null);
  });
});

describe("categories through the service", () => {
  it("creates, renames and refuses a clash", () => {
    const s = createLedgerService(memoryStore());
    const g = s.createCategory("Groceries");
    expect(g).toMatchObject({ ok: true, value: { name: "Groceries" } });
    const id = g.ok ? g.value.id : "";
    expect(s.createCategory("groceries")).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(s.renameCategory(id, "Food")).toEqual({ ok: true, value: { id, name: "Food" } });
    s.createCategory("Fuel");
    expect(s.renameCategory(id, "fuel")).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(s.renameCategory("c99", "X")).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(s.getLedger().categories.map((c) => c.name)).toEqual(["Food", "Fuel"]);
  });

  it("deleting a category leaves its transactions uncategorised and removes its rules", () => {
    const store = memoryStore();
    const s = createLedgerService(store);
    s.addTransaction(draft("Corner Shop", "Groceries"));
    s.addTransaction(draft("Market", "Groceries"));
    s.addTransaction(draft("Shell", "Fuel"));
    const groceries = s.getLedger().categories.find((c) => c.name === "Groceries")!;
    s.createRule("shop", groceries.id);
    expect(s.deleteCategory(groceries.id)).toEqual({ ok: true, value: { uncategorised: 2 } });
    expect(s.listTransactions().map((t) => [t.payee, t.categoryId === null])).toEqual([
      ["Shell", false],
      ["Market", true],
      ["Corner Shop", true],
    ]);
    expect(s.getLedger().rules).toEqual([]);
    expect(store.current().categories.map((c) => c.name)).toEqual(["Fuel"]);
  });

  it("merging moves transactions and rules to the target and removes the source", () => {
    const s = createLedgerService(memoryStore());
    s.addTransaction(draft("Corner Shop", "Food shopping"));
    s.addTransaction(draft("Market", "Groceries"));
    const [food, groceries] = ["Food shopping", "Groceries"].map((n) => s.getLedger().categories.find((c) => c.name === n)!);
    s.createRule("corner", food.id);
    expect(s.mergeCategories(food.id, groceries.id)).toEqual({ ok: true, value: { moved: 1 } });
    expect(s.listTransactions().every((t) => t.categoryId === groceries.id)).toBe(true);
    expect(s.getLedger().rules).toEqual([{ id: expect.any(String), contains: "corner", categoryId: groceries.id }]);
    expect(s.getLedger().categories.map((c) => c.name)).toEqual(["Groceries"]);
    expect(s.mergeCategories(groceries.id, groceries.id)).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(s.mergeCategories(food.id, groceries.id)).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

describe("rules through the service", () => {
  it("creates and deletes rules, refusing a duplicate or a missing category", () => {
    const s = createLedgerService(memoryStore());
    const fuel = s.createCategory("Fuel");
    const fuelId = fuel.ok ? fuel.value.id : "";
    const r = s.createRule(" Shell ", fuelId);
    expect(r).toMatchObject({ ok: true, value: { contains: "Shell", categoryId: fuelId } });
    expect(s.createRule("shell", fuelId)).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(s.createRule("bp", "c99")).toMatchObject({ ok: false, error: { code: "invalid", field: "category" } });
    expect(s.deleteRule(r.ok ? r.value.id : "")).toEqual({ ok: true, value: null });
    expect(s.deleteRule("r99")).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(s.getLedger().rules).toEqual([]);
  });

  it("applies rules on request to every uncategorised transaction only", () => {
    const s = createLedgerService(memoryStore());
    s.addTransaction(draft("SHELL Main St"));
    s.addTransaction(draft("Shell Garage", "Car"));
    s.addTransaction(draft("Bakery"));
    const fuel = s.createCategory("Fuel");
    const fuelId = fuel.ok ? fuel.value.id : "";
    s.createRule("shell", fuelId);
    expect(s.applyRules()).toEqual({ ok: true, value: { categorised: 1 } });
    const byPayee = Object.fromEntries(s.listTransactions().map((t) => [t.payee, t.categoryId]));
    expect(byPayee["SHELL Main St"]).toBe(fuelId);
    expect(byPayee["Shell Garage"]).not.toBe(fuelId);
    expect(byPayee.Bakery).toBe(null);
    expect(s.applyRules()).toEqual({ ok: true, value: { categorised: 0 } });
  });

  it("gives imported rows the category of the first matching rule, in the preview and on import", () => {
    const text = decodeCsvBytes(readFileSync("tests/fixtures/csv/us-comma.csv"));
    const us: ImportMapping = { delimiter: ",", hasHeader: true, date: 0, payee: 1, amount: { kind: "signed", column: 2 }, dateOrder: "MDY", decimal: "." };
    const s = createLedgerService(memoryStore());
    const g = s.createCategory("Groceries");
    const gid = g.ok ? g.value.id : "";
    s.createRule("corner shop", gid);
    s.createRule("market", gid);
    const p = s.previewImport(text, us);
    expect(p.ok && p.value.rows.map((r) => [r.payee, r.categoryId])).toEqual([
      ["Landlord, Inc.", null],
      ["Employer Ltd", null],
      ["Corner Shop", gid],
      ["Corner Shop", gid],
      ['Farmers "Fresh" Market', gid],
      ["Multi line payee", null],
    ]);
    s.commitImport(text, us);
    expect(s.listTransactions().filter((t) => t.categoryId === gid)).toHaveLength(3);
  });
});

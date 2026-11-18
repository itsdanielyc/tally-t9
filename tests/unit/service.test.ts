// L1: the ledger service over a memory store: recording transactions, the
// currency setting, and that a failed save changes nothing.
import { describe, expect, it } from "vitest";
import type { TransactionDraft } from "../../contracts/ledger";
import { emptyLedger, type LedgerData } from "../../core/schema";
import { createLedgerService, memoryStore, type LedgerStore } from "../../core/service";

const draft = (patch: Partial<TransactionDraft> = {}): TransactionDraft => ({
  date: "2026-03-14",
  payee: "Corner Shop",
  amount: -1250,
  category: "",
  note: "",
  ...patch,
});

describe("ledger service: transactions", () => {
  it("adds, lists newest first, edits and deletes", () => {
    const store = memoryStore();
    const s = createLedgerService(store);
    const a = s.addTransaction(draft({ date: "2026-03-01", payee: "Rent", amount: -90000 }));
    const b = s.addTransaction(draft({ date: "2026-03-14" }));
    const c = s.addTransaction(draft({ date: "2026-03-01", payee: "Salary", amount: 250000 }));
    expect(a.ok && b.ok && c.ok).toBe(true);
    expect(s.listTransactions().map((t) => t.payee)).toEqual(["Corner Shop", "Salary", "Rent"]);

    const id = a.ok ? a.value.id : "";
    const edited = s.updateTransaction(id, draft({ date: "2026-03-02", payee: "Rent March", amount: -95000, note: "late" }));
    expect(edited).toMatchObject({ ok: true, value: { id, payee: "Rent March", amount: -95000, note: "late" } });
    expect(store.current().transactions.find((t) => t.id === id)?.amount).toBe(-95000);

    expect(s.deleteTransaction(id)).toEqual({ ok: true, value: null });
    expect(s.listTransactions().map((t) => t.payee)).toEqual(["Corner Shop", "Salary"]);
    expect(s.getLedger().transactionCount).toBe(2);
  });

  it("creates a category from a typed name and reuses it, case-insensitively", () => {
    const s = createLedgerService(memoryStore());
    const one = s.addTransaction(draft({ category: "Groceries" }));
    const two = s.addTransaction(draft({ category: "groceries" }));
    const none = s.addTransaction(draft({ category: "" }));
    expect(one.ok && two.ok && one.value.categoryId === two.value.categoryId).toBe(true);
    expect(none.ok && none.value.categoryId).toBe(null);
    expect(s.getLedger().categories).toEqual([{ id: one.ok ? one.value.categoryId : "", name: "Groceries" }]);
  });

  it("returns field errors instead of saving a bad draft", () => {
    const store = memoryStore();
    const s = createLedgerService(store);
    expect(s.addTransaction(draft({ payee: " " }))).toMatchObject({ ok: false, error: { code: "invalid", field: "payee" } });
    expect(store.current().transactions).toEqual([]);
  });

  it("answers not_found for an id that does not exist", () => {
    const s = createLedgerService(memoryStore());
    expect(s.updateTransaction("t99", draft())).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(s.deleteTransaction("t99")).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  it("leaves the ledger exactly as it was when the save fails", () => {
    const seed: LedgerData = { ...emptyLedger() };
    let failing = false;
    const inner = memoryStore(seed);
    const store: LedgerStore = {
      load: inner.load,
      describe: inner.describe,
      save: (d) => {
        if (failing) throw new Error("disk full");
        inner.save(d);
      },
    };
    const s = createLedgerService(store);
    const first = s.addTransaction(draft());
    failing = true;
    const second = s.addTransaction(draft({ payee: "Second" }));
    expect(second).toMatchObject({ ok: false, error: { code: "io" } });
    if (!second.ok) expect(second.error.message).toContain("disk full");
    const removed = s.deleteTransaction(first.ok ? first.value.id : "");
    expect(removed.ok).toBe(false);
    expect(s.listTransactions().map((t) => t.payee)).toEqual(["Corner Shop"]);
    expect(s.getLedger().categories).toEqual([]);
  });
});

describe("ledger service: settings", () => {
  it("sets a supported currency and refuses others", () => {
    const store = memoryStore();
    const s = createLedgerService(store);
    expect(s.getLedger().settings.currency).toBe("USD");
    expect(s.setCurrency("eur")).toEqual({ ok: true, value: { currency: "EUR" } });
    expect(store.current().settings.currency).toBe("EUR");
    expect(s.setCurrency("JPY")).toMatchObject({ ok: false, error: { code: "invalid", field: "currency" } });
    expect(s.getLedger().settings.currency).toBe("EUR");
  });

  it("changing the currency relabels and never converts", () => {
    const s = createLedgerService(memoryStore());
    s.addTransaction(draft({ amount: -1234 }));
    s.setCurrency("GBP");
    expect(s.listTransactions()[0].amount).toBe(-1234);
  });

  it("reports where it stores the ledger", () => {
    expect(createLedgerService(memoryStore()).getLedger().storage).toEqual({ kind: "memory", location: null, recovered: null });
  });
});

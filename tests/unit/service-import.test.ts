// L1: import through the ledger service: inspect, preview, commit, all or
// nothing, and a second import of the same file adding nothing.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ImportMapping } from "../../contracts/ledger";
import { decodeCsvBytes } from "../../core/csv";
import { createLedgerService, memoryStore, PREVIEW_ROWS, type LedgerStore } from "../../core/service";

const usText = decodeCsvBytes(readFileSync("tests/fixtures/csv/us-comma.csv"));
const us: ImportMapping = { delimiter: ",", hasHeader: true, date: 0, payee: 1, amount: { kind: "signed", column: 2 }, dateOrder: "MDY", decimal: "." };

describe("import through the service", () => {
  it("inspects a file and refuses one with no rows", () => {
    const s = createLedgerService(memoryStore());
    const i = s.inspectImport(usText);
    expect(i.ok && i.value.suggested).toEqual(us);
    expect(s.inspectImport("Date,Payee,Amount\n")).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(s.inspectImport("")).toMatchObject({ ok: false });
  });

  it("previews the first rows as they will be imported, with counts and rejects", () => {
    const s = createLedgerService(memoryStore());
    const p = s.previewImport(usText, us);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.value.accepted).toBe(6);
    expect(p.value.duplicates).toBe(0);
    expect(p.value.rejected.map((r) => r.line)).toEqual([7, 8, 9]);
    expect(p.value.rows[0]).toEqual({ line: 2, date: "2026-03-01", payee: "Landlord, Inc.", amount: -95000, status: "new", categoryId: null });
    expect(p.value.rows.length).toBeLessThanOrEqual(PREVIEW_ROWS);
    // Previewing saves nothing.
    expect(s.listTransactions()).toEqual([]);
  });

  it("imports every accepted row, and the same file again adds nothing", () => {
    const store = memoryStore();
    const s = createLedgerService(store);
    const first = s.commitImport(usText, us);
    expect(first).toEqual({ ok: true, value: { imported: 6, duplicates: 0, rejected: expect.any(Array) } });
    expect(store.current().transactions).toHaveLength(6);
    const second = s.commitImport(usText, us);
    expect(second.ok && second.value).toMatchObject({ imported: 0, duplicates: 6 });
    expect(store.current().transactions).toHaveLength(6);
    const preview = s.previewImport(usText, us);
    expect(preview.ok && preview.value.rows.every((r) => r.status === "duplicate")).toBe(true);
  });

  it("imports all or nothing: a failed save adds no row at all", () => {
    let saves = 0;
    const inner = memoryStore();
    const store: LedgerStore = { load: inner.load, describe: inner.describe, save: () => { saves += 1; throw new Error("disk full"); } };
    const s = createLedgerService(store);
    expect(s.commitImport(usText, us)).toMatchObject({ ok: false, error: { code: "io" } });
    expect(saves).toBe(1);
    expect(s.listTransactions()).toEqual([]);
    expect(s.getLedger().transactionCount).toBe(0);
  });

  it("refuses a mapping that does not name real, distinct columns", () => {
    const s = createLedgerService(memoryStore());
    expect(s.previewImport(usText, { ...us, payee: 7 })).toMatchObject({ ok: false, error: { code: "invalid", message: "Choose a column for the payee." } });
    expect(s.previewImport(usText, { ...us, payee: 0 })).toMatchObject({ ok: false, error: { message: "Each of date, payee and amount needs its own column." } });
    expect(s.commitImport(usText, { ...us, delimiter: "x" as never })).toMatchObject({ ok: false });
    expect(s.listTransactions()).toEqual([]);
  });

  it("imports rows as uncategorised with no note, keeping their own dates and amounts", () => {
    const s = createLedgerService(memoryStore());
    s.commitImport(usText, us);
    const landlord = s.listTransactions().find((t) => t.payee === "Landlord, Inc.");
    expect(landlord).toMatchObject({ date: "2026-03-01", amount: -95000, categoryId: null, note: "" });
  });
});

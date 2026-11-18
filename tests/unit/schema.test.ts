// L1: the ledger file's shape and the checks run on open.
import { describe, expect, it } from "vitest";
import { CURRENT_VERSION, emptyLedger, parseLedger, parseLedgerText, serializeLedger } from "../../core/schema";

const valid = () => ({
  format: "tally-ledger",
  version: 1,
  settings: { currency: "EUR" },
  transactions: [{ id: "t2", date: "2026-03-01", payee: "Rent", amount: -90000, categoryId: "c1", note: "" }],
  categories: [{ id: "c1", name: "Housing" }],
  nextId: 3,
});

describe("ledger schema", () => {
  it("round-trips an empty ledger through its own serializer", () => {
    const parsed = parseLedgerText(serializeLedger(emptyLedger()));
    expect(parsed).toEqual({ ok: true, data: emptyLedger(), migratedFrom: null });
  });

  it("reads a version 1 file", () => {
    const r = parseLedger(valid());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.settings.currency).toBe("EUR");
      expect(r.data.transactions[0]).toEqual(valid().transactions[0]);
      expect(r.data.version).toBe(CURRENT_VERSION);
    }
  });

  it("refuses a file from a newer version and says so", () => {
    const r = parseLedger({ ...valid(), version: CURRENT_VERSION + 1 });
    expect(r).toMatchObject({ ok: false, newer: true });
    if (!r.ok) expect(r.reason).toContain("newer version of Tally");
  });

  it.each([
    ["not JSON", "{ \"format\": "],
    ["another format", JSON.stringify({ ...valid(), format: "other" })],
    ["no version", JSON.stringify({ ...valid(), version: undefined })],
    ["no transactions", JSON.stringify({ ...valid(), transactions: undefined })],
    ["transactions not a list", JSON.stringify({ ...valid(), transactions: "lots" })],
    ["a float amount", JSON.stringify({ ...valid(), transactions: [{ ...valid().transactions[0], amount: 12.5 }] })],
    ["a bad date", JSON.stringify({ ...valid(), transactions: [{ ...valid().transactions[0], date: "2026-02-30" }] })],
    ["a repeated id", JSON.stringify({ ...valid(), transactions: [valid().transactions[0], valid().transactions[0]] })],
  ])("refuses %s", (_label, text) => {
    expect(parseLedgerText(text)).toMatchObject({ ok: false, newer: false });
  });

  it("repairs a dangling category reference instead of refusing the file", () => {
    const r = parseLedger({ ...valid(), categories: [] });
    expect(r.ok && r.data.transactions[0].categoryId).toBe(null);
  });

  it("never hands out an id already in use, whatever nextId says", () => {
    const r = parseLedger({ ...valid(), nextId: 1 });
    expect(r.ok && r.data.nextId).toBe(3);
  });
});

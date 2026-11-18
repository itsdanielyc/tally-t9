// L1: the import mapping. Detection of header, columns, date order and
// decimal separator; every row read into a transaction or a reason with its
// line number; duplicates counted as a multiset.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ImportMapping, Transaction } from "../../contracts/ledger";
import { decodeCsvBytes } from "../../core/csv";
import { inspect, parseDateWithOrder, readAll } from "../../core/importer";

const csv = (name: string) => decodeCsvBytes(readFileSync(`tests/fixtures/csv/${name}`));

describe("parseDateWithOrder", () => {
  it.each([
    ["2026-03-14", "YMD", "2026-03-14"],
    ["2026/3/4", "YMD", "2026-03-04"],
    ["20260314", "YMD", "2026-03-14"],
    ["14.03.2026", "DMY", "2026-03-14"],
    ["14/03/26", "DMY", "2026-03-14"],
    ["03/14/2026", "MDY", "2026-03-14"],
    ["3/14/99", "MDY", "1999-03-14"],
    ["14 Mar 2026", "DMY", "2026-03-14"],
    ["Mar 14 2026", "MDY", "2026-03-14"],
    ["2026-03-14 08:15:00", "YMD", "2026-03-14"],
    ["2026-03-14T08:15:00Z", "YMD", "2026-03-14"],
    ["29.02.2024", "DMY", "2024-02-29"],
  ] as const)("%s as %s is %s", (input, order, date) => {
    expect(parseDateWithOrder(input, order)).toEqual({ ok: true, date });
  });

  it.each([
    ["29.02.2026", "DMY"],
    ["14/03/2026", "MDY"],
    ["2026-14-03", "YMD"],
    ["31.04.2026", "DMY"],
    ["yesterday", "YMD"],
    ["2026-03", "YMD"],
    ["14 Foo 2026", "DMY"],
  ] as const)("rejects %s as %s", (input, order) => {
    expect(parseDateWithOrder(input, order).ok).toBe(false);
  });
});

describe("inspect", () => {
  it("reads a US export: comma, header, month-day-year, decimal point", () => {
    const i = inspect(csv("us-comma.csv"));
    expect(i).toMatchObject({
      delimiter: ",",
      hasHeader: true,
      columns: ["Date", "Description", "Amount"],
      rowCount: 9,
      suggested: { date: 0, payee: 1, amount: { kind: "signed", column: 2 }, dateOrder: "MDY", decimal: "." },
    });
  });

  it("reads a German export: BOM, semicolon, day-month-year, decimal comma", () => {
    const i = inspect(csv("de-semicolon.csv"));
    expect(i).toMatchObject({
      delimiter: ";",
      hasHeader: true,
      columns: ["Buchungstag", "Empfänger", "Verwendungszweck", "Betrag"],
      suggested: { date: 0, payee: 1, amount: { kind: "signed", column: 3 }, dateOrder: "DMY", decimal: "," },
    });
  });

  it("finds separate debit and credit columns", () => {
    expect(inspect(csv("debit-credit.csv")).suggested).toMatchObject({
      delimiter: ",",
      date: 0,
      payee: 1,
      amount: { kind: "debitCredit", debit: 2, credit: 3 },
      dateOrder: "YMD",
    });
  });

  it("names columns when there is no header and still guesses them from the data", () => {
    const i = inspect("2026-03-01,Shop,-1.50\n2026-03-02,Other shop,-2.00\n");
    expect(i).toMatchObject({
      hasHeader: false,
      columns: ["Column 1", "Column 2", "Column 3"],
      rowCount: 2,
      suggested: { date: 0, payee: 1, amount: { kind: "signed", column: 2 }, dateOrder: "YMD" },
    });
  });

  it("detects the decimal separator from the amounts, not from the delimiter", () => {
    expect(inspect('Date,Payee,Amount\n01.03.2026,Shop,"-12,50"\n02.03.2026,Bakery,"3,10"\n').suggested).toMatchObject({ decimal: ",", dateOrder: "DMY" });
    expect(inspect("Date;Payee;Amount\n2026-03-01;Shop;-12.50\n2026-03-02;Bakery;3.10\n").suggested).toMatchObject({ decimal: ".", dateOrder: "YMD" });
  });

  it("lets the person override the delimiter and the header", () => {
    const i = inspect("a;b,c\n1;2,3\n", { delimiter: ";", hasHeader: false });
    expect(i).toMatchObject({ delimiter: ";", hasHeader: false, columns: ["Column 1", "Column 2"], rowCount: 2 });
  });
});

describe("readAll", () => {
  const us: ImportMapping = { delimiter: ",", hasHeader: true, date: 0, payee: 1, amount: { kind: "signed", column: 2 }, dateOrder: "MDY", decimal: "." };

  it("reads rows into transactions and lists every unreadable row with its line and reason", () => {
    const r = readAll(csv("us-comma.csv"), us, []);
    expect(r.rows.map(({ line, date, payee, amount }) => [line, date, payee, amount])).toEqual([
      [2, "2026-03-01", "Landlord, Inc.", -95000],
      [3, "2026-03-02", "Employer Ltd", 312050],
      [4, "2026-03-09", "Corner Shop", -1250],
      [5, "2026-03-09", "Corner Shop", -1250],
      [6, "2026-03-12", 'Farmers "Fresh" Market', -4320],
      [10, "2026-03-15", "Multi line payee", -725],
    ]);
    expect(r.rejected).toEqual([
      { line: 7, reason: 'date "13/45/2026" is not a valid month-day-year date' },
      { line: 8, reason: "payee is empty" },
      { line: 9, reason: 'amount "twelve" is not a number with "." as the decimal separator' },
    ]);
    expect(r.rows.every((x) => !x.duplicate)).toBe(true);
  });

  it("reads decimal commas and grouping dots", () => {
    const de: ImportMapping = { delimiter: ";", hasHeader: true, date: 0, payee: 1, amount: { kind: "signed", column: 3 }, dateOrder: "DMY", decimal: "," };
    expect(readAll(csv("de-semicolon.csv"), de, []).rows.map((x) => [x.date, x.payee, x.amount])).toEqual([
      ["2026-03-01", "Vermieter GmbH", -95000],
      ["2026-03-02", "Arbeitgeber AG", 312050],
      ["2026-03-09", "Bäckerei Müller", -435],
      ["2026-03-12", "Wochenmarkt", -4320],
    ]);
  });

  it("turns debit into spending and credit into income, and refuses rows with both or neither", () => {
    const dc: ImportMapping = { delimiter: ",", hasHeader: true, date: 0, payee: 1, amount: { kind: "debitCredit", debit: 2, credit: 3 }, dateOrder: "YMD", decimal: "." };
    const r = readAll(csv("debit-credit.csv"), dc, []);
    expect(r.rows.map((x) => [x.payee, x.amount])).toEqual([
      ["Landlord", -95000],
      ["Employer Ltd", 312050],
      ["Corner Shop", -1250],
      ["Refund Shop", 499],
    ]);
    expect(r.rejected).toEqual([
      { line: 6, reason: "both debit and credit are filled in" },
      { line: 7, reason: "debit and credit are both empty" },
    ]);
  });

  it("explains a row with too few columns", () => {
    const r = readAll("Date,Payee,Amount\n2026-03-01,Shop\n", { ...us, dateOrder: "YMD" }, []);
    expect(r.rejected).toEqual([{ line: 2, reason: "has 2 columns, expected at least 3" }]);
  });

  it("counts duplicates as a multiset against what the ledger already has", () => {
    const existing: Transaction[] = [
      { id: "t1", date: "2026-03-09", payee: "corner  shop", amount: -1250, categoryId: null, note: "" },
      { id: "t2", date: "2026-03-01", payee: "Landlord, Inc.", amount: -95000, categoryId: null, note: "x" },
    ];
    const r = readAll(csv("us-comma.csv"), us, existing);
    // One of the two identical Corner Shop rows matches the one already there.
    expect(r.rows.map((x) => [x.line, x.duplicate])).toEqual([
      [2, true],
      [3, false],
      [4, true],
      [5, false],
      [6, false],
      [10, false],
    ]);
  });

  it("finds nothing new when the same rows are read against themselves", () => {
    const first = readAll(csv("us-comma.csv"), us, []).rows;
    const asLedger: Transaction[] = first.map((r, i) => ({ id: `t${i}`, date: r.date, payee: r.payee, amount: r.amount, categoryId: null, note: "" }));
    expect(readAll(csv("us-comma.csv"), us, asLedger).rows.every((r) => r.duplicate)).toBe(true);
  });
});

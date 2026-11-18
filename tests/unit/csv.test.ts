// L1: reading CSV the way banks write it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeCsvBytes, detectDelimiter, parseCsv } from "../../core/csv";

const fixture = (name: string) => readFileSync(`tests/fixtures/csv/${name}`);

describe("parseCsv", () => {
  it("splits fields and keeps the line each record starts on", () => {
    expect(parseCsv("a,b,c\n1,2,3\n", ",")).toEqual([
      { line: 1, fields: ["a", "b", "c"] },
      { line: 2, fields: ["1", "2", "3"] },
    ]);
  });

  it("reads quoted fields with delimiters, doubled quotes and line breaks inside", () => {
    const text = 'x,"a, b","say ""hi""","two\r\nlines"\r\nnext,1,2,3';
    expect(parseCsv(text, ",")).toEqual([
      { line: 1, fields: ["x", "a, b", 'say "hi"', "two\r\nlines"] },
      { line: 3, fields: ["next", "1", "2", "3"] },
    ]);
  });

  it("accepts CRLF, LF and lone CR line ends and skips blank lines without losing count", () => {
    expect(parseCsv("a;1\r\n\r\nb;2\rc;3\n\n;;\nd;4", ";").map((r) => [r.line, r.fields[0]])).toEqual([
      [1, "a"],
      [3, "b"],
      [4, "c"],
      [7, "d"],
    ]);
  });

  it("strips a byte-order mark", () => {
    expect(parseCsv("\ufeffDate,Amount\n", ",")[0].fields).toEqual(["Date", "Amount"]);
  });

  it("flags a quoted field that is never closed instead of swallowing the file silently", () => {
    const records = parseCsv('a,b\n1,"open\n2,3\n', ",");
    expect(records[1]).toMatchObject({ line: 2, unterminated: true });
  });

  it("keeps an empty last field", () => {
    expect(parseCsv("a,b,\n", ",")[0].fields).toEqual(["a", "b", ""]);
  });
});

describe("detectDelimiter", () => {
  it.each([
    ["Date,Description,Amount\n2026-03-01,Shop,-1.00\n", ","],
    ["Datum;Empfänger;Betrag\n01.03.2026;Laden;-1,00\n02.03.2026;Laden;-2,50\n", ";"],
    ["Date\tPayee\tAmount\n2026-03-01\tShop, Inc\t-1.00\n", "\t"],
    ["Date|Payee|Amount\n2026-03-01|Shop|-1.00\n", "|"],
    ['Date,Payee,Amount\n2026-03-01,"Shop; Inc",-1.00\n', ","],
  ])("finds the delimiter of %j", (text, d) => {
    expect(detectDelimiter(text)).toBe(d);
  });
});

describe("decodeCsvBytes", () => {
  it("reads UTF-8 with a BOM", () => {
    expect(decodeCsvBytes(fixture("de-semicolon.csv")).startsWith("Buchungstag;Empfänger")).toBe(true);
  });

  it("falls back to Windows-1252 when the bytes are not UTF-8", () => {
    expect(decodeCsvBytes(fixture("tab-latin1.csv"))).toContain("Café Latin");
    expect(decodeCsvBytes(new Uint8Array([0x80, 0x20, 0x35]))).toBe("€ 5");
  });
});

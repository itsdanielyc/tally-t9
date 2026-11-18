// L1: money as integer minor units. Parsing works on digit strings, so no
// input can pick up a floating-point error on the way in or out.
import { describe, expect, it } from "vitest";
import { MAX_MINOR, formatAmount, formatMagnitude, formatPlain, parseDecimal, parseFormAmount, sumMinor } from "../../core/money";
import { int, seeded } from "../support/random";

describe("parseDecimal", () => {
  it.each([
    ["12.34", ".", 1234],
    ["0.1", ".", 10],
    ["0.07", ".", 7],
    [".5", ".", 50],
    ["1,234.56", ".", 123456],
    ["1,234,567.89", ".", 123456789],
    ["-12.50", ".", -1250],
    ["+12.50", ".", 1250],
    ["\u221212.50", ".", -1250],
    ["12.50-", ".", -1250],
    ["(12.50)", ".", -1250],
    ["$12.50", ".", 1250],
    ["-$12.50", ".", -1250],
    ["$-12.50", ".", -1250],
    ["USD 12.50", ".", 1250],
    ["12.50 EUR", ".", 1250],
    ["1'234.56", ".", 123456],
    ["12,34", ",", 1234],
    ["1.234,56", ",", 123456],
    ["1 234,56", ",", 123456],
    ["1\u00a0234,56", ",", 123456],
    ["-0,99", ",", -99],
    ["€ 5", ",", 500],
    ["1234", ".", 123400],
    ["007.10", ".", 710],
  ] as const)("reads %s with %s as the decimal separator", (input, decimal, minor) => {
    expect(parseDecimal(input, decimal)).toEqual({ ok: true, minor });
  });

  it.each([
    ["", "amount is empty"],
    ["   ", "amount is empty"],
    ["twelve", "is not a number"],
    ["abc", "is not a number"],
    ["USD", "is not a number"],
    ["12.345", "more than 2 decimal places"],
    ["1.2.3", "more than one decimal separator"],
    ["12.", "ends with a decimal separator"],
    ["1,23.45", "is not a number"],
    ["1e5", "is not a number"],
    ["12..5", "more than one decimal separator"],
    ["9999999999999999", "too large"],
    ["1,000,000,000.00", "too large"],
  ])("rejects %j with a reason", (input, reason) => {
    const r = parseDecimal(input, ".");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(reason);
  });

  it("never rounds: 0.1 + 0.2 typed as text is exactly 30 minor units", () => {
    const a = parseDecimal("0.1");
    const b = parseDecimal("0.2");
    expect(a.ok && b.ok && a.minor + b.minor).toBe(30);
  });

  it("round-trips every formatted amount, randomized (seed 20261118)", () => {
    const rand = seeded(20261118);
    for (let i = 0; i < 5000; i++) {
      const minor = int(rand, -MAX_MINOR, MAX_MINOR);
      expect(parseDecimal(formatAmount(minor))).toEqual({ ok: true, minor: minor === 0 ? 0 : minor });
      expect(parseDecimal(formatPlain(minor))).toEqual({ ok: true, minor: minor === 0 ? 0 : minor });
      expect(parseDecimal(formatAmount(minor).replace(/,/g, " ").replace(".", ","), ",")).toEqual({ ok: true, minor: minor === 0 ? 0 : minor });
    }
  });
});

describe("parseFormAmount", () => {
  it("accepts a dot or a comma as the decimal separator", () => {
    expect(parseFormAmount("12.50")).toEqual({ ok: true, minor: 1250 });
    expect(parseFormAmount("12,50")).toEqual({ ok: true, minor: 1250 });
    expect(parseFormAmount("1,234")).toEqual({ ok: true, minor: 123400 });
    expect(parseFormAmount("1,234.5")).toEqual({ ok: true, minor: 123450 });
  });

  it("never reads a dot as grouping: 12.345 is an error, not twelve thousand", () => {
    const r = parseFormAmount("12.345");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("more than 2 decimal places");
  });

  it("explains a bad amount", () => {
    const r = parseFormAmount("twelve");
    expect(r.ok).toBe(false);
  });
});

describe("formatting", () => {
  it.each([
    [0, "0.00", "0.00"],
    [5, "0.05", "0.05"],
    [-5, "-0.05", "-0.05"],
    [123456, "1,234.56", "1234.56"],
    [-123456789, "-1,234,567.89", "-1234567.89"],
    [100, "1.00", "1.00"],
  ])("%i minor units is %s (plain %s)", (minor, grouped, plain) => {
    expect(formatAmount(minor)).toBe(grouped);
    expect(formatPlain(minor)).toBe(plain);
  });

  it("shows the magnitude for the form", () => {
    expect(formatMagnitude(-1250)).toBe("12.50");
  });

  it("refuses a non-integer amount instead of formatting it", () => {
    expect(() => formatAmount(12.5)).toThrow(/not an integer/);
  });

  it("sums exactly", () => {
    expect(sumMinor([10, 20, -5])).toBe(25);
    expect(() => sumMinor([0.1])).toThrow();
  });
});

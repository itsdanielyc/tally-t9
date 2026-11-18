// Money as integer minor units. Parsing and formatting work on digit
// strings; no value ever passes through a floating-point number.

/** Largest accepted magnitude in minor units: 999,999,999.99 at two digits. */
export const MAX_MINOR = 99_999_999_999;

export type ParsedAmount = { ok: true; minor: number } | { ok: false; reason: string };

/**
 * Parses a decimal amount written with `decimal` as the decimal separator.
 * Accepts a sign (+, -, U+2212), a trailing minus, parentheses for negative,
 * currency symbols and codes around the number, and grouping with the other
 * separator, spaces or apostrophes ("1,234.56", "1.234,56", "1 234,56",
 * "1'234.56"). More fraction digits than `digits` is an error, never a
 * rounding.
 */
export function parseDecimal(input: string, decimal: "." | "," = ".", digits = 2): ParsedAmount {
  let s = String(input ?? "").trim();
  if (s === "") return { ok: false, reason: "amount is empty" };
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  // A three-letter currency code before or after the number ("USD 12.50").
  s = s
    .replace(/^[A-Za-z]{3}[\s\u00a0]*(?=[\d+\-\u2212$€£¥₹.,])/, "")
    .replace(/(?<=[\d.,])[\s\u00a0]*[A-Za-z]{3}$/, "");
  let signed = false;
  const takeSign = (m: RegExpExecArray | null, fromEnd: boolean): void => {
    if (!m || signed) return;
    signed = true;
    if (m[1] !== "+") negative = !negative;
    s = fromEnd ? s.slice(0, -m[0].length) : s.slice(m[0].length);
  };
  const SYMBOL = /^[$€£¥₹][\s\u00a0]*/;
  takeSign(/^([+\-\u2212])[\s\u00a0]*/.exec(s), false); // "-$12.50"
  s = s.replace(SYMBOL, "");
  takeSign(/^([+\-\u2212])[\s\u00a0]*/.exec(s), false); // "$-12.50"
  s = s.replace(/[\s\u00a0]*[$€£¥₹]$/, "");
  takeSign(/[\s\u00a0]*([+\-\u2212])$/.exec(s), true); // "12.50-"
  s = s.replace(/[\s\u00a0\u202f']/g, "");
  if (s === "") return { ok: false, reason: "amount has no digits" };
  const group = decimal === "." ? "," : ".";
  const parts = s.split(decimal);
  if (parts.length > 2) return { ok: false, reason: `"${input}" has more than one decimal separator` };
  let [intPart, frac = ""] = parts;
  if (parts.length === 2 && frac === "") return { ok: false, reason: `"${input}" ends with a decimal separator` };
  if (intPart.includes(group)) {
    if (!new RegExp(`^\\d{1,3}(\\${group}\\d{3})+$`).test(intPart)) {
      return { ok: false, reason: `"${input}" is not a number` };
    }
    intPart = intPart.split(group).join("");
  }
  if (intPart === "") intPart = "0";
  if (!/^\d+$/.test(intPart) || !/^\d*$/.test(frac)) return { ok: false, reason: `"${input}" is not a number` };
  if (frac.length > digits) return { ok: false, reason: `"${input}" has more than ${digits} decimal places` };
  intPart = intPart.replace(/^0+(?=\d)/, "");
  if (intPart.length > 15) return { ok: false, reason: `"${input}" is too large` };
  const minorText = intPart + frac.padEnd(digits, "0");
  const magnitude = Number(minorText);
  if (!Number.isSafeInteger(magnitude) || magnitude > MAX_MINOR) return { ok: false, reason: `"${input}" is too large` };
  return { ok: true, minor: negative && magnitude !== 0 ? -magnitude : magnitude };
}

/**
 * The transaction form's amount: a positive number typed with "." or ","
 * as the decimal separator ("12.50", "12,50", "1,234.56").
 */
export function parseFormAmount(input: string, digits = 2): ParsedAmount {
  const dot = parseDecimal(input, ".", digits);
  if (dot.ok) return dot;
  const comma = parseDecimal(input, ",", digits);
  return comma.ok ? comma : dot;
}

/** "-1,234.56": sign, grouped major units, all minor digits. */
export function formatAmount(minor: number, digits = 2): string {
  assertMinor(minor);
  const { sign, major, fraction } = split(minor, digits);
  const grouped = major.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped}${digits ? "." + fraction : ""}`;
}

/** "-1234.56": no grouping, "." decimal; the export format. */
export function formatPlain(minor: number, digits = 2): string {
  assertMinor(minor);
  const { sign, major, fraction } = split(minor, digits);
  return `${sign}${major}${digits ? "." + fraction : ""}`;
}

/** The form shows a magnitude: "12.50" for both -1250 and 1250. */
export function formatMagnitude(minor: number, digits = 2): string {
  return formatPlain(Math.abs(minor), digits);
}

export function isValidMinor(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && Math.abs(value) <= MAX_MINOR;
}

/** Exact integer sum; throws if a value is not an integer. */
export function sumMinor(values: readonly number[]): number {
  let total = 0;
  for (const v of values) {
    assertMinor(v);
    total += v;
  }
  if (!Number.isSafeInteger(total)) throw new RangeError("sum outside the safe integer range");
  return total;
}

function assertMinor(minor: number): void {
  if (!Number.isSafeInteger(minor)) throw new TypeError(`not an integer amount: ${minor}`);
}

function split(minor: number, digits: number): { sign: string; major: string; fraction: string } {
  const text = String(Math.abs(minor)).padStart(digits + 1, "0");
  return {
    sign: minor < 0 ? "-" : "",
    major: digits ? text.slice(0, -digits) : text,
    fraction: digits ? text.slice(-digits) : "",
  };
}

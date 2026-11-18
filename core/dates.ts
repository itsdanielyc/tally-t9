// Calendar dates as YYYY-MM-DD strings and months as YYYY-MM. No Date
// arithmetic in UTC: "today" is the person's local calendar date.

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH = /^(\d{4})-(\d{2})$/;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export function isValidDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = ISO.exec(value);
  if (!m) return false;
  return isValidParts(Number(m[1]), Number(m[2]), Number(m[3]));
}

export function isValidParts(year: number, month: number, day: number): boolean {
  return (
    Number.isInteger(year) && year >= 1900 && year <= 2999 &&
    Number.isInteger(month) && month >= 1 && month <= 12 &&
    Number.isInteger(day) && day >= 1 && day <= daysInMonth(year, month)
  );
}

export function isValidMonth(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = MONTH.exec(value);
  return !!m && isValidParts(Number(m[1]), Number(m[2]), 1);
}

export function toIsoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The local calendar date of `now`, never the UTC one. */
export function localToday(now: Date = new Date()): string {
  return toIsoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

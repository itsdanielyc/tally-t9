// Finding transactions and taking them out as CSV. The export is written so
// that Tally's own import reads it back as the same transactions: ISO dates,
// signed amounts with a decimal point and no grouping, RFC 4180 quoting, and
// the rows oldest first so a re-import lists them in the same order.
import type { Category, CsvExport, Transaction, TransactionFilter } from "../contracts/ledger.ts";
import { isValidDate } from "./dates.ts";
import { formatPlain, isValidMinor } from "./money.ts";
import { cleanText } from "./transactions.ts";

export const EXPORT_HEADER = ["Date", "Payee", "Amount", "Category", "Note"] as const;

/** Keeps the transactions the filter matches; filter parts that are missing or invalid are ignored. */
export function applyFilter(transactions: readonly Transaction[], filter: TransactionFilter | undefined): Transaction[] {
  if (!filter || typeof filter !== "object") return [...transactions];
  const text = typeof filter.text === "string" ? cleanText(filter.text).toLocaleLowerCase() : "";
  const category = typeof filter.category === "string" && filter.category !== "" ? filter.category : "any";
  const from = isValidDate(filter.from) ? filter.from : null;
  const to = isValidDate(filter.to) ? filter.to : null;
  const min = isValidMinor(filter.minAmount) ? Math.abs(filter.minAmount) : null;
  const max = isValidMinor(filter.maxAmount) ? Math.abs(filter.maxAmount) : null;
  return transactions.filter((t) => {
    if (text && !t.payee.toLocaleLowerCase().includes(text) && !t.note.toLocaleLowerCase().includes(text)) return false;
    if (category === "none" ? t.categoryId !== null : category !== "any" && t.categoryId !== category) return false;
    if (from && t.date < from) return false;
    if (to && t.date > to) return false;
    const size = Math.abs(t.amount);
    if (min !== null && size < min) return false;
    if (max !== null && size > max) return false;
    return true;
  });
}

/** One CSV field, quoted when it holds a delimiter, a quote, a line break or edge spaces. */
export function csvField(value: string): string {
  return /[",\r\n]|^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * The CSV for `newestFirstList` (the order the list shows), written oldest
 * first. Line ends are CRLF, as RFC 4180 and spreadsheets expect.
 */
export function toCsv(newestFirstList: readonly Transaction[], categories: readonly Category[]): string {
  const names = new Map(categories.map((c) => [c.id, c.name]));
  const lines = [EXPORT_HEADER.join(",")];
  for (const t of [...newestFirstList].reverse()) {
    lines.push(
      [t.date, t.payee, formatPlain(t.amount), t.categoryId ? (names.get(t.categoryId) ?? "") : "", t.note].map(csvField).join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

export function exportOf(newestFirstList: readonly Transaction[], categories: readonly Category[], today: string): CsvExport {
  return { text: toCsv(newestFirstList, categories), count: newestFirstList.length, suggestedName: `tally-export-${today}.csv` };
}

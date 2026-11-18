// Bank CSV import: detection, the column mapping, reading each row into a
// transaction or a reason it cannot be read, and duplicate counting.
// Pure functions; the service decides when to save.
import type {
  AmountMapping,
  DateOrder,
  Delimiter,
  ImportInspection,
  ImportMapping,
  ImportRejection,
  Rule,
  Transaction,
} from "../contracts/ledger.ts";
import { categoryFor } from "./categories.ts";
import { parseCsv, detectDelimiter, type CsvRecord } from "./csv.ts";
import { isValidParts, toIsoDate } from "./dates.ts";
import { parseDecimal } from "./money.ts";
import { CATEGORY_NAME_MAX, cleanText, NOTE_MAX, PAYEE_MAX } from "./transactions.ts";

/** Twenty megabytes of text is far beyond any bank export Tally expects. */
export const MAX_IMPORT_CHARS = 20_000_000;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export type ReadRow = { line: number; date: string; payee: string; amount: number; category: string; note: string };

// ---- dates ----

/**
 * Reads a date written in the given order with "-", "/", "." or spaces
 * between the parts ("2026-03-14", "14.03.2026", "03/14/26", "14 Mar 2026",
 * "20260314" for YMD). A time after the date is ignored. Two-digit years are
 * 2000 to 2069 and 1970 to 1999.
 */
export function parseDateWithOrder(input: string, order: DateOrder): { ok: true; date: string } | { ok: false } {
  let s = String(input ?? "").trim();
  s = s.replace(/[T\s]+\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[AaPp][Mm]|[+-]\d{2}:?\d{2})?$/, "").trim();
  let parts: string[];
  if (order === "YMD" && /^\d{8}$/.test(s)) parts = [s.slice(0, 4), s.slice(4, 6), s.slice(6, 8)];
  else parts = s.split(/[-/.\s]+/).filter((p) => p !== "");
  if (parts.length !== 3) return { ok: false };
  const [a, b, c] = parts;
  const [ys, ms, ds] = order === "YMD" ? [a, b, c] : order === "DMY" ? [c, b, a] : [c, a, b];
  if (!/^\d{2}(\d{2})?$/.test(ys) || !/^\d{1,2}$/.test(ds)) return { ok: false };
  let month: number;
  if (/^\d{1,2}$/.test(ms)) month = Number(ms);
  else {
    const index = MONTHS.indexOf(ms.slice(0, 3).toLowerCase());
    if (index < 0 || !/^[A-Za-z]{3,9}$/.test(ms)) return { ok: false };
    month = index + 1;
  }
  let year = Number(ys);
  if (ys.length === 2) year += year < 70 ? 2000 : 1900;
  const day = Number(ds);
  if (!isValidParts(year, month, day)) return { ok: false };
  return { ok: true, date: toIsoDate(year, month, day) };
}

// ---- detection ----

const HINTS = {
  date: /date|datum|fecha|data|booked|booking|posted|posting|valuta|transaction ?date|buchung/i,
  payee: /payee|description|desc|name|merchant|details|counterparty|beneficiary|narrative|recipient|empf|beschreibung|libell|text|reference|memo/i,
  amount: /amount|betrag|montant|importe|sum|value|total/i,
  debit: /debit|withdraw|paid ?out|money ?out|outflow|soll|spent|charge/i,
  credit: /credit|deposit|paid ?in|money ?in|inflow|haben|received/i,
  category: /^categor|kategor|catégor/i,
  note: /note|comment|notiz|remark|memo/i,
};

function looksLikeAmount(v: string): boolean {
  const t = v.trim();
  if (t === "" || !/\d/.test(t)) return false;
  return parseDecimal(t, ".").ok || parseDecimal(t, ",").ok;
}

function looksLikeDate(v: string): boolean {
  return (["YMD", "DMY", "MDY"] as const).some((o) => parseDateWithOrder(v, o).ok);
}

/** The first record is a header when it has text where later rows have dates or numbers. */
export function detectHeader(records: CsvRecord[]): boolean {
  if (records.length < 2) return records.length === 1 && records[0].fields.every((f) => !looksLikeAmount(f) && !looksLikeDate(f));
  const first = records[0].fields;
  const rest = records.slice(1, 11);
  if (first.some((f) => looksLikeDate(f) || looksLikeAmount(f))) return false;
  return first.some((_, col) => rest.some((r) => looksLikeDate(r.fields[col] ?? "") || looksLikeAmount(r.fields[col] ?? "")));
}

export function detectDateOrder(values: string[], decimal: "." | ","): DateOrder {
  const nonEmpty = values.map((v) => v.trim()).filter((v) => v !== "");
  const fits = (o: DateOrder) => nonEmpty.length > 0 && nonEmpty.every((v) => parseDateWithOrder(v, o).ok);
  if (fits("YMD") && nonEmpty.every((v) => /^\d{4}/.test(v))) return "YMD";
  const dmy = fits("DMY");
  const mdy = fits("MDY");
  if (dmy && !mdy) return "DMY";
  if (mdy && !dmy) return "MDY";
  if (fits("YMD")) return "YMD";
  // Every date fits both (all days are 12 or less): follow the number style.
  return decimal === "," ? "DMY" : "MDY";
}

export function detectDecimal(values: string[], delimiter: Delimiter): "." | "," {
  let comma = 0;
  let dot = 0;
  for (const v of values) {
    const t = v.trim();
    if (/,\d{1,2}\)?-?$/.test(t)) comma += 1;
    else if (/\.\d{1,2}\)?-?$/.test(t)) dot += 1;
  }
  if (comma > dot) return ",";
  if (dot > comma) return ".";
  return delimiter === ";" ? "," : ".";
}

function columnNames(records: CsvRecord[], hasHeader: boolean): string[] {
  const width = Math.max(0, ...records.slice(0, 30).map((r) => r.fields.length));
  return Array.from({ length: width }, (_, i) => {
    const name = hasHeader ? cleanText(records[0]?.fields[i] ?? "") : "";
    return name || `Column ${i + 1}`;
  });
}

export function inspect(text: string, options: { delimiter?: Delimiter; hasHeader?: boolean } = {}): ImportInspection {
  const delimiter = options.delimiter ?? detectDelimiter(text);
  const records = parseCsv(text, delimiter);
  const hasHeader = options.hasHeader ?? detectHeader(records.slice(0, 12));
  const columns = columnNames(records, hasHeader);
  const data = records.slice(hasHeader ? 1 : 0);
  const sample = data.slice(0, 50);
  const header = hasHeader ? columns.map((c) => c.toLowerCase()) : columns.map(() => "");
  const values = (col: number) => sample.map((r) => r.fields[col] ?? "");
  const share = (col: number, test: (v: string) => boolean) => {
    const vs = values(col).filter((v) => v.trim() !== "");
    return vs.length ? vs.filter(test).length / vs.length : 0;
  };
  const indexes = columns.map((_, i) => i);
  const byHint = (re: RegExp, exclude: number[] = []) => indexes.find((i) => !exclude.includes(i) && re.test(header[i]));
  const best = (score: (i: number) => number, exclude: number[]) =>
    indexes.filter((i) => !exclude.includes(i)).sort((a, b) => score(b) - score(a))[0] ?? 0;

  const dateCol = byHint(HINTS.date) ?? best((i) => share(i, looksLikeDate), []);
  const debitCol = byHint(HINTS.debit, [dateCol]);
  const creditCol = byHint(HINTS.credit, [dateCol, ...(debitCol === undefined ? [] : [debitCol])]);
  let amount: AmountMapping;
  if (debitCol !== undefined && creditCol !== undefined && byHint(HINTS.amount, [dateCol, debitCol, creditCol]) === undefined) {
    amount = { kind: "debitCredit", debit: debitCol, credit: creditCol };
  } else {
    const amountCol =
      byHint(HINTS.amount, [dateCol]) ?? best((i) => share(i, looksLikeAmount) - share(i, looksLikeDate), [dateCol]);
    amount = { kind: "signed", column: amountCol };
  }
  const used = amount.kind === "signed" ? [dateCol, amount.column] : [dateCol, amount.debit, amount.credit];
  const textScore = (i: number) => {
    const vs = values(i);
    const avg = vs.reduce((n, v) => n + v.trim().length, 0) / Math.max(1, vs.length);
    return avg * (1 - share(i, looksLikeAmount)) * (1 - share(i, looksLikeDate));
  };
  const payeeCol = byHint(HINTS.payee, used) ?? best(textScore, used);
  const categoryCol = byHint(HINTS.category, [...used, payeeCol]) ?? null;
  const noteCol = byHint(HINTS.note, [...used, payeeCol, ...(categoryCol === null ? [] : [categoryCol])]) ?? null;
  const amountValues =
    amount.kind === "signed" ? values(amount.column) : [...values(amount.debit), ...values(amount.credit)];
  const decimal = detectDecimal(amountValues, delimiter);
  const dateOrder = detectDateOrder(values(dateCol), decimal);
  return {
    delimiter,
    hasHeader,
    columns,
    rowCount: data.length,
    suggested: { delimiter, hasHeader, date: dateCol, payee: payeeCol, amount, dateOrder, decimal, category: categoryCol, note: noteCol },
  };
}

// ---- reading rows ----

/** Checks that a mapping names real, distinct columns. Returns a message or null. */
export function mappingProblem(mapping: ImportMapping, width: number): string | null {
  const cols: [string, number][] = [
    ["date", mapping.date],
    ["payee", mapping.payee],
    ...(mapping.amount.kind === "signed"
      ? ([["amount", mapping.amount.column]] as [string, number][])
      : ([["debit", mapping.amount.debit], ["credit", mapping.amount.credit]] as [string, number][])),
  ];
  for (const [name, col] of cols) {
    if (!Number.isInteger(col) || col < 0 || col >= Math.max(width, 1)) return `Choose a column for the ${name}.`;
  }
  const seen = new Set(cols.map(([, c]) => c));
  if (seen.size !== cols.length) return "Each of date, payee and amount needs its own column.";
  for (const [name, col] of [["category", mapping.category], ["note", mapping.note]] as const) {
    if (col === undefined || col === null) continue;
    if (!Number.isInteger(col) || col < 0 || col >= Math.max(width, 1)) return `Choose a column for the ${name}, or none.`;
    if (seen.has(col)) return `The ${name} needs its own column.`;
    seen.add(col);
  }
  if (!["YMD", "DMY", "MDY"].includes(mapping.dateOrder)) return "Choose the date order.";
  if (mapping.decimal !== "." && mapping.decimal !== ",") return "Choose the decimal separator.";
  return null;
}

export function readRow(record: CsvRecord, mapping: ImportMapping): { ok: true; row: ReadRow } | { ok: false; reason: string } {
  const fail = (reason: string) => ({ ok: false as const, reason });
  if (record.unterminated) return fail("a quoted field is never closed");
  const f = record.fields;
  const needed =
    Math.max(mapping.date, mapping.payee, ...(mapping.amount.kind === "signed" ? [mapping.amount.column] : [mapping.amount.debit, mapping.amount.credit])) + 1;
  if (f.length < needed) return fail(`has ${f.length} column${f.length === 1 ? "" : "s"}, expected at least ${needed}`);

  const rawDate = f[mapping.date].trim();
  if (rawDate === "") return fail("date is empty");
  const date = parseDateWithOrder(rawDate, mapping.dateOrder);
  if (!date.ok) return fail(`date "${rawDate}" is not a valid ${orderLabel(mapping.dateOrder)} date`);

  const payee = cleanText(f[mapping.payee]);
  if (payee === "") return fail("payee is empty");
  if (payee.length > PAYEE_MAX) return fail(`payee is longer than ${PAYEE_MAX} characters`);

  let amount: number;
  if (mapping.amount.kind === "signed") {
    const raw = f[mapping.amount.column].trim();
    if (raw === "") return fail("amount is empty");
    const parsed = parseDecimal(raw, mapping.decimal);
    if (!parsed.ok) return fail(`amount "${raw}" is not a number with "${mapping.decimal}" as the decimal separator`);
    amount = parsed.minor;
  } else {
    const rawDebit = f[mapping.amount.debit].trim();
    const rawCredit = f[mapping.amount.credit].trim();
    const debit = rawDebit === "" ? null : parseDecimal(rawDebit, mapping.decimal);
    const credit = rawCredit === "" ? null : parseDecimal(rawCredit, mapping.decimal);
    if (debit && !debit.ok) return fail(`debit "${rawDebit}" is not a number with "${mapping.decimal}" as the decimal separator`);
    if (credit && !credit.ok) return fail(`credit "${rawCredit}" is not a number with "${mapping.decimal}" as the decimal separator`);
    const d = debit?.ok ? Math.abs(debit.minor) : 0;
    const c = credit?.ok ? Math.abs(credit.minor) : 0;
    if (d !== 0 && c !== 0) return fail("both debit and credit are filled in");
    if (d === 0 && c === 0) return fail(debit || credit ? "amount is zero" : "debit and credit are both empty");
    amount = d !== 0 ? -d : c;
  }
  if (amount === 0) return fail("amount is zero");
  const category = optionalCell(f, mapping.category);
  if (category.length > CATEGORY_NAME_MAX) return fail(`category is longer than ${CATEGORY_NAME_MAX} characters`);
  const note = optionalCell(f, mapping.note, false);
  if (note.length > NOTE_MAX) return fail(`note is longer than ${NOTE_MAX} characters`);
  return { ok: true, row: { line: record.line, date: date.date, payee, amount, category, note } };
}

function optionalCell(fields: string[], col: number | null | undefined, collapse = true): string {
  if (col === undefined || col === null) return "";
  const raw = fields[col] ?? "";
  return collapse ? cleanText(raw) : raw.trim();
}

function orderLabel(order: DateOrder): string {
  return order === "YMD" ? "year-month-day" : order === "DMY" ? "day-month-year" : "month-day-year";
}

/** `ruleCategoryId` is the rule's category when the row has no category of its own. */
export type ReadResult = { rows: (ReadRow & { duplicate: boolean; ruleCategoryId: string | null })[]; rejected: ImportRejection[] };

/**
 * Reads every data row and marks duplicates: a row identical in date,
 * amount and payee to a transaction already in the ledger is a duplicate,
 * counted as a multiset, so two identical rows in one file both import the
 * first time and both are duplicates the second time. Rules give each row
 * its category.
 */
export function readAll(text: string, mapping: ImportMapping, existing: readonly Transaction[], rules: readonly Rule[] = []): ReadResult {
  const records = parseCsv(text, mapping.delimiter);
  const data = records.slice(mapping.hasHeader ? 1 : 0);
  const available = new Map<string, number>();
  for (const t of existing) {
    const k = duplicateKey(t.date, t.amount, t.payee);
    available.set(k, (available.get(k) ?? 0) + 1);
  }
  const rows: ReadResult["rows"] = [];
  const rejected: ImportRejection[] = [];
  for (const record of data) {
    const r = readRow(record, mapping);
    if (!r.ok) {
      rejected.push({ line: record.line, reason: r.reason });
      continue;
    }
    const k = duplicateKey(r.row.date, r.row.amount, r.row.payee);
    const left = available.get(k) ?? 0;
    if (left > 0) available.set(k, left - 1);
    rows.push({ ...r.row, duplicate: left > 0, ruleCategoryId: r.row.category ? null : categoryFor(r.row.payee, rules) });
  }
  return { rows, rejected };
}

export function duplicateKey(date: string, amount: number, payee: string): string {
  return `${date}|${amount}|${cleanText(payee).toLocaleLowerCase()}`;
}

export function widthOf(text: string, delimiter: Delimiter): number {
  return Math.max(0, ...parseCsv(text, delimiter, 30).map((r) => r.fields.length));
}

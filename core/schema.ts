// The ledger file's shape, its version, and the checks and migrations run
// on open. Every version Tally has written keeps opening: a committed
// fixture per version under tests/fixtures/ is opened by the L3 suite.
// Collections added after a version was first written default to empty.
import type { Category, Currency, Rule, Settings, Transaction } from "../contracts/ledger.ts";
import { CURRENCIES } from "../contracts/ledger.ts";
import { isValidDate } from "./dates.ts";
import { isValidMinor } from "./money.ts";

export const FORMAT = "tally-ledger";
export const CURRENT_VERSION = 1;

export type LedgerData = {
  format: typeof FORMAT;
  version: number;
  settings: Settings;
  /** in the order they were added; listing sorts them */
  transactions: Transaction[];
  categories: Category[];
  /** added in slice 3; a file without it opens with none */
  rules: Rule[];
  /** added in slice 4: monthly budget per category id; a file without it opens with none */
  budgets: Record<string, number>;
  /** the next number used to make an id ("t12", "c3", "r4") */
  nextId: number;
};

export function emptyLedger(): LedgerData {
  return {
    format: FORMAT,
    version: CURRENT_VERSION,
    settings: { currency: "USD" },
    transactions: [],
    categories: [],
    rules: [],
    budgets: {},
    nextId: 1,
  };
}

export type ParseResult =
  | { ok: true; data: LedgerData; migratedFrom: number | null }
  | { ok: false; reason: string; newer: boolean };

/** Parses the text of a ledger file. Never throws. */
export function parseLedgerText(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, reason: `not valid JSON (${(e as Error).message})`, newer: false };
  }
  return parseLedger(raw);
}

/** Validates, repairs dangling references, and migrates to the current version. */
export function parseLedger(raw: unknown): ParseResult {
  const fail = (reason: string, newer = false): ParseResult => ({ ok: false, reason, newer });
  if (!isObject(raw)) return fail("not a JSON object");
  if (raw.format !== FORMAT) return fail(`not a Tally ledger (format is ${JSON.stringify(raw.format)})`);
  const version = raw.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) return fail("missing or invalid version");
  if (version > CURRENT_VERSION) {
    return fail(`made by a newer version of Tally (file version ${version}, this app reads up to ${CURRENT_VERSION})`, true);
  }
  // Migrations from older versions run here, oldest first. Version 1 is the first.
  const migratedFrom = version < CURRENT_VERSION ? version : null;

  const settings = isObject(raw.settings) ? raw.settings : {};
  const currency = (CURRENCIES as readonly string[]).includes(settings.currency as string)
    ? (settings.currency as Currency)
    : "USD";

  if (!Array.isArray(raw.transactions)) return fail("transactions are missing");
  if (!Array.isArray(raw.categories)) return fail("categories are missing");

  const categories: Category[] = [];
  const categoryIds = new Set<string>();
  for (const [i, c] of raw.categories.entries()) {
    if (!isObject(c) || typeof c.id !== "string" || typeof c.name !== "string" || c.name.trim() === "") {
      return fail(`category ${i + 1} is malformed`);
    }
    if (categoryIds.has(c.id)) return fail(`category id ${c.id} appears twice`);
    categoryIds.add(c.id);
    categories.push({ id: c.id, name: c.name });
  }

  const transactions: Transaction[] = [];
  const ids = new Set<string>();
  for (const [i, t] of raw.transactions.entries()) {
    if (!isObject(t)) return fail(`transaction ${i + 1} is not an object`);
    if (typeof t.id !== "string" || ids.has(t.id)) return fail(`transaction ${i + 1} has a missing or repeated id`);
    if (!isValidDate(t.date)) return fail(`transaction ${t.id} has an invalid date`);
    if (typeof t.payee !== "string") return fail(`transaction ${t.id} has no payee`);
    if (!isValidMinor(t.amount)) return fail(`transaction ${t.id} has an amount that is not whole minor units`);
    ids.add(t.id);
    const categoryId = typeof t.categoryId === "string" && categoryIds.has(t.categoryId) ? t.categoryId : null;
    transactions.push({
      id: t.id,
      date: t.date,
      payee: t.payee,
      amount: t.amount,
      categoryId,
      note: typeof t.note === "string" ? t.note : "",
    });
  }

  if (raw.rules !== undefined && !Array.isArray(raw.rules)) return fail("rules are not a list");
  const rules: Rule[] = [];
  const ruleIds = new Set<string>();
  for (const [i, r] of (raw.rules ?? []).entries()) {
    if (!isObject(r) || typeof r.id !== "string" || typeof r.contains !== "string" || r.contains.trim() === "" || typeof r.categoryId !== "string") {
      return fail(`rule ${i + 1} is malformed`);
    }
    if (ruleIds.has(r.id)) return fail(`rule id ${r.id} appears twice`);
    ruleIds.add(r.id);
    // A rule whose category is gone is dropped rather than refusing the file.
    if (categoryIds.has(r.categoryId)) rules.push({ id: r.id, contains: r.contains, categoryId: r.categoryId });
  }

  if (raw.budgets !== undefined && !isObject(raw.budgets)) return fail("budgets are not an object");
  const budgets: Record<string, number> = {};
  for (const [id, amount] of Object.entries(raw.budgets ?? {})) {
    if (!isValidMinor(amount) || amount <= 0) return fail(`the budget for ${id} is not a positive whole number of minor units`);
    // A budget whose category is gone is dropped rather than refusing the file.
    if (categoryIds.has(id)) budgets[id] = amount;
  }

  const nextId = typeof raw.nextId === "number" && Number.isSafeInteger(raw.nextId) && raw.nextId > 0 ? raw.nextId : 1;
  const data: LedgerData = {
    format: FORMAT,
    version: CURRENT_VERSION,
    settings: { currency },
    transactions,
    categories,
    rules,
    budgets,
    // Never hand out an id that is already in use, whatever nextId says.
    nextId: Math.max(nextId, maxIdNumber([...ids, ...categoryIds, ...ruleIds]) + 1),
  };
  return { ok: true, data, migratedFrom };
}

export function serializeLedger(data: LedgerData): string {
  return JSON.stringify(data, null, 2) + "\n";
}

function maxIdNumber(ids: string[]): number {
  let max = 0;
  for (const id of ids) {
    const n = Number(/^[a-z](\d+)$/.exec(id)?.[1] ?? 0);
    if (n > max) max = n;
  }
  return max;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

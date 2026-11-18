// The ledger service: every LedgerApi call, over a store. The main process
// runs it over the crash-safe file store; the labelled mock runs the same
// code over a memory store. A change is computed on a copy and becomes the
// current state only after the store has saved it, so a failed save leaves
// the ledger exactly as it was.
import type {
  Category,
  ImportMapping,
  LedgerApi,
  LedgerError,
  Result,
  Settings,
  StorageInfo,
  Transaction,
} from "../contracts/ledger.ts";
import { CURRENCIES } from "../contracts/ledger.ts";
import { categoryFor, checkCategoryName, checkRuleText } from "./categories.ts";
import { DELIMITERS } from "./csv.ts";
import { inspect, MAX_IMPORT_CHARS, mappingProblem, readAll, widthOf } from "./importer.ts";
import { isValidMonth } from "./dates.ts";
import { isValidMinor } from "./money.ts";
import { emptyLedger, type LedgerData } from "./schema.ts";
import { summarise } from "./summary.ts";
import { cleanText, newestFirst, validateDraft, type CleanDraft } from "./transactions.ts";

export type LoadResult = { data: LedgerData; recovered: string | null };

/** How many rows the import preview shows. */
export const PREVIEW_ROWS = 10;

export interface LedgerStore {
  load(): LoadResult;
  /** Persists the whole ledger; throws when it could not. */
  save(data: LedgerData): void;
  describe(): { kind: StorageInfo["kind"]; location: string | null };
}

/** The service answers synchronously; adapters make the calls async. */
export type SyncApi<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => Promise<infer R> ? (...args: A) => R : never;
};

export type LedgerService = SyncApi<LedgerApi>;

export function memoryStore(initial: LedgerData = emptyLedger()): LedgerStore & { current(): LedgerData } {
  let current = structuredClone(initial);
  return {
    load: () => ({ data: structuredClone(current), recovered: null }),
    save: (data) => {
      current = structuredClone(data);
    },
    describe: () => ({ kind: "memory", location: null }),
    current: () => structuredClone(current),
  };
}

export function createLedgerService(store: LedgerStore): LedgerService {
  const opened = store.load();
  let data: LedgerData = opened.data;
  const recovered = opened.recovered;

  const ok = <T>(value: T): Result<T> => ({ ok: true, value });
  const err = (code: LedgerError["code"], message: string, field?: string): Result<never> => ({
    ok: false,
    error: field ? { code, message, field } : { code, message },
  });

  /** Saves `next` and makes it current, or leaves everything as it was. */
  function commit<T>(next: LedgerData, value: T): Result<T> {
    try {
      store.save(next);
    } catch (e) {
      return err("io", `The ledger could not be saved: ${(e as Error).message}`);
    }
    data = next;
    return ok(value);
  }

  function copy(): LedgerData {
    return structuredClone(data);
  }

  function newId(next: LedgerData, prefix: "t" | "c" | "r"): string {
    const id = `${prefix}${next.nextId}`;
    next.nextId += 1;
    return id;
  }

  /** Finds a category by name (case-insensitive) or creates it in `next`. */
  function resolveCategory(next: LedgerData, name: string): string | null {
    if (name === "") return null;
    const key = name.toLocaleLowerCase();
    const found = next.categories.find((c) => c.name.toLocaleLowerCase() === key);
    if (found) return found.id;
    const created: Category = { id: newId(next, "c"), name };
    next.categories.push(created);
    return created.id;
  }

  function toTransaction(next: LedgerData, id: string, d: CleanDraft): Transaction {
    return { id, date: d.date, payee: d.payee, amount: d.amount, categoryId: resolveCategory(next, d.category), note: d.note };
  }

  function checkText(text: unknown): Result<string> {
    if (typeof text !== "string") return err("invalid", "The file could not be read as text.");
    if (text.length > MAX_IMPORT_CHARS) return err("invalid", "The file is too large to import (over 20 MB).");
    return ok(text);
  }

  function readImport(text: unknown, mapping: ImportMapping): Result<ReturnType<typeof readAll>> {
    const t = checkText(text);
    if (!t.ok) return t;
    if (typeof mapping !== "object" || mapping === null || !DELIMITERS.includes(mapping.delimiter)) {
      return err("invalid", "Choose a delimiter.", "delimiter");
    }
    const problem = mappingProblem(mapping, widthOf(t.value, mapping.delimiter));
    if (problem) return err("invalid", problem, "mapping");
    return ok(readAll(t.value, mapping, data.transactions, data.rules));
  }

  return {
    getLedger() {
      return {
        settings: { ...data.settings },
        categories: [...data.categories].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" })),
        rules: structuredClone(data.rules),
        budgets: { ...data.budgets },
        transactionCount: data.transactions.length,
        storage: { ...store.describe(), recovered },
      };
    },

    listTransactions() {
      return structuredClone(newestFirst(data.transactions));
    },

    addTransaction(draft) {
      const v = validateDraft(draft);
      if (!v.ok) return v;
      const next = copy();
      const t = toTransaction(next, newId(next, "t"), v.value);
      next.transactions.push(t);
      return commit(next, structuredClone(t));
    },

    updateTransaction(id, draft) {
      const index = data.transactions.findIndex((t) => t.id === String(id));
      if (index < 0) return err("not_found", "That transaction no longer exists.");
      const v = validateDraft(draft);
      if (!v.ok) return v;
      const next = copy();
      const t = toTransaction(next, next.transactions[index].id, v.value);
      next.transactions[index] = t;
      return commit(next, structuredClone(t));
    },

    deleteTransaction(id) {
      const index = data.transactions.findIndex((t) => t.id === String(id));
      if (index < 0) return err("not_found", "That transaction no longer exists.");
      const next = copy();
      next.transactions.splice(index, 1);
      return commit(next, null);
    },

    inspectImport(text, options = {}) {
      const t = checkText(text);
      if (!t.ok) return t;
      const delimiter = options?.delimiter;
      if (delimiter !== undefined && !DELIMITERS.includes(delimiter)) return err("invalid", "Choose a delimiter.", "delimiter");
      const hasHeader = typeof options?.hasHeader === "boolean" ? options.hasHeader : undefined;
      const inspection = inspect(t.value, { delimiter, hasHeader });
      if (inspection.rowCount === 0) return err("invalid", "The file has no rows to import.");
      return ok(inspection);
    },

    previewImport(text, mapping) {
      const read = readImport(text, mapping);
      if (!read.ok) return read;
      const { rows, rejected } = read.value;
      return ok({
        rows: rows.slice(0, PREVIEW_ROWS).map(({ line, date, payee, amount, duplicate, categoryId }) => ({
          line,
          date,
          payee,
          amount,
          status: duplicate ? ("duplicate" as const) : ("new" as const),
          categoryId,
        })),
        accepted: rows.filter((r) => !r.duplicate).length,
        duplicates: rows.filter((r) => r.duplicate).length,
        rejected,
      });
    },

    commitImport(text, mapping) {
      const read = readImport(text, mapping);
      if (!read.ok) return read;
      const { rows, rejected } = read.value;
      const fresh = rows.filter((r) => !r.duplicate);
      const next = copy();
      for (const r of fresh) {
        next.transactions.push({ id: newId(next, "t"), date: r.date, payee: r.payee, amount: r.amount, categoryId: r.categoryId, note: "" });
      }
      const outcome = { imported: fresh.length, duplicates: rows.length - fresh.length, rejected };
      // Nothing to add: nothing to save.
      return fresh.length === 0 ? ok(outcome) : commit(next, outcome);
    },

    createCategory(name) {
      const checked = checkCategoryName(name, data.categories);
      if (!checked.ok) return checked;
      const next = copy();
      const category: Category = { id: newId(next, "c"), name: checked.value };
      next.categories.push(category);
      return commit(next, { ...category });
    },

    renameCategory(id, name) {
      const index = data.categories.findIndex((c) => c.id === String(id));
      if (index < 0) return err("not_found", "That category no longer exists.");
      const checked = checkCategoryName(name, data.categories, data.categories[index].id);
      if (!checked.ok) return checked;
      const next = copy();
      next.categories[index] = { ...next.categories[index], name: checked.value };
      return commit(next, { ...next.categories[index] });
    },

    deleteCategory(id) {
      const target = data.categories.find((c) => c.id === String(id));
      if (!target) return err("not_found", "That category no longer exists.");
      const next = copy();
      let uncategorised = 0;
      for (const t of next.transactions) {
        if (t.categoryId === target.id) {
          t.categoryId = null;
          uncategorised += 1;
        }
      }
      next.categories = next.categories.filter((c) => c.id !== target.id);
      next.rules = next.rules.filter((r) => r.categoryId !== target.id);
      delete next.budgets[target.id];
      return commit(next, { uncategorised });
    },

    mergeCategories(sourceId, targetId) {
      const source = data.categories.find((c) => c.id === String(sourceId));
      const target = data.categories.find((c) => c.id === String(targetId));
      if (!source || !target) return err("not_found", "That category no longer exists.");
      if (source.id === target.id) return err("invalid", "Choose a different category to merge into.", "target");
      const next = copy();
      let moved = 0;
      for (const t of next.transactions) {
        if (t.categoryId === source.id) {
          t.categoryId = target.id;
          moved += 1;
        }
      }
      for (const r of next.rules) if (r.categoryId === source.id) r.categoryId = target.id;
      next.categories = next.categories.filter((c) => c.id !== source.id);
      // The target keeps its own budget; the source's goes with it.
      delete next.budgets[source.id];
      return commit(next, { moved });
    },

    createRule(contains, categoryId) {
      const checked = checkRuleText(contains);
      if (!checked.ok) return checked;
      const category = data.categories.find((c) => c.id === String(categoryId));
      if (!category) return err("invalid", "Choose a category for the rule.", "category");
      const key = checked.value.toLocaleLowerCase();
      if (data.rules.some((r) => r.contains.toLocaleLowerCase() === key && r.categoryId === category.id)) {
        return err("conflict", "That rule already exists.", "contains");
      }
      const next = copy();
      const rule = { id: newId(next, "r"), contains: checked.value, categoryId: category.id };
      next.rules.push(rule);
      return commit(next, { ...rule });
    },

    deleteRule(id) {
      if (!data.rules.some((r) => r.id === String(id))) return err("not_found", "That rule no longer exists.");
      const next = copy();
      next.rules = next.rules.filter((r) => r.id !== String(id));
      return commit(next, null);
    },

    applyRules() {
      const next = copy();
      let categorised = 0;
      for (const t of next.transactions) {
        if (t.categoryId !== null) continue;
        const categoryId = categoryFor(t.payee, next.rules);
        if (categoryId) {
          t.categoryId = categoryId;
          categorised += 1;
        }
      }
      return categorised === 0 ? ok({ categorised }) : commit(next, { categorised });
    },

    monthSummary(month) {
      if (!isValidMonth(month)) return err("invalid", "Choose a month (YYYY-MM).", "month");
      return ok(summarise(month, data.transactions, data.categories, data.budgets));
    },

    setBudget(categoryId, amount) {
      const category = data.categories.find((c) => c.id === String(categoryId));
      if (!category) return err("not_found", "That category no longer exists.");
      if (amount !== null && (!isValidMinor(amount) || amount < 0)) {
        return err("invalid", "Enter a budget as a positive amount.", "amount");
      }
      const next = copy();
      if (amount === null || amount === 0) delete next.budgets[category.id];
      else next.budgets[category.id] = amount;
      return commit(next, { categoryId: category.id, amount: next.budgets[category.id] ?? null });
    },

    setCurrency(currency) {
      const code = cleanText(String(currency ?? "")).toUpperCase();
      if (!(CURRENCIES as readonly string[]).includes(code)) {
        return err("invalid", `Tally supports ${CURRENCIES.join(", ")}.`, "currency");
      }
      const next = copy();
      next.settings = { currency: code as Settings["currency"] };
      return commit(next, { ...next.settings });
    },
  };
}

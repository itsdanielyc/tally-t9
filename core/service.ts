// The ledger service: every LedgerApi call, over a store. The main process
// runs it over the crash-safe file store; the labelled mock runs the same
// code over a memory store. A change is computed on a copy and becomes the
// current state only after the store has saved it, so a failed save leaves
// the ledger exactly as it was.
import type { Category, LedgerApi, LedgerError, Result, Settings, StorageInfo, Transaction } from "../contracts/ledger.ts";
import { CURRENCIES } from "../contracts/ledger.ts";
import { emptyLedger, type LedgerData } from "./schema.ts";
import { cleanText, newestFirst, validateDraft, type CleanDraft } from "./transactions.ts";

export type LoadResult = { data: LedgerData; recovered: string | null };

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

  function newId(next: LedgerData, prefix: "t" | "c"): string {
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

  return {
    getLedger() {
      return {
        settings: { ...data.settings },
        categories: [...data.categories].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" })),
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

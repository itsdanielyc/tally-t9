// The labelled mock backend for browser mode (Vite dev server, Playwright).
// It runs the same ledger service as the main process (core/service.ts)
// over an in-memory store, and clones every argument and result the way
// IPC would. tests/contract runs the same calls against this mock and
// against the service over the real file store. What the main process does
// with the OS (file dialogs) the mock does from a queue a test fills.
import type { ImportFile, LedgerApi, PlatformApi } from "../contracts/ledger.ts";
import { ledgerMethods } from "../contracts/methods.ts";
import { emptyLedger, parseLedger, type LedgerData } from "../core/schema.ts";
import { createLedgerService, memoryStore } from "../core/service.ts";

export interface Backend extends LedgerApi, PlatformApi {
  readonly kind: "native" | "mock";
}

/** Test hooks a browser-mode test sets before or after the page loads (page.addInitScript, page.evaluate). */
export type MockHooks = {
  /** the content of a ledger file to start the mock from */
  seed?: unknown;
  /** what the open-file dialog answers, first in first out; empty means the person cancelled */
  files?: ImportFile[];
  /** set to true to make the next save dialog answer "cancelled" */
  cancelSave?: boolean;
  /** every file the mock "saved", newest last, for tests to read */
  exports?: { name: string; text: string }[];
};

export function createMockBackend(seed?: LedgerData, hooks: () => MockHooks | undefined = () => undefined): Backend {
  const service = createLedgerService(memoryStore(seed ?? emptyLedger()));
  const backend: Record<string, unknown> = {
    kind: "mock",
    platformInfo: async () => ({ os: "mock", arch: "mock", electron: "mock", packaged: false }),
    chooseImportFile: async () => ({ ok: true, value: structuredClone(hooks()?.files?.shift() ?? null) }),
    saveExportFile: async (text: string, suggestedName: string) => {
      const h = hooks();
      if (h?.cancelSave) {
        h.cancelSave = false;
        return { ok: true, value: null };
      }
      if (h) (h.exports ??= []).push({ name: suggestedName, text });
      return { ok: true, value: { path: `mock:${suggestedName}` } };
    },
  };
  for (const method of ledgerMethods) {
    const call = service[method] as (...args: unknown[]) => unknown;
    backend[method] = async (...args: unknown[]) => structuredClone(call(...structuredClone(args)));
  }
  return backend as unknown as Backend;
}

/** The seed a test put in window.__TALLY_MOCK__, checked like a ledger file. */
export function seedFromHooks(hooks: MockHooks | undefined): LedgerData | undefined {
  if (hooks?.seed === undefined) return undefined;
  const parsed = parseLedger(hooks.seed);
  if (!parsed.ok) throw new Error(`mock seed is not a valid ledger: ${parsed.reason}`);
  return parsed.data;
}

// The labelled mock backend for browser mode (Vite dev server, Playwright).
// It runs the same ledger service as the main process (core/service.ts)
// over an in-memory store, and clones every argument and result the way
// IPC would. tests/contract runs the same calls against this mock and
// against the service over the real file store.
import type { LedgerApi, PlatformApi } from "../contracts/ledger.ts";
import { ledgerMethods } from "../contracts/methods.ts";
import { emptyLedger, parseLedger, type LedgerData } from "../core/schema.ts";
import { createLedgerService, memoryStore } from "../core/service.ts";

export interface Backend extends LedgerApi, PlatformApi {
  readonly kind: "native" | "mock";
}

/** Test hooks a browser-mode test sets before the page loads (page.addInitScript). */
export type MockHooks = {
  /** the content of a ledger file to start the mock from */
  seed?: unknown;
};

export function createMockBackend(seed?: LedgerData): Backend {
  const service = createLedgerService(memoryStore(seed ?? emptyLedger()));
  const backend: Record<string, unknown> = {
    kind: "mock",
    platformInfo: async () => ({ os: "mock", arch: "mock", electron: "mock", packaged: false }),
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

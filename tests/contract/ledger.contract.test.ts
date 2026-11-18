// L2: the mock and the real backend answer the same calls the same way.
// "Real" is the ledger service over the crash-safe file store in a temp
// directory, with every argument and result passed through structuredClone
// as IPC does, and the ledger reopened from disk after every call to check
// that what was answered is what was saved.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LedgerApi } from "../../contracts/ledger";
import { ledgerMethods } from "../../contracts/methods";
import { createLedgerService } from "../../core/service";
import { createFileStore } from "../../electron/store";
import { createMockBackend } from "../../src/mock";
import { scenarios, type Call } from "./scenarios";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function realBackend(): { api: LedgerApi; reopen: () => LedgerApi } {
  const dir = mkdtempSync(join(tmpdir(), "tally-contract-"));
  dirs.push(dir);
  const wrap = (service: ReturnType<typeof createLedgerService>): LedgerApi => {
    const api: Record<string, unknown> = {};
    for (const m of ledgerMethods) {
      const call = service[m] as (...a: unknown[]) => unknown;
      api[m] = async (...args: unknown[]) => structuredClone(call(...structuredClone(args)));
    }
    return api as unknown as LedgerApi;
  };
  return { api: wrap(createLedgerService(createFileStore(dir))), reopen: () => wrap(createLedgerService(createFileStore(dir))) };
}

/** What a backend holds, minus where it holds it. */
async function state(api: LedgerApi) {
  const { storage: _storage, ...ledger } = await api.getLedger();
  return { ledger, transactions: await api.listTransactions() };
}

async function run(api: LedgerApi, calls: Call[], afterEach?: () => Promise<void>): Promise<unknown[]> {
  const transcript: unknown[] = [];
  for (const [method, ...args] of calls) {
    const fn = api[method] as (...a: unknown[]) => Promise<unknown>;
    const result = await fn(...args);
    transcript.push(method === "getLedger" ? { ...(result as object), storage: "(differs by design)" } : result);
    await afterEach?.();
  }
  return transcript;
}

describe("contract: mock and real backend agree", () => {
  it("cover every ledger method between them", () => {
    const used = new Set(scenarios.flatMap((s) => s.calls.map((c) => c[0])));
    expect([...ledgerMethods].filter((m) => !used.has(m))).toEqual([]);
  });

  for (const scenario of scenarios) {
    it(scenario.name, async () => {
      const mock = createMockBackend();
      const real = realBackend();
      const mockTranscript = await run(mock, scenario.calls);
      const realTranscript = await run(real.api, scenario.calls, async () => {
        // What the real backend answered must be what it saved.
        expect(await state(real.reopen())).toEqual(await state(real.api));
      });
      expect(realTranscript).toEqual(mockTranscript);
      expect(await state(real.api)).toEqual(await state(mock));
    });
  }

  it("the real backend says it stores a file, the mock says memory", async () => {
    expect((await realBackend().api.getLedger()).storage).toMatchObject({ kind: "file", recovered: null });
    expect((await createMockBackend().getLedger()).storage).toEqual({ kind: "memory", location: null, recovered: null });
  });
});

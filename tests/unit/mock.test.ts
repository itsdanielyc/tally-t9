// L1: the browser-mode mock labels itself, starts from a checked seed, and
// clones what crosses it the way IPC does.
import { describe, expect, it } from "vitest";
import { emptyLedger } from "../../core/schema";
import { createMockBackend, seedFromHooks } from "../../src/mock";

describe("mock backend", () => {
  it("labels itself as a mock", async () => {
    const mock = createMockBackend();
    expect(mock.kind).toBe("mock");
    expect(await mock.platformInfo()).toEqual({ os: "mock", arch: "mock", electron: "mock", packaged: false });
  });

  it("starts from a seed only after checking it like a ledger file", () => {
    expect(seedFromHooks(undefined)).toBeUndefined();
    expect(seedFromHooks({ seed: emptyLedger() })).toEqual(emptyLedger());
    expect(() => seedFromHooks({ seed: { format: "tally-ledger", version: 99 } })).toThrow(/not a valid ledger/);
  });

  it("returns copies, so the UI cannot change the ledger by mutating a result", async () => {
    const mock = createMockBackend();
    await mock.addTransaction({ date: "2026-03-14", payee: "Shop", amount: -100, category: "", note: "" });
    const list = await mock.listTransactions();
    list[0].amount = -999;
    expect((await mock.listTransactions())[0].amount).toBe(-100);
  });
});

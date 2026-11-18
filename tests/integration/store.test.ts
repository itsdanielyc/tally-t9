// L3: the ledger file in real temp directories. Crash safety, recovery,
// versions, and a restart that must give back exactly what was saved.
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { serializeLedger } from "../../core/schema";
import { createLedgerService } from "../../core/service";
import { LEDGER_FILE, LedgerTooNewError, createFileStore } from "../../electron/store";
import { int, seeded } from "../support/random";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "tally-store-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const draft = { date: "2026-03-14", payee: "Corner Shop", amount: -1250, category: "Groceries", note: "milk" };

describe("file store", () => {
  it("gives back exactly what was saved after a restart", () => {
    const dir = tempDir();
    const first = createLedgerService(createFileStore(dir));
    first.setCurrency("EUR");
    const added = first.addTransaction(draft);
    expect(added.ok).toBe(true);

    const reopened = createLedgerService(createFileStore(dir));
    expect(reopened.listTransactions()).toEqual(first.listTransactions());
    expect(reopened.getLedger()).toEqual(first.getLedger());

    const onDisk = JSON.parse(readFileSync(join(dir, LEDGER_FILE), "utf8"));
    expect(onDisk).toMatchObject({ format: "tally-ledger", version: 1, settings: { currency: "EUR" } });
    expect(onDisk.transactions[0]).toMatchObject({ payee: "Corner Shop", amount: -1250, note: "milk" });
    expect(Number.isInteger(onDisk.transactions[0].amount)).toBe(true);
  });

  it("starts an empty ledger in a new directory without writing anything", () => {
    const dir = join(tempDir(), "nested", "tally");
    const loaded = createFileStore(dir).load();
    expect(loaded).toMatchObject({ recovered: null, data: { transactions: [], version: 1 } });
    expect(readdirSync(dir)).toEqual([]);
  });

  it("keeps the last saved ledger when a save was cut off while writing the temp file", () => {
    const dir = tempDir();
    const s = createLedgerService(createFileStore(dir));
    s.addTransaction(draft);
    const saved = readFileSync(join(dir, LEDGER_FILE), "utf8");
    writeFileSync(join(dir, `${LEDGER_FILE}.tmp`), saved.slice(0, saved.length / 2));
    const loaded = createFileStore(dir).load();
    expect(loaded.recovered).toBe(null);
    expect(loaded.data.transactions.map((t) => t.payee)).toEqual(["Corner Shop"]);
  });

  it("keeps the old ledger when the process dies between writing the temp file and the rename", () => {
    const dir = tempDir();
    const s = createLedgerService(createFileStore(dir));
    s.addTransaction(draft);
    // The same store with a rename that never happens, as if power went out.
    const dying = createFileStore(dir, { ...fs, renameSync: () => { throw Object.assign(new Error("power lost"), { code: "EIO" }); } });
    const s2 = createLedgerService(dying);
    const r = s2.addTransaction({ ...draft, payee: "Never saved" });
    expect(r).toMatchObject({ ok: false, error: { code: "io" } });
    expect(s2.listTransactions().map((t) => t.payee)).toEqual(["Corner Shop"]);
    const loaded = createFileStore(dir).load();
    expect(loaded.recovered).toBe(null);
    expect(loaded.data.transactions.map((t) => t.payee)).toEqual(["Corner Shop"]);
  });

  it("opens the backup when the ledger file is corrupt, and keeps the corrupt file aside", () => {
    const dir = tempDir();
    const s = createLedgerService(createFileStore(dir));
    s.addTransaction(draft);
    s.addTransaction({ ...draft, payee: "Second" });
    const file = join(dir, LEDGER_FILE);
    const corrupt = readFileSync(file, "utf8").slice(0, 40);
    writeFileSync(file, corrupt);
    const loaded = createFileStore(dir, fs, () => new Date("2026-03-15T10:00:00Z")).load();
    expect(loaded.data.transactions.map((t) => t.payee)).toEqual(["Corner Shop"]);
    expect(loaded.recovered).toContain("backup was opened");
    const aside = join(dir, "ledger.unreadable-2026-03-15T10-00-00-000Z.json");
    expect(readFileSync(aside, "utf8")).toBe(corrupt);
  });

  it("starts a new ledger when nothing is readable, without deleting the unreadable file", () => {
    const dir = tempDir();
    writeFileSync(join(dir, LEDGER_FILE), "garbage");
    const loaded = createFileStore(dir).load();
    expect(loaded.data.transactions).toEqual([]);
    expect(loaded.recovered).toContain("new ledger was started");
    const kept = readdirSync(dir).filter((f) => f.startsWith("ledger.unreadable-"));
    expect(kept).toHaveLength(1);
    expect(readFileSync(join(dir, kept[0]), "utf8")).toBe("garbage");
  });

  it("opens the backup when the ledger file is missing", () => {
    const dir = tempDir();
    const s = createLedgerService(createFileStore(dir));
    s.addTransaction(draft);
    s.addTransaction({ ...draft, payee: "Second" });
    rmSync(join(dir, LEDGER_FILE));
    const loaded = createFileStore(dir).load();
    expect(loaded.data.transactions.map((t) => t.payee)).toEqual(["Corner Shop"]);
    expect(loaded.recovered).toContain("missing");
  });

  it("refuses a ledger from a newer Tally and leaves it byte for byte untouched", () => {
    const dir = tempDir();
    const file = join(dir, LEDGER_FILE);
    const newer = serializeLedger({ ...JSON.parse(readFileSync("tests/fixtures/ledger-v1.json", "utf8")), version: 2 });
    writeFileSync(file, newer);
    expect(() => createFileStore(dir).load()).toThrow(LedgerTooNewError);
    expect(readFileSync(file, "utf8")).toBe(newer);
    expect(readdirSync(dir)).toEqual([LEDGER_FILE]);
  });
});

describe("file versions", () => {
  it("opens the version 1 fixture with every field intact", () => {
    const dir = tempDir();
    writeFileSync(join(dir, LEDGER_FILE), readFileSync("tests/fixtures/ledger-v1.json"));
    const s = createLedgerService(createFileStore(dir));
    expect(s.getLedger()).toMatchObject({
      settings: { currency: "EUR" },
      transactionCount: 3,
      categories: [
        { id: "c5", name: "Eating out" },
        { id: "c2", name: "Housing" },
      ],
      storage: { kind: "file", recovered: null },
    });
    expect(s.listTransactions()).toEqual([
      { id: "t4", date: "2026-03-01", payee: "Café Ünïcode «Zürich»", amount: -455, categoryId: "c5", note: 'line one, "quoted"; semicolon' },
      { id: "t3", date: "2026-03-01", payee: "Employer Ltd", amount: 312050, categoryId: null, note: "" },
      { id: "t1", date: "2026-02-28", payee: "Landlord", amount: -95000, categoryId: "c2", note: "February rent" },
    ]);
    // New ids continue after the file's own.
    const added = s.addTransaction(draft);
    expect(added.ok && added.value.id).toBe("t6");
  });
});

describe("crash safety under a real kill", () => {
  it("a process killed in the middle of saving never leaves a ledger that will not open", async () => {
    const dir = tempDir();
    const rand = seeded(7);
    let lastCount = 0;
    for (let round = 0; round < 12; round++) {
      const child = spawn(process.execPath, [join("tests", "integration", "helpers", "save-loop.ts"), dir], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (b) => (stderr += String(b)));
      const exited = new Promise<number | null>((r) => child.once("exit", (code) => r(code)));
      await Promise.race([new Promise((r) => child.stdout.once("data", r)), exited]);
      await new Promise((r) => setTimeout(r, int(rand, 30, 250)));
      expect(child.exitCode, `helper stopped by itself: ${stderr}`).toBe(null);
      child.kill("SIGKILL");
      await exited;

      const loaded = createFileStore(dir).load();
      expect(loaded.recovered, `round ${round}`).toBe(null);
      const count = loaded.data.transactions.length;
      expect(count, `round ${round}: saves were lost`).toBeGreaterThanOrEqual(lastCount);
      // Every saved transaction is whole.
      for (const t of loaded.data.transactions) expect(Number.isInteger(t.amount) && t.payee.startsWith("Payee ")).toBe(true);
      lastCount = count;
    }
    expect(lastCount).toBeGreaterThan(0);
    expect(existsSync(join(dir, LEDGER_FILE))).toBe(true);
  }, 60_000);
});

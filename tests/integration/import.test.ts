// L3: import against the real file store. A 2,000-row bank CSV imports in
// under five seconds with every rejected row listed; a save that fails adds
// nothing to the file; importing the same file again after a restart adds
// nothing.
import * as fs from "node:fs";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ImportMapping } from "../../contracts/ledger";
import { createLedgerService } from "../../core/service";
import { LEDGER_FILE, createFileStore } from "../../electron/store";
import { int, pick, seeded } from "../support/random";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "tally-import-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A semicolon, day-month-year, decimal-comma export with CRLF line ends and every 100th row broken. */
function bankExport(rows: number, seed = 2000): { text: string; badLines: number[] } {
  const rand = seeded(seed);
  const payees = ["Bäckerei Müller", "Supermarkt", '"Café ""Zentral"""', "Stadtwerke; Strom", "Arbeitgeber AG", "Apotheke"];
  const lines = ["Buchungstag;Empfänger;Betrag"];
  const badLines: number[] = [];
  for (let i = 0; i < rows; i++) {
    const line = i + 2;
    const day = String(int(rand, 1, 28)).padStart(2, "0");
    const month = String(int(rand, 1, 12)).padStart(2, "0");
    let payee = pick(rand, payees);
    if (payee.includes(";") && !payee.startsWith('"')) payee = `"${payee}"`;
    const cents = int(rand, 1, 500000) * (rand() < 0.85 ? -1 : 1);
    const amount = `${cents < 0 ? "-" : ""}${Math.floor(Math.abs(cents) / 100).toLocaleString("de-DE")},${String(Math.abs(cents) % 100).padStart(2, "0")}`;
    if (i % 100 === 99) {
      badLines.push(line);
      lines.push(`31.02.2025;${payee};${amount}`);
    } else {
      lines.push(`${day}.${month}.2025;${payee} ${i};${amount}`);
    }
  }
  return { text: lines.join("\r\n") + "\r\n", badLines };
}

const mapping: ImportMapping = { delimiter: ";", hasHeader: true, date: 0, payee: 1, amount: { kind: "signed", column: 2 }, dateOrder: "DMY", decimal: ",", category: null, note: null };

describe("import against the file store", () => {
  it("imports a 2,000-row bank CSV in under five seconds and lists every rejected row", () => {
    const dir = tempDir();
    const { text, badLines } = bankExport(2000);
    const started = performance.now();
    const s = createLedgerService(createFileStore(dir));
    const inspection = s.inspectImport(text);
    const preview = s.previewImport(text, mapping);
    const outcome = s.commitImport(text, mapping);
    const elapsed = performance.now() - started;

    expect(inspection.ok && inspection.value.suggested).toEqual(mapping);
    expect(preview.ok && preview.value.accepted).toBe(1980);
    expect(outcome.ok && outcome.value.imported).toBe(1980);
    expect(outcome.ok && outcome.value.rejected).toEqual(badLines.map((line) => ({ line, reason: 'date "31.02.2025" is not a valid day-month-year date' })));
    expect(elapsed, `took ${Math.round(elapsed)} ms`).toBeLessThan(5000);

    const onDisk = JSON.parse(readFileSync(join(dir, LEDGER_FILE), "utf8"));
    expect(onDisk.transactions).toHaveLength(1980);
    expect(onDisk.transactions.every((t: { amount: number }) => Number.isInteger(t.amount))).toBe(true);
  });

  it("importing the same file again after a restart adds nothing", () => {
    const dir = tempDir();
    const { text } = bankExport(300, 7);
    const first = createLedgerService(createFileStore(dir)).commitImport(text, mapping);
    expect(first.ok && first.value.imported).toBe(297);
    const reopened = createLedgerService(createFileStore(dir));
    const again = reopened.commitImport(text, mapping);
    expect(again.ok && again.value).toMatchObject({ imported: 0, duplicates: 297 });
    expect(reopened.getLedger().transactionCount).toBe(297);
  });

  it("a save that fails during import leaves the ledger file exactly as it was", () => {
    const dir = tempDir();
    const ok = createLedgerService(createFileStore(dir));
    ok.addTransaction({ date: "2025-01-01", payee: "Before import", amount: -100, category: "", note: "" });
    const before = readFileSync(join(dir, LEDGER_FILE), "utf8");

    const failing = createFileStore(dir, { ...fs, renameSync: () => { throw Object.assign(new Error("device unplugged"), { code: "EIO" }); } });
    const s = createLedgerService(failing);
    const outcome = s.commitImport(bankExport(500).text, mapping);
    expect(outcome).toMatchObject({ ok: false, error: { code: "io" } });
    expect(s.getLedger().transactionCount).toBe(1);
    expect(readFileSync(join(dir, LEDGER_FILE), "utf8")).toBe(before);
    expect(createLedgerService(createFileStore(dir)).listTransactions().map((t) => t.payee)).toEqual(["Before import"]);
  });
});

// L3: the exported file on disk. Written crash-safe (temp file, rename), and
// read back through the same decoding the open dialog uses, into an empty
// ledger file, gives the same transactions.
import * as fs from "node:fs";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { decodeCsvBytes } from "../../core/csv";
import { createLedgerService } from "../../core/service";
import { createFileStore, writeTextAtomic } from "../../electron/store";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "tally-export-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("export to a file", () => {
  it("round-trips through a file into an empty ledger file", () => {
    const dir = tempDir();
    const source = createLedgerService(createFileStore(join(dir, "a")));
    source.addTransaction({ date: "2026-03-01", payee: "Café Zürich", amount: -455, category: "Eating out", note: 'with "friends", late' });
    source.addTransaction({ date: "2026-03-01", payee: "Employer Ltd", amount: 312050, category: "Salary", note: "" });
    source.addTransaction({ date: "2026-02-28", payee: "Landlord", amount: -95000, category: "", note: "rent" });
    const exported = source.exportCsv();
    if (!exported.ok) throw new Error("export failed");
    const file = join(dir, "export.csv");
    writeTextAtomic(file, exported.value.text);

    const target = createLedgerService(createFileStore(join(dir, "b")));
    const text = decodeCsvBytes(readFileSync(file));
    const inspection = target.inspectImport(text);
    if (!inspection.ok) throw new Error(inspection.error.message);
    expect(target.commitImport(text, inspection.value.suggested)).toMatchObject({ ok: true, value: { imported: 3, rejected: [] } });

    const shape = (s: typeof source) => {
      const names = new Map(s.getLedger().categories.map((c) => [c.id, c.name]));
      return s.listTransactions().map(({ date, payee, amount, categoryId, note }) => ({ date, payee, amount, note, category: categoryId ? names.get(categoryId) : null }));
    };
    const reopened = createLedgerService(createFileStore(join(dir, "b")));
    expect(shape(reopened)).toEqual(shape(source));
  });

  it("replaces an existing file whole, and a cut-off write leaves the old one", () => {
    const dir = tempDir();
    const file = join(dir, "export.csv");
    writeFileSync(file, "old\r\n");
    writeTextAtomic(file, "new\r\n");
    expect(readFileSync(file, "utf8")).toBe("new\r\n");
    const dying = { ...fs, renameSync: () => { throw Object.assign(new Error("power lost"), { code: "EIO" }); } };
    expect(() => writeTextAtomic(file, "never\r\n", dying)).toThrow("power lost");
    expect(readFileSync(file, "utf8")).toBe("new\r\n");
  });
});

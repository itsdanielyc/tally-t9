// L1: search and filters, the export format, export then import into an
// empty ledger giving the same transactions, and undo once for delete,
// merge and import.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ImportMapping, Transaction, TransactionDraft } from "../../contracts/ledger";
import { decodeCsvBytes } from "../../core/csv";
import { applyFilter, csvField, toCsv } from "../../core/find";
import { createLedgerService, memoryStore } from "../../core/service";
import { int, pick, seeded } from "../support/random";

const t = (id: string, date: string, payee: string, amount: number, categoryId: string | null = null, note = ""): Transaction => ({
  id,
  date,
  payee,
  amount,
  categoryId,
  note,
});
const list = [
  t("t1", "2026-03-01", "Landlord", -95000, "c2", "March rent"),
  t("t2", "2026-03-02", "Employer Ltd", 312050, "c3"),
  t("t3", "2026-03-09", "Corner Shop", -1250, "c1", "milk"),
  t("t4", "2026-03-12", "Farmers Market", -4320, "c1"),
  t("t5", "2026-02-27", "Water Utility", -3875, null, "quarterly"),
];
const ids = (xs: Transaction[]) => xs.map((x) => x.id);

describe("applyFilter", () => {
  it("finds text in the payee or the note, ignoring case", () => {
    expect(ids(applyFilter(list, { text: "SHOP" }))).toEqual(["t3"]);
    expect(ids(applyFilter(list, { text: "rent" }))).toEqual(["t1"]);
    expect(ids(applyFilter(list, { text: "  " }))).toEqual(ids(list));
  });

  it("filters by category, uncategorised or any", () => {
    expect(ids(applyFilter(list, { category: "c1" }))).toEqual(["t3", "t4"]);
    expect(ids(applyFilter(list, { category: "none" }))).toEqual(["t5"]);
    expect(ids(applyFilter(list, { category: "any" }))).toEqual(ids(list));
  });

  it("filters by an inclusive date range", () => {
    expect(ids(applyFilter(list, { from: "2026-03-02", to: "2026-03-09" }))).toEqual(["t2", "t3"]);
    expect(ids(applyFilter(list, { to: "2026-02-28" }))).toEqual(["t5"]);
  });

  it("filters by an inclusive amount range without the sign", () => {
    expect(ids(applyFilter(list, { minAmount: 1250, maxAmount: 4320 }))).toEqual(["t3", "t4", "t5"]);
    expect(ids(applyFilter(list, { minAmount: 100000 }))).toEqual(["t2"]);
  });

  it("combines everything, and ignores parts that are not valid", () => {
    expect(ids(applyFilter(list, { text: "a", category: "c1", from: "2026-03-10", maxAmount: 5000 }))).toEqual(["t4"]);
    expect(ids(applyFilter(list, { from: "not a date", minAmount: 1.5 as number }))).toEqual(ids(list));
  });
});

describe("CSV export", () => {
  it("writes ISO dates, plain signed amounts, category names, notes, oldest first, CRLF", () => {
    const cats = [{ id: "c1", name: "Groceries" }];
    const csv = toCsv([t("b", "2026-03-10", "Shop, Inc", -123456, "c1", 'say "hi"'), t("a", "2026-03-09", " Spaces ", 5, null, "two\nlines")], cats);
    expect(csv).toBe('Date,Payee,Amount,Category,Note\r\n2026-03-09," Spaces ",0.05,,"two\nlines"\r\n2026-03-10,"Shop, Inc",-1234.56,Groceries,"say ""hi"""\r\n');
  });

  it("quotes only what needs quoting", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('q"')).toBe('"q"""');
    expect(csvField("x\r\ny")).toBe('"x\r\ny"');
    expect(csvField(" lead")).toBe('" lead"');
  });
});

describe("export then import into an empty ledger", () => {
  const roundTrip = (seedDrafts: TransactionDraft[]) => {
    const source = createLedgerService(memoryStore());
    for (const d of seedDrafts) source.addTransaction(d);
    const exported = source.exportCsv();
    if (!exported.ok) throw new Error("export failed");
    const target = createLedgerService(memoryStore());
    const inspection = target.inspectImport(exported.value.text);
    if (!inspection.ok) throw new Error(inspection.error.message);
    const outcome = target.commitImport(exported.value.text, inspection.value.suggested);
    const strip = (xs: Transaction[], names: Map<string, string>) =>
      xs.map(({ date, payee, amount, categoryId, note }) => ({ date, payee, amount, note, category: categoryId ? names.get(categoryId) : null }));
    const names = (s: typeof source) => new Map(s.getLedger().categories.map((c) => [c.id, c.name]));
    return { outcome, inspection: inspection.value, before: strip(source.listTransactions(), names(source)), after: strip(target.listTransactions(), names(target)) };
  };

  it("detects the export's own columns", () => {
    const { inspection } = roundTrip([{ date: "2026-03-01", payee: "Shop", amount: -100, category: "Food", note: "n" }]);
    expect(inspection.suggested).toEqual({
      delimiter: ",",
      hasHeader: true,
      date: 0,
      payee: 1,
      amount: { kind: "signed", column: 2 },
      dateOrder: "YMD",
      decimal: ".",
      category: 3,
      note: 4,
    } satisfies ImportMapping);
  });

  it("gives back the same transactions in the same order, randomized (seed 55)", () => {
    const rand = seeded(55);
    const payees = ["Corner Shop", "Shop, Inc", 'The "Best" Cafe', "Café Zürich", "  padded  ", "Semi;colon", "1,234 Main St"];
    const notes = ["", "", "milk", 'quote "x"', "comma, here", "ümlaut"];
    for (let round = 0; round < 25; round++) {
      const drafts: TransactionDraft[] = [];
      for (let i = 0; i < int(rand, 1, 40); i++) {
        drafts.push({
          date: `2026-0${int(rand, 1, 9)}-${String(int(rand, 1, 28)).padStart(2, "0")}`,
          payee: pick(rand, payees),
          amount: int(rand, 1, 9_999_999) * (rand() < 0.7 ? -1 : 1),
          category: pick(rand, ["", "Groceries", "Eating out", "Housing"]),
          note: pick(rand, notes),
        });
      }
      const { outcome, before, after } = roundTrip(drafts);
      expect(outcome.ok && outcome.value.rejected, `round ${round}`).toEqual([]);
      expect(after, `round ${round}`).toEqual(before);
    }
  });

  it("an export of a filtered list holds only what was shown", () => {
    const s = createLedgerService(memoryStore());
    s.addTransaction({ date: "2026-03-01", payee: "Shop", amount: -100, category: "Food", note: "" });
    s.addTransaction({ date: "2026-03-02", payee: "Rent", amount: -900, category: "", note: "" });
    const e = s.exportCsv({ text: "shop" });
    expect(e.ok && e.value.count).toBe(1);
    expect(e.ok && e.value.text).toBe("Date,Payee,Amount,Category,Note\r\n2026-03-01,Shop,-1.00,Food,\r\n");
    expect(e.ok && e.value.suggestedName).toMatch(/^tally-export-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});

describe("undo", () => {
  const draft = (payee: string, category = "") => ({ date: "2026-03-10", payee, amount: -100, category, note: "" });

  it("undoes the last delete once, and says what it undid", () => {
    const store = memoryStore();
    const s = createLedgerService(store);
    s.addTransaction(draft("Keep"));
    const gone = s.addTransaction(draft("Gone"));
    const before = s.listTransactions();
    s.deleteTransaction(gone.ok ? gone.value.id : "");
    expect(s.getLedger().undo).toEqual({ label: "Deleted Gone" });
    expect(s.undo()).toEqual({ ok: true, value: { undone: "Deleted Gone" } });
    expect(s.listTransactions()).toEqual(before);
    expect(store.current().transactions).toHaveLength(2);
    expect(s.getLedger().undo).toBe(null);
    expect(s.undo()).toMatchObject({ ok: false, error: { message: "There is nothing to undo." } });
  });

  it("undoes a merge: both categories and every transaction come back", () => {
    const s = createLedgerService(memoryStore());
    s.addTransaction(draft("A", "Food"));
    s.addTransaction(draft("B", "Groceries"));
    const before = { ledger: s.getLedger(), list: s.listTransactions() };
    const [food, groceries] = ["Food", "Groceries"].map((n) => before.ledger.categories.find((c) => c.name === n)!.id);
    s.mergeCategories(food, groceries);
    expect(s.getLedger().undo).toEqual({ label: "Merged Food into Groceries" });
    s.undo();
    expect(s.listTransactions()).toEqual(before.list);
    expect(s.getLedger().categories).toEqual(before.ledger.categories);
  });

  it("undoes an import in one step", () => {
    const text = decodeCsvBytes(readFileSync("tests/fixtures/csv/us-comma.csv"));
    const s = createLedgerService(memoryStore());
    s.addTransaction(draft("Before"));
    const i = s.inspectImport(text);
    s.commitImport(text, i.ok ? i.value.suggested : ({} as ImportMapping));
    expect(s.getLedger()).toMatchObject({ transactionCount: 7, undo: { label: "Imported 6 transactions" } });
    s.undo();
    expect(s.listTransactions().map((x) => x.payee)).toEqual(["Before"]);
  });

  it("any other change clears it; reading does not", () => {
    const s = createLedgerService(memoryStore());
    const a = s.addTransaction(draft("A"));
    s.deleteTransaction(a.ok ? a.value.id : "");
    s.listTransactions();
    s.monthSummary("2026-03");
    s.exportCsv();
    expect(s.getLedger().undo).not.toBe(null);
    s.addTransaction(draft("B"));
    expect(s.getLedger().undo).toBe(null);
    expect(s.undo().ok).toBe(false);
  });

  it("a failed change keeps the undo that was there", () => {
    const s = createLedgerService(memoryStore());
    const a = s.addTransaction(draft("A"));
    s.deleteTransaction(a.ok ? a.value.id : "");
    s.addTransaction(draft(""));
    s.deleteTransaction("t99");
    expect(s.getLedger().undo).toEqual({ label: "Deleted A" });
  });
});

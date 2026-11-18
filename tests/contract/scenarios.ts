// Call sequences the contract suite plays against both backends. Each call
// is [method, ...args]; the transcripts of results must be equal.
import { readFileSync } from "node:fs";
import type { ImportMapping, LedgerApi } from "../../contracts/ledger";
import { decodeCsvBytes } from "../../core/csv";

export type Call = { [K in keyof LedgerApi]: [K, ...Parameters<LedgerApi[K]>] }[keyof LedgerApi];

const usCsv = decodeCsvBytes(readFileSync("tests/fixtures/csv/us-comma.csv"));
const deCsv = decodeCsvBytes(readFileSync("tests/fixtures/csv/de-semicolon.csv"));
const us: ImportMapping = { delimiter: ",", hasHeader: true, date: 0, payee: 1, amount: { kind: "signed", column: 2 }, dateOrder: "MDY", decimal: "." };
const de: ImportMapping = { delimiter: ";", hasHeader: true, date: 0, payee: 1, amount: { kind: "signed", column: 3 }, dateOrder: "DMY", decimal: "," };

const shop = { date: "2026-03-14", payee: "Corner Shop", amount: -1250, category: "Groceries", note: "" };

export const scenarios: { name: string; calls: Call[] }[] = [
  {
    name: "record, edit and delete transactions",
    calls: [
      ["getLedger"],
      ["addTransaction", { date: "2026-03-01", payee: "Rent", amount: -90000, category: "Housing", note: "March" }],
      ["addTransaction", shop],
      ["addTransaction", { date: "2026-03-01", payee: "Salary", amount: 250000, category: "", note: "" }],
      ["addTransaction", { ...shop, category: "groceries", payee: "Market" }],
      ["listTransactions"],
      ["updateTransaction", "t1", { date: "2026-03-02", payee: "Rent", amount: -95000, category: "Housing", note: "" }],
      ["updateTransaction", "t1", { date: "2026-03-02", payee: "Rent", amount: -95000, category: "Home", note: "moved" }],
      ["deleteTransaction", "t4"],
      ["listTransactions"],
      ["getLedger"],
    ],
  },
  {
    name: "reject bad input the same way",
    calls: [
      ["addTransaction", { ...shop, payee: "" }],
      ["addTransaction", { ...shop, amount: 12.5 }],
      ["addTransaction", { ...shop, date: "2026-02-29" }],
      ["addTransaction", { ...shop, amount: 0 }],
      ["updateTransaction", "t42", shop],
      ["deleteTransaction", "t42"],
      ["listTransactions"],
    ],
  },
  {
    name: "currency setting",
    calls: [
      ["setCurrency", "eur"],
      ["setCurrency", "XYZ"],
      ["addTransaction", shop],
      ["setCurrency", "GBP"],
      ["getLedger"],
      ["listTransactions"],
    ],
  },
  {
    name: "import a bank CSV: inspect, preview, commit, repeat",
    calls: [
      ["inspectImport", usCsv],
      ["inspectImport", deCsv],
      ["inspectImport", usCsv, { delimiter: ";", hasHeader: false }],
      ["inspectImport", "Date,Payee\n"],
      ["addTransaction", { date: "2026-03-09", payee: "Corner Shop", amount: -1250, category: "", note: "typed in" }],
      ["previewImport", usCsv, us],
      ["previewImport", usCsv, { ...us, amount: { kind: "signed", column: 9 } }],
      ["commitImport", usCsv, us],
      ["commitImport", usCsv, us],
      ["commitImport", deCsv, de],
      ["listTransactions"],
      ["getLedger"],
    ],
  },
  {
    name: "categories and rules",
    calls: [
      ["addTransaction", { ...shop, category: "Food shopping" }],
      ["addTransaction", { ...shop, payee: "SHELL Main St", category: "" }],
      ["addTransaction", { ...shop, payee: "Market", category: "Groceries" }],
      ["createCategory", "Fuel"],
      ["createCategory", "fuel"],
      ["createCategory", ""],
      ["renameCategory", "c2", "Food"],
      ["renameCategory", "c2", "groceries"],
      ["createRule", "shell", "c6"],
      ["createRule", "shell", "c6"],
      ["createRule", "corner", "c2"],
      ["createRule", "x", "c99"],
      ["applyRules"],
      ["previewImport", usCsv, us],
      ["mergeCategories", "c2", "c5"],
      ["mergeCategories", "c5", "c5"],
      ["getLedger"],
      ["deleteRule", "r8"],
      ["deleteRule", "r8"],
      ["deleteCategory", "c6"],
      ["deleteCategory", "c6"],
      ["commitImport", usCsv, us],
      ["listTransactions"],
      ["getLedger"],
    ],
  },
  {
    name: "monthly summary and budgets",
    calls: [
      ["addTransaction", { date: "2026-03-01", payee: "Rent", amount: -95000, category: "Housing", note: "" }],
      ["addTransaction", { date: "2026-03-31", payee: "Salary", amount: 312050, category: "Pay", note: "" }],
      ["addTransaction", { date: "2026-03-09", payee: "Shop", amount: -1250, category: "Groceries", note: "" }],
      ["addTransaction", { date: "2026-03-10", payee: "Refund", amount: 499, category: "Groceries", note: "" }],
      ["addTransaction", { date: "2026-04-01", payee: "Shop", amount: -100, category: "", note: "" }],
      ["setBudget", "c2", 90000],
      ["setBudget", "c6", 20000],
      ["setBudget", "c6", 12.5],
      ["setBudget", "c99", 100],
      ["monthSummary", "2026-03"],
      ["monthSummary", "2026-04"],
      ["monthSummary", "2026-02"],
      ["monthSummary", "March"],
      ["setBudget", "c2", null],
      ["mergeCategories", "c6", "c2"],
      ["monthSummary", "2026-03"],
      ["getLedger"],
    ],
  },
  {
    name: "find, export, undo",
    calls: [
      ["addTransaction", { date: "2026-03-01", payee: "Rent", amount: -95000, category: "Housing", note: "March" }],
      ["addTransaction", { date: "2026-03-09", payee: "Shop, Inc", amount: -1250, category: "Groceries", note: 'say "hi"' }],
      ["addTransaction", { date: "2026-02-27", payee: "Water", amount: -3875, category: "", note: "" }],
      ["listTransactions", { text: "shop" }],
      ["listTransactions", { category: "none" }],
      ["listTransactions", { from: "2026-03-01", to: "2026-03-31", minAmount: 1000, maxAmount: 2000 }],
      ["exportCsv"],
      ["exportCsv", { category: "none" }],
      ["undo"],
      ["deleteTransaction", "t5"],
      ["getLedger"],
      ["undo"],
      ["undo"],
      ["commitImport", usCsv, us],
      ["undo"],
      ["mergeCategories", "c4", "c2"],
      ["addTransaction", { date: "2026-03-10", payee: "Bakery", amount: -300, category: "", note: "" }],
      ["undo"],
      ["listTransactions"],
      ["getLedger"],
    ],
  },
];

// Call sequences the contract suite plays against both backends. Each call
// is [method, ...args]; the transcripts of results must be equal.
import type { LedgerApi } from "../../contracts/ledger";

export type Call = { [K in keyof LedgerApi]: [K, ...Parameters<LedgerApi[K]>] }[keyof LedgerApi];

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
];

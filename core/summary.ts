// The monthly summary: per-category totals, income against spending, and
// each category against its budget. Every total is an exact integer sum of
// the transactions the summary returns, so what the screen shows adds up to
// the cent.
import type { Category, CategoryMonth, MonthSummary, Transaction } from "../contracts/ledger.ts";
import { monthOf } from "./dates.ts";
import { sumMinor } from "./money.ts";
import { newestFirst } from "./transactions.ts";

export const UNCATEGORISED = "Uncategorised";

export function summarise(
  month: string,
  transactions: readonly Transaction[],
  categories: readonly Category[],
  budgets: Readonly<Record<string, number>>,
): MonthSummary {
  const inMonth = newestFirst(transactions.filter((t) => monthOf(t.date) === month));
  const groups = new Map<string | null, Transaction[]>();
  for (const t of inMonth) {
    const key = t.categoryId;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const rows: CategoryMonth[] = [];
  const named = [...categories].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  for (const c of named) {
    const list = groups.get(c.id) ?? [];
    const budget = budgets[c.id] ?? null;
    if (list.length === 0 && budget === null) continue;
    rows.push(row(c.id, c.name, list, budget));
  }
  const loose = groups.get(null);
  if (loose?.length) rows.push(row(null, UNCATEGORISED, loose, null));

  const amounts = inMonth.map((t) => t.amount);
  const income = sumMinor(amounts.filter((a) => a > 0));
  const spending = 0 - sumMinor(amounts.filter((a) => a < 0)); // never -0
  return { month, income, spending, net: income - spending, categories: rows, transactions: structuredClone(inMonth) };
}

function row(categoryId: string | null, name: string, list: Transaction[], budget: number | null): CategoryMonth {
  const amounts = list.map((t) => t.amount);
  const income = sumMinor(amounts.filter((a) => a > 0));
  const spending = 0 - sumMinor(amounts.filter((a) => a < 0)); // never -0
  const net = income - spending;
  // Spent is the negative of the net, so a refund in the category reduces it.
  return { categoryId, name, income, spending, net, budget, left: budget === null ? null : budget + net };
}

// Transaction rules: what a valid draft is, and the newest-first order.
import type { LedgerError, Transaction } from "../contracts/ledger.ts";
import { isValidDate } from "./dates.ts";
import { isValidMinor } from "./money.ts";

export const PAYEE_MAX = 200;
export const NOTE_MAX = 1000;
export const CATEGORY_NAME_MAX = 60;

export type CleanDraft = { date: string; payee: string; amount: number; category: string; note: string };

/** Collapses runs of whitespace and trims. */
export function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Checks a draft from the UI (or anything else that reaches the backend). */
export function validateDraft(draft: unknown): { ok: true; value: CleanDraft } | { ok: false; error: LedgerError } {
  const invalid = (field: string, message: string) => ({ ok: false as const, error: { code: "invalid" as const, field, message } });
  if (typeof draft !== "object" || draft === null) return invalid("draft", "The transaction is missing.");
  const d = draft as Record<string, unknown>;
  if (!isValidDate(d.date)) return invalid("date", "Enter a real date (YYYY-MM-DD).");
  const payee = typeof d.payee === "string" ? cleanText(d.payee) : "";
  if (payee === "") return invalid("payee", "Enter a payee.");
  if (payee.length > PAYEE_MAX) return invalid("payee", `A payee can be at most ${PAYEE_MAX} characters.`);
  if (!isValidMinor(d.amount)) return invalid("amount", "Enter an amount in whole cents.");
  if (d.amount === 0) return invalid("amount", "An amount cannot be zero.");
  const category = typeof d.category === "string" ? cleanText(d.category) : "";
  if (category.length > CATEGORY_NAME_MAX) return invalid("category", `A category name can be at most ${CATEGORY_NAME_MAX} characters.`);
  const note = typeof d.note === "string" ? d.note.trim() : "";
  if (note.length > NOTE_MAX) return invalid("note", `A note can be at most ${NOTE_MAX} characters.`);
  return { ok: true, value: { date: d.date, payee, amount: d.amount, category, note } };
}

/** Date descending; on the same date, the one added later comes first. */
export function newestFirst(transactions: readonly Transaction[]): Transaction[] {
  return transactions
    .map((t, index) => ({ t, index }))
    .sort((a, b) => (a.t.date === b.t.date ? b.index - a.index : a.t.date < b.t.date ? 1 : -1))
    .map(({ t }) => t);
}

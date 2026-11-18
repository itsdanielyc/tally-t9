// Category names and payee rules.
import type { Category, LedgerError, Rule } from "../contracts/ledger.ts";
import { CATEGORY_NAME_MAX, cleanText } from "./transactions.ts";

export const RULE_TEXT_MAX = 100;

type Checked = { ok: true; value: string } | { ok: false; error: LedgerError };

/** A category name: trimmed, 1 to 60 characters, unique ignoring case (except for the category being renamed). */
export function checkCategoryName(name: unknown, categories: readonly Category[], exceptId?: string): Checked {
  const value = typeof name === "string" ? cleanText(name) : "";
  if (value === "") return { ok: false, error: { code: "invalid", field: "name", message: "Enter a category name." } };
  if (value.length > CATEGORY_NAME_MAX) {
    return { ok: false, error: { code: "invalid", field: "name", message: `A category name can be at most ${CATEGORY_NAME_MAX} characters.` } };
  }
  const key = value.toLocaleLowerCase();
  const clash = categories.find((c) => c.id !== exceptId && c.name.toLocaleLowerCase() === key);
  if (clash) {
    return { ok: false, error: { code: "conflict", field: "name", message: `There is already a category called ${clash.name}. Merge them instead.` } };
  }
  return { ok: true, value };
}

/** The text a rule looks for: trimmed, 1 to 100 characters. */
export function checkRuleText(contains: unknown): Checked {
  const value = typeof contains === "string" ? cleanText(contains) : "";
  if (value === "") return { ok: false, error: { code: "invalid", field: "contains", message: "Enter the text the payee contains." } };
  if (value.length > RULE_TEXT_MAX) {
    return { ok: false, error: { code: "invalid", field: "contains", message: `Rule text can be at most ${RULE_TEXT_MAX} characters.` } };
  }
  return { ok: true, value };
}

/** The category of the first rule whose text the payee contains, ignoring case; null when none matches. */
export function categoryFor(payee: string, rules: readonly Rule[]): string | null {
  const p = cleanText(payee).toLocaleLowerCase();
  for (const r of rules) if (p.includes(r.contains.toLocaleLowerCase())) return r.categoryId;
  return null;
}

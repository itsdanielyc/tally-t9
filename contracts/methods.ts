// The method lists the preload exposes and the main process registers, one
// IPC channel per name. The type checks below fail compilation when a
// method is added to an interface in contracts/ledger.ts but not here.
import type { LedgerApi, PlatformApi } from "./ledger.ts";

export const ledgerMethods = [
  "getLedger",
  "listTransactions",
  "addTransaction",
  "updateTransaction",
  "deleteTransaction",
  "setCurrency",
  "inspectImport",
  "previewImport",
  "commitImport",
  "createCategory",
  "renameCategory",
  "deleteCategory",
  "mergeCategories",
  "createRule",
  "deleteRule",
  "applyRules",
] as const satisfies readonly (keyof LedgerApi)[];

export const platformMethods = ["platformInfo", "chooseImportFile"] as const satisfies readonly (keyof PlatformApi)[];

export type LedgerMethod = (typeof ledgerMethods)[number];
export type PlatformMethod = (typeof platformMethods)[number];

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const ledgerMethodsComplete: Exact<LedgerMethod, keyof LedgerApi> = true;
export const platformMethodsComplete: Exact<PlatformMethod, keyof PlatformApi> = true;

/** The IPC channel for a method. */
export function channelFor(method: LedgerMethod | PlatformMethod): string {
  return `tally:${method}`;
}

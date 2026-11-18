// The contract between the UI and the ledger backend. Every type that
// crosses the preload bridge is declared here, and the method list in
// contracts/methods.ts is what the preload exposes and the main process
// registers. The labelled mock (src/api.ts) and the main process both serve
// `LedgerApi` from core/service.ts; the contract suite (tests/contract)
// holds them to the same answers.
//
// Money is always an integer number of minor units (cents): `amount` is
// negative for spending and positive for income. Dates are YYYY-MM-DD.

export type Transaction = {
  id: string;
  /** YYYY-MM-DD, a real calendar date */
  date: string;
  payee: string;
  /** integer minor units; negative is spending, positive is income, never 0 */
  amount: number;
  categoryId: string | null;
  note: string;
};

/** What the transaction form sends. `category` is a name; "" means none. */
export type TransactionDraft = {
  date: string;
  payee: string;
  amount: number;
  category: string;
  note: string;
};

export type Category = { id: string; name: string };

/** Currencies with two minor digits; changing it relabels, never converts. */
export const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "NZD", "CHF", "SEK", "NOK", "DKK", "PLN", "INR"] as const;
export type Currency = (typeof CURRENCIES)[number];

export type Settings = { currency: Currency };

export type StorageInfo = {
  kind: "file" | "memory";
  /** the ledger file's path, or null for the in-memory mock */
  location: string | null;
  /** set when opening had to recover (backup used, unreadable file kept aside) */
  recovered: string | null;
};

export type LedgerView = {
  settings: Settings;
  /** sorted by name, case-insensitive */
  categories: Category[];
  transactionCount: number;
  storage: StorageInfo;
};

export type ErrorCode = "invalid" | "not_found" | "conflict" | "io";
export type LedgerError = { code: ErrorCode; message: string; field?: string };
export type Result<T> = { ok: true; value: T } | { ok: false; error: LedgerError };

/** Served by core/service.ts in both the main process and the mock. */
export interface LedgerApi {
  getLedger(): Promise<LedgerView>;
  /** newest first: date descending, then most recently added first */
  listTransactions(): Promise<Transaction[]>;
  addTransaction(draft: TransactionDraft): Promise<Result<Transaction>>;
  updateTransaction(id: string, draft: TransactionDraft): Promise<Result<Transaction>>;
  deleteTransaction(id: string): Promise<Result<null>>;
  setCurrency(currency: string): Promise<Result<Settings>>;
}

export type PlatformInfo = {
  /** process.platform in the main process: win32 | darwin | linux */
  os: string;
  /** process.arch in the main process: x64 | arm64 */
  arch: string;
  /** process.versions.electron */
  electron: string;
  /** app.isPackaged: false when launched from the build output, true when installed */
  packaged: boolean;
};

/** Served by the main process (and imitated by the mock): the OS side. */
export interface PlatformApi {
  platformInfo(): Promise<PlatformInfo>;
}

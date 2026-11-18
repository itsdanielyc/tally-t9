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

/** "Payee contains this text, use this category." Matching ignores case; the first rule created wins. */
export type Rule = { id: string; contains: string; categoryId: string };

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
  /** in the order they were created, which is the order they are tried */
  rules: Rule[];
  /** monthly budget per category id, in minor units (positive) */
  budgets: Record<string, number>;
  transactionCount: number;
  storage: StorageInfo;
};

// ---- Monthly summary and budgets (slice 4) ----

export type CategoryMonth = {
  /** null is the "Uncategorised" row */
  categoryId: string | null;
  name: string;
  /** sum of the positive amounts */
  income: number;
  /** sum of the negative amounts, as a positive number */
  spending: number;
  /** income minus spending: the sum of every amount in the category this month */
  net: number;
  /** the category's monthly budget, or null when it has none */
  budget: number | null;
  /** budget minus what was spent (spent = -net, so refunds reduce it); negative means over; null without a budget */
  left: number | null;
};

export type MonthSummary = {
  /** YYYY-MM */
  month: string;
  income: number;
  spending: number;
  /** income minus spending: the sum of every amount shown */
  net: number;
  /** every category with a transaction or a budget this month, by name, then Uncategorised */
  categories: CategoryMonth[];
  /** the month's transactions, newest first; the totals are their sums */
  transactions: Transaction[];
};

export type ErrorCode = "invalid" | "not_found" | "conflict" | "io";
export type LedgerError = { code: ErrorCode; message: string; field?: string };
export type Result<T> = { ok: true; value: T } | { ok: false; error: LedgerError };

// ---- Import (slice 2) ----

export type Delimiter = "," | ";" | "\t" | "|";
/** The order of day, month and year in the file's dates. */
export type DateOrder = "YMD" | "DMY" | "MDY";

/** Columns are 0-based indexes into each row. */
export type AmountMapping =
  | { kind: "signed"; column: number }
  /** debit is money out (stored negative), credit is money in (stored positive) */
  | { kind: "debitCredit"; debit: number; credit: number };

export type ImportMapping = {
  delimiter: Delimiter;
  hasHeader: boolean;
  date: number;
  payee: number;
  amount: AmountMapping;
  dateOrder: DateOrder;
  decimal: "." | ",";
};

export type ImportInspection = {
  delimiter: Delimiter;
  hasHeader: boolean;
  /** header names, or "Column 1", "Column 2", ... when there is no header */
  columns: string[];
  /** rows after the header, not counting blank lines */
  rowCount: number;
  /** the best guess at a mapping; the person can change every field */
  suggested: ImportMapping;
};

export type ImportRejection = { line: number; reason: string };

export type ImportPreviewRow = {
  line: number;
  date: string;
  payee: string;
  amount: number;
  /** "duplicate": identical in date, amount and payee to a transaction already in the ledger; skipped */
  status: "new" | "duplicate";
  /** the category a rule gives the row, or null */
  categoryId: string | null;
};

export type ImportPreview = {
  /** the first rows that can be read, as they will be imported */
  rows: ImportPreviewRow[];
  /** rows that will be added */
  accepted: number;
  /** rows skipped as duplicates */
  duplicates: number;
  /** rows that cannot be read, with line number and reason */
  rejected: ImportRejection[];
};

export type ImportOutcome = { imported: number; duplicates: number; rejected: ImportRejection[] };

/** A file the person picked: its name and decoded text. */
export type ImportFile = { name: string; text: string };

/** Served by core/service.ts in both the main process and the mock. */
export interface LedgerApi {
  getLedger(): Promise<LedgerView>;
  /** newest first: date descending, then most recently added first */
  listTransactions(): Promise<Transaction[]>;
  addTransaction(draft: TransactionDraft): Promise<Result<Transaction>>;
  updateTransaction(id: string, draft: TransactionDraft): Promise<Result<Transaction>>;
  deleteTransaction(id: string): Promise<Result<null>>;
  setCurrency(currency: string): Promise<Result<Settings>>;
  /** Detects the delimiter, the header and a suggested mapping; the options override detection. */
  inspectImport(text: string, options?: { delimiter?: Delimiter; hasHeader?: boolean }): Promise<Result<ImportInspection>>;
  previewImport(text: string, mapping: ImportMapping): Promise<Result<ImportPreview>>;
  /** Adds every accepted row in one save, or nothing. Rules give imported rows their category. */
  commitImport(text: string, mapping: ImportMapping): Promise<Result<ImportOutcome>>;
  createCategory(name: string): Promise<Result<Category>>;
  /** A name already used by another category is a conflict; merge instead. */
  renameCategory(id: string, name: string): Promise<Result<Category>>;
  /** Its transactions become uncategorised and its rules are removed. */
  deleteCategory(id: string): Promise<Result<{ uncategorised: number }>>;
  /** Moves the source's transactions and rules to the target, then removes the source. */
  mergeCategories(sourceId: string, targetId: string): Promise<Result<{ moved: number }>>;
  createRule(contains: string, categoryId: string): Promise<Result<Rule>>;
  deleteRule(id: string): Promise<Result<null>>;
  /** Gives every uncategorised transaction the category of the first rule its payee matches. */
  applyRules(): Promise<Result<{ categorised: number }>>;
  monthSummary(month: string): Promise<Result<MonthSummary>>;
  /** A positive amount sets the category's monthly budget; null or 0 removes it. */
  setBudget(categoryId: string, amount: number | null): Promise<Result<{ categoryId: string; amount: number | null }>>;
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
  /** Shows the open-file dialog for a CSV; null when the person cancels. */
  chooseImportFile(): Promise<Result<ImportFile | null>>;
}

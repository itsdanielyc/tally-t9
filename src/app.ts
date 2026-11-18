// The app shell: navigation between screens and the shared context every
// screen gets (the backend and the current ledger view).
import type { Backend, LedgerView } from "./api.ts";

export type ScreenName = "transactions" | "import" | "categories" | "month" | "settings";

export type AppContext = {
  readonly backend: Backend;
  /** the latest ledger view; refreshed after every change */
  ledger: LedgerView;
  refresh(): Promise<void>;
  navigate(screen: ScreenName): void;
};

export type Screen = (root: HTMLElement, ctx: AppContext) => Promise<void>;

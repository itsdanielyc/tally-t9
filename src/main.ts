// Starts the renderer: the backend badge, the recovery notice, navigation
// and the first screen.
import { backend } from "./api.ts";
import type { AppContext, Screen, ScreenName } from "./app.ts";
import { categoriesScreen } from "./screens/categories.ts";
import { importScreen } from "./screens/import.ts";
import { settingsScreen } from "./screens/settings.ts";
import { transactionsScreen } from "./screens/transactions.ts";

const screens: Record<ScreenName, Screen> = {
  transactions: transactionsScreen,
  import: importScreen,
  categories: categoriesScreen,
  settings: settingsScreen,
};

async function start(): Promise<void> {
  const root = document.querySelector<HTMLElement>("#screen")!;
  const badge = document.querySelector<HTMLElement>("[data-testid=backend-badge]")!;
  const platform = document.querySelector<HTMLElement>("[data-testid=platform]")!;
  const notice = document.querySelector<HTMLElement>("#notice")!;
  const navButtons = [...document.querySelectorAll<HTMLButtonElement>("nav button[data-screen]")];

  badge.textContent = backend.kind;
  badge.dataset.kind = backend.kind;

  const ctx: AppContext = {
    backend,
    ledger: await backend.getLedger(),
    async refresh() {
      ctx.ledger = await backend.getLedger();
    },
    navigate(name) {
      for (const b of navButtons) {
        if (b.dataset.screen === name) b.setAttribute("aria-current", "page");
        else b.removeAttribute("aria-current");
      }
      void screens[name](root, ctx);
    },
  };

  if (ctx.ledger.storage.recovered) {
    notice.textContent = ctx.ledger.storage.recovered;
    notice.hidden = false;
  }
  for (const b of navButtons) b.addEventListener("click", () => ctx.navigate(b.dataset.screen as ScreenName));
  ctx.navigate("transactions");

  const info = await backend.platformInfo();
  platform.textContent = `${info.os} / ${info.arch}`;
}

window.addEventListener("DOMContentLoaded", () => void start());

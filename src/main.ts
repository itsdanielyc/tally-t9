// Starts the renderer: the backend badge, the recovery notice, the undo
// bar, navigation and the first screen.
import { backend } from "./api.ts";
import type { AppContext, Screen, ScreenName } from "./app.ts";
import { categoriesScreen } from "./screens/categories.ts";
import { importScreen } from "./screens/import.ts";
import { monthScreen } from "./screens/month.ts";
import { settingsScreen } from "./screens/settings.ts";
import { transactionsScreen } from "./screens/transactions.ts";

const screens: Record<ScreenName, Screen> = {
  transactions: transactionsScreen,
  import: importScreen,
  categories: categoriesScreen,
  month: monthScreen,
  settings: settingsScreen,
};

async function start(): Promise<void> {
  const root = document.querySelector<HTMLElement>("#screen")!;
  const badge = document.querySelector<HTMLElement>("[data-testid=backend-badge]")!;
  const platform = document.querySelector<HTMLElement>("[data-testid=platform]")!;
  const notice = document.querySelector<HTMLElement>("#notice")!;
  const undoBar = document.querySelector<HTMLElement>("#undo-bar")!;
  const undoLabel = document.querySelector<HTMLElement>("#undo-label")!;
  const undoButton = document.querySelector<HTMLButtonElement>("#undo-button")!;
  const navButtons = [...document.querySelectorAll<HTMLButtonElement>("nav button[data-screen]")];
  let current: ScreenName = "transactions";
  /** "Undone: ..." stays until the next change or the next section. */
  let undoneMessage: string | null = null;

  badge.textContent = backend.kind;
  badge.dataset.kind = backend.kind;

  /** The bar offers to undo the most recent delete, merge or import while that is still possible. */
  function renderUndo(): void {
    const undo = ctx.ledger.undo;
    if (undo) {
      undoneMessage = null;
      undoLabel.textContent = `${undo.label}.`;
      undoButton.hidden = false;
      undoBar.hidden = false;
    } else if (undoneMessage) {
      undoLabel.textContent = undoneMessage;
      undoButton.hidden = true;
      undoBar.hidden = false;
    } else {
      undoBar.hidden = true;
    }
  }

  const ctx: AppContext = {
    backend,
    ledger: await backend.getLedger(),
    async refresh() {
      ctx.ledger = await backend.getLedger();
      renderUndo();
    },
    navigate(name) {
      current = name;
      for (const b of navButtons) {
        if (b.dataset.screen === name) b.setAttribute("aria-current", "page");
        else b.removeAttribute("aria-current");
      }
      void screens[name](root, ctx);
    },
  };

  undoButton.addEventListener("click", async () => {
    const r = await backend.undo();
    ctx.ledger = await backend.getLedger();
    undoneMessage = r.ok ? `Undone: ${r.value.undone}.` : r.error.message;
    renderUndo();
    ctx.navigate(current);
  });

  if (ctx.ledger.storage.recovered) {
    notice.textContent = ctx.ledger.storage.recovered;
    notice.hidden = false;
  }
  for (const b of navButtons) {
    b.addEventListener("click", () => {
      undoneMessage = null;
      renderUndo();
      ctx.navigate(b.dataset.screen as ScreenName);
    });
  }
  renderUndo();
  ctx.navigate("transactions");

  const info = await backend.platformInfo();
  platform.textContent = `${info.os} / ${info.arch}`;
}

window.addEventListener("DOMContentLoaded", () => void start());

// The Settings screen: the ledger's one currency and where the ledger lives.
import { CURRENCIES } from "../../contracts/ledger.ts";
import type { Screen } from "../app.ts";
import { clear, h } from "../ui/dom.ts";

export const settingsScreen: Screen = async (root, ctx) => {
  const status = h("p", { class: "status", role: "status", "aria-live": "polite", "data-testid": "settings-status" });
  const currency = h(
    "select",
    { id: "currency", name: "currency", onchange: () => void change() },
    CURRENCIES.map((code) => h("option", { value: code }, code)),
  );
  currency.value = ctx.ledger.settings.currency;
  const storage = ctx.ledger.storage;

  clear(root);
  root.append(
    h("h1", { "data-geo": "heading" }, "Settings"),
    h(
      "section",
      { class: "card", "data-geo": "settings-currency", "aria-labelledby": "currency-title" },
      h("h2", { id: "currency-title" }, "Currency"),
      h("div", { class: "field" }, h("label", { for: "currency" }, "Currency for every amount"), currency),
      h(
        "p",
        { class: "hint" },
        "Amounts are kept in whole cents. Changing the currency relabels every amount; it never converts them.",
      ),
      status,
    ),
    h(
      "section",
      { class: "card", "data-geo": "settings-storage", "aria-labelledby": "storage-title" },
      h("h2", { id: "storage-title" }, "Ledger file"),
      h(
        "p",
        { "data-testid": "ledger-location", class: "path" },
        storage.kind === "file" ? storage.location : "In-memory mock ledger: nothing is saved to disk.",
      ),
      h("p", { class: "hint" }, "Everything Tally records stays in this one file on this computer."),
    ),
  );

  async function change(): Promise<void> {
    const result = await ctx.backend.setCurrency(currency.value);
    if (!result.ok) {
      status.textContent = result.error.message;
      currency.value = ctx.ledger.settings.currency;
      return;
    }
    await ctx.refresh();
    status.textContent = `Currency set to ${result.value.currency}.`;
  }
};

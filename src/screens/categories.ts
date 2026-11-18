// The Categories screen: create, rename, merge and delete categories, and
// the payee rules that sort imported rows (and, on request, every
// uncategorised transaction).
import type { Category, Transaction } from "../api.ts";
import type { Screen } from "../app.ts";
import { clear, h } from "../ui/dom.ts";

type Mode = { kind: "rename" | "merge" | "delete"; id: string } | null;

export const categoriesScreen: Screen = async (root, ctx) => {
  let transactions: Transaction[] = [];
  let mode: Mode = null;

  const catStatus = h("p", { class: "status", role: "status", "aria-live": "polite", "data-testid": "categories-status" });
  const catError = h("p", { class: "error", role: "alert", "data-testid": "categories-error" });
  const ruleStatus = h("p", { class: "status", role: "status", "aria-live": "polite", "data-testid": "rules-status" });
  const ruleError = h("p", { class: "error", role: "alert", "data-testid": "rules-error" });
  const newName = h("input", { id: "new-category", autocomplete: "off", maxlength: 60 });
  const catBody = h("tbody");
  const catTable = h(
    "table",
    { class: "tx-table", "aria-label": "Categories" },
    h(
      "thead",
      {},
      h("tr", {}, h("th", { scope: "col" }, "Name"), h("th", { scope: "col", class: "num col-count" }, "Transactions"), h("th", { scope: "col", class: "col-cat-actions" }, h("span", { class: "sr-only" }, "Actions"))),
    ),
    catBody,
  );
  const catEmpty = h("p", { class: "empty" }, "No categories yet.");
  const ruleText = h("input", { id: "rule-contains", autocomplete: "off", maxlength: 100 });
  const ruleCategory = h("select", { id: "rule-category" });
  const ruleBody = h("tbody");
  const ruleTable = h(
    "table",
    { class: "tx-table", "aria-label": "Rules" },
    h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Payee contains"), h("th", { scope: "col" }, "Category"), h("th", { scope: "col", class: "col-actions" }, h("span", { class: "sr-only" }, "Actions")))),
    ruleBody,
  );
  const ruleEmpty = h("p", { class: "empty" }, "No rules yet.");

  clear(root);
  root.append(
    h("h1", { "data-geo": "heading" }, "Categories"),
    h(
      "section",
      { class: "card", "data-geo": "categories", "aria-labelledby": "categories-title" },
      h("h2", { id: "categories-title" }, "Categories"),
      h(
        "form",
        { class: "inline-form", "aria-label": "New category", onsubmit: (e: Event) => void create(e) },
        h("div", { class: "field grow" }, h("label", { for: "new-category" }, "New category name"), newName),
        h("button", { type: "submit", class: "primary" }, "Add category"),
      ),
      catError,
      catStatus,
      catTable,
      catEmpty,
    ),
    h(
      "section",
      { class: "card", "data-geo": "rules", "aria-labelledby": "rules-title" },
      h("h2", { id: "rules-title" }, "Rules"),
      h("p", { class: "hint first" }, "A rule gives a category to imported rows whose payee contains its text. When several match, the first rule wins."),
      h(
        "form",
        { class: "inline-form", "aria-label": "New rule", onsubmit: (e: Event) => void addRule(e) },
        h("div", { class: "field grow" }, h("label", { for: "rule-contains" }, "Payee contains"), ruleText),
        h("div", { class: "field" }, h("label", { for: "rule-category" }, "Category"), ruleCategory),
        h("button", { type: "submit", class: "primary" }, "Add rule"),
      ),
      ruleError,
      ruleTable,
      ruleEmpty,
      h("div", { class: "actions spaced" }, h("button", { type: "button", onclick: () => void apply() }, "Apply rules to uncategorised transactions")),
      ruleStatus,
    ),
  );

  const nameOf = (id: string) => ctx.ledger.categories.find((c) => c.id === id)?.name ?? "";
  const countOf = (id: string) => transactions.filter((t) => t.categoryId === id).length;

  function render(): void {
    const cats = ctx.ledger.categories;
    clear(catBody);
    for (const c of cats) catBody.append(categoryRow(c));
    catTable.hidden = cats.length === 0;
    catEmpty.hidden = cats.length !== 0;

    const chosen = ruleCategory.value;
    clear(ruleCategory);
    for (const c of cats) ruleCategory.append(h("option", { value: c.id }, c.name));
    if (cats.some((c) => c.id === chosen)) ruleCategory.value = chosen;

    clear(ruleBody);
    for (const r of ctx.ledger.rules) {
      ruleBody.append(
        h(
          "tr",
          { "data-id": r.id },
          h("td", {}, r.contains),
          h("td", {}, nameOf(r.categoryId)),
          h("td", { class: "col-actions" }, h("button", { type: "button", "aria-label": `Delete rule ${r.contains}`, onclick: () => void removeRule(r.id) }, "Delete")),
        ),
      );
    }
    ruleTable.hidden = ctx.ledger.rules.length === 0;
    ruleEmpty.hidden = ctx.ledger.rules.length !== 0;
  }

  function categoryRow(c: Category): HTMLElement {
    const count = countOf(c.id);
    const cancel = h("button", { type: "button", onclick: () => setMode(null) }, "Cancel");
    let nameCell: HTMLElement = h("td", {}, c.name);
    let actions: HTMLElement[];
    if (mode?.id === c.id && mode.kind === "rename") {
      const input = h("input", { "aria-label": `New name for ${c.name}`, value: c.name, maxlength: 60 });
      nameCell = h("td", {}, input);
      actions = [h("button", { type: "button", class: "primary", onclick: () => void rename(c, input.value) }, "Save"), cancel];
      queueMicrotask(() => input.focus());
    } else if (mode?.id === c.id && mode.kind === "merge") {
      const others = ctx.ledger.categories.filter((o) => o.id !== c.id);
      const target = h("select", { "aria-label": `Merge ${c.name} into` }, others.map((o) => h("option", { value: o.id }, o.name)));
      actions = [h("span", { class: "inline-label" }, "into"), target, h("button", { type: "button", class: "primary", onclick: () => void merge(c, target.value) }, "Merge"), cancel];
    } else if (mode?.id === c.id && mode.kind === "delete") {
      actions = [
        h("button", { type: "button", class: "danger", "aria-label": `Confirm delete ${c.name}` , onclick: () => void remove(c) }, "Confirm delete"),
        h("button", { type: "button", "aria-label": `Keep ${c.name}`, onclick: () => setMode(null) }, "Keep"),
      ];
    } else {
      actions = [
        h("button", { type: "button", "aria-label": `Rename ${c.name}`, onclick: () => setMode({ kind: "rename", id: c.id }) }, "Rename"),
        h("button", { type: "button", "aria-label": `Merge ${c.name}`, disabled: ctx.ledger.categories.length < 2, onclick: () => setMode({ kind: "merge", id: c.id }) }, "Merge…"),
        h("button", { type: "button", "aria-label": `Delete ${c.name}`, onclick: () => setMode({ kind: "delete", id: c.id }) }, "Delete"),
      ];
    }
    return h(
      "tr",
      { "data-id": c.id },
      nameCell,
      h("td", { class: "num col-count" }, count),
      h("td", { class: "col-cat-actions" }, actions),
    );
  }

  function setMode(m: Mode): void {
    mode = m;
    catError.textContent = "";
    if (m?.kind === "delete") {
      const n = countOf(m.id);
      catStatus.textContent = `Deleting ${nameOf(m.id)} leaves ${n} transaction${n === 1 ? "" : "s"} uncategorised and removes its rules.`;
    }
    render();
  }

  async function reload(): Promise<void> {
    await ctx.refresh();
    transactions = await ctx.backend.listTransactions();
    render();
  }

  async function create(e: Event): Promise<void> {
    e.preventDefault();
    const r = await ctx.backend.createCategory(newName.value);
    if (!r.ok) {
      catError.textContent = r.error.message;
      return;
    }
    newName.value = "";
    catError.textContent = "";
    catStatus.textContent = `Added ${r.value.name}.`;
    await reload();
  }

  async function rename(c: Category, name: string): Promise<void> {
    const r = await ctx.backend.renameCategory(c.id, name);
    if (!r.ok) {
      catError.textContent = r.error.message;
      return;
    }
    mode = null;
    catError.textContent = "";
    catStatus.textContent = `Renamed ${c.name} to ${r.value.name}.`;
    await reload();
  }

  async function merge(c: Category, targetId: string): Promise<void> {
    const target = nameOf(targetId);
    const r = await ctx.backend.mergeCategories(c.id, targetId);
    if (!r.ok) {
      catError.textContent = r.error.message;
      return;
    }
    mode = null;
    catStatus.textContent = `Merged ${c.name} into ${target}: ${r.value.moved} transaction${r.value.moved === 1 ? "" : "s"} moved.`;
    await reload();
  }

  async function remove(c: Category): Promise<void> {
    const r = await ctx.backend.deleteCategory(c.id);
    if (!r.ok) {
      catError.textContent = r.error.message;
      return;
    }
    mode = null;
    catStatus.textContent = `Deleted ${c.name}: ${r.value.uncategorised} transaction${r.value.uncategorised === 1 ? "" : "s"} now uncategorised.`;
    await reload();
  }

  async function addRule(e: Event): Promise<void> {
    e.preventDefault();
    if (!ruleCategory.value) {
      ruleError.textContent = "Add a category first.";
      return;
    }
    const r = await ctx.backend.createRule(ruleText.value, ruleCategory.value);
    if (!r.ok) {
      ruleError.textContent = r.error.message;
      return;
    }
    ruleText.value = "";
    ruleError.textContent = "";
    ruleStatus.textContent = `Added the rule for "${r.value.contains}".`;
    await reload();
  }

  async function removeRule(id: string): Promise<void> {
    const r = await ctx.backend.deleteRule(id);
    ruleStatus.textContent = r.ok ? "Rule deleted." : r.error.message;
    await reload();
  }

  async function apply(): Promise<void> {
    const r = await ctx.backend.applyRules();
    ruleStatus.textContent = r.ok ? `Categorised ${r.value.categorised} transaction${r.value.categorised === 1 ? "" : "s"}.` : r.error.message;
    await reload();
  }

  await reload();
};

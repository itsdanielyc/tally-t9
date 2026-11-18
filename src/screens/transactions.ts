// The Transactions screen: the add/edit form and the newest-first list.
import type { Transaction, TransactionDraft } from "../api.ts";
import type { Screen } from "../app.ts";
import { localToday } from "../../core/dates.ts";
import { formatAmount, formatMagnitude, parseFormAmount } from "../../core/money.ts";
import { clear, h } from "../ui/dom.ts";

export const transactionsScreen: Screen = async (root, ctx) => {
  let editing: Transaction | null = null;
  let confirming: string | null = null;
  let transactions: Transaction[] = [];

  const status = h("p", { class: "status", role: "status", "aria-live": "polite", "data-testid": "tx-status" });
  const error = h("p", { class: "error", role: "alert", id: "tx-error" });

  const date = h("input", { id: "tx-date", name: "date", type: "date", required: true, value: localToday() });
  const payee = h("input", { id: "tx-payee", name: "payee", autocomplete: "off", maxlength: 200 });
  const spending = h("input", { type: "radio", name: "kind", value: "spending", id: "tx-kind-spending", checked: true });
  const income = h("input", { type: "radio", name: "kind", value: "income", id: "tx-kind-income" });
  const amount = h("input", { id: "tx-amount", name: "amount", inputmode: "decimal", autocomplete: "off", placeholder: "0.00" });
  const category = h("input", { id: "tx-category", name: "category", list: "tx-category-options", autocomplete: "off", maxlength: 60 });
  const categoryOptions = h("datalist", { id: "tx-category-options" });
  const note = h("input", { id: "tx-note", name: "note", autocomplete: "off", maxlength: 1000 });
  const amountLabel = h("label", { for: "tx-amount" });
  const formTitle = h("h2", { id: "tx-form-title" });
  const submit = h("button", { type: "submit", class: "primary" });
  const cancel = h("button", { type: "button", onclick: () => setEditing(null) }, "Cancel");
  const fields: Record<string, HTMLElement> = { date, payee, amount, category, note };

  const form = h(
    "form",
    { class: "tx-form", "aria-labelledby": "tx-form-title", novalidate: true, onsubmit: (e: Event) => void onSubmit(e) },
    h("div", { class: "field" }, h("label", { for: "tx-date" }, "Date"), date),
    h("div", { class: "field grow" }, h("label", { for: "tx-payee" }, "Payee"), payee),
    h(
      "div",
      { class: "field kind", role: "radiogroup", "aria-labelledby": "tx-kind-label" },
      h("span", { class: "label", id: "tx-kind-label" }, "Type"),
      h(
        "div",
        { class: "radios" },
        h("label", { for: "tx-kind-spending" }, spending, " Spending"),
        h("label", { for: "tx-kind-income" }, income, " Income"),
      ),
    ),
    h("div", { class: "field" }, amountLabel, amount),
    h("div", { class: "field" }, h("label", { for: "tx-category" }, "Category"), category, categoryOptions),
    h("div", { class: "field grow" }, h("label", { for: "tx-note" }, "Note"), note),
    h("div", { class: "actions" }, submit, cancel),
    error,
  );

  const tbody = h("tbody");
  const amountHeader = h("th", { scope: "col", class: "num" });
  const table = h(
    "table",
    { class: "tx-table", "aria-label": "Transactions, newest first" },
    h(
      "thead",
      {},
      h(
        "tr",
        {},
        h("th", { scope: "col", class: "col-date" }, "Date"),
        h("th", { scope: "col" }, "Payee"),
        h("th", { scope: "col" }, "Category"),
        h("th", { scope: "col" }, "Note"),
        amountHeader,
        h("th", { scope: "col", class: "col-actions" }, h("span", { class: "sr-only" }, "Actions")),
      ),
    ),
    tbody,
  );
  const empty = h("p", { class: "empty" }, "No transactions yet. Add one above.");

  clear(root);
  root.append(
    h("h1", { "data-geo": "heading" }, "Transactions"),
    h("section", { class: "card", "data-geo": "tx-form" }, formTitle, form),
    h("section", { class: "list", "aria-label": "Transaction list", "data-geo": "tx-list" }, status, table, empty),
  );

  function categoryName(id: string | null): string {
    return id ? (ctx.ledger.categories.find((c) => c.id === id)?.name ?? "") : "";
  }

  function setEditing(t: Transaction | null): void {
    editing = t;
    confirming = null;
    showError(null);
    if (t) {
      date.value = t.date;
      payee.value = t.payee;
      (t.amount < 0 ? spending : income).checked = true;
      amount.value = formatMagnitude(t.amount);
      category.value = categoryName(t.categoryId);
      note.value = t.note;
      payee.focus();
    } else {
      resetForm(true);
    }
    renderChrome();
    renderRows();
  }

  function resetForm(full: boolean): void {
    payee.value = "";
    amount.value = "";
    category.value = "";
    note.value = "";
    if (full) {
      date.value = localToday();
      spending.checked = true;
    }
  }

  function showError(message: string | null, field?: string): void {
    error.textContent = message ?? "";
    for (const [name, el] of Object.entries(fields)) {
      if (name === field) el.setAttribute("aria-invalid", "true");
      else el.removeAttribute("aria-invalid");
    }
    if (field && fields[field]) fields[field].focus();
  }

  function renderChrome(): void {
    const currency = ctx.ledger.settings.currency;
    formTitle.textContent = editing ? "Edit transaction" : "Add a transaction";
    submit.textContent = editing ? "Save changes" : "Add";
    cancel.hidden = !editing;
    amountLabel.textContent = `Amount (${currency})`;
    amountHeader.textContent = `Amount (${currency})`;
    clear(categoryOptions);
    for (const c of ctx.ledger.categories) categoryOptions.append(h("option", { value: c.name }));
  }

  function renderRows(): void {
    clear(tbody);
    for (const t of transactions) {
      const label = `${t.payee} on ${t.date}`;
      const actions =
        confirming === t.id
          ? [
              h("button", { type: "button", class: "danger", "aria-label": `Confirm delete ${label}`, onclick: () => void remove(t) }, "Confirm delete"),
              h("button", { type: "button", "aria-label": `Keep ${label}`, onclick: () => { confirming = null; renderRows(); } }, "Keep"),
            ]
          : [
              h("button", { type: "button", "aria-label": `Edit ${label}`, onclick: () => setEditing(t) }, "Edit"),
              h("button", { type: "button", "aria-label": `Delete ${label}`, onclick: () => { confirming = t.id; renderRows(); } }, "Delete"),
            ];
      tbody.append(
        h(
          "tr",
          { "data-id": t.id, class: editing?.id === t.id ? "editing" : null },
          h("td", { class: "col-date" }, t.date),
          h("td", {}, t.payee),
          h("td", {}, categoryName(t.categoryId)),
          h("td", { class: "note" }, t.note),
          h("td", { class: `num ${t.amount < 0 ? "neg" : "pos"}` }, formatAmount(t.amount)),
          h("td", { class: "col-actions" }, actions),
        ),
      );
    }
    table.hidden = transactions.length === 0;
    empty.hidden = transactions.length !== 0;
  }

  async function reload(): Promise<void> {
    await ctx.refresh();
    transactions = await ctx.backend.listTransactions();
    renderChrome();
    renderRows();
  }

  async function onSubmit(e: Event): Promise<void> {
    e.preventDefault();
    const parsed = parseFormAmount(amount.value);
    if (!parsed.ok) return showError(`Amount: ${parsed.reason}.`, "amount");
    if (parsed.minor === 0) return showError("An amount cannot be zero.", "amount");
    if (parsed.minor < 0) return showError("Enter the amount without a sign; choose Spending or Income.", "amount");
    const draft: TransactionDraft = {
      date: date.value,
      payee: payee.value,
      amount: spending.checked ? -parsed.minor : parsed.minor,
      category: category.value,
      note: note.value,
    };
    const result = editing ? await ctx.backend.updateTransaction(editing.id, draft) : await ctx.backend.addTransaction(draft);
    if (!result.ok) return showError(result.error.message, result.error.field);
    status.textContent = editing ? `Saved ${result.value.payee}.` : `Added ${result.value.payee}.`;
    const wasEditing = editing !== null;
    editing = null;
    showError(null);
    resetForm(wasEditing);
    await reload();
    payee.focus();
  }

  async function remove(t: Transaction): Promise<void> {
    const result = await ctx.backend.deleteTransaction(t.id);
    confirming = null;
    if (!result.ok) {
      status.textContent = result.error.message;
    } else {
      status.textContent = `Deleted ${t.payee}.`;
      if (editing?.id === t.id) setEditing(null);
    }
    await reload();
  }

  setEditing(null);
  await reload();
};


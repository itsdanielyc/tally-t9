// The Month screen: for a chosen month, income against spending, each
// category's total against its budget (with a simple bar), and the month's
// transactions whose sums the totals are. Previous and next month buttons.
import type { CategoryMonth, MonthSummary } from "../api.ts";
import type { Screen } from "../app.ts";
import { addMonths, isValidMonth, localToday, monthLabel, monthOf } from "../../core/dates.ts";
import { formatAmount, formatMagnitude, parseFormAmount } from "../../core/money.ts";
import { clear, h } from "../ui/dom.ts";

let lastMonth: string | null = null;

export const monthScreen: Screen = async (root, ctx) => {
  let month = lastMonth ?? monthOf(localToday());
  let summary: MonthSummary | null = null;
  let editing: string | null = null;

  const status = h("p", { class: "status", role: "status", "aria-live": "polite", "data-testid": "month-status" });
  const error = h("p", { class: "error", role: "alert", "data-testid": "month-error" });
  const title = h("h2", { id: "month-title", class: "month-title" });
  const picker = h("input", { type: "month", id: "month-picker", "aria-label": "Month", onchange: () => void go(picker.value) });
  const totals = h("dl", { class: "totals", "data-geo": "month-totals" });
  const catBody = h("tbody");
  const catTable = h(
    "table",
    { class: "tx-table month-table", "aria-label": "Categories this month" },
    h(
      "thead",
      {},
      h(
        "tr",
        {},
        h("th", { scope: "col" }, "Category"),
        h("th", { scope: "col", class: "num" }, "Total"),
        h("th", { scope: "col", class: "num" }, "Budget"),
        h("th", { scope: "col", class: "num" }, "Left"),
        h("th", { scope: "col", class: "col-bar" }, h("span", { class: "sr-only" }, "Spent of budget")),
        h("th", { scope: "col", class: "col-budget-actions" }, h("span", { class: "sr-only" }, "Actions")),
      ),
    ),
    catBody,
  );
  const catEmpty = h("p", { class: "empty" }, "Nothing recorded this month.");
  const txBody = h("tbody");
  const txTable = h(
    "table",
    { class: "tx-table", "aria-label": "Transactions this month" },
    h(
      "thead",
      {},
      h("tr", {}, h("th", { scope: "col", class: "col-date" }, "Date"), h("th", { scope: "col" }, "Payee"), h("th", { scope: "col" }, "Category"), h("th", { scope: "col", class: "num" }, "Amount")),
    ),
    txBody,
  );

  clear(root);
  root.append(
    h("h1", { "data-geo": "heading" }, "Month"),
    h(
      "div",
      { class: "month-nav", "data-geo": "month-nav" },
      h("button", { type: "button", "aria-label": "Previous month", onclick: () => void go(addMonths(month, -1)) }, "‹ Previous"),
      title,
      h("button", { type: "button", "aria-label": "Next month", onclick: () => void go(addMonths(month, 1)) }, "Next ›"),
      picker,
    ),
    h("section", { class: "card", "aria-labelledby": "month-title" }, totals),
    h(
      "section",
      { class: "card", "data-geo": "month-categories", "aria-labelledby": "month-cat-title" },
      h("h2", { id: "month-cat-title" }, "By category"),
      error,
      catTable,
      catEmpty,
      status,
    ),
    h(
      "section",
      { class: "card", "data-geo": "month-transactions", "aria-labelledby": "month-tx-title" },
      h("h2", { id: "month-tx-title" }, "Transactions this month"),
      txTable,
    ),
  );

  const money = (minor: number) => formatAmount(minor);

  function render(): void {
    if (!summary) return;
    const s = summary;
    const currency = ctx.ledger.settings.currency;
    title.textContent = monthLabel(s.month);
    picker.value = s.month;
    clear(totals);
    for (const [label, value, testid, cls] of [
      ["Income", s.income, "month-income", "pos"],
      ["Spending", s.spending, "month-spending", "neg"],
      ["Net", s.net, "month-net", s.net < 0 ? "neg" : "pos"],
    ] as const) {
      totals.append(h("div", { class: "total" }, h("dt", {}, `${label} (${currency})`), h("dd", { "data-testid": testid, class: cls }, money(value))));
    }
    clear(catBody);
    for (const c of s.categories) catBody.append(categoryRow(c));
    catTable.hidden = s.categories.length === 0;
    catEmpty.hidden = s.categories.length !== 0;
    clear(txBody);
    for (const t of s.transactions) {
      const name = t.categoryId ? (ctx.ledger.categories.find((c) => c.id === t.categoryId)?.name ?? "") : "";
      txBody.append(
        h(
          "tr",
          {},
          h("td", { class: "col-date" }, t.date),
          h("td", {}, t.payee),
          h("td", {}, name),
          h("td", { class: `num ${t.amount < 0 ? "neg" : "pos"}` }, money(t.amount)),
        ),
      );
    }
    txTable.hidden = s.transactions.length === 0;
  }

  function categoryRow(c: CategoryMonth): HTMLElement {
    const spent = -c.net;
    let bar: HTMLElement | string = "";
    if (c.budget !== null) {
      const ratio = Math.max(0, Math.min(1, spent / c.budget));
      const over = c.left !== null && c.left < 0;
      bar = h(
        "div",
        { class: `bar${over ? " over" : ""}`, role: "img", "aria-label": `${Math.round(Math.max(0, spent / c.budget) * 100)}% of budget spent` },
        h("div", { class: "fill", style: `width: ${Math.round(ratio * 100)}%` }),
      );
    }
    let budgetCell: HTMLElement = h("td", { class: "num" }, c.budget === null ? "" : money(c.budget));
    let actions: HTMLElement[] = [];
    if (c.categoryId !== null) {
      const id = c.categoryId;
      if (editing === id) {
        const input = h("input", { "aria-label": `Monthly budget for ${c.name}`, inputmode: "decimal", value: c.budget === null ? "" : formatMagnitude(c.budget) });
        budgetCell = h("td", { class: "num" }, input);
        actions = [
          h("button", { type: "button", class: "primary", onclick: () => void save(id, c.name, input.value) }, "Save"),
          h("button", { type: "button", onclick: () => { editing = null; render(); } }, "Cancel"),
        ];
        queueMicrotask(() => input.focus());
      } else {
        actions = [
          h("button", { type: "button", "aria-label": `${c.budget === null ? "Set" : "Change"} budget for ${c.name}`, onclick: () => { editing = id; error.textContent = ""; render(); } }, c.budget === null ? "Set budget" : "Change"),
        ];
      }
    }
    const leftText = c.left === null ? "" : c.left < 0 ? `${money(-c.left)} over` : money(c.left);
    return h(
      "tr",
      { "data-category": c.categoryId ?? "none" },
      h("td", {}, c.name),
      h("td", { class: `num ${c.net < 0 ? "neg" : "pos"}` }, money(c.net)),
      budgetCell,
      h("td", { class: `num${c.left !== null && c.left < 0 ? " neg" : ""}` }, leftText),
      h("td", { class: "col-bar" }, bar),
      h("td", { class: "col-budget-actions" }, actions),
    );
  }

  async function go(next: string): Promise<void> {
    if (!isValidMonth(next)) return;
    const r = await ctx.backend.monthSummary(next);
    if (!r.ok) {
      error.textContent = r.error.message;
      return;
    }
    month = next;
    lastMonth = next;
    summary = r.value;
    editing = null;
    render();
  }

  async function save(categoryId: string, name: string, text: string): Promise<void> {
    let amount: number | null = null;
    if (text.trim() !== "") {
      const parsed = parseFormAmount(text);
      if (!parsed.ok || parsed.minor < 0) {
        error.textContent = parsed.ok ? "Enter a budget as a positive amount." : `Budget: ${parsed.reason}.`;
        return;
      }
      amount = parsed.minor;
    }
    const r = await ctx.backend.setBudget(categoryId, amount);
    if (!r.ok) {
      error.textContent = r.error.message;
      return;
    }
    error.textContent = "";
    status.textContent = r.value.amount === null ? `Removed the budget for ${name}.` : `Budget for ${name} set to ${money(r.value.amount)}.`;
    await ctx.refresh();
    await go(month);
  }

  await go(month);
};

// The Import screen: pick a bank CSV, match its columns, check the preview
// (rows as they will be imported, duplicates, unreadable rows with line and
// reason), then import every accepted row in one go.
import type { Delimiter, ImportFile, ImportInspection, ImportMapping, ImportPreview } from "../api.ts";
import type { Screen } from "../app.ts";
import { formatAmount } from "../../core/money.ts";
import { append, clear, h } from "../ui/dom.ts";

const DELIMITER_LABELS: [Delimiter, string][] = [
  [",", "Comma ( , )"],
  [";", "Semicolon ( ; )"],
  ["\t", "Tab"],
  ["|", "Pipe ( | )"],
];
const ORDER_LABELS: [ImportMapping["dateOrder"], string][] = [
  ["YMD", "Year-month-day (2026-03-14)"],
  ["DMY", "Day-month-year (14.03.2026)"],
  ["MDY", "Month-day-year (03/14/2026)"],
];
const DECIMAL_LABELS: [ImportMapping["decimal"], string][] = [
  [".", "Point (1,234.56)"],
  [",", "Comma (1.234,56)"],
];

export const importScreen: Screen = async (root, ctx) => {
  let file: ImportFile | null = null;
  let inspection: ImportInspection | null = null;
  let mapping: ImportMapping | null = null;
  let preview: ImportPreview | null = null;

  const status = h("p", { class: "status", role: "status", "aria-live": "polite", "data-testid": "import-status" });
  const error = h("p", { class: "error", role: "alert", "data-testid": "import-error" });
  const fileLabel = h("p", { class: "file-name", "data-testid": "import-file" }, "No file chosen.");
  const choose = h("button", { type: "button", class: "primary", onclick: () => void pick() }, "Choose CSV file…");
  const mappingSection = h("section", { class: "card", "data-geo": "import-mapping", "aria-labelledby": "import-map-title", hidden: true });
  const previewSection = h("section", { class: "card", "data-geo": "import-preview", "aria-labelledby": "import-preview-title", hidden: true });

  clear(root);
  root.append(
    h("h1", { "data-geo": "heading" }, "Import"),
    h(
      "section",
      { class: "card", "data-geo": "import-file", "aria-labelledby": "import-file-title" },
      h("h2", { id: "import-file-title" }, "1. Choose a file"),
      h("p", { class: "hint first" }, "Download a CSV export from your bank's website and choose it here. Nothing is added until you confirm."),
      h("div", { class: "file-row" }, choose, fileLabel),
      status,
    ),
    mappingSection,
    previewSection,
  );

  async function pick(): Promise<void> {
    error.textContent = "";
    const chosen = await ctx.backend.chooseImportFile();
    if (!chosen.ok) {
      error.textContent = chosen.error.message;
      return;
    }
    if (!chosen.value) return; // cancelled: nothing changes
    file = chosen.value;
    status.textContent = "";
    await reinspect({});
  }

  /** Re-reads the file. A new delimiter re-guesses the columns; switching the header keeps the person's choices. */
  async function reinspect(options: { delimiter?: Delimiter; hasHeader?: boolean }, keepMapping = false): Promise<void> {
    if (!file) return;
    const kept = keepMapping ? mapping : null;
    const r = await ctx.backend.inspectImport(file.text, options);
    if (!r.ok) {
      inspection = null;
      mapping = null;
      preview = null;
      fileLabel.textContent = file.name;
      showError(r.error.message);
      render();
      return;
    }
    inspection = r.value;
    mapping = kept ? { ...kept, hasHeader: r.value.hasHeader } : { ...r.value.suggested };
    fileLabel.textContent = `${file.name}: ${r.value.rowCount} row${r.value.rowCount === 1 ? "" : "s"}`;
    await refreshPreview();
  }

  async function refreshPreview(): Promise<void> {
    if (!file || !mapping) return;
    const r = await ctx.backend.previewImport(file.text, mapping);
    preview = r.ok ? r.value : null;
    showError(r.ok ? null : r.error.message);
    render();
  }

  function showError(message: string | null): void {
    error.textContent = message ?? "";
  }

  async function update(patch: Partial<ImportMapping>): Promise<void> {
    if (!mapping) return;
    mapping = { ...mapping, ...patch };
    await refreshPreview();
  }

  function select<T extends string | number>(id: string, label: string, options: [T, string][], value: T, onchange: (v: T) => void): HTMLElement {
    const el = h(
      "select",
      { id, onchange: () => onchange(options[el.selectedIndex][0]) },
      options.map(([v, text]) => h("option", { value: String(v) }, text)),
    );
    el.selectedIndex = Math.max(0, options.findIndex(([v]) => v === value));
    return h("div", { class: "field" }, h("label", { for: id }, label), el);
  }

  function render(): void {
    clear(mappingSection);
    clear(previewSection);
    mappingSection.hidden = !inspection;
    previewSection.hidden = !inspection;
    if (!inspection || !mapping) {
      if (file) root.querySelector("section")?.append(error);
      return;
    }
    const m = mapping;
    const columns: [number, string][] = inspection.columns.map((c, i) => [i, c]);
    const optional: [number, string][] = [[-1, "(none)"], ...columns];
    const amountKind = h(
      "div",
      { class: "field amount-kind", role: "radiogroup", "aria-labelledby": "import-amount-kind" },
      h("span", { class: "label", id: "import-amount-kind" }, "Amounts"),
      h(
        "div",
        { class: "radios" },
        h(
          "label",
          {},
          h("input", {
            type: "radio",
            name: "amount-kind",
            checked: m.amount.kind === "signed",
            onchange: () => void update({ amount: { kind: "signed", column: m.amount.kind === "signed" ? m.amount.column : m.amount.debit } }),
          }),
          " One column, negative is spending",
        ),
        h(
          "label",
          {},
          h("input", {
            type: "radio",
            name: "amount-kind",
            checked: m.amount.kind === "debitCredit",
            onchange: () => {
              const first = m.amount.kind === "signed" ? m.amount.column : m.amount.debit;
              const other = columns.find(([i]) => i !== first && i !== m.date && i !== m.payee)?.[0] ?? first;
              void update({ amount: { kind: "debitCredit", debit: first, credit: other } });
            },
          }),
          " Separate debit and credit columns",
        ),
      ),
    );
    const amountFields =
      m.amount.kind === "signed"
        ? [select("import-amount", "Amount column", columns, m.amount.column, (v) => void update({ amount: { kind: "signed", column: v } }))]
        : [
            select("import-debit", "Debit column (money out)", columns, m.amount.debit, (v) =>
              void update({ amount: { kind: "debitCredit", debit: v, credit: m.amount.kind === "debitCredit" ? m.amount.credit : v } }),
            ),
            select("import-credit", "Credit column (money in)", columns, m.amount.credit, (v) =>
              void update({ amount: { kind: "debitCredit", debit: m.amount.kind === "debitCredit" ? m.amount.debit : v, credit: v } }),
            ),
          ];
    const header = h("input", {
      type: "checkbox",
      id: "import-header",
      checked: m.hasHeader,
      onchange: (e: Event) => void reinspect({ delimiter: m.delimiter, hasHeader: (e.target as HTMLInputElement).checked }, true),
    });
    mappingSection.append(
      h("h2", { id: "import-map-title" }, "2. Match the columns"),
      h(
        "div",
        { class: "map-grid" },
        select("import-delimiter", "Delimiter", DELIMITER_LABELS, m.delimiter, (v) => void reinspect({ delimiter: v })),
        h("div", { class: "field check" }, h("span", { class: "label" }, "Header"), h("label", { for: "import-header" }, header, " First row is a header")),
        select("import-date", "Date column", columns, m.date, (v) => void update({ date: v })),
        select("import-order", "Date order", ORDER_LABELS, m.dateOrder, (v) => void update({ dateOrder: v })),
        select("import-payee", "Payee column", columns, m.payee, (v) => void update({ payee: v })),
        select("import-decimal", "Decimal separator", DECIMAL_LABELS, m.decimal, (v) => void update({ decimal: v })),
        select("import-category", "Category column (optional)", optional, m.category ?? -1, (v) => void update({ category: v < 0 ? null : v })),
        select("import-note", "Note column (optional)", optional, m.note ?? -1, (v) => void update({ note: v < 0 ? null : v })),
        h("div", { class: "spacer" }),
        amountKind,
        ...amountFields,
      ),
    );

    previewSection.append(h("h2", { id: "import-preview-title" }, "3. Check and import"), error);
    if (!preview) return;
    const p = preview;
    const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    append(previewSection, [
      h(
        "p",
        { class: "summary", "data-testid": "import-summary" },
        `${plural(p.accepted, "row", "rows")} will be imported. ${plural(p.duplicates, "duplicate", "duplicates")} will be skipped. ${plural(p.rejected.length, "row cannot", "rows cannot")} be read.`,
      ),
      h(
        "table",
        { class: "tx-table preview", "aria-label": "Preview of the first rows" },
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            h("th", { scope: "col", class: "col-line" }, "Line"),
            h("th", { scope: "col", class: "col-date" }, "Date"),
            h("th", { scope: "col" }, "Payee"),
            h("th", { scope: "col" }, "Category"),
            m.note === null || m.note === undefined ? null : h("th", { scope: "col" }, "Note"),
            h("th", { scope: "col", class: "num" }, `Amount (${ctx.ledger.settings.currency})`),
            h("th", { scope: "col", class: "col-status" }, "Status"),
          ),
        ),
        h(
          "tbody",
          {},
          p.rows.map((r) =>
            h(
              "tr",
              { class: r.status },
              h("td", { class: "col-line" }, r.line),
              h("td", { class: "col-date" }, r.date),
              h("td", {}, r.payee),
              h("td", {}, r.category),
              m.note === null || m.note === undefined ? null : h("td", { class: "note" }, r.note),
              h("td", { class: `num ${r.amount < 0 ? "neg" : "pos"}` }, formatAmount(r.amount)),
              h("td", { class: "col-status" }, r.status === "new" ? "New" : "Duplicate, skipped"),
            ),
          ),
        ),
      ),
      p.rejected.length
        ? h(
            "div",
            { class: "rejected" },
            h("h3", { id: "import-rejected-title" }, "Rows that cannot be read"),
            h(
              "table",
              { class: "tx-table", "aria-labelledby": "import-rejected-title" },
              h("thead", {}, h("tr", {}, h("th", { scope: "col", class: "col-line" }, "Line"), h("th", { scope: "col" }, "Reason"))),
              h("tbody", {}, p.rejected.map((r) => h("tr", {}, h("td", { class: "col-line" }, r.line), h("td", { class: "reason" }, r.reason)))),
            ),
          )
        : null,
      h(
        "div",
        { class: "actions" },
        h(
          "button",
          { type: "button", class: "primary", disabled: p.accepted === 0, onclick: () => void confirm() },
          `Import ${plural(p.accepted, "transaction", "transactions")}`,
        ),
        h("button", { type: "button", onclick: () => reset("") }, "Cancel"),
      ),
    ]);
  }

  function reset(message: string): void {
    file = null;
    inspection = null;
    mapping = null;
    preview = null;
    fileLabel.textContent = "No file chosen.";
    status.textContent = message;
    showError(null);
    render();
  }

  async function confirm(): Promise<void> {
    if (!file || !mapping) return;
    const r = await ctx.backend.commitImport(file.text, mapping);
    if (!r.ok) {
      showError(r.error.message);
      return;
    }
    await ctx.refresh();
    const { imported, duplicates, rejected } = r.value;
    reset(
      `Imported ${imported} transaction${imported === 1 ? "" : "s"}. Skipped ${duplicates} duplicate${duplicates === 1 ? "" : "s"}. ${rejected.length} row${rejected.length === 1 ? "" : "s"} could not be read.`,
    );
  }

  render();
};

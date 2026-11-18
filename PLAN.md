# Plan

Slices are fixed by `SLICES.md` (same numbers, same order). One agent
builds everything (`solo`). A slice is done when its "done when" is green
on all three Tier 1 runners (ubuntu-latest, windows-latest, macos-latest)
and `VERIFICATION.md` has a row per claim with the run. A slice that
changes `contracts/` lands the contract first in its own PR (types, mock,
contract suite green), then the implementation PR.

| # | Slice | Done when | Levels | Owner | Status |
|---|---|---|---|---|---|
| 0 | Scaffold | `electron-web` template renamed to Tally; `ci` (unit, ui x3, e2e x3, contact sheet) and `installers` (x3) green on the Tier 1 runners; pixel baselines from the `snapshots` workflow merged; first ledger row names the runs | L0 to L7 (template) | solo | open |
| 1 | Record transactions | L1: money parse and format on digit strings, draft validation, newest-first order; L2: add, edit, delete, list, set currency on mock and file-backed service; L3: versioned file, crash-safe write, truncated temp and corrupt main recover, v1 fixture opens, newer version refused untouched; L4: add, edit, delete, currency flows; L5: tiers 1 to 3 of the transactions and settings screens; L6: add a transaction, relaunch, unchanged | L0 to L6 | solo | open |
| 2 | Import a bank CSV | L1: parser (quotes, `,` `;` tab, CRLF, BOM), header and delimiter detection, date orders, decimal comma, debit and credit columns, rejects with line and reason, duplicate counting; L2: inspect, preview, commit; L3: 2,000 rows under 5 s, failed save leaves the ledger unchanged, second import adds nothing; L4: pick, map, preview, confirm; L5: import screen tiers; L6: import a fixture through `TALLY_TEST_IMPORT_FILE`, import again adds nothing | L0 to L6 | solo | open |
| 3 | Categories and rules | L1: create, rename, delete (transactions uncategorised), merge, rule matching and apply-to-uncategorised; rules applied on import; L2: the category and rule calls; L3: the slice 1 fixture still opens; L4: category and rule flows; L5: categories screen tiers; L6: the bridge exposes exactly the contract's method list | L0 to L6 | solo | open |
| 4 | Monthly summary and budgets | L1: per-category totals, income against spending, budget left or over, month boundaries, randomized sums equal to the cent; L2: summary and budget calls; L4: month navigation, budget edit, totals match the month's list; L5: month screen tiers | L0 to L5, L6 suite green | solo | open |
| 5 | Find, export, undo | L1: search and filters, export format, export then import round trip, undo once for delete, merge, import; L2: filter, export, undo calls; L4: search, filter, export, undo flows; L5: transactions screen with the filter bar; L6: export to `TALLY_TEST_EXPORT_FILE`, import into an empty ledger, same transactions | L0 to L6 | solo | open |
| 6 | Release readiness | version 0.1.0, `CHANGELOG.md` from merged PRs and the ledger, release workflow adapted from the Keel reference (gate on `installers`), `installers` green on the release commit on all three Tier 1 runners, ledger rows, signing status (unsigned) written in the release notes draft; no tag, no GitHub release | L7, release | solo | open |

## Rulings

- Planning. Ruling: the mock runs the shared `core/service.ts` over a
  memory store (ARCHITECTURE.md, The seam) — one ledger implementation
  instead of two that drift — cost if wrong: fault simulation needs an
  injected store.
- Planning. Ruling: questions Keel would ask the owner are answered by
  rulings in this file and in each PR — the run is unattended — cost if
  wrong: a ruling is reversed in a later slice.
- Slice 1. Ruling: the category on a transaction is typed with suggestions
  from the ledger's categories, and a new name creates the category —
  "optional category" must work before slice 3's screen exists — cost if
  wrong: the input becomes a select.
- Slice 1. Ruling: a Spending/Income switch plus a positive amount, stored
  signed (negative is spending) — faster than typing a minus sign — cost
  if wrong: a form change only.
- Slice 1. Ruling: only currencies with two minor digits are offered, and
  changing the currency relabels without converting — the brief names one
  currency and no conversion — cost if wrong: digit-aware settings later.
- Slice 2. Ruling: duplicates match as a multiset on date, amount and payee
  (trimmed, whitespace collapsed, case-insensitive), so two identical rows
  in one file both import the first time and neither the second — the
  brief needs repeat imports to add nothing without losing real repeats —
  cost if wrong: the key is one function.
- Slice 2. Ruling: the mapping carries a decimal separator, detected and
  changeable — the brief lists decimal commas as a risk — cost if wrong:
  one more select than needed.
- Slice 3. Ruling: the first created matching rule wins; deleting a
  category deletes its rules and budget; merging moves transactions and
  rules to the target and keeps the target's budget — simplest predictable
  semantics — cost if wrong: rule order becomes editable later.
- Slice 4. Ruling: a budget is one standing monthly amount per category,
  and spent is the negative of the category's net for the month (refunds
  reduce it) — the slice names one budget per category — cost if wrong:
  per-month budgets need a schema field.
- Slice 5. Ruling: the amount range filters on the absolute amount, and
  export carries category and note, which import reads through optional
  columns — "reads back unchanged" needs both — cost if wrong: a signed
  filter is one comparison.
- Slice 5. Ruling: undo lives in memory only and any other change clears it
  — "once, immediately afterwards" in the brief — cost if wrong: none for
  0.1.0.

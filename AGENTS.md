# Tally

Tally is a desktop expense ledger for one person: type transactions in or
import a bank's CSV, sort them into categories, and see each month against
a budget. Everything stays in one local file; no network, no account.
Electron with a TypeScript and Vite UI, for Windows x64, macOS Apple
silicon and Linux x64. The brief is `PRODUCT.md`; decisions are in
`docs/adr/`; the fixed slice list is `SLICES.md`.

<!-- keel:start -->
## Keel

This repository uses Keel (`keel.json` at the root, profile
`electron-web`). Commands per testing level are listed there; the testing
doctrine is in the `keel-test` skill; `VERIFICATION.md` is the append-only
ledger of what has been proven and where.

## Commands

- lint: `npm run typecheck` (tsc over the renderer, `electron/` and the suites)
- unit: `npm run test:unit`; contract: `npm run test:contract`; integration: `npm run test:integration`
- ui: `npm run test:ui` (Playwright, chromium, against the labelled mock; starts Vite itself; `TALLY_UI_PORT=<port>` when 1420 is taken)
- e2e: `npm run test:e2e` (needs `npm run build` first)
- installers: the `installers` workflow (main and on demand: `gh workflow run installers`)
- release: `CHANGELOG.md`, `docs/release-notes/<version>.md`, the tag-driven `release` workflow (gated on `installers`)
- triage a CI run: `npm run triage [run-id]`
- verify this app end to end: the `verify-tally` skill in `.agents/skills`

## Layout

- `src/`: the UI. Talks to the backend only through `src/api.ts`.
- `contracts/`: the contract: types crossing IPC, the method list, results.
- `core/`: pure domain (money, dates, CSV, import, rules, summary, the
  ledger service). No Node, DOM or Electron imports.
- `electron/`: main process (IPC, dialogs, the ledger file store), the
  sandboxed preload and the bridge types.
- `tests/`: unit, contract, integration, ui, e2e suites; fixtures.

## Rules that are not negotiable

1. A claim of "tested" names the level, the platform and the run. Anything
   else is "built". The ledger (`VERIFICATION.md`) is append-only.
2. A new test proves it can fail before it is trusted: break the code path,
   see red, restore, see green.
3. The contract changes only through its own small PR: contract module,
   mock updated, contract suite green. Then implementations.
4. Pixel baselines are captured by the `snapshots` workflow on the runners,
   never on a laptop.
5. Flaky tests are quarantined with an issue, never deleted, never "fixed"
   by a wider timeout without a found cause.
6. Money is integer minor units everywhere; no floating-point money. The
   ledger file is written only through the crash-safe store.
7. Nothing is built outside `SLICES.md`.
<!-- keel:end -->

## Where to look

PRODUCT.md (brief), docs/adr/ (decisions), ARCHITECTURE.md (boundaries),
TESTING.md (strategy), PLAN.md (slices and rulings), VERIFICATION.md
(evidence), DESIGN.md (UI decision log).

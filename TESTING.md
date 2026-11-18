# Testing strategy

Strategy only; evidence is in `VERIFICATION.md`. Doctrine: the `keel-test`
skill and its `electron-web` recipe. Tier 1 runners: ubuntu-latest,
windows-latest, macos-latest (arm64). No Tier 2 or Tier 3.

| Level | Tool | Command | Runs |
|---|---|---|---|
| L0 | tsc over renderer, `electron/`, suites | `npm run typecheck` | every push (unit job) |
| L1 | Vitest, `tests/unit/` | `npm run test:unit` | every push |
| L2 | Vitest, `tests/contract/`: mock against the service over the file store, IPC-cloned | `npm run test:contract` | every push |
| L3 | Vitest, `tests/integration/`: file store in temp dirs | `npm run test:integration` | every push, plus the three OS runners in the e2e job |
| L4/L5 | Playwright chromium, `tests/ui/`, against the labelled mock | `npm run test:ui` | every PR, 3 OS runners |
| L6 | Playwright Electron, `tests/e2e/`, built app in a temp `TALLY_DATA_DIR` | `npm run build && npm run test:e2e` | every PR, 3 OS runners |
| L7 | installer round trips (NSIS, dmg, deb, AppImage) | `installers` workflow | main, release, on demand |

Pixel baselines come only from the `snapshots` workflow (each runner
uploads its own images); `TALLY_UI_PORT` moves the browser suite off port
1420 on a machine shared with other projects.

## Critical journeys

| Journey | Proven at |
|---|---|
| Record a transaction and find it unchanged after a restart | L1 money and validation, L2, L3 save and reopen, L4 form, L6 add then relaunch |
| A crash during a save never leaves a ledger that will not open | L3: truncated temp file, corrupt main file with a backup, newer version refused untouched |
| Import a bank CSV: detect, map, preview, rejects with line and reason, duplicates skipped, all or nothing | L1 parser and mapping, L2, L3 2,000 rows under 5 s and atomic commit, L4 wizard, L6 fixture import |
| Importing the same file twice adds nothing | L1 dedupe, L3, L6 |
| Categories and payee rules sort transactions | L1, L2, L4 |
| Monthly totals equal the shown transactions to the cent | L1 randomized sums and month boundaries, L4 |
| Export then import into an empty ledger gives the same transactions | L1 round trip, L6 export to a preset path and reimport |
| Undo the last delete, merge or import, once | L1, L2, L4 |
| First launch from the installer | L7 |

Money and date rules get randomized L1 tests with a fixed seed (mixes of
income and spending, month ends, leap days, 31-day months), because the
brief lists them as the subtle risk.

## Visual

Tiers 1 to 3 per screen (transactions, import, categories, month,
settings): ARIA snapshot (tier 1, shared), geometry of `data-geo` elements
(tier 2, shared, 8 px), full-page pixels per OS (tier 3,
`maxDiffPixelRatio` 0.002, captured only by the `snapshots` workflow).
UI tests freeze the clock (`page.clock`) at 2026-03-15 so dates and the
default month never move a baseline.

## Budgets

Fast suite (L0 to L3) under 3 minutes on one runner; L4/L5 under 5 minutes
per OS; L6 under 15 minutes per OS including the build; whole PR wall
clock under 20 minutes. Retries: one, at L6 and L7 only. Flaky tests are
quarantined with an issue (keel-test section 6), never deleted or given a
wider timeout.

## Not tested in 0.1.0

- Screen readers and keyboard-only use beyond the ARIA tree (manual later).
- Signed or notarized bundles: 0.1.0 ships unsigned (ADR 001).
- Ledgers above 50,000 transactions; currencies without two minor digits.
- CSV encodings other than UTF-8 and Windows-1252.
- Other architectures and distributions (no Tier 2 or 3, ADR 002).

# Architecture

Tally is an Electron app (ADR 001) for one person on Windows x64, macOS
Apple silicon and Linux x64 (ADR 002). The main process owns the ledger
file and the file dialogs; the renderer is sandboxed and reaches them only
through the typed preload bridge.

## Boundaries

| Module | Owns | May call |
|---|---|---|
| `src/` (UI) | screens, view state, formatting for display | `src/api.ts` and pure helpers in `core/` (money, dates) |
| `src/api.ts` (adapter) | one `Backend` interface: native (`window.electronBridge`) or the labelled mock | the bridge, or `core/service.ts` over a memory store |
| `contracts/` | the contract: data types, the method list, result and error shapes | nothing |
| `core/` (domain) | pure TypeScript: money, dates, CSV parsing, import mapping, dedupe, categories, rules, summary, search, export, undo, the ledger service | `contracts/` only; no Node, no DOM, no Electron |
| `electron/store.ts` (persistence) | the ledger file: versioned JSON, crash-safe writes, recovery, migrations | `node:fs`, `core/` schema |
| `electron/main.ts`, `preload.ts`, `bridge.ts` (platform) | window, IPC handlers generated from the method list, file dialogs, test-only bypasses | `core/service.ts`, `electron/store.ts` |

Rule: arrows point down the table only. `core/` never imports `electron`,
`node:*` or DOM types; the three `tsconfig` files enforce the split
(renderer sees DOM, `electron/` sees Node, `core/` and `contracts/` are
compiled by both and so may use neither).

## The seam

- `contracts/ledger.ts` declares every type that crosses IPC and the
  `LedgerApi` interface; `contracts/methods.ts` lists the method names.
  The preload exposes exactly those methods and main registers one
  `ipcMain.handle("ledger:<method>")` per name, both generated from the
  list, so a method cannot exist on one side only.
- Every mutating call returns `Result<T>` (`{ ok: true, value }` or
  `{ ok: false, error: { code, message, field? } }`), never a thrown error,
  because Electron flattens errors thrown across IPC into strings.
- Ruling (planning): the labelled mock runs the same `core/service.ts` as
  the main process, over an in-memory store, instead of a second
  hand-written ledger — a ledger's rules are the product, and two copies
  would drift — cost if wrong: the mock cannot diverge on purpose to
  simulate backend faults; tests that need a fault inject a failing store.
- What still differs between mock and real: persistence (memory against
  the file), the file dialogs (a queue the UI tests fill against
  `showOpenDialog`/`showSaveDialog`), and IPC serialization. The contract
  suite (L2) runs the same calls against the mock and against the service
  over the file store with every argument and result passed through
  `structuredClone`, reopening from disk after each call. The real-shell
  suite (L6) calls the bridge and compares with the contract module.
- Drift checks: `npm run typecheck` (the bridge, preload and adapter are
  typed from `contracts/`), the contract suite, the L6 check that the
  bridge exposes exactly the method list.

## State and data

- UI state is per screen and rebuilt from the backend after every change.
- The ledger is one JSON file, `ledger.json`, in Electron's `userData`
  directory: `{ format: "tally-ledger", version, settings, transactions,
  categories, rules, budgets }`.
- Money is an integer number of minor units (`amount`, negative for
  spending) checked with `Number.isSafeInteger`; parsing and formatting
  work on digit strings, never on floats. Dates are `YYYY-MM-DD` strings,
  months `YYYY-MM`; "today" is the local calendar date, never UTC.
- Crash-safe save: write `ledger.json.tmp`, `fsync`, copy the current file
  to `ledger.json.bak`, rename the temp file over `ledger.json`. Open reads
  `ledger.json`; if it is missing or does not parse and validate, it reads
  the backup, and moves an unreadable file aside as
  `ledger.unreadable-<time>.json` rather than overwriting it.
- Versions: `version` is 1 for 0.1.0. `core/schema.ts` validates and
  migrates on open; collections added in later slices default to empty so
  every earlier file still opens. A committed fixture per version under
  `tests/fixtures/` must keep opening (L3). A file with a newer version is
  refused and left untouched.
- Undo: the service keeps one in-memory snapshot taken before a delete,
  merge or import; any other change clears it. Not persisted.

## Platform integration

- File dialogs live in `electron/main.ts` only. Test-only bypasses, honoured
  only when the app is not packaged: `TALLY_DATA_DIR` (ledger directory),
  `TALLY_TEST_IMPORT_FILE` and `TALLY_TEST_EXPORT_FILE` (preset dialog
  answers). The L6 journeys name the bypass they use.
- CSV bytes are decoded in `core/` (UTF-8 with or without BOM, falling back
  to Windows-1252), so decoding is tested in Node at L1.
- No network use: the CSP has no remote origins and main opens no sockets.

## Deliberately simple

- One JSON file rewritten on every save, not a database, until a ledger is
  large enough that a save takes over 200 ms at L3 (about 100k rows).
- Vanilla TypeScript DOM rendering with a small `h()` helper, no UI
  framework, until a screen needs shared reactive state across views.
- One currency, two minor digits (the money functions take the digit count,
  so other exponents are a settings change later). Changing the currency
  relabels amounts; it never converts.

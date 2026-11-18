# Changelog

All notable changes to Tally. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the version
numbers follow [Semantic Versioning](https://semver.org/) (0.x while there
are no outside users). Written from the merged pull requests and
`VERIFICATION.md`.

## [0.1.0] - 2026-11-18

The first version: a desktop expense ledger for Windows x64, macOS on Apple
silicon and Linux x64 that keeps everything in one local file.

### Added

- Record transactions: date, payee, amount, optional category and note;
  spending or income chosen with a switch; edit in place; delete after a
  confirmation. The list shows the newest first. Amounts are whole cents in
  one currency chosen in Settings (changing it relabels, never converts).
- The ledger is one versioned file in the app's data folder, written
  crash-safe (temporary file, flush, backup copy, atomic rename). An
  unreadable file is kept aside and the backup opened; a file from a newer
  Tally is left untouched.
- Import a bank CSV: the delimiter, header, columns, date order and decimal
  separator are detected and can be changed; one signed amount column or
  separate debit and credit columns; a preview of the rows as they will be
  imported; every unreadable row listed with its line number and the
  reason; rows already in the ledger skipped and counted; all accepted rows
  imported together or none.
- Categories: create, rename, merge and delete (its transactions become
  uncategorised). Payee rules ("payee contains this text, use this
  category") sort imported rows and, on request, every uncategorised
  transaction.
- Month view: income against spending, a total per category, a monthly
  budget per category with the amount left or over and a simple bar,
  previous and next month, and the month's transactions.
- Find: search payee and note text; filter by category, date range and
  amount range. Export the transactions shown to a CSV that Tally's own
  import reads back as the same transactions.
- Undo the most recent delete, category merge or import, once.

### Known limits

- Bundles are not signed or notarized (see the release notes).
- One currency with two decimal places; CSV files in UTF-8 or
  Windows-1252.

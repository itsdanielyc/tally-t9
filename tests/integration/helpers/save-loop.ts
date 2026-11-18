// Child process for the crash test: opens the ledger in the directory given
// as argv[2] and saves a growing ledger in a loop until it is killed. Run by
// Node directly (type stripping), so it exercises the same store code the
// main process bundles.
import { createLedgerService } from "../../../core/service.ts";
import { createFileStore } from "../../../electron/store.ts";

const dir = process.argv[2];
const service = createLedgerService(createFileStore(dir));
const note = "x".repeat(400);
let n = 0;
process.stdout.write("saving\n");
for (;;) {
  n += 1;
  const r = service.addTransaction({ date: "2026-03-14", payee: `Payee ${n}`, amount: -n, category: n % 2 ? "Even" : "Odd", note });
  if (!r.ok) {
    process.stderr.write(`save failed: ${r.error.message}\n`);
    process.exit(1);
  }
}

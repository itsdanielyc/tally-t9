// The ledger file. One JSON file, written crash-safe:
//   1. write ledger.json.tmp and fsync it,
//   2. copy the current ledger.json to ledger.json.bak,
//   3. rename the temp file over ledger.json (atomic on one filesystem).
// A crash at any point leaves ledger.json either the old or the new complete
// file. Opening reads ledger.json, falls back to the backup when it is
// missing or unreadable, and moves an unreadable file aside instead of ever
// overwriting it. A file from a newer Tally is refused and left untouched.
import * as nodeFs from "node:fs";
import { join } from "node:path";
import { emptyLedger, parseLedgerText, serializeLedger, type LedgerData } from "../core/schema.ts";
import type { LedgerStore, LoadResult } from "../core/service.ts";

export const LEDGER_FILE = "ledger.json";

export class LedgerTooNewError extends Error {
  readonly path: string;
  constructor(path: string, reason: string) {
    super(`${path} was ${reason}. Tally will not change it.`);
    this.name = "LedgerTooNewError";
    this.path = path;
  }
}

type Fs = Pick<
  typeof nodeFs,
  "mkdirSync" | "readFileSync" | "existsSync" | "openSync" | "writeSync" | "fsyncSync" | "closeSync" | "copyFileSync" | "renameSync"
>;

export function createFileStore(dir: string, fs: Fs = nodeFs, now: () => Date = () => new Date()): LedgerStore {
  const file = join(dir, LEDGER_FILE);
  const tmp = `${file}.tmp`;
  const bak = `${file}.bak`;

  function read(path: string): { state: "missing" } | { state: "bad"; reason: string; newer: boolean } | { state: "ok"; data: LedgerData } {
    let text: string;
    try {
      text = fs.readFileSync(path, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return { state: "missing" };
      return { state: "bad", reason: (e as Error).message, newer: false };
    }
    const parsed = parseLedgerText(text);
    return parsed.ok ? { state: "ok", data: parsed.data } : { state: "bad", reason: parsed.reason, newer: parsed.newer };
  }

  function setAside(path: string): string {
    const stamp = now().toISOString().replace(/[:.]/g, "-");
    const aside = join(dir, `ledger.unreadable-${stamp}.json`);
    retry(() => fs.renameSync(path, aside));
    return aside;
  }

  return {
    load(): LoadResult {
      fs.mkdirSync(dir, { recursive: true });
      const main = read(file);
      if (main.state === "ok") return { data: main.data, recovered: null };
      if (main.state === "bad" && main.newer) throw new LedgerTooNewError(file, main.reason);
      const backup = read(bak);
      if (backup.state === "bad" && backup.newer) throw new LedgerTooNewError(bak, backup.reason);
      if (main.state === "missing") {
        if (backup.state === "ok") return { data: backup.data, recovered: `${LEDGER_FILE} was missing; opened the backup ${bak}.` };
        return { data: emptyLedger(), recovered: null };
      }
      const aside = setAside(file);
      if (backup.state === "ok") {
        return { data: backup.data, recovered: `${LEDGER_FILE} could not be read (${main.reason}); it was kept as ${aside} and the backup was opened.` };
      }
      return { data: emptyLedger(), recovered: `${LEDGER_FILE} could not be read (${main.reason}) and there was no usable backup; it was kept as ${aside} and a new ledger was started.` };
    },

    save(data: LedgerData): void {
      fs.mkdirSync(dir, { recursive: true });
      const fd = fs.openSync(tmp, "w");
      try {
        fs.writeSync(fd, serializeLedger(data));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      if (fs.existsSync(file)) retry(() => fs.copyFileSync(file, bak));
      retry(() => fs.renameSync(tmp, file));
    },

    describe: () => ({ kind: "file", location: file }),
  };
}

/** Writes a text file the same crash-safe way as the ledger: temp file, fsync, rename. */
export function writeTextAtomic(path: string, text: string, fs: Fs = nodeFs): void {
  const tmp = `${path}.tmp`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  retry(() => fs.renameSync(tmp, path));
}

/** Windows can refuse a rename or copy for a moment while another process (an indexer, antivirus) has the file open. */
function retry(op: () => void, attempts = 6): void {
  for (let i = 1; ; i++) {
    try {
      op();
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (i >= attempts || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * i);
    }
  }
}

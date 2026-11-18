// L6: the real shell. Playwright launches the built app (out/, from
// `npm run build`) with Electron itself, with the ledger in a temp directory
// (the TALLY_DATA_DIR test bypass, honoured only unpackaged). Everything here
// crosses the preload bridge and IPC to the main process and the real file,
// which no browser-mode test can do.
import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Transaction } from "../../contracts/ledger";
import { ledgerMethods, platformMethods } from "../../contracts/methods";
import { Tally } from "./support";

const tally = new Tally();
const rows = () => tally.win.getByRole("table", { name: "Transactions, newest first" }).locator("tbody tr");
const bridgeList = () => tally.win.evaluate(() => window.electronBridge!.listTransactions()) as Promise<Transaction[]>;

test.describe.configure({ mode: "serial" });
test.beforeAll(() => tally.launch());
test.afterAll(() => tally.dispose());

test.describe("tally in the real shell", () => {
  test("opens the main window on the native backend with the sandbox on", async () => {
    const html = readFileSync("index.html", "utf8");
    const title = /<title>(.*?)<\/title>/.exec(html)?.[1];
    await expect(tally.win).toHaveTitle(title!);
    await expect(tally.win.getByRole("heading", { name: "Transactions", level: 1 })).toBeVisible();
    // contextIsolation and the sandbox: the page sees the bridge, not Node.
    const exposed = await tally.win.evaluate(() => ({
      bridge: typeof window.electronBridge,
      require: typeof (window as unknown as { require?: unknown }).require,
      process: typeof (window as unknown as { process?: unknown }).process,
    }));
    expect(exposed).toEqual({ bridge: "object", require: "undefined", process: "undefined" });
  });

  test("the bridge exposes exactly the contract's methods", async () => {
    const keys = await tally.win.evaluate(() => Object.keys(window.electronBridge!).sort());
    expect(keys).toEqual([...ledgerMethods, ...platformMethods].sort());
  });

  test("the ledger lives in the data directory the main process was given", async () => {
    const ledger = await tally.win.evaluate(() => window.electronBridge!.getLedger());
    expect(ledger.storage).toEqual({ kind: "file", location: join(tally.dataDir, "ledger.json"), recovered: null });
  });

  test("a transaction typed in is still there, unchanged, after a restart", async () => {
    const win = tally.win;
    await win.getByLabel("Date", { exact: true }).fill("2026-03-14");
    await win.getByLabel("Payee", { exact: true }).fill("Corner Shop");
    await win.getByLabel(/^Amount/).fill("12.50");
    await win.getByLabel("Category", { exact: true }).fill("Groceries");
    await win.getByLabel("Note", { exact: true }).fill('milk, "organic"');
    await win.getByRole("button", { name: "Add", exact: true }).click();
    await expect(rows()).toHaveCount(1);
    await expect(rows().first().locator("td.num")).toHaveText("-12.50");
    const before = await bridgeList();
    expect(before).toEqual([{ id: "t1", date: "2026-03-14", payee: "Corner Shop", amount: -1250, categoryId: "c2", note: 'milk, "organic"' }]);

    await tally.restart();
    await expect(rows()).toHaveCount(1);
    await expect(rows().first()).toContainText("Corner Shop");
    await expect(rows().first()).toContainText("Groceries");
    await expect(rows().first().locator("td.num")).toHaveText("-12.50");
    expect(await bridgeList()).toEqual(before);

    const onDisk = JSON.parse(readFileSync(join(tally.dataDir, "ledger.json"), "utf8"));
    expect(onDisk).toMatchObject({ format: "tally-ledger", version: 1 });
    expect(onDisk.transactions).toEqual(before);
  });

  test("an edit and a delete survive a restart too", async () => {
    await tally.win.getByRole("button", { name: "Edit Corner Shop on 2026-03-14" }).click();
    await tally.win.getByLabel(/^Amount/).fill("13.75");
    await tally.win.getByRole("button", { name: "Save changes" }).click();
    await expect(rows().first().locator("td.num")).toHaveText("-13.75");
    await tally.restart();
    await expect(rows().first().locator("td.num")).toHaveText("-13.75");

    await tally.win.getByRole("button", { name: "Delete Corner Shop on 2026-03-14" }).click();
    await tally.win.getByRole("button", { name: "Confirm delete Corner Shop on 2026-03-14" }).click();
    await expect(tally.win.getByText("No transactions yet.")).toBeVisible();
    await tally.restart();
    await expect(tally.win.getByText("No transactions yet.")).toBeVisible();
    expect(await bridgeList()).toEqual([]);
  });

  test("reports the platform from the main process and saves a screenshot named after it", async () => {
    await tally.win.evaluate(() =>
      window.electronBridge!.addTransaction({ date: "2026-03-14", payee: "Screenshot Cafe", amount: -455, category: "Eating out", note: "" }),
    );
    await tally.restart();
    const main = await tally.app.evaluate(({ app: electronApp }) => ({
      os: process.platform,
      arch: process.arch,
      packaged: electronApp.isPackaged,
    }));
    expect(["win32", "darwin", "linux"]).toContain(main.os);
    expect(["x64", "arm64"]).toContain(main.arch);
    expect(main.packaged).toBe(false);
    const viaBridge = await tally.win.evaluate(() => window.electronBridge!.platformInfo());
    expect(viaBridge).toMatchObject(main);
    await expect(tally.win.getByTestId("platform")).toHaveText(`${main.os} / ${main.arch}`);
    await expect(rows()).toHaveCount(1);

    const dir = join(process.cwd(), "artifacts", "e2e");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${main.os}-${main.arch}.png`);
    await tally.win.screenshot({ path: file });
    console.log(`[e2e] screenshot saved: ${file}`);
  });

  test("logged no console errors (CSP violations, failed loads)", async () => {
    expect(tally.consoleErrors).toEqual([]);
  });
});

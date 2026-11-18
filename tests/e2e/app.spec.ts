// L6: the real shell. Playwright launches the built app (out/, from
// `npm run build`) with Electron itself, with the ledger in a temp directory
// (the TALLY_DATA_DIR test bypass, honoured only unpackaged). Everything here
// crosses the preload bridge and IPC to the main process and the real file,
// which no browser-mode test can do.
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Transaction } from "../../contracts/ledger";
import { ledgerMethods, platformMethods } from "../../contracts/methods";

const dataDir = mkdtempSync(join(tmpdir(), "tally-e2e-"));
let app: ElectronApplication;
let win: Page;
const consoleErrors: string[] = [];

async function launch(): Promise<void> {
  app = await electron.launch({ args: ["."], cwd: process.cwd(), env: { ...process.env, TALLY_DATA_DIR: dataDir } });
  win = await app.firstWindow();
  win.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  await win.waitForLoadState("domcontentloaded");
  await expect(win.getByTestId("backend-badge")).toHaveText("native");
}

async function restart(): Promise<void> {
  const proc = app.process();
  const closed = proc.exitCode !== null ? Promise.resolve() : new Promise<void>((r) => proc.once("close", () => r()));
  await app.close();
  // Wait until the old process has exited and its stdio pipes are closed
  // before starting the next one in the same worker.
  await closed;
  await launch();
}

const rows = () => win.getByRole("table", { name: "Transactions, newest first" }).locator("tbody tr");
const bridgeList = () => win.evaluate(() => window.electronBridge!.listTransactions()) as Promise<Transaction[]>;

test.describe.configure({ mode: "serial" });

test.beforeAll(launch);

test.afterAll(async () => {
  await app?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

test.describe("tally in the real shell", () => {
  test("opens the main window on the native backend with the sandbox on", async () => {
    const html = readFileSync("index.html", "utf8");
    const title = /<title>(.*?)<\/title>/.exec(html)?.[1];
    await expect(win).toHaveTitle(title!);
    await expect(win.getByRole("heading", { name: "Transactions", level: 1 })).toBeVisible();
    // contextIsolation and the sandbox: the page sees the bridge, not Node.
    const exposed = await win.evaluate(() => ({
      bridge: typeof window.electronBridge,
      require: typeof (window as unknown as { require?: unknown }).require,
      process: typeof (window as unknown as { process?: unknown }).process,
    }));
    expect(exposed).toEqual({ bridge: "object", require: "undefined", process: "undefined" });
  });

  test("the bridge exposes exactly the contract's methods", async () => {
    const keys = await win.evaluate(() => Object.keys(window.electronBridge!).sort());
    expect(keys).toEqual([...ledgerMethods, ...platformMethods].sort());
  });

  test("the ledger lives in the data directory the main process was given", async () => {
    const ledger = await win.evaluate(() => window.electronBridge!.getLedger());
    expect(ledger.storage).toEqual({ kind: "file", location: join(dataDir, "ledger.json"), recovered: null });
  });

  test("a transaction typed in is still there, unchanged, after a restart", async () => {
    await win.getByLabel("Date").fill("2026-03-14");
    await win.getByLabel("Payee").fill("Corner Shop");
    await win.getByLabel(/^Amount/).fill("12.50");
    await win.getByLabel("Category").fill("Groceries");
    await win.getByLabel("Note").fill("milk, \"organic\"");
    await win.getByRole("button", { name: "Add", exact: true }).click();
    await expect(rows()).toHaveCount(1);
    await expect(rows().first().locator("td.num")).toHaveText("-12.50");
    const before = await bridgeList();
    expect(before).toEqual([{ id: "t1", date: "2026-03-14", payee: "Corner Shop", amount: -1250, categoryId: "c2", note: 'milk, "organic"' }]);

    await restart();
    await expect(rows()).toHaveCount(1);
    await expect(rows().first()).toContainText("Corner Shop");
    await expect(rows().first()).toContainText("Groceries");
    await expect(rows().first().locator("td.num")).toHaveText("-12.50");
    expect(await bridgeList()).toEqual(before);

    const onDisk = JSON.parse(readFileSync(join(dataDir, "ledger.json"), "utf8"));
    expect(onDisk).toMatchObject({ format: "tally-ledger", version: 1 });
    expect(onDisk.transactions).toEqual(before);
  });

  test("an edit and a delete survive a restart too", async () => {
    await win.getByRole("button", { name: "Edit Corner Shop on 2026-03-14" }).click();
    await win.getByLabel(/^Amount/).fill("13.75");
    await win.getByRole("button", { name: "Save changes" }).click();
    await expect(rows().first().locator("td.num")).toHaveText("-13.75");
    await restart();
    await expect(rows().first().locator("td.num")).toHaveText("-13.75");

    await win.getByRole("button", { name: "Delete Corner Shop on 2026-03-14" }).click();
    await win.getByRole("button", { name: "Confirm delete Corner Shop on 2026-03-14" }).click();
    await expect(win.getByText("No transactions yet.")).toBeVisible();
    await restart();
    await expect(win.getByText("No transactions yet.")).toBeVisible();
    expect(await bridgeList()).toEqual([]);
  });

  test("reports the platform from the main process and saves a screenshot named after it", async () => {
    await win.evaluate(() =>
      window.electronBridge!.addTransaction({ date: "2026-03-14", payee: "Screenshot Cafe", amount: -455, category: "Eating out", note: "" }),
    );
    await restart();
    const main = await app.evaluate(({ app: electronApp }) => ({
      os: process.platform,
      arch: process.arch,
      packaged: electronApp.isPackaged,
    }));
    expect(["win32", "darwin", "linux"]).toContain(main.os);
    expect(["x64", "arm64"]).toContain(main.arch);
    expect(main.packaged).toBe(false);
    const viaBridge = await win.evaluate(() => window.electronBridge!.platformInfo());
    expect(viaBridge).toMatchObject(main);
    await expect(win.getByTestId("platform")).toHaveText(`${main.os} / ${main.arch}`);
    await expect(rows()).toHaveCount(1);

    const dir = join(process.cwd(), "artifacts", "e2e");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${main.os}-${main.arch}.png`);
    await win.screenshot({ path: file });
    console.log(`[e2e] screenshot saved: ${file}`);
  });

  test("logged no console errors (CSP violations, failed loads)", async () => {
    expect(consoleErrors).toEqual([]);
  });
});

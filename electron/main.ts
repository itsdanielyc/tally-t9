// The main process: Tally's backend. It owns the ledger file (through the
// crash-safe store) and answers the bridge's IPC calls with the ledger
// service. Handlers are registered from the contract's method list, so the
// preload and main cannot disagree about which methods exist.
//
// Test-only bypasses, honoured only when the app is not packaged:
//   TALLY_DATA_DIR          the directory that holds ledger.json (the L6 suite uses a temp dir)
//   TALLY_TEST_IMPORT_FILE  the file the open dialog answers with, because no
//                           test driver can see a native file dialog
//   TALLY_TEST_EXPORT_FILE  the path the save dialog answers with, for the same reason
import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent, type OpenDialogOptions, type SaveDialogOptions } from "electron";
import { readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { ImportFile, PlatformApi, PlatformInfo, Result } from "../contracts/ledger.ts";
import { channelFor, ledgerMethods, platformMethods, type PlatformMethod } from "../contracts/methods.ts";
import { decodeCsvBytes } from "../core/csv.ts";
import { MAX_IMPORT_CHARS } from "../core/importer.ts";
import { createLedgerService, type LedgerService } from "../core/service.ts";
import { createFileStore, writeTextAtomic } from "./store.ts";

function dataDir(): string {
  const override = process.env.TALLY_DATA_DIR;
  return !app.isPackaged && override ? override : app.getPath("userData");
}

function platformInfo(): PlatformInfo {
  return {
    os: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    packaged: app.isPackaged,
  };
}

const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;

function testOnly(name: string): string | undefined {
  return app.isPackaged ? undefined : process.env[name] || undefined;
}

async function chooseImportFile(win: BrowserWindow | null): Promise<Result<ImportFile | null>> {
  let path = testOnly("TALLY_TEST_IMPORT_FILE");
  if (!path) {
    const options: OpenDialogOptions = {
      title: "Import a bank CSV",
      properties: ["openFile"],
      filters: [
        { name: "CSV files", extensions: ["csv", "txt"] },
        { name: "All files", extensions: ["*"] },
      ],
    };
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (picked.canceled || picked.filePaths.length === 0) return { ok: true, value: null };
    path = picked.filePaths[0];
  }
  try {
    if (statSync(path).size > MAX_IMPORT_CHARS) {
      return { ok: false, error: { code: "invalid", message: `${basename(path)} is too large to import (over 20 MB).` } };
    }
    return { ok: true, value: { name: basename(path), text: decodeCsvBytes(readFileSync(path)) } };
  } catch (e) {
    return { ok: false, error: { code: "io", message: `${basename(path)} could not be read: ${(e as Error).message}` } };
  }
}

async function saveExportFile(win: BrowserWindow | null, text: unknown, suggestedName: unknown): Promise<Result<{ path: string } | null>> {
  if (typeof text !== "string" || text.length > MAX_IMPORT_CHARS) {
    return { ok: false, error: { code: "invalid", message: "There is nothing to export." } };
  }
  const name = basename(String(suggestedName || "tally-export.csv")).replace(/[^\w.\- ]/g, "_");
  let path = testOnly("TALLY_TEST_EXPORT_FILE");
  if (!path) {
    const options: SaveDialogOptions = {
      title: "Export transactions",
      defaultPath: join(app.getPath("documents"), name),
      filters: [{ name: "CSV files", extensions: ["csv"] }],
    };
    const picked = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (picked.canceled || !picked.filePath) return { ok: true, value: null };
    path = picked.filePath;
  }
  try {
    writeTextAtomic(path, text);
    return { ok: true, value: { path } };
  } catch (e) {
    return { ok: false, error: { code: "io", message: `${basename(path)} could not be written: ${(e as Error).message}` } };
  }
}

type PlatformHandlers = {
  [K in PlatformMethod]: (event: IpcMainInvokeEvent, ...args: Parameters<PlatformApi[K]>) => ReturnType<PlatformApi[K]>;
};

/** One handler per platform method; the type makes a missing one a compile error. */
const platform: PlatformHandlers = {
  platformInfo: async () => platformInfo(),
  chooseImportFile: (event) => chooseImportFile(BrowserWindow.fromWebContents(event.sender)),
  saveExportFile: (event, text, suggestedName) => saveExportFile(BrowserWindow.fromWebContents(event.sender), text, suggestedName),
};

/** Only the app's own page may call the backend. */
function trusted(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? "";
  return url.startsWith("file://") || (!!devUrl && url.startsWith(devUrl));
}

function registerHandlers(service: LedgerService): void {
  for (const method of ledgerMethods) {
    const call = service[method] as (...args: unknown[]) => unknown;
    ipcMain.handle(channelFor(method), (event, ...args: unknown[]) => {
      if (!trusted(event)) throw new Error("Refused a call from an untrusted page.");
      return call(...args);
    });
  }
  for (const method of platformMethods) {
    const handler = platform[method] as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
    ipcMain.handle(channelFor(method), (event, ...args: unknown[]) => {
      if (!trusted(event)) throw new Error("Refused a call from an untrusted page.");
      return handler(event, ...args);
    });
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1024,
    height: 700,
    minWidth: 760,
    minHeight: 520,
    title: "Tally",
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once("ready-to-show", () => win.show());
  // Links open in the system browser, never inside the app window, and the
  // window never navigates away from the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });

  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
}

app.whenReady().then(() => {
  let service: LedgerService;
  try {
    service = createLedgerService(createFileStore(dataDir()));
  } catch (e) {
    dialog.showErrorBox("Tally cannot open the ledger", (e as Error).message);
    app.exit(1);
    return;
  }
  registerHandlers(service);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

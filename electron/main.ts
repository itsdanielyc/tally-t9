// The main process: Tally's backend. It owns the ledger file (through the
// crash-safe store) and answers the bridge's IPC calls with the ledger
// service. Handlers are registered from the contract's method list, so the
// preload and main cannot disagree about which methods exist.
//
// Test-only bypasses, honoured only when the app is not packaged:
//   TALLY_DATA_DIR  the directory that holds ledger.json (the L6 suite uses a temp dir)
import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from "electron";
import { join } from "node:path";
import type { PlatformInfo } from "../contracts/ledger.ts";
import { channelFor, ledgerMethods } from "../contracts/methods.ts";
import { createLedgerService, type LedgerService } from "../core/service.ts";
import { createFileStore } from "./store.ts";

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
  ipcMain.handle(channelFor("platformInfo"), () => platformInfo());
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

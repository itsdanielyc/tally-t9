// Runs sandboxed with contextIsolation on. It exposes exactly the typed
// bridge and nothing else: no ipcRenderer, no Node. The methods are
// generated from the contract's method lists, the same lists the main
// process registers handlers from.
import { contextBridge, ipcRenderer } from "electron";
import { channelFor, ledgerMethods, platformMethods } from "../contracts/methods.ts";
import type { ElectronBridge } from "./bridge.ts";

const bridge: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
for (const method of [...ledgerMethods, ...platformMethods]) {
  bridge[method] = (...args) => ipcRenderer.invoke(channelFor(method), ...args);
}

contextBridge.exposeInMainWorld("electronBridge", bridge as unknown as ElectronBridge);

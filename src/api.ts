// The seam between the UI and the backend. Inside Electron the calls go
// through the preload bridge (window.electronBridge) over IPC to the main
// process; in a plain browser (Vite dev server, Playwright) the labelled mock
// in src/mock.ts answers instead, running the same ledger service over
// memory. tests/contract holds the two to the same answers and the
// real-shell suite holds the bridge to the contract's method list.
import type { ElectronBridge } from "../electron/bridge.ts";
import { createMockBackend, seedFromHooks, type Backend, type MockHooks } from "./mock.ts";

export type * from "../contracts/ledger.ts";
export type { Backend };

declare global {
  interface Window {
    electronBridge?: ElectronBridge;
    /** browser-mode test hooks, set before the page loads */
    __TALLY_MOCK__?: MockHooks;
  }
}

const bridge = typeof window !== "undefined" ? window.electronBridge : undefined;

export const isNative = bridge !== undefined;

export const backend: Backend = bridge
  ? { ...bridge, kind: "native" }
  : createMockBackend(
      typeof window !== "undefined" ? seedFromHooks(window.__TALLY_MOCK__) : undefined,
      () => (typeof window !== "undefined" ? window.__TALLY_MOCK__ : undefined),
    );

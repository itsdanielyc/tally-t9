// The typed surface the preload exposes to the renderer as
// window.electronBridge: exactly the contract's methods, one IPC channel
// each (contracts/methods.ts). The renderer imports only this type.
import type { LedgerApi, PlatformApi } from "../contracts/ledger.ts";

export type { PlatformInfo } from "../contracts/ledger.ts";

export type ElectronBridge = LedgerApi & PlatformApi;

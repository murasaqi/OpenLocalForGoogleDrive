// Dispatches to the platform-specific mount detection implementation.
// normalizeMountValue is a Windows-registry-value concept only, so it is not
// re-exported here; tests that need it import mount.win.mjs directly.
import * as mac from "./mount.mac.mjs";
import * as win from "./mount.win.mjs";

const impl = process.platform === "darwin" ? mac : win;

export const detectMountRoots = (options) => impl.detectMountRoots(options);
export const detectMountRoot = (options) => impl.detectMountRoot(options);
export const mountRootsForAccount = (accountId, options) =>
  impl.mountRootsForAccount(accountId, options);

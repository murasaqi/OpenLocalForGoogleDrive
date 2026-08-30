import { test } from "node:test";
import assert from "node:assert/strict";

import { mountRootsForAccount, normalizeMountValue } from "../host/lib/mount.mjs";

test("normalizeMountValue handles registry value shapes", () => {
  assert.equal(normalizeMountValue("G"), "G:\\");
  assert.equal(normalizeMountValue("g"), "G:\\");
  assert.equal(normalizeMountValue("H:"), "H:\\");
  assert.equal(normalizeMountValue("C:\\GoogleDrive"), "C:\\GoogleDrive\\");
  assert.equal(normalizeMountValue("C:\\GoogleDrive\\"), "C:\\GoogleDrive\\");
  assert.equal(normalizeMountValue(""), null);
  assert.equal(normalizeMountValue(null), null);
  assert.equal(normalizeMountValue(undefined), null);
  assert.equal(normalizeMountValue(7), null);
});

test("mountRootsForAccount orders roots by account preference", () => {
  const roots = ["H:\\", "G:\\"];
  const prefs = new Map([["114", "H:\\"]]);

  // Explicitly configured account: its mount point comes first.
  assert.deepEqual(mountRootsForAccount("114", { prefs, roots }), ["H:\\", "G:\\"]);

  // Account on the default mount (empty prefs value, so absent from the
  // map): every detected root is tried, with roots claimed by other
  // accounts last. The old single-root behavior returned another
  // account's H:\ here.
  assert.deepEqual(mountRootsForAccount("116", { prefs, roots }), ["G:\\", "H:\\"]);

  // Preferred root later in the detection order is moved to the front.
  assert.deepEqual(
    mountRootsForAccount("114", { prefs: new Map([["114", "G:\\"]]), roots }),
    ["G:\\", "H:\\"]
  );

  // Preferred root without Drive content (unmounted) falls back to the
  // detected list as-is.
  assert.deepEqual(
    mountRootsForAccount("114", { prefs: new Map([["114", "X:\\"]]), roots }),
    ["H:\\", "G:\\"]
  );
});

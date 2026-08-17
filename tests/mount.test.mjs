import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeMountValue } from "../host/lib/mount.mjs";

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

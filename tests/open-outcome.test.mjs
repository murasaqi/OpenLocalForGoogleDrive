import { test } from "node:test";
import assert from "node:assert/strict";

import { decideOpen } from "../host/lib/open-outcome.mjs";

const neverCalled = () => assert.fail("breadcrumb fallback must not run");
const found = { path: "/m/My Drive/x", exists: true, isFolder: true, mountRoot: "/m/" };

test("an existing DB path is opened as is", () => {
  assert.deepEqual(decideOpen(found, neverCalled), { resolved: found });
});

test("a DB path not on disk yet is reported without trying breadcrumbs", () => {
  const missing = { ...found, exists: false };
  assert.deepEqual(decideOpen(missing, neverCalled), { resolved: missing });
});

test("unreachable items map to their reason without trying breadcrumbs", () => {
  assert.deepEqual(
    decideOpen(
      { unreachable: true, reason: "shared_drive_not_synced", drive: "TeamZ" },
      neverCalled
    ),
    { response: { ok: false, error: "shared_drive_not_synced", drive: "TeamZ" } }
  );
  assert.deepEqual(decideOpen({ unreachable: true, reason: "not_synced" }, neverCalled), {
    response: { ok: false, error: "not_synced" },
  });
});

test("breadcrumbs are the fallback only when the DB cannot answer", () => {
  assert.deepEqual(decideOpen(null, () => found), { resolved: found });
  assert.deepEqual(decideOpen(null, () => null), {
    response: { ok: false, error: "not_synced" },
  });
});

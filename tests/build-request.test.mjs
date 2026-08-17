import { test } from "node:test";
import assert from "node:assert/strict";

import { buildRequest } from "../extension/lib/build-request.js";

const folderParsed = { kind: "folder", id: "folderid001" };

test("folder page with no context opens the folder", () => {
  assert.deepEqual(buildRequest(folderParsed, null), {
    action: "open",
    itemId: "folderid001",
    breadcrumbs: [],
  });
});

test("exactly one selected item wins over the URL", () => {
  const context = { selectedIds: ["selected001"], breadcrumbs: ["マイドライブ"] };
  assert.deepEqual(buildRequest(folderParsed, context), {
    action: "open",
    itemId: "selected001",
    breadcrumbs: ["マイドライブ"],
  });
});

test("multiple selected items fall back to the URL folder", () => {
  const context = { selectedIds: ["a0000000001", "b0000000001"], breadcrumbs: [] };
  assert.deepEqual(buildRequest(folderParsed, context), {
    action: "open",
    itemId: "folderid001",
    breadcrumbs: [],
  });
});

test("special pages map to special targets", () => {
  assert.deepEqual(buildRequest({ kind: "myDrive" }, null), {
    action: "open",
    special: "myDrive",
  });
  assert.deepEqual(buildRequest({ kind: "sharedDrives" }, null), {
    action: "open",
    special: "sharedDrives",
  });
});

test("legacy item URLs open the item", () => {
  assert.deepEqual(buildRequest({ kind: "item", id: "itemid00001" }, null), {
    action: "open",
    itemId: "itemid00001",
    breadcrumbs: [],
  });
});

test("other pages need a single selection", () => {
  assert.deepEqual(buildRequest({ kind: "other" }, { selectedIds: ["sel00000001"] }), {
    action: "open",
    itemId: "sel00000001",
    breadcrumbs: [],
  });
  assert.equal(buildRequest({ kind: "other" }, { selectedIds: [] }), null);
  assert.equal(buildRequest({ kind: "other" }, null), null);
});

test("malformed context shapes are tolerated", () => {
  assert.deepEqual(buildRequest(folderParsed, { selectedIds: "x", breadcrumbs: "y" }), {
    action: "open",
    itemId: "folderid001",
    breadcrumbs: [],
  });
});

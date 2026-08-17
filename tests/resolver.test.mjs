import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { detectMountRoot } from "../host/lib/mount.mjs";
import {
  defaultDriveFsRoot,
  listAccountDbPaths,
  resolveBreadcrumbPath,
  resolveItemPath,
  resolveSpecialPath,
} from "../host/lib/resolver.mjs";
import { createFixture, FIXTURE_IDS } from "./fixtures.mjs";

// ---------------------------------------------------------------------------
// Fixture-based unit tests (machine independent)
// ---------------------------------------------------------------------------

const fixture = createFixture();
const opts = { driveFsRoot: fixture.driveFsRoot, mountRoot: fixture.mountRoot };
after(() => fixture.cleanup());

test("fixture: resolves a nested My Drive folder", () => {
  const result = resolveItemPath(FIXTURE_IDS.subFolder, opts);
  assert.equal(result.path, path.join(fixture.mountRoot, "My Drive", "FolderA", "Sub"));
  assert.equal(result.exists, true);
  assert.equal(result.isFolder, true);
});

test("fixture: resolves a file with isFolder=false", () => {
  const result = resolveItemPath(FIXTURE_IDS.file, opts);
  assert.equal(result.path, path.join(fixture.mountRoot, "My Drive", "FolderA", "note.txt"));
  assert.equal(result.exists, true);
  assert.equal(result.isFolder, false);
});

test("fixture: resolves shared drive folder and root", () => {
  const docs = resolveItemPath(FIXTURE_IDS.teamDocs, opts);
  assert.equal(docs.path, path.join(fixture.mountRoot, "Shared drives", "TeamX", "Docs"));
  assert.equal(docs.exists, true);
  const root = resolveItemPath(FIXTURE_IDS.teamRoot, opts);
  assert.equal(root.path, path.join(fixture.mountRoot, "Shared drives", "TeamX"));
});

test("fixture: resolves the My Drive root", () => {
  const result = resolveItemPath(FIXTURE_IDS.myDriveRoot, opts);
  assert.equal(result.path, path.join(fixture.mountRoot, "My Drive"));
  assert.equal(result.exists, true);
});

test("fixture: excludes trashed items", () => {
  assert.equal(resolveItemPath(FIXTURE_IDS.trashed, opts), null);
});

test("fixture: rejects unsafe DB titles", () => {
  assert.equal(resolveItemPath(FIXTURE_IDS.unsafeTitle, opts), null);
});

test("fixture: unknown and malformed IDs return null", () => {
  assert.equal(resolveItemPath("nosuchid0001", opts), null);
  assert.equal(resolveItemPath("../../etc", opts), null);
  assert.equal(resolveItemPath(123, opts), null);
  assert.equal(resolveItemPath("", opts), null);
});

test("fixture: breadcrumb fallback resolves valid roots only", () => {
  const myDrive = resolveBreadcrumbPath(["マイドライブ", "FolderA"], opts);
  assert.equal(myDrive.path, path.join(fixture.mountRoot, "My Drive", "FolderA"));

  const english = resolveBreadcrumbPath(["My Drive", "FolderA", "Sub"], opts);
  assert.equal(english.path, path.join(fixture.mountRoot, "My Drive", "FolderA", "Sub"));

  const shared = resolveBreadcrumbPath(["TeamX", "Docs"], opts);
  assert.equal(shared.path, path.join(fixture.mountRoot, "Shared drives", "TeamX", "Docs"));

  // Unsynced views must NOT fall back to My Drive
  assert.equal(resolveBreadcrumbPath(["共有アイテム"], opts), null);
  assert.equal(resolveBreadcrumbPath(["NoSuchRoot", "x"], opts), null);
  // Missing leaf under a valid root
  assert.equal(resolveBreadcrumbPath(["マイドライブ", "missing"], opts), null);
});

test("fixture: breadcrumb fallback rejects invalid input", () => {
  assert.equal(resolveBreadcrumbPath([], opts), null);
  assert.equal(resolveBreadcrumbPath(["ok", "bad\\..\\segment"], opts), null);
  assert.equal(resolveBreadcrumbPath(["ok", ".."], opts), null);
  assert.equal(resolveBreadcrumbPath("not-an-array", opts), null);
});

test("fixture: resolveSpecialPath maps targets and rejects prototype keys", () => {
  const myDrive = resolveSpecialPath("myDrive", opts);
  assert.equal(myDrive.path, path.join(fixture.mountRoot, "My Drive"));
  assert.equal(myDrive.exists, true);
  const shared = resolveSpecialPath("sharedDrives", opts);
  assert.equal(shared.path, path.join(fixture.mountRoot, "Shared drives"));
  assert.equal(resolveSpecialPath("nonsense", opts), null);
  assert.equal(resolveSpecialPath("constructor", opts), null);
  assert.equal(resolveSpecialPath("__proto__", opts), null);
  assert.equal(resolveSpecialPath(null, opts), null);
});

// ---------------------------------------------------------------------------
// Live integration tests against this machine's real DriveFS install.
// Real Drive IDs live in the gitignored tests/local-ids.json; both that file
// and a DriveFS install are required, otherwise these are skipped.
// ---------------------------------------------------------------------------

const loadLocalIds = () => {
  try {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "local-ids.json");
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

const localIds = loadLocalIds();
const driveFsAvailable = listAccountDbPaths(defaultDriveFsRoot()).length > 0;
const liveSkip =
  driveFsAvailable && localIds ? false : "requires DriveFS install + tests/local-ids.json";

test("live: detectMountRoot finds a drive containing My Drive", { skip: liveSkip }, () => {
  const mount = detectMountRoot();
  assert.ok(mount, "mount root should be detected");
  assert.match(mount, /^[A-Z]:\\$/);
  assert.ok(
    existsSync(path.join(mount, "My Drive")) || existsSync(path.join(mount, "Shared drives")),
    `expected My Drive or Shared drives under ${mount}`
  );
});

test("live: resolves known items from local-ids.json", { skip: liveSkip }, () => {
  for (const key of ["myDriveFolder", "sharedDriveFolder", "myDriveRoot", "sharedDriveRoot"]) {
    const entry = localIds[key];
    const result = resolveItemPath(entry.id);
    assert.ok(result, `${key} should resolve`);
    assert.equal(result.exists, true, `${key} should exist locally`);
    assert.match(result.path, new RegExp(entry.pathPattern), key);
  }
});

test("live: breadcrumb fallback resolves known trails", { skip: liveSkip }, () => {
  for (const key of ["myDriveBreadcrumbs", "sharedDriveBreadcrumbs"]) {
    const entry = localIds[key];
    const result = resolveBreadcrumbPath(entry.trail);
    assert.ok(result, `${key} should resolve`);
    assert.match(result.path, new RegExp(entry.pathPattern), key);
  }
});

test("live: unknown ID returns null", { skip: driveFsAvailable ? false : "no DriveFS" }, () => {
  assert.equal(resolveItemPath("0000000000_no_such_id_0000000000"), null);
});

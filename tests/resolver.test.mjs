import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { detectMountRoot } from "../host/lib/mount.mjs";
import {
  defaultDriveFsRoot,
  isSafeSegment,
  listAccountDbPaths,
  resolveBreadcrumbPath,
  resolveItemPath,
  resolveSpecialPath,
} from "../host/lib/resolver.mjs";
import { myDriveDir, sharedDrivesDir } from "../host/lib/special-folders.mjs";
import {
  createFixture,
  createMultiAccountFixture,
  createShortcutFixture,
  FIXTURE_IDS,
  MULTI_IDS,
  SHORTCUT_IDS,
  SPECIAL_TITLE,
} from "./fixtures.mjs";

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
  assert.equal(resolveBreadcrumbPath(["ok", "bad\\..\\segment"], { ...opts, platform: "win32" }), null);
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
// Multi-account fixtures: two accounts, each on its own mount root.
// ---------------------------------------------------------------------------

const multi = createMultiAccountFixture();
const multiOpts = {
  driveFsRoot: multi.driveFsRoot,
  mountRoots: [multi.mountA, multi.mountB],
};
after(() => multi.cleanup());

test("multi-account: item resolves on a later mount root", () => {
  // Regression for the multi-account bug: another account's root (mountA)
  // comes first, but the item only exists under mountB.
  const result = resolveItemPath(MULTI_IDS.reports, multiOpts);
  assert.equal(result.path, path.join(multi.mountB, "Shared drives", "TeamY", "Reports"));
  assert.equal(result.exists, true);
  assert.equal(result.mountRoot, multi.mountB);
});

test("multi-account: same cloud ID across DBs resolves where it exists", () => {
  // Account 111111's DB answers first with an unsynced chain; the scan must
  // continue to account 222222 whose chain is on disk.
  const result = resolveItemPath(MULTI_IDS.shadow, multiOpts);
  assert.equal(result.path, path.join(multi.mountB, "Shared drives", "TeamY", "Shadow"));
  assert.equal(result.exists, true);
});

test("multi-account: full miss keeps the first candidate for error display", () => {
  const result = resolveItemPath(MULTI_IDS.missing, multiOpts);
  assert.equal(result.exists, false);
  assert.equal(result.path, path.join(multi.mountA, "My Drive", "Nowhere"));
  assert.equal(result.mountRoot, multi.mountA);
});

test("multi-account: an item unreachable in one account resolves where another has it", () => {
  const result = resolveItemPath(MULTI_IDS.visitor, multiOpts);
  assert.equal(result.path, path.join(multi.mountB, "Shared drives", "TeamY", "Visitor"));
  assert.equal(result.exists, true);
});

test("multi-account: unreachable everywhere reports unreachable", () => {
  const result = resolveItemPath(MULTI_IDS.stranded, multiOpts);
  assert.equal(result.unreachable, true);
  assert.equal(result.reason, "not_synced");
});

test("multi-account: an expected-but-missing location wins over unreachable", () => {
  const result = resolveItemPath(MULTI_IDS.pending, multiOpts);
  assert.equal(result.unreachable, undefined);
  assert.equal(result.exists, false);
  assert.equal(result.path, path.join(multi.mountA, "My Drive", "Pending"));
});

test("multi-account: breadcrumb fallback scans all mount roots", () => {
  const result = resolveBreadcrumbPath(["TeamY", "Reports"], multiOpts);
  assert.equal(result.path, path.join(multi.mountB, "Shared drives", "TeamY", "Reports"));
  assert.equal(resolveBreadcrumbPath(["共有アイテム"], multiOpts), null);
});

// ---------------------------------------------------------------------------
// Items outside every synced root: excluded shared drives, shared-with-me
// items, and the shortcuts that make them local.
// ---------------------------------------------------------------------------

const shortcuts = createShortcutFixture();
const scOpts = { driveFsRoot: shortcuts.driveFsRoot, mountRoot: shortcuts.mountRoot };
const scPath = (...segments) => path.join(shortcuts.mountRoot, ...segments);
const byIdPath = (id, ...segments) => scPath(".shortcut-targets-by-id", id, ...segments);
after(() => shortcuts.cleanup());

test("shortcut: My Drive is identified by root_id, not by its title", () => {
  const result = resolveItemPath(SHORTCUT_IDS.docs, scOpts);
  assert.equal(result.path, scPath("My Drive", "Docs"));
  assert.equal(result.exists, true);
});

test("shortcut: excluded drive items resolve below the target's by-id folder", () => {
  const clip = resolveItemPath(SHORTCUT_IDS.clip, scOpts);
  assert.equal(clip.path, byIdPath(SHORTCUT_IDS.year, "Year", "Proj", "clip.mp4"));
  assert.equal(clip.isFolder, false);
  const target = resolveItemPath(SHORTCUT_IDS.year, scOpts);
  assert.equal(target.path, byIdPath(SHORTCUT_IDS.year, "Year"));
});

test("shortcut: a nested target lives below the outermost exposed ancestor", () => {
  const result = resolveItemPath(SHORTCUT_IDS.deep, scOpts);
  assert.equal(result.path, byIdPath(SHORTCUT_IDS.year, "Year", "Proj", "Nested", "Deep"));
});

test("shortcut: falls back to the shortcut's own (renamed) location", () => {
  // No by-id entry for Lazy yet; its shortcut "Lazy 2" sits in My Drive.
  const result = resolveItemPath(SHORTCUT_IDS.lazyInner, scOpts);
  assert.equal(result.path, scPath("My Drive", "Lazy 2", "Inner"));
});

test("shortcut: a shortcut inside another exposed target makes its target local", () => {
  const result = resolveItemPath(SHORTCUT_IDS.chain, scOpts);
  assert.equal(result.path, byIdPath(SHORTCUT_IDS.chain, "Chain"));
});

test("shortcut: shared-with-me folders resolve via their shortcut", () => {
  const root = resolveItemPath(SHORTCUT_IDS.sharedWithMe, scOpts);
  assert.equal(root.path, byIdPath(SHORTCUT_IDS.sharedWithMe, "Shared"));
  const inner = resolveItemPath(SHORTCUT_IDS.sharedWithMeInner, scOpts);
  assert.equal(inner.path, byIdPath(SHORTCUT_IDS.sharedWithMe, "Shared", "Inner"));
});

test("shortcut: a shared-with-me file resolves at its file shortcut", () => {
  const result = resolveItemPath(SHORTCUT_IDS.deck, scOpts);
  assert.equal(result.path, scPath("Shared drives", "Synced", "Hub", "deck.gslides"));
  assert.equal(result.isFolder, false);
});

test("shortcut: shared-with-me items without a shortcut never resolve to My Drive", () => {
  // Regression: a parentless title used to collapse to the My Drive folder.
  for (const id of [SHORTCUT_IDS.lonely, SHORTCUT_IDS.fakeMyDrive, SHORTCUT_IDS.floating]) {
    const result = resolveItemPath(id, scOpts);
    assert.equal(result.unreachable, true, id);
    assert.equal(result.reason, "not_synced", id);
  }
});

test("shortcut: excluded drive items without a local shortcut are shared_drive_not_synced", () => {
  // Orphan: no shortcut. Island: only shortcut sits in an unreachable place.
  // Loop / PingA / PingB: shortcut cycles. Trashy: only shortcut is trashed.
  for (const id of [
    SHORTCUT_IDS.unsyncedRoot,
    SHORTCUT_IDS.orphan,
    SHORTCUT_IDS.island,
    SHORTCUT_IDS.loop,
    SHORTCUT_IDS.pingA,
    SHORTCUT_IDS.pingB,
    SHORTCUT_IDS.trashy,
  ]) {
    const result = resolveItemPath(id, scOpts);
    assert.equal(result.unreachable, true, id);
    assert.equal(result.reason, "shared_drive_not_synced", id);
    assert.equal(result.drive, "Unsynced", id);
  }
});

test("shortcut: a stale unsynced flag still finds the drive's own folder", () => {
  const result = resolveItemPath(SHORTCUT_IDS.staleKept, scOpts);
  assert.equal(result.path, scPath("Shared drives", "Stale", "Kept"));
  assert.equal(result.exists, true);
});

test("shortcut: a reachable item not on disk yet reports its by-id location", () => {
  const result = resolveItemPath(SHORTCUT_IDS.pending, scOpts);
  assert.equal(result.exists, false);
  assert.equal(result.unreachable, undefined);
  assert.equal(result.path, byIdPath(SHORTCUT_IDS.year, "Year", "Pending"));
});

test(
  "titles with * < > : resolve on macOS",
  { skip: process.platform === "win32" ? "cannot create such names on Windows" : false },
  () => {
    const result = resolveItemPath(SHORTCUT_IDS.specialTitle, { ...scOpts, platform: "darwin" });
    assert.equal(result.path, scPath("My Drive", SPECIAL_TITLE));
    assert.equal(result.exists, true);
  }
);

test("titles with * < > : are rejected on Windows", () => {
  assert.equal(
    resolveItemPath(SHORTCUT_IDS.specialTitle, { ...scOpts, platform: "win32" }),
    null
  );
});

test("isSafeSegment applies per-platform rules", () => {
  for (const segment of ["J24**_x", "<a>", "a:b", "a\\b", "a."]) {
    assert.equal(isSafeSegment(segment, "darwin"), true, segment);
  }
  for (const segment of ["J24**_x", "<a>", "a:b", "a\\b", "a.", "a ", "CON", "con.txt", "LPT1"]) {
    assert.equal(isSafeSegment(segment, "win32"), false, segment);
  }
  for (const platform of ["darwin", "win32"]) {
    for (const segment of ["", ".", "..", "a/b", "a\0b", "x".repeat(256), null]) {
      assert.equal(isSafeSegment(segment, platform), false, `${platform}: ${segment}`);
    }
    assert.equal(isSafeSegment("Docs", platform), true);
  }
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

test("live: detectMountRoot finds a mount containing My Drive", { skip: liveSkip }, () => {
  const mount = detectMountRoot();
  assert.ok(mount, "mount root should be detected");
  assert.match(mount, process.platform === "darwin" ? /\/GoogleDrive-[^/]+\/$/ : /^[A-Z]:\\$/);
  assert.ok(
    existsSync(myDriveDir(mount)) || existsSync(sharedDrivesDir(mount)),
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

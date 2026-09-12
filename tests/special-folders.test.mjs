import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { myDriveDir, sharedDrivesDir } from "../host/lib/special-folders.mjs";
import {
  resolveBreadcrumbPath,
  resolveItemPath,
  resolveSpecialPath,
} from "../host/lib/resolver.mjs";
import { createLocalizedFixture, LOCALIZED_IDS } from "./fixtures.mjs";

test("Windows always uses the fixed English folder names, regardless of options.platform", () => {
  const mountRoot = "C:\\fake\\";
  assert.equal(myDriveDir(mountRoot, { platform: "win32" }), path.join(mountRoot, "My Drive"));
  assert.equal(
    sharedDrivesDir(mountRoot, { platform: "win32" }),
    path.join(mountRoot, "Shared drives")
  );
});

// ---------------------------------------------------------------------------
// Regression: real macOS mounts localize the top-level folder names, and the
// "Shared drives" container has no DriveFS DB entry of its own.
// ---------------------------------------------------------------------------

const localized = createLocalizedFixture();
after(() => localized.cleanup());
const darwinOpts = {
  driveFsRoot: localized.driveFsRoot,
  mountRoot: localized.mountRoot,
  platform: "darwin",
};

test("myDriveDir/sharedDrivesDir find the localized folders on disk", () => {
  assert.equal(
    myDriveDir(localized.mountRoot, { platform: "darwin" }),
    path.join(localized.mountRoot, "マイドライブ")
  );
  assert.equal(
    sharedDrivesDir(localized.mountRoot, { platform: "darwin" }),
    path.join(localized.mountRoot, "共有ドライブ")
  );
});

test("resolveItemPath resolves a My Drive item under the localized folder", () => {
  const result = resolveItemPath(LOCALIZED_IDS.folderA, darwinOpts);
  assert.equal(result.path, path.join(localized.mountRoot, "マイドライブ", "FolderA"));
  assert.equal(result.exists, true);
});

test("resolveItemPath resolves a Shared drive item with no DB entry for the container folder", () => {
  const result = resolveItemPath(LOCALIZED_IDS.teamDocs, darwinOpts);
  assert.equal(result.path, path.join(localized.mountRoot, "共有ドライブ", "TeamX", "Docs"));
  assert.equal(result.exists, true);
});

test("resolveBreadcrumbPath resolves a shared drive breadcrumb via the localized container", () => {
  const result = resolveBreadcrumbPath(["TeamX", "Docs"], darwinOpts);
  assert.equal(result.path, path.join(localized.mountRoot, "共有ドライブ", "TeamX", "Docs"));
});

test("resolveSpecialPath resolves both targets to the localized folders", () => {
  const myDrive = resolveSpecialPath("myDrive", darwinOpts);
  assert.equal(myDrive.path, path.join(localized.mountRoot, "マイドライブ"));
  assert.equal(myDrive.exists, true);

  const shared = resolveSpecialPath("sharedDrives", darwinOpts);
  assert.equal(shared.path, path.join(localized.mountRoot, "共有ドライブ"));
  assert.equal(shared.exists, true);
});

// ---------------------------------------------------------------------------
// Locale-name heuristic: names beyond the known English/Japanese list.
// ---------------------------------------------------------------------------

const buildMountDir = (...topLevelNames) => {
  const base = mkdtempSync(path.join(tmpdir(), "olg-locale-"));
  const mountRoot = path.join(base, "mount") + path.sep;
  for (const name of topLevelNames) mkdirSync(path.join(mountRoot, name), { recursive: true });
  mkdirSync(path.join(mountRoot, ".shortcut-targets-by-id"), { recursive: true });
  return { base, mountRoot, cleanup: () => rmSync(base, { recursive: true, force: true }) };
};

test("unrecognized locale: falls back to 'the other top-level directory'", () => {
  const fixture = buildMountDir("My Drive", "Unità condivise");
  try {
    assert.equal(
      sharedDrivesDir(fixture.mountRoot, { platform: "darwin" }),
      path.join(fixture.mountRoot, "Unità condivise")
    );
  } finally {
    fixture.cleanup();
  }
});

test("ambiguous mount (3+ top-level directories): falls back to the safe default rather than guessing", () => {
  const fixture = buildMountDir("My Drive", "Mystery A", "Mystery B");
  try {
    assert.equal(
      sharedDrivesDir(fixture.mountRoot, { platform: "darwin" }),
      path.join(fixture.mountRoot, "Shared drives")
    );
  } finally {
    fixture.cleanup();
  }
});

test("hidden top-level entries are never treated as candidates", () => {
  const fixture = buildMountDir("My Drive");
  try {
    // Only ".shortcut-targets-by-id" (hidden) exists besides My Drive, so
    // there are zero usable candidates -> safe default.
    assert.equal(
      sharedDrivesDir(fixture.mountRoot, { platform: "darwin" }),
      path.join(fixture.mountRoot, "Shared drives")
    );
  } finally {
    fixture.cleanup();
  }
});

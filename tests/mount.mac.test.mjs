import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { detectMountRoots, mountRootsForAccount } from "../host/lib/mount.mac.mjs";

// Mirrors this repo's real ~/Library/CloudStorage layout, where unrelated
// CloudStorage providers (MacDroid, Synology Drive, ...) sit alongside
// Google Drive's own GoogleDrive-<account> directories.
const createCloudStorageFixture = () => {
  const cloudStorageRoot = mkdtempSync(path.join(tmpdir(), "olg-cloudstorage-"));
  const makeMount = (name, hasContent) => {
    const dir = path.join(cloudStorageRoot, name);
    mkdirSync(dir, { recursive: true });
    if (hasContent) mkdirSync(path.join(dir, "My Drive"), { recursive: true });
  };
  makeMount("GoogleDrive-a@example.com", true);
  makeMount("GoogleDrive-b@example.com", true);
  makeMount("GoogleDrive-empty@example.com", false);
  makeMount("MacDroid-somePhone", true);
  makeMount("SynologyDrive-home", true);
  const cleanup = () => rmSync(cloudStorageRoot, { recursive: true, force: true });
  return { cloudStorageRoot, cleanup };
};

const fixture = createCloudStorageFixture();
after(() => fixture.cleanup());

test("detectMountRoots only matches GoogleDrive- prefixed directories with content", () => {
  const roots = detectMountRoots({ cloudStorageRoot: fixture.cloudStorageRoot });
  assert.equal(roots.length, 2);
  assert.ok(roots.every((root) => root.includes("GoogleDrive-")));
  assert.ok(!roots.some((root) => root.includes("MacDroid") || root.includes("SynologyDrive")));
  assert.ok(!roots.some((root) => root.includes("GoogleDrive-empty")));
});

test("detectMountRoots resolves gracefully when CloudStorage is missing", () => {
  const roots = detectMountRoots({ cloudStorageRoot: path.join(fixture.cloudStorageRoot, "nope") });
  assert.deepEqual(roots, []);
});

test("mountRootsForAccount tries all detected roots (no per-account preference source)", () => {
  const roots = detectMountRoots({ cloudStorageRoot: fixture.cloudStorageRoot });
  assert.deepEqual(mountRootsForAccount("anyAccount", { roots }), roots);
});

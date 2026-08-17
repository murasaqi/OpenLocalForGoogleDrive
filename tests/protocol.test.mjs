import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { encodeMessage } from "../host/lib/framing.mjs";
import { defaultDriveFsRoot, listAccountDbPaths } from "../host/lib/resolver.mjs";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const hostPath = path.join(testsDir, "..", "host", "open-local-host.mjs");

const loadLocalIds = () => {
  try {
    return JSON.parse(readFileSync(path.join(testsDir, "local-ids.json"), "utf8"));
  } catch {
    return null;
  }
};

const localIds = loadLocalIds();
const driveFsAvailable = listAccountDbPaths(defaultDriveFsRoot()).length > 0;
const dbSkip = driveFsAvailable ? false : "Google DriveFS metadata DB not found";
const liveSkip =
  driveFsAvailable && localIds ? false : "requires DriveFS install + tests/local-ids.json";

// Spawns the host, sends one framed message, returns the decoded response.
const roundTrip = (message) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--no-warnings", hostPath], {
      stdio: ["pipe", "pipe", "inherit"],
    });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", () => {
      try {
        const buffer = Buffer.concat(chunks);
        assert.ok(buffer.length >= 4, "response should include a length header");
        const length = buffer.readUInt32LE(0);
        assert.equal(buffer.length, 4 + length, "response should be exactly one frame");
        resolve(JSON.parse(buffer.subarray(4).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.write(encodeMessage(message));
  });

test("ping round-trip", async () => {
  const response = await roundTrip({ action: "ping" });
  assert.deepEqual(response, { ok: true, pong: true });
});

test("dryRun open resolves a known folder without launching Explorer", { skip: liveSkip }, async () => {
  const entry = localIds.myDriveFolder;
  const response = await roundTrip({ action: "open", itemId: entry.id, dryRun: true });
  assert.equal(response.ok, true);
  assert.match(response.path, new RegExp(entry.pathPattern));
  assert.equal(response.selected, false);
});

test("dryRun open of special myDrive target", { skip: dbSkip }, async () => {
  const response = await roundTrip({ action: "open", special: "myDrive", dryRun: true });
  assert.equal(response.ok, true);
  assert.match(response.path, /My Drive$/);
});

test("unknown ID reports not_synced", { skip: dbSkip }, async () => {
  const response = await roundTrip({
    action: "open",
    itemId: "0000000000_no_such_id_0000000000",
    dryRun: true,
  });
  assert.deepEqual(response, { ok: false, error: "not_synced" });
});

test("unsynced breadcrumbs do not fall back to My Drive", { skip: dbSkip }, async () => {
  const response = await roundTrip({
    action: "open",
    itemId: "0000000000_no_such_id_0000000000",
    breadcrumbs: ["共有アイテム"],
    dryRun: true,
  });
  assert.deepEqual(response, { ok: false, error: "not_synced" });
});

test("open without itemId or special is bad_request", async () => {
  const response = await roundTrip({ action: "open", dryRun: true });
  assert.deepEqual(response, { ok: false, error: "bad_request" });
});

test("malformed request reports bad_request", async () => {
  const response = await roundTrip({ action: "explode" });
  assert.deepEqual(response, { ok: false, error: "bad_request" });
});

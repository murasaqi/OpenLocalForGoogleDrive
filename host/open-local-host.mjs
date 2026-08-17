import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { encodeMessage, readMessage } from "./lib/framing.mjs";
import { detectMountRoot } from "./lib/mount.mjs";
import {
  defaultDriveFsRoot,
  listAccountDbPaths,
  resolveBreadcrumbPath,
  resolveItemPath,
  resolveSpecialPath,
} from "./lib/resolver.mjs";

const EXPLORER_EXE = path.join(process.env.SystemRoot ?? "C:\\Windows", "explorer.exe");
const LOG_PATH = path.join(tmpdir(), "open-local-gdrive-host.log");

// Local diagnostics only; the file lives in the user's %TEMP%.
const logLine = (kind, data) => {
  try {
    appendFileSync(
      LOG_PATH,
      `${JSON.stringify({ t: new Date().toISOString(), kind, ...data })}\n`
    );
  } catch {
    // logging must never break the protocol
  }
};

const EXPLORER_EXIT_WAIT_MS = 3000;

// Explorer parses its raw command line, so build it verbatim. Windows file
// names cannot contain double quotes, which makes this quoting injection-safe.
//
// The spawned explorer.exe only delegates to the running shell and exits
// (~400ms). Chrome may kill our process tree as soon as the host exits, so
// wait for that delegation to finish before we respond. Resolves to whether
// the launch is believed to have succeeded.
const openInExplorer = (targetPath, selectFile) =>
  new Promise((resolve) => {
    const arg = selectFile ? `/select,"${targetPath}"` : `"${targetPath}"`;
    let child;
    try {
      child = spawn(EXPLORER_EXE, [arg], {
        stdio: "ignore",
        windowsVerbatimArguments: true,
      });
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      child.unref();
      resolve(true);
    }, EXPLORER_EXIT_WAIT_MS);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    // explorer.exe exits with code 1 even on success, so the code is ignored
    child.on("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });

// A resolved path must stay inside its mount root (path.join already
// normalized any ".." segments, so reject anything that escapes).
const isContained = (resolved) => {
  const relative = path.relative(resolved.mountRoot, resolved.path);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const openResolved = async (resolved, dryRun) => {
  if (!isContained(resolved)) return { ok: false, error: "invalid_path" };
  if (!resolved.exists) return { ok: false, error: "path_missing", path: resolved.path };
  const selectFile = !resolved.isFolder;
  if (!dryRun) {
    const launched = await openInExplorer(resolved.path, selectFile);
    if (!launched) return { ok: false, error: "explorer_failed", path: resolved.path };
  }
  return { ok: true, path: resolved.path, selected: selectFile };
};

const handleOpen = (request) => {
  if (!detectMountRoot()) return { ok: false, error: "mount_not_found" };

  if (request.special !== undefined) {
    const special = resolveSpecialPath(request.special);
    if (!special) return { ok: false, error: "bad_request" };
    return openResolved(special, request.dryRun);
  }

  if (typeof request.itemId !== "string") return { ok: false, error: "bad_request" };

  const dbPaths = listAccountDbPaths(defaultDriveFsRoot());
  if (dbPaths.length === 0) return { ok: false, error: "db_not_found" };

  const fromDb = resolveItemPath(request.itemId, { dbPaths });
  const resolved =
    fromDb && fromDb.exists
      ? fromDb
      : resolveBreadcrumbPath(request.breadcrumbs) ?? fromDb;
  if (!resolved) return { ok: false, error: "not_synced" };
  return openResolved(resolved, request.dryRun);
};

const handleRequest = async (request) => {
  try {
    if (!request || typeof request !== "object") return { ok: false, error: "bad_request" };
    if (request.action === "ping") return { ok: true, pong: true };
    if (request.action === "log") {
      logLine("extension", { data: request.data });
      return { ok: true };
    }
    if (request.action === "open") return await handleOpen(request);
    return { ok: false, error: "bad_request" };
  } catch (error) {
    return { ok: false, error: "internal", detail: String(error?.message ?? error) };
  }
};

const main = async () => {
  const request = await readMessage(process.stdin).catch(() => null);
  const response = await handleRequest(request);
  if (request?.action !== "log") {
    logLine("request", { request, response });
  }
  process.stdout.write(encodeMessage(response), () => process.exit(0));
};

main().catch(() => {
  process.stdout.write(encodeMessage({ ok: false, error: "internal" }), () =>
    process.exit(1)
  );
});

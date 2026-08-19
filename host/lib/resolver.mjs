import { DatabaseSync } from "node:sqlite";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { detectMountRoot, detectMountRoots, mountRootsForAccount } from "./mount.mjs";

const CLOUD_ID_PATTERN = /^[-\w]{5,120}$/;
const MAX_PARENT_DEPTH = 100;
const MY_DRIVE_ROOT_NAMES = new Set(["My Drive", "マイドライブ"]);

// DB titles and page breadcrumbs are untrusted input for filesystem paths.
const isSafeSegment = (segment) =>
  typeof segment === "string" &&
  segment.length > 0 &&
  segment.length <= 255 &&
  !/[\\/:*?"<>|]/.test(segment) &&
  segment !== "." &&
  segment !== "..";

export const defaultDriveFsRoot = () => {
  if (!process.env.LOCALAPPDATA) return null;
  return path.join(process.env.LOCALAPPDATA, "Google", "DriveFS");
};

export const listAccountDbPaths = (driveFsRoot = defaultDriveFsRoot()) => {
  if (!driveFsRoot) return [];
  try {
    return readdirSync(driveFsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
      .map((entry) => path.join(driveFsRoot, entry.name, "metadata_sqlite_db"))
      .filter((dbPath) => existsSync(dbPath));
  } catch {
    return [];
  }
};

// Looks up the item chain (item -> ... -> root) in one DriveFS metadata DB.
// Returns null when the cloud ID is unknown to this account. Throws on
// schema mismatches; callers treat that as "this DB cannot answer".
const lookupInDb = (dbPath, cloudId) => {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const item = db
      .prepare(
        `SELECT stable_id, local_title, is_folder, team_drive_stable_id
         FROM items
         WHERE id = ?
           AND (is_tombstone IS NULL OR is_tombstone = 0)
           AND (trashed IS NULL OR trashed = 0)`
      )
      .get(cloudId);
    if (!item) return null;

    const parentStmt = db.prepare(
      "SELECT parent_stable_id FROM stable_parents WHERE item_stable_id = ?"
    );
    const titleStmt = db.prepare(
      "SELECT local_title FROM items WHERE stable_id = ?"
    );

    const titles = [item.local_title];
    let current = item.stable_id;
    for (let depth = 0; depth < MAX_PARENT_DEPTH; depth++) {
      const parent = parentStmt.get(current);
      if (!parent) break;
      current = parent.parent_stable_id;
      const row = titleStmt.get(current);
      if (!row) break;
      titles.push(row.local_title);
    }

    return {
      parts: titles.reverse(),
      isFolder: Boolean(item.is_folder),
      sharedDriveHint: Boolean(item.team_drive_stable_id),
    };
  } finally {
    db.close();
  }
};

// The DB stores the localized root title (e.g. マイドライブ) while the actual
// folder on the mount is always "My Drive" / "Shared drives". Build candidate
// paths for both interpretations and let filesystem existence decide.
const candidatePaths = (parts, sharedDriveHint, mountRoot) => {
  const [root, ...rest] = parts;
  const asSharedDrive = path.join(mountRoot, "Shared drives", root, ...rest);
  const asMyDrive = path.join(mountRoot, "My Drive", ...rest);
  const asLiteral = path.join(mountRoot, ...parts);
  return sharedDriveHint && !MY_DRIVE_ROOT_NAMES.has(root)
    ? [asSharedDrive, asMyDrive, asLiteral]
    : [asMyDrive, asSharedDrive, asLiteral];
};

// The same cloud ID can exist in several account DBs (e.g. a shared drive
// both accounts are members of) and each account may be mounted on its own
// drive letter, so keep scanning DBs and mount roots until a candidate path
// actually exists. The first miss is kept so a not-yet-synced item still
// reports the most likely path it was expected at.
export const resolveItemPath = (cloudId, options = {}) => {
  if (typeof cloudId !== "string" || !CLOUD_ID_PATTERN.test(cloudId)) return null;

  const dbPaths =
    options.dbPaths ?? listAccountDbPaths(options.driveFsRoot ?? defaultDriveFsRoot());
  let firstMiss = null;
  for (const dbPath of dbPaths) {
    let found;
    try {
      found = lookupInDb(dbPath, cloudId);
    } catch {
      continue; // corrupt DB or schema change: try the next account
    }
    if (!found) continue;
    if (!found.parts.every(isSafeSegment)) continue;

    const accountId = path.basename(path.dirname(dbPath));
    const mountRoots =
      options.mountRoots ??
      (options.mountRoot ? [options.mountRoot] : mountRootsForAccount(accountId));

    for (const mountRoot of mountRoots) {
      const candidates = candidatePaths(found.parts, found.sharedDriveHint, mountRoot);
      const existing = candidates.find((candidate) => existsSync(candidate));
      if (existing) {
        return { path: existing, exists: true, isFolder: found.isFolder, mountRoot };
      }
      firstMiss ??= {
        path: candidates[0],
        exists: false,
        isFolder: found.isFolder,
        mountRoot,
      };
    }
  }
  return firstMiss;
};

// Fallback used when the metadata DB cannot resolve an ID (e.g. schema
// change after a DriveFS update): resolve by the breadcrumb titles scraped
// from the Drive web page. The root segment must map to an actual root
// (My Drive or an existing shared drive) so unsynced views like 共有アイテム
// never silently resolve to the wrong folder.
export const resolveBreadcrumbPath = (breadcrumbs, options = {}) => {
  if (!Array.isArray(breadcrumbs) || breadcrumbs.length === 0) return null;
  if (!breadcrumbs.every(isSafeSegment)) return null;
  const mountRoots =
    options.mountRoots ?? (options.mountRoot ? [options.mountRoot] : detectMountRoots());

  for (const mountRoot of mountRoots) {
    const [root, ...rest] = breadcrumbs;
    const base = MY_DRIVE_ROOT_NAMES.has(root)
      ? path.join(mountRoot, "My Drive")
      : path.join(mountRoot, "Shared drives", root);
    if (!existsSync(base)) continue;

    const fullPath = path.join(base, ...rest);
    if (!existsSync(fullPath)) continue;
    return { path: fullPath, exists: true, isFolder: true, mountRoot };
  }
  return null;
};

export const resolveSpecialPath = (target, options = {}) => {
  const specialDirs = { myDrive: "My Drive", sharedDrives: "Shared drives" };
  if (typeof target !== "string" || !Object.hasOwn(specialDirs, target)) return null;
  const mountRoot = options.mountRoot ?? detectMountRoot();
  if (!mountRoot) return null;
  const specialPath = path.join(mountRoot, specialDirs[target]);
  return { path: specialPath, exists: existsSync(specialPath), isFolder: true, mountRoot };
};

import { DatabaseSync } from "node:sqlite";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { detectMountRoot, detectMountRoots, mountRootsForAccount } from "./mount.mjs";
import { myDriveDir, sharedDrivesDir } from "./special-folders.mjs";

const CLOUD_ID_PATTERN = /^[-\w]{5,120}$/;
const MAX_PARENT_DEPTH = 100;
const MAX_SHORTCUT_HOPS = 5;
const MAX_LOCATIONS = 16;
const MY_DRIVE_ROOT_NAMES = new Set(["My Drive", "マイドライブ"]);
const SHORTCUT_TARGETS_DIR = ".shortcut-targets-by-id";
const UNSYNCED_DRIVE_KEY = "shared-drive-unsynced";
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

// DB titles and page breadcrumbs are untrusted input for filesystem paths.
// macOS only forbids "/" in a name, so titles such as "J24**_x" or "<a>"
// exist on disk verbatim. Windows forbids more characters and silently
// drops trailing dots/spaces and maps device names, either of which could
// make a different path match.
export const isSafeSegment = (segment, platform = process.platform) => {
  if (typeof segment !== "string" || segment.length === 0 || segment.length > 255) return false;
  if (segment === "." || segment === ".." || segment.includes("\0")) return false;
  if (platform === "darwin") return !segment.includes("/");
  return (
    !/[\\/:*?"<>|]/.test(segment) &&
    !/[. ]$/.test(segment) &&
    !WINDOWS_RESERVED_NAME.test(segment)
  );
};

export const defaultDriveFsRoot = () => {
  if (process.platform === "darwin") {
    return path.join(homedir(), "Library", "Application Support", "Google", "DriveFS");
  }
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

// Optional DriveFS tables (absent from older schemas and minimal fixtures)
// read as "no rows".
const optionalRows = (db, sql, ...params) => {
  try {
    return db.prepare(sql).all(...params);
  } catch {
    return [];
  }
};

// Per-DB facts that decide where (and whether) an item appears locally:
// which item is the My Drive root, which shared drives the user excluded
// via "Manage shared drives", and which live shortcuts point at an item.
const readDbContext = (db) => {
  const rootId =
    optionalRows(db, "SELECT CAST(value AS TEXT) AS id FROM properties WHERE property = 'root_id'")[0]
      ?.id ?? null;
  const unsyncedDrives = new Set(
    optionalRows(
      db,
      "SELECT item_stable_id, CAST(value AS TEXT) AS flag FROM item_properties WHERE key = ?",
      UNSYNCED_DRIVE_KEY
    )
      .filter((row) => row.flag !== "0")
      .map((row) => row.item_stable_id)
  );

  // shortcut_details has no index on the target, so load it once, lazily.
  let shortcutsByTarget = null;
  const shortcutsTo = (targetStableId) => {
    shortcutsByTarget ??= optionalRows(
      db,
      `SELECT sd.shortcut_stable_id AS shortcut, sd.target_stable_id AS target
       FROM shortcut_details sd
       JOIN items s ON s.stable_id = sd.shortcut_stable_id
       WHERE (s.is_tombstone IS NULL OR s.is_tombstone = 0)
         AND (s.trashed IS NULL OR s.trashed = 0)`
    ).reduce(
      (map, row) => map.set(row.target, [...(map.get(row.target) ?? []), row.shortcut]),
      new Map()
    );
    return shortcutsByTarget.get(targetStableId) ?? [];
  };

  return {
    rootId,
    unsyncedDrives,
    shortcutsTo,
    nodeStmt: db.prepare(
      `SELECT stable_id, id, local_title, is_folder, team_drive_stable_id
       FROM items WHERE stable_id = ?`
    ),
    parentStmt: db.prepare("SELECT parent_stable_id FROM stable_parents WHERE item_stable_id = ?"),
  };
};

// Top-down chain of nodes ending at the item. null when a parent row is
// missing or the chain is implausibly deep: the DB cannot place the item.
const loadChain = (ctx, stableId) => {
  const nodes = [];
  let current = stableId;
  for (let depth = 0; depth < MAX_PARENT_DEPTH; depth++) {
    const node = ctx.nodeStmt.get(current);
    if (!node) return null;
    nodes.push(node);
    const parent = ctx.parentStmt.get(current);
    if (!parent) return nodes.reverse();
    current = parent.parent_stable_id;
  }
  return null;
};

// Without root_id (older schemas) fall back to the known root titles.
const isMyDriveRoot = (ctx, top) =>
  ctx.rootId
    ? top.id === ctx.rootId
    : top.team_drive_stable_id == null && MY_DRIVE_ROOT_NAMES.has(top.local_title);

const isSharedDriveRoot = (top) =>
  top.team_drive_stable_id != null && top.stable_id === top.team_drive_stable_id;

// Where an item appears under a mount root, derived from the DB alone:
//   { locations: [{ base, segments, report }], unreachable: null | { reason, drive? } }
// base is "myDrive", "sharedDrives" or "mount". report marks a location the
// item is expected at, so a miss there means "not synced yet"; unreported
// ones are only worth a look. null means the DB cannot place the item.
const locate = (ctx, stableId, visited = new Set()) => {
  const chain = loadChain(ctx, stableId);
  if (!chain) return null;
  const top = chain[0];
  const titles = chain.map((node) => node.local_title);

  if (isMyDriveRoot(ctx, top)) {
    return {
      locations: [{ base: "myDrive", segments: titles.slice(1), report: true }],
      unreachable: null,
    };
  }
  const inSharedDrive = isSharedDriveRoot(top);
  const asSharedDrive = { base: "sharedDrives", segments: titles, report: true };
  if (inSharedDrive && !ctx.unsyncedDrives.has(top.stable_id)) {
    return { locations: [asSharedDrive], unreachable: null };
  }

  // Outside every synced root (an excluded shared drive, or an item shared
  // with the user) an item is local only below a shortcut that is itself
  // local. DriveFS links such a shortcut to
  // .shortcut-targets-by-id/<target id>/<target title>, and a target nested
  // in another exposed target lives below the outermost one, so those paths
  // go topmost first. The shortcut's own location, which also covers file
  // shortcuts and by-id entries that only appear once accessed, goes
  // nearest first.
  const byTargetId = [];
  const viaShortcut = [];
  if (visited.size < MAX_SHORTCUT_HOPS) {
    chain.forEach((target, index) => {
      const rest = titles.slice(index + 1);
      const shortcutLocations = ctx
        .shortcutsTo(target.stable_id)
        .filter((shortcut) => !visited.has(shortcut))
        .map((shortcut) => locate(ctx, shortcut, new Set([...visited, shortcut])))
        .filter((found) => found?.locations.some((location) => location.report))
        .flatMap((found) => found.locations);
      if (shortcutLocations.length === 0) return;
      if (target.is_folder && CLOUD_ID_PATTERN.test(target.id)) {
        byTargetId.push({
          base: "mount",
          segments: [SHORTCUT_TARGETS_DIR, target.id, target.local_title, ...rest],
          report: true,
        });
      }
      viaShortcut.unshift(
        ...shortcutLocations.map((location) => ({
          ...location,
          segments: [...location.segments, ...rest],
        }))
      );
    });
  }

  // An excluded shared drive's own folder is still tried first, unreported:
  // it is where the item would be if the unsynced flag were stale.
  const locations = [
    ...(inSharedDrive ? [{ ...asSharedDrive, report: false }] : []),
    ...byTargetId,
    ...viaShortcut,
  ].slice(0, MAX_LOCATIONS);
  if (byTargetId.length + viaShortcut.length > 0) return { locations, unreachable: null };
  return {
    locations,
    unreachable: inSharedDrive
      ? { reason: "shared_drive_not_synced", drive: top.local_title }
      : { reason: "not_synced" },
  };
};

// Places a cloud ID using one DriveFS metadata DB. Returns null when this
// DB cannot answer (unknown ID, incomplete chain, only unsafe titles).
// Throws on schema mismatches; callers treat that as "cannot answer" too.
// The DB is closed before any filesystem access.
const lookupInDb = (dbPath, cloudId, platform) => {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const item = db
      .prepare(
        `SELECT stable_id, is_folder
         FROM items
         WHERE id = ?
           AND (is_tombstone IS NULL OR is_tombstone = 0)
           AND (trashed IS NULL OR trashed = 0)`
      )
      .get(cloudId);
    if (!item) return null;

    const found = locate(readDbContext(db), item.stable_id);
    if (!found) return null;
    const locations = found.locations.filter((location) =>
      location.segments.every((segment) => isSafeSegment(segment, platform))
    );
    if (!found.unreachable && !locations.some((location) => location.report)) return null;
    return { isFolder: Boolean(item.is_folder), locations, unreachable: found.unreachable };
  } finally {
    db.close();
  }
};

const toAbsolutePath = (location, mountRoot, options) => {
  const base =
    location.base === "myDrive"
      ? myDriveDir(mountRoot, options)
      : location.base === "sharedDrives"
        ? sharedDrivesDir(mountRoot, options)
        : mountRoot;
  return path.join(base, ...location.segments);
};

// The same cloud ID can exist in several account DBs (e.g. a shared drive
// both accounts are members of) and each account may be mounted on its own
// root, so every DB and mount root is scanned for an existing location.
// Otherwise the first expected location is reported (not synced yet), and
// only when no account expects the item locally is it unreachable: another
// account may well have the drive this one excluded.
export const resolveItemPath = (cloudId, options = {}) => {
  if (typeof cloudId !== "string" || !CLOUD_ID_PATTERN.test(cloudId)) return null;

  const platform = options.platform ?? process.platform;
  const dbPaths =
    options.dbPaths ?? listAccountDbPaths(options.driveFsRoot ?? defaultDriveFsRoot());
  let firstMiss = null;
  let firstUnreachable = null;
  for (const dbPath of dbPaths) {
    let found;
    try {
      found = lookupInDb(dbPath, cloudId, platform);
    } catch {
      continue; // corrupt DB or schema change: try the next account
    }
    if (!found) continue;

    const accountId = path.basename(path.dirname(dbPath));
    const mountRoots =
      options.mountRoots ??
      (options.mountRoot ? [options.mountRoot] : mountRootsForAccount(accountId));

    for (const mountRoot of mountRoots) {
      for (const location of found.locations) {
        const candidate = toAbsolutePath(location, mountRoot, options);
        if (existsSync(candidate)) {
          return { path: candidate, exists: true, isFolder: found.isFolder, mountRoot };
        }
        if (location.report) {
          firstMiss ??= { path: candidate, exists: false, isFolder: found.isFolder, mountRoot };
        }
      }
    }
    if (found.unreachable) {
      firstUnreachable ??= {
        unreachable: true,
        exists: false,
        isFolder: found.isFolder,
        ...found.unreachable,
      };
    }
  }
  return firstMiss ?? firstUnreachable;
};

// Fallback used when the metadata DB cannot resolve an ID (e.g. schema
// change after a DriveFS update): resolve by the breadcrumb titles scraped
// from the Drive web page. The root segment must map to an actual root
// (My Drive or an existing shared drive) so unsynced views like 共有アイテム
// never silently resolve to the wrong folder.
export const resolveBreadcrumbPath = (breadcrumbs, options = {}) => {
  if (!Array.isArray(breadcrumbs) || breadcrumbs.length === 0) return null;
  const platform = options.platform ?? process.platform;
  if (!breadcrumbs.every((segment) => isSafeSegment(segment, platform))) return null;
  const mountRoots =
    options.mountRoots ?? (options.mountRoot ? [options.mountRoot] : detectMountRoots());

  for (const mountRoot of mountRoots) {
    const [root, ...rest] = breadcrumbs;
    const base = MY_DRIVE_ROOT_NAMES.has(root)
      ? myDriveDir(mountRoot, options)
      : path.join(sharedDrivesDir(mountRoot, options), root);
    if (!existsSync(base)) continue;

    const fullPath = path.join(base, ...rest);
    if (!existsSync(fullPath)) continue;
    return { path: fullPath, exists: true, isFolder: true, mountRoot };
  }
  return null;
};

export const resolveSpecialPath = (target, options = {}) => {
  if (target !== "myDrive" && target !== "sharedDrives") return null;
  const mountRoot = options.mountRoot ?? detectMountRoot();
  if (!mountRoot) return null;
  const specialPath =
    target === "myDrive" ? myDriveDir(mountRoot, options) : sharedDrivesDir(mountRoot, options);
  return { path: specialPath, exists: existsSync(specialPath), isFolder: true, mountRoot };
};

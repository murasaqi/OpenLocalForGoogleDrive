// Builds a machine-independent DriveFS fixture: a minimal metadata_sqlite_db
// plus a fake mount directory tree, in a temp directory.
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const FIXTURE_IDS = {
  myDriveRoot: "rootid00001",
  folderA: "folderA0001",
  subFolder: "subid000001",
  file: "fileid00001",
  teamRoot: "teamroot001",
  teamDocs: "docsid00001",
  trashed: "trashed0001",
  unsafeTitle: "evilid00001",
};

export const LOCALIZED_IDS = {
  myDriveRoot: "lrootid0001",
  folderA: "lfolderA001",
  teamRoot: "lteamroot01",
  teamDocs: "ldocsid0001",
};

export const MULTI_IDS = {
  reports: "reportsid01",
  shadow: "shadowid001",
  missing: "missingid01",
  visitor: "visitorid01",
  stranded: "strandedid1",
  pending: "pendingid01",
};

export const createFixture = () => {
  const base = mkdtempSync(path.join(tmpdir(), "olg-fixture-"));

  const mountRoot = path.join(base, "mount") + path.sep;
  mkdirSync(path.join(mountRoot, "My Drive", "FolderA", "Sub"), { recursive: true });
  writeFileSync(path.join(mountRoot, "My Drive", "FolderA", "note.txt"), "x");
  mkdirSync(path.join(mountRoot, "Shared drives", "TeamX", "Docs"), { recursive: true });

  const driveFsRoot = path.join(base, "drivefs");
  const accountDir = path.join(driveFsRoot, "123456");
  mkdirSync(accountDir, { recursive: true });

  const db = new DatabaseSync(path.join(accountDir, "metadata_sqlite_db"));
  db.exec(`
    CREATE TABLE items (
      stable_id INTEGER PRIMARY KEY,
      id TEXT,
      local_title TEXT,
      is_folder INTEGER,
      trashed INTEGER,
      is_tombstone INTEGER,
      team_drive_stable_id INTEGER
    );
    CREATE TABLE stable_parents (
      item_stable_id INTEGER,
      parent_stable_id INTEGER
    );
  `);
  const insertItem = db.prepare("INSERT INTO items VALUES (?, ?, ?, ?, ?, ?, ?)");
  const insertParent = db.prepare("INSERT INTO stable_parents VALUES (?, ?)");

  insertItem.run(1, FIXTURE_IDS.myDriveRoot, "マイドライブ", 1, 0, 0, null);
  insertItem.run(2, FIXTURE_IDS.folderA, "FolderA", 1, 0, 0, null);
  insertItem.run(3, FIXTURE_IDS.subFolder, "Sub", 1, 0, 0, null);
  insertItem.run(4, FIXTURE_IDS.file, "note.txt", 0, 0, 0, null);
  insertItem.run(10, FIXTURE_IDS.teamRoot, "TeamX", 1, 0, 0, 10);
  insertItem.run(11, FIXTURE_IDS.teamDocs, "Docs", 1, 0, 0, 10);
  insertItem.run(5, FIXTURE_IDS.trashed, "Gone", 1, 1, 0, null);
  insertItem.run(6, FIXTURE_IDS.unsafeTitle, "..", 1, 0, 0, null);
  insertParent.run(2, 1);
  insertParent.run(3, 2);
  insertParent.run(4, 2);
  insertParent.run(11, 10);
  insertParent.run(5, 1);
  insertParent.run(6, 1);
  db.close();

  const cleanup = () => rmSync(base, { recursive: true, force: true });
  return { driveFsRoot, mountRoot, cleanup };
};

// Two accounts, each mounted on its own root: account 111111 (scanned first)
// uses mountA, account 222222 uses mountB. The shadow ID exists in both DBs
// but only account 222222's chain is materialized on disk; the missing ID
// exists on no mount at all. Visitor/stranded are shared with account
// 111111 only as parentless items (not local there); visitor is local in
// 222222's shared drive. Pending is expected in 111111's My Drive but not
// on disk, while 222222 only has it as an unreachable shared item.
export const createMultiAccountFixture = () => {
  const base = mkdtempSync(path.join(tmpdir(), "olg-multi-"));

  const mountA = path.join(base, "mountA") + path.sep;
  mkdirSync(path.join(mountA, "My Drive"), { recursive: true });
  const mountB = path.join(base, "mountB") + path.sep;
  mkdirSync(path.join(mountB, "Shared drives", "TeamY", "Reports"), { recursive: true });
  mkdirSync(path.join(mountB, "Shared drives", "TeamY", "Shadow"), { recursive: true });
  mkdirSync(path.join(mountB, "Shared drives", "TeamY", "Visitor"), { recursive: true });

  const driveFsRoot = path.join(base, "drivefs");
  const openDb = (account) => {
    const accountDir = path.join(driveFsRoot, account);
    mkdirSync(accountDir, { recursive: true });
    const db = new DatabaseSync(path.join(accountDir, "metadata_sqlite_db"));
    db.exec(`
      CREATE TABLE items (
        stable_id INTEGER PRIMARY KEY,
        id TEXT,
        local_title TEXT,
        is_folder INTEGER,
        trashed INTEGER,
        is_tombstone INTEGER,
        team_drive_stable_id INTEGER
      );
      CREATE TABLE stable_parents (
        item_stable_id INTEGER,
        parent_stable_id INTEGER
      );
    `);
    return db;
  };

  let db = openDb("111111");
  let insertItem = db.prepare("INSERT INTO items VALUES (?, ?, ?, ?, ?, ?, ?)");
  let insertParent = db.prepare("INSERT INTO stable_parents VALUES (?, ?)");
  insertItem.run(1, "rootid11111", "マイドライブ", 1, 0, 0, null);
  insertItem.run(2, MULTI_IDS.shadow, "Ghost", 1, 0, 0, null);
  insertItem.run(3, MULTI_IDS.missing, "Nowhere", 1, 0, 0, null);
  insertItem.run(4, MULTI_IDS.visitor, "Visitor", 1, 0, 0, null);
  insertItem.run(5, MULTI_IDS.stranded, "Stranded", 1, 0, 0, null);
  insertItem.run(6, MULTI_IDS.pending, "Pending", 1, 0, 0, null);
  insertParent.run(2, 1);
  insertParent.run(3, 1);
  insertParent.run(6, 1);
  db.close();

  db = openDb("222222");
  insertItem = db.prepare("INSERT INTO items VALUES (?, ?, ?, ?, ?, ?, ?)");
  insertParent = db.prepare("INSERT INTO stable_parents VALUES (?, ?)");
  insertItem.run(10, "teamrootY01", "TeamY", 1, 0, 0, 10);
  insertItem.run(11, MULTI_IDS.reports, "Reports", 1, 0, 0, 10);
  insertItem.run(12, MULTI_IDS.shadow, "Shadow", 1, 0, 0, 10);
  insertItem.run(13, MULTI_IDS.visitor, "Visitor", 1, 0, 0, 10);
  insertItem.run(14, MULTI_IDS.pending, "Pending", 1, 0, 0, null);
  insertParent.run(11, 10);
  insertParent.run(12, 10);
  insertParent.run(13, 10);
  db.close();

  const cleanup = () => rmSync(base, { recursive: true, force: true });
  return { driveFsRoot, mountA, mountB, cleanup };
};

// Mirrors a real macOS mount under a non-English OS locale (verified against
// this repo's own dev machine, ja_JP): the top-level folder names on disk
// are localized (マイドライブ / 共有ドライブ) instead of the fixed English
// names Windows always uses. The My Drive root's DB title matches the real
// folder name exactly; the Shared drives container has no DB entry at all.
export const createLocalizedFixture = () => {
  const base = mkdtempSync(path.join(tmpdir(), "olg-localized-"));

  const mountRoot = path.join(base, "mount") + path.sep;
  mkdirSync(path.join(mountRoot, "マイドライブ", "FolderA"), { recursive: true });
  mkdirSync(path.join(mountRoot, "共有ドライブ", "TeamX", "Docs"), { recursive: true });

  const driveFsRoot = path.join(base, "drivefs");
  const accountDir = path.join(driveFsRoot, "999999");
  mkdirSync(accountDir, { recursive: true });

  const db = new DatabaseSync(path.join(accountDir, "metadata_sqlite_db"));
  db.exec(`
    CREATE TABLE items (
      stable_id INTEGER PRIMARY KEY,
      id TEXT,
      local_title TEXT,
      is_folder INTEGER,
      trashed INTEGER,
      is_tombstone INTEGER,
      team_drive_stable_id INTEGER
    );
    CREATE TABLE stable_parents (
      item_stable_id INTEGER,
      parent_stable_id INTEGER
    );
  `);
  const insertItem = db.prepare("INSERT INTO items VALUES (?, ?, ?, ?, ?, ?, ?)");
  const insertParent = db.prepare("INSERT INTO stable_parents VALUES (?, ?)");

  insertItem.run(1, LOCALIZED_IDS.myDriveRoot, "マイドライブ", 1, 0, 0, null);
  insertItem.run(2, LOCALIZED_IDS.folderA, "FolderA", 1, 0, 0, null);
  insertItem.run(10, LOCALIZED_IDS.teamRoot, "TeamX", 1, 0, 0, 10);
  insertItem.run(11, LOCALIZED_IDS.teamDocs, "Docs", 1, 0, 0, 10);
  insertParent.run(2, 1);
  insertParent.run(11, 10);
  db.close();

  const cleanup = () => rmSync(base, { recursive: true, force: true });
  return { driveFsRoot, mountRoot, cleanup };
};

export const SHORTCUT_IDS = {
  myDriveRoot: "sroot000001",
  docs: "sdocs000001",
  unsyncedRoot: "udrive00001",
  year: "year0000001",
  clip: "clip0000001",
  deep: "deep0000001",
  orphan: "orphan00001",
  lazyInner: "inner000001",
  pending: "pending0001",
  sharedWithMe: "swm00000001",
  sharedWithMeInner: "swminner001",
  fakeMyDrive: "fakemydr001",
  lonely: "lonely00001",
  deck: "deck0000001",
  island: "island00001",
  chain: "chain000001",
  loop: "loop0000001",
  pingA: "pinga000001",
  pingB: "pingb000001",
  trashy: "trashy00001",
  staleKept: "kept0000001",
  floating: "float000001",
  specialTitle: "star0000001",
};

// Legal on macOS, illegal on Windows (only created on disk off Windows).
export const SPECIAL_TITLE = "J24**_<x>:y";

// Mirrors how DriveFS exposes items outside every synced root (verified on
// a real macOS install): a shortcut appears at its own location (a symlink
// on disk, a plain directory/file here) and, when its target is not
// otherwise local, the target is exposed under
// .shortcut-targets-by-id/<target id>/<target title>. The My Drive root has
// a title outside the known list, so only properties.root_id identifies it.
//
//   Meine Ablage (My Drive)       Docs, "Nested link" -> Nested,
//                                  "Lazy 2" -> Lazy, Shared -> Shared,
//                                  Trashy -> Trashy (trashed shortcut)
//   Synced (shared drive)         Hub/{Year -> Year, deck.gslides -> deck}
//   Unsynced (excluded drive)     Year/Proj/{clip.mp4, Nested/Deep,
//                                  Chain -> Chain}, Year/Pending, Orphan/
//                                  {Island -> Island}, Lazy/Inner, Island,
//                                  Chain, Loop/{Loop -> Loop},
//                                  PingA/{"to B" -> PingB},
//                                  PingB/{"to A" -> PingA}, Trashy
//   Stale (flagged unsynced, but its folder exists)  Kept
//   shared with me (parentless)   Shared/Inner, マイドライブ, Lonely,
//                                  deck.gslides; Floating (drive not in DB)
export const createShortcutFixture = () => {
  const base = mkdtempSync(path.join(tmpdir(), "olg-shortcut-"));
  const mountRoot = path.join(base, "mount") + path.sep;
  const byId = (id, ...rest) => [".shortcut-targets-by-id", id, ...rest];
  const S = SHORTCUT_IDS;

  const dirs = [
    ["My Drive", "Docs"],
    ["My Drive", "Lazy 2", "Inner"],
    ["Shared drives", "Synced", "Hub"],
    ["Shared drives", "Stale", "Kept"],
    byId(S.year, "Year", "Proj", "Nested", "Deep"),
    byId(S.sharedWithMe, "Shared", "Inner"),
    byId(S.chain, "Chain"),
    byId(S.trashy, "Trashy"),
  ];
  if (process.platform !== "win32") dirs.push(["My Drive", SPECIAL_TITLE]);
  for (const segments of dirs) mkdirSync(path.join(mountRoot, ...segments), { recursive: true });
  writeFileSync(path.join(mountRoot, ...byId(S.year, "Year", "Proj", "clip.mp4")), "x");
  writeFileSync(path.join(mountRoot, "Shared drives", "Synced", "Hub", "deck.gslides"), "x");

  const driveFsRoot = path.join(base, "drivefs");
  const accountDir = path.join(driveFsRoot, "777777");
  mkdirSync(accountDir, { recursive: true });

  const db = new DatabaseSync(path.join(accountDir, "metadata_sqlite_db"));
  db.exec(`
    CREATE TABLE items (
      stable_id INTEGER PRIMARY KEY,
      id TEXT,
      local_title TEXT,
      is_folder INTEGER,
      trashed INTEGER,
      is_tombstone INTEGER,
      team_drive_stable_id INTEGER
    );
    CREATE TABLE stable_parents (
      item_stable_id INTEGER,
      parent_stable_id INTEGER
    );
    CREATE TABLE properties (property TEXT PRIMARY KEY, value BLOB);
    CREATE TABLE item_properties (
      item_stable_id INTEGER,
      key TEXT,
      value BLOB,
      value_type INTEGER
    );
    CREATE TABLE shortcut_details (
      shortcut_stable_id INTEGER PRIMARY KEY,
      target_stable_id INTEGER,
      target_mime_type TEXT
    );
  `);
  const insertItem = db.prepare("INSERT INTO items VALUES (?, ?, ?, ?, ?, 0, ?)");
  const insertParent = db.prepare("INSERT INTO stable_parents VALUES (?, ?)");
  const insertShortcut = db.prepare("INSERT INTO shortcut_details VALUES (?, ?, ?)");

  // [stable_id, id, title, is_folder, team_drive_stable_id, parent, trashed]
  const items = [
    [1, S.myDriveRoot, "Meine Ablage", 1, null, null],
    [2, S.docs, "Docs", 1, null, 1],
    [10, "sdrive00001", "Synced", 1, 10, null],
    [11, "hub00000001", "Hub", 1, 10, 10],
    [20, S.unsyncedRoot, "Unsynced", 1, 20, null],
    [21, S.year, "Year", 1, 20, 20],
    [22, "proj0000001", "Proj", 1, 20, 21],
    [23, S.clip, "clip.mp4", 0, 20, 22],
    [24, "nested00001", "Nested", 1, 20, 22],
    [25, S.deep, "Deep", 1, 20, 24],
    [26, S.orphan, "Orphan", 1, 20, 20],
    [27, "lazy0000001", "Lazy", 1, 20, 20],
    [28, S.lazyInner, "Inner", 1, 20, 27],
    [29, S.pending, "Pending", 1, 20, 21],
    [30, "scyear00001", "Year", 0, 10, 11],
    [31, "scnested001", "Nested link", 0, null, 1],
    [32, "sclazy00001", "Lazy 2", 0, null, 1],
    [40, S.sharedWithMe, "Shared", 1, null, null],
    [41, S.sharedWithMeInner, "Inner", 1, null, 40],
    [42, "scshared001", "Shared", 0, null, 1],
    [43, S.fakeMyDrive, "マイドライブ", 1, null, null],
    [44, S.lonely, "Lonely", 1, null, null],
    [45, S.deck, "deck.gslides", 0, null, null],
    [46, "scdeck00001", "deck.gslides", 0, 10, 11],
    [50, S.island, "Island", 1, 20, 20],
    [51, "scisland001", "Island", 0, 20, 26],
    [52, S.chain, "Chain", 1, 20, 20],
    [53, "scchain0001", "Chain", 0, 20, 22],
    [54, S.loop, "Loop", 1, 20, 20],
    [55, "scloop00001", "Loop", 0, 20, 54],
    [56, S.pingA, "PingA", 1, 20, 20],
    [57, S.pingB, "PingB", 1, 20, 20],
    [58, "scpingb0001", "to B", 0, 20, 56],
    [59, "scpinga0001", "to A", 0, 20, 57],
    [60, S.trashy, "Trashy", 1, 20, 20],
    [61, "sctrashy001", "Trashy", 0, null, 1, 1],
    [70, "stale000001", "Stale", 1, 70, null],
    [71, S.staleKept, "Kept", 1, 70, 70],
    [80, S.floating, "Floating", 0, 99, null],
    [90, S.specialTitle, SPECIAL_TITLE, 1, null, 1],
  ];
  for (const [stableId, id, title, isFolder, teamDrive, parent, trashed = 0] of items) {
    insertItem.run(stableId, id, title, isFolder, trashed, teamDrive);
    if (parent !== null) insertParent.run(stableId, parent);
  }

  // [shortcut, target, target is a folder]
  const shortcuts = [
    [30, 21, true],
    [31, 24, true],
    [32, 27, true],
    [42, 40, true],
    [46, 45, false],
    [51, 50, true],
    [53, 52, true],
    [55, 54, true],
    [58, 57, true],
    [59, 56, true],
    [61, 60, true],
  ];
  for (const [shortcut, target, isFolder] of shortcuts) {
    insertShortcut.run(
      shortcut,
      target,
      isFolder ? "application/vnd.google-apps.folder" : "application/vnd.google-apps.presentation"
    );
  }

  db.prepare("INSERT INTO properties VALUES ('root_id', ?)").run(Buffer.from(S.myDriveRoot));
  const insertProperty = db.prepare(
    "INSERT INTO item_properties VALUES (?, 'shared-drive-unsynced', ?, 0)"
  );
  insertProperty.run(20, "1");
  insertProperty.run(70, "1");
  insertProperty.run(10, "0"); // explicitly synced
  db.close();

  const cleanup = () => rmSync(base, { recursive: true, force: true });
  return { driveFsRoot, mountRoot, cleanup };
};

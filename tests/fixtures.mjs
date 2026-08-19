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

export const MULTI_IDS = {
  reports: "reportsid01",
  shadow: "shadowid001",
  missing: "missingid01",
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
// exists on no mount at all.
export const createMultiAccountFixture = () => {
  const base = mkdtempSync(path.join(tmpdir(), "olg-multi-"));

  const mountA = path.join(base, "mountA") + path.sep;
  mkdirSync(path.join(mountA, "My Drive"), { recursive: true });
  const mountB = path.join(base, "mountB") + path.sep;
  mkdirSync(path.join(mountB, "Shared drives", "TeamY", "Reports"), { recursive: true });
  mkdirSync(path.join(mountB, "Shared drives", "TeamY", "Shadow"), { recursive: true });

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
  insertParent.run(2, 1);
  insertParent.run(3, 1);
  db.close();

  db = openDb("222222");
  insertItem = db.prepare("INSERT INTO items VALUES (?, ?, ?, ?, ?, ?, ?)");
  insertParent = db.prepare("INSERT INTO stable_parents VALUES (?, ?)");
  insertItem.run(10, "teamrootY01", "TeamY", 1, 0, 0, 10);
  insertItem.run(11, MULTI_IDS.reports, "Reports", 1, 0, 0, 10);
  insertItem.run(12, MULTI_IDS.shadow, "Shadow", 1, 0, 0, 10);
  insertParent.run(11, 10);
  insertParent.run(12, 10);
  db.close();

  const cleanup = () => rmSync(base, { recursive: true, force: true });
  return { driveFsRoot, mountA, mountB, cleanup };
};

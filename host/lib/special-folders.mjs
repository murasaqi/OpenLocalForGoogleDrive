// Locates the "My Drive" / "Shared drives" folders under a Drive mount
// root. On Windows these are always the same two English names regardless
// of UI language. On macOS the actual folder names are localized to the OS
// locale (e.g. マイドライブ / 共有ドライブ under ja_JP), and "Shared drives"
// has no corresponding entry in the DriveFS metadata DB at all (it's a
// synthetic grouping folder, not a real Drive item), so its name must be
// discovered from disk rather than read out of the DB.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const WINDOWS_MY_DRIVE = "My Drive";
const WINDOWS_SHARED_DRIVES = "Shared drives";

// Known localized folder names, checked in order. Extend as more locales
// are confirmed; unrecognized locales fall back to the heuristic below.
const KNOWN_MY_DRIVE_NAMES = ["My Drive", "マイドライブ"];
const KNOWN_SHARED_DRIVES_NAMES = ["Shared drives", "共有ドライブ"];

const isMac = (options) => (options.platform ?? process.platform) === "darwin";

const firstExisting = (mountRoot, names) =>
  names.map((name) => path.join(mountRoot, name)).find((candidate) => existsSync(candidate)) ??
  null;

const listTopLevelDirs = (mountRoot) => {
  try {
    return readdirSync(mountRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => path.join(mountRoot, entry.name));
  } catch {
    return [];
  }
};

// Always returns a path string, never null: an unresolved guess simply
// won't exist on disk, and callers already treat a missing path as
// not_synced/path_missing, so there's no need for a separate null case.
export const myDriveDir = (mountRoot, options = {}) => {
  if (!isMac(options)) return path.join(mountRoot, WINDOWS_MY_DRIVE);
  return firstExisting(mountRoot, KNOWN_MY_DRIVE_NAMES) ?? path.join(mountRoot, WINDOWS_MY_DRIVE);
};

export const sharedDrivesDir = (mountRoot, options = {}) => {
  if (!isMac(options)) return path.join(mountRoot, WINDOWS_SHARED_DRIVES);
  const known = firstExisting(mountRoot, KNOWN_SHARED_DRIVES_NAMES);
  if (known) return known;
  // Unrecognized locale: the only other non-hidden top-level directory
  // (besides My Drive) is assumed to be the localized Shared drives
  // container. An ambiguous result (0 or 2+ candidates) falls back to the
  // default name rather than risk guessing the wrong folder.
  const myDrive = myDriveDir(mountRoot, options);
  const others = listTopLevelDirs(mountRoot).filter((dir) => dir !== myDrive);
  return others.length === 1 ? others[0] : path.join(mountRoot, WINDOWS_SHARED_DRIVES);
};

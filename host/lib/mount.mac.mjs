// macOS mount detection: Google Drive for Desktop mounts each account under
// ~/Library/CloudStorage/GoogleDrive-<account>, using Apple's CloudStorage
// (File Provider) convention. There is no registry to consult for a custom
// mount point and no drive-letter ambiguity to resolve, since the folder
// name itself is unique per account.
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const GOOGLE_DRIVE_PREFIX = "GoogleDrive-";

const defaultCloudStorageRoot = () => path.join(homedir(), "Library", "CloudStorage");

// A GoogleDrive-* directory with no visible entries (e.g. an account that is
// not currently mounted) cannot hold any item, so it is not a usable root.
const isUsableMountRoot = (root) => {
  try {
    return readdirSync(root).some((name) => !name.startsWith("."));
  } catch {
    return false;
  }
};

export const detectMountRoots = (options = {}) => {
  const cloudStorageRoot = options.cloudStorageRoot ?? defaultCloudStorageRoot();
  let entries;
  try {
    entries = readdirSync(cloudStorageRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  // Other CloudStorage providers (e.g. MacDroid, Synology Drive) share this
  // same directory, so the prefix check is required, not just "any directory".
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(GOOGLE_DRIVE_PREFIX))
    .map((entry) => path.join(cloudStorageRoot, entry.name) + path.sep)
    .filter(isUsableMountRoot);
};

export const detectMountRoot = (options = {}) => detectMountRoots(options)[0] ?? null;

// No per-account preference source exists on macOS (the account is already
// disambiguated by the mount folder name), so every account tries all
// detected roots in the same order; resolveItemPath's existsSync scan across
// roots is what actually picks the right one.
export const mountRootsForAccount = (accountId, options = {}) =>
  options.roots ?? detectMountRoots(options);

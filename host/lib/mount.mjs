import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const DRIVE_LETTERS = "GHIJKLMNOPQRSTUVWXYZDEF".split("");
const REG_EXE = path.join(
  process.env.SystemRoot ?? "C:\\Windows",
  "System32",
  "reg.exe"
);

const hasDriveContent = (root) =>
  existsSync(path.join(root, "My Drive")) || existsSync(path.join(root, "Shared drives"));

export const normalizeMountValue = (value) => {
  if (typeof value !== "string" || value.length === 0) return null;
  if (/^[A-Za-z]$/.test(value)) return `${value.toUpperCase()}:\\`;
  if (/^[A-Za-z]:$/.test(value)) return `${value.toUpperCase()}\\`;
  return value.endsWith("\\") ? value : `${value}\\`;
};

// Google Drive for Desktop stores per-account preferences (including a custom
// mount point) as a JSON string in this registry value. The entry key is the
// account ID, matching the %LOCALAPPDATA%\Google\DriveFS\<key> directory.
// An empty value means the default mount point is used; which drive letter
// the default resolves to is not recorded here, so such accounts must be
// resolved by probing every detected mount root.
const accountMountPrefs = () => {
  try {
    const out = execFileSync(
      REG_EXE,
      ["query", "HKCU\\Software\\Google\\DriveFS", "/v", "PerAccountPreferences"],
      { encoding: "utf8", windowsHide: true, timeout: 5000, shell: false }
    );
    const match = out.match(/PerAccountPreferences[ \t]+REG_SZ[ \t]+(.+)/);
    if (!match) return new Map();
    const prefs = JSON.parse(match[1].trim());
    const entries = Array.isArray(prefs.per_account_preferences)
      ? prefs.per_account_preferences
      : [];
    return new Map(
      entries
        .map((entry) => [entry?.key, normalizeMountValue(entry?.value?.mount_point_path)])
        .filter(([key, value]) => Boolean(key) && Boolean(value))
    );
  } catch {
    return new Map();
  }
};

// All roots that currently hold Drive content, explicitly configured mount
// points first. With multiple accounts each mounted on its own letter, every
// entry here is a valid root for some account.
export const detectMountRoots = () => {
  const candidates = [
    ...accountMountPrefs().values(),
    ...DRIVE_LETTERS.map((letter) => `${letter}:\\`),
  ];
  return [...new Set(candidates)].filter(hasDriveContent);
};

export const detectMountRoot = () => detectMountRoots()[0] ?? null;

// Roots to try for the given account, most likely first: an explicitly
// configured mount point wins, but the others stay as fallbacks so accounts
// on the default mount (absent from the prefs) resolve by filesystem
// existence instead of guessing a single drive letter. For default-mount
// accounts, roots explicitly claimed by other accounts go last so a
// same-named path on someone else's mount doesn't shadow the right one.
export const mountRootsForAccount = (accountId, options = {}) => {
  const prefs = options.prefs ?? accountMountPrefs();
  const roots = options.roots ?? detectMountRoots();
  const preferred = prefs.get(accountId);
  if (preferred && roots.includes(preferred)) {
    return [preferred, ...roots.filter((root) => root !== preferred)];
  }
  const claimed = new Set(prefs.values());
  return [
    ...roots.filter((root) => !claimed.has(root)),
    ...roots.filter((root) => claimed.has(root)),
  ];
};

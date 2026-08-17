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
// An empty value means the default mount point is used.
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

export const detectMountRoot = () => {
  const candidates = [
    ...accountMountPrefs().values(),
    ...DRIVE_LETTERS.map((letter) => `${letter}:\\`),
  ];
  return candidates.find(hasDriveContent) ?? null;
};

// Prefers the mount point configured for the given account so items from a
// secondary account resolve against that account's drive letter.
export const mountRootForAccount = (accountId) => {
  const preferred = accountMountPrefs().get(accountId);
  if (preferred && hasDriveContent(preferred)) return preferred;
  return detectMountRoot();
};

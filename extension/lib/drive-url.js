// Pure URL classification for drive.google.com pages.
// kinds: folder (URL carries a folder ID), item (legacy /open?id=),
//        myDrive, sharedDrives, other (Drive page without a target),
//        notDrive (not a Drive page at all)

const FOLDER_PATTERN = /^\/drive\/(?:u\/\d+\/)?folders\/([-\w]+)/;
const FILE_PATTERN = /^\/(?:drive\/(?:u\/\d+\/)?)?file\/d\/([-\w]+)/;
const MY_DRIVE_PATTERN = /^\/drive\/(?:u\/\d+\/)?my-drive\/?$/;
const SHARED_DRIVES_PATTERN = /^\/drive\/(?:u\/\d+\/)?shared-drives\/?$/;

export const parseDriveUrl = (url) => {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: "notDrive" };
  }
  if (parsed.hostname !== "drive.google.com") return { kind: "notDrive" };

  const folderMatch = parsed.pathname.match(FOLDER_PATTERN);
  if (folderMatch) return { kind: "folder", id: folderMatch[1] };

  const fileMatch = parsed.pathname.match(FILE_PATTERN);
  if (fileMatch) return { kind: "item", id: fileMatch[1] };

  if (MY_DRIVE_PATTERN.test(parsed.pathname)) return { kind: "myDrive" };
  if (SHARED_DRIVES_PATTERN.test(parsed.pathname)) return { kind: "sharedDrives" };

  if (parsed.pathname === "/open") {
    const id = parsed.searchParams.get("id");
    if (id && /^[-\w]+$/.test(id)) return { kind: "item", id };
  }

  return { kind: "other" };
};

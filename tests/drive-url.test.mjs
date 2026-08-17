import { test } from "node:test";
import assert from "node:assert/strict";

import { parseDriveUrl } from "../extension/lib/drive-url.js";

const cases = [
  [
    "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWx_1234567",
    { kind: "folder", id: "1AbCdEfGhIjKlMnOpQrStUvWx_1234567" },
  ],
  [
    "https://drive.google.com/drive/u/0/folders/0ABcDeFgHiJkUk9PVA",
    { kind: "folder", id: "0ABcDeFgHiJkUk9PVA" },
  ],
  [
    "https://drive.google.com/drive/folders/1abc?usp=sharing",
    { kind: "folder", id: "1abc" },
  ],
  ["https://drive.google.com/drive/my-drive", { kind: "myDrive" }],
  ["https://drive.google.com/drive/u/1/my-drive", { kind: "myDrive" }],
  ["https://drive.google.com/drive/shared-drives", { kind: "sharedDrives" }],
  [
    "https://drive.google.com/open?id=1XYZ_abc-123",
    { kind: "item", id: "1XYZ_abc-123" },
  ],
  [
    "https://drive.google.com/file/d/1FileId_abc/view",
    { kind: "item", id: "1FileId_abc" },
  ],
  [
    "https://drive.google.com/file/d/1FileId_abc/view?usp=drive_link",
    { kind: "item", id: "1FileId_abc" },
  ],
  [
    "https://drive.google.com/drive/u/0/file/d/1FileId_abc/view",
    { kind: "item", id: "1FileId_abc" },
  ],
  ["https://drive.google.com/drive/home", { kind: "other" }],
  ["https://drive.google.com/drive/shared-with-me", { kind: "other" }],
  ["https://drive.google.com/drive/search?q=test", { kind: "other" }],
  ["https://docs.google.com/document/d/xxx/edit", { kind: "notDrive" }],
  ["https://example.com/drive/my-drive", { kind: "notDrive" }],
  ["not a url", { kind: "notDrive" }],
  ["", { kind: "notDrive" }],
];

for (const [url, expected] of cases) {
  test(`parseDriveUrl(${url || "<empty>"})`, () => {
    assert.deepEqual(parseDriveUrl(url), expected);
  });
}

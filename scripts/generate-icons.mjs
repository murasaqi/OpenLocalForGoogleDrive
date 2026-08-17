// Generates extension icons (blue folder + green "to local" arrow badge)
// as PNG files without any dependencies.

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SIZES = [16, 32, 48, 128];
const COLORS = {
  folderTab: [41, 98, 255, 255],
  folderBody: [66, 133, 244, 255],
  badge: [24, 128, 56, 255],
  arrow: [255, 255, 255, 255],
  transparent: [0, 0, 0, 0],
};

const pixelColor = (u, v) => {
  const inBadge = (u - 0.7) ** 2 + (v - 0.7) ** 2 <= 0.28 ** 2;
  if (inBadge) {
    const shaft = Math.abs(u - 0.7) <= 0.05 && v >= 0.54 && v <= 0.72;
    const headHalfWidth = 0.13 * (1 - (v - 0.7) / 0.16);
    const head = v >= 0.7 && v <= 0.86 && Math.abs(u - 0.7) <= headHalfWidth;
    return shaft || head ? COLORS.arrow : COLORS.badge;
  }
  if (u >= 0.06 && u <= 0.94 && v >= 0.28 && v <= 0.88) return COLORS.folderBody;
  if (u >= 0.06 && u <= 0.46 && v >= 0.16 && v <= 0.3) return COLORS.folderTab;
  return COLORS.transparent;
};

const renderRaster = (size) => {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelColor((x + 0.5) / size, (y + 0.5) / size);
      row.writeUInt8(r, 1 + x * 4);
      row.writeUInt8(g, 2 + x * 4);
      row.writeUInt8(b, 3 + x * 4);
      row.writeUInt8(a, 4 + x * 4);
    }
    rows.push(row);
  }
  return Buffer.concat(rows);
};

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const pngChunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
};

const encodePng = (size) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(renderRaster(size))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
};

const iconsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "extension",
  "icons"
);
mkdirSync(iconsDir, { recursive: true });
for (const size of SIZES) {
  writeFileSync(path.join(iconsDir, `icon${size}.png`), encodePng(size));
}
process.stdout.write(`Generated ${SIZES.map((s) => `icon${s}.png`).join(", ")} in ${iconsDir}\n`);

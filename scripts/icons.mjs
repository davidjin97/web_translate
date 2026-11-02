// Generate the extension's code-native L mark as PNG, with no external libraries.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name, data) {
  const type = Buffer.from(name);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, crc]);
}
for (const size of [16, 32, 48, 128]) {
  const bytes = Buffer.alloc((size * 4 + 1) * size);
  const inRect = (x, y, a, b, c, d) => x >= a && y >= b && x < c && y < d;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = (x + .5) / size * 48, py = (y + .5) / size * 48;
    const cornerX = Math.max(12 - px, 0, px - 36), cornerY = Math.max(12 - py, 0, py - 36);
    let color = cornerX ** 2 + cornerY ** 2 > 144 ? [0, 0, 0, 0] : [15, 118, 110, 255];
    if (color[3] && (inRect(px, py, 13, 12, 20, 38) || inRect(px, py, 13, 32, 32, 38))) color = [255, 255, 255, 255];
    if (inRect(px, py, 29, 12, 36, 19)) color = [190, 219, 204, 255];
    if (inRect(px, py, 29, 22, 36, 29)) color = [232, 184, 119, 255];
    bytes.set(color, y * (size * 4 + 1) + 1 + x * 4);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  writeFileSync(new URL(`../extension/assets/icon${size}.png`, import.meta.url), Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(bytes)), chunk("IEND", Buffer.alloc(0))]));
}

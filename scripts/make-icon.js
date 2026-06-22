// Generates build/icon.ico and build/icon.png (a calendar glyph) with no
// external dependencies — uses only Node's built-in zlib for PNG compression.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const S = 256;
const buf = Buffer.alloc(S * S * 4, 0); // RGBA, transparent

function px(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  // simple alpha blend over existing
  const sa = a / 255;
  const da = buf[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa === 0) return;
  buf[i] = Math.round((r * sa + buf[i] * da * (1 - sa)) / oa);
  buf[i + 1] = Math.round((g * sa + buf[i + 1] * da * (1 - sa)) / oa);
  buf[i + 2] = Math.round((b * sa + buf[i + 2] * da * (1 - sa)) / oa);
  buf[i + 3] = Math.round(oa * 255);
}

function roundRect(x0, y0, w, h, rad, r, g, b, a = 255) {
  const x1 = x0 + w, y1 = y0 + h;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      let cx = x, cy = y;
      if (x < x0 + rad && y < y0 + rad) { cx = x0 + rad; cy = y0 + rad; }
      else if (x > x1 - rad - 1 && y < y0 + rad) { cx = x1 - rad - 1; cy = y0 + rad; }
      else if (x < x0 + rad && y > y1 - rad - 1) { cx = x0 + rad; cy = y1 - rad - 1; }
      else if (x > x1 - rad - 1 && y > y1 - rad - 1) { cx = x1 - rad - 1; cy = y1 - rad - 1; }
      else { px(x, y, r, g, b, a); continue; }
      const d = Math.hypot(x - cx, y - cy);
      if (d <= rad) {
        const edge = rad - d;
        px(x, y, r, g, b, edge < 1 ? Math.round(a * edge) : a);
      }
    }
  }
}

// Body (white card with subtle border)
roundRect(34, 46, 188, 178, 22, 255, 255, 255, 255);
// Header bar (red accent)
roundRect(34, 46, 188, 56, 22, 0xE5, 0x3E, 0x3E, 255);
// square off the bottom of the header so only top corners are round
for (let y = 80; y < 102; y++) for (let x = 34; x < 222; x++) px(x, y, 0xE5, 0x3E, 0x3E, 255);
// Binder rings
roundRect(74, 30, 14, 34, 6, 0x55, 0x55, 0x55, 255);
roundRect(168, 30, 14, 34, 6, 0x55, 0x55, 0x55, 255);
// Calendar grid dots (days)
const gx = 60, gy = 128, cell = 34;
for (let row = 0; row < 3; row++) {
  for (let col = 0; col < 4; col++) {
    const isToday = row === 1 && col === 1;
    roundRect(gx + col * cell, gy + row * cell, 20, 20, 5,
      isToday ? 0xE5 : 0xBF, isToday ? 0x3E : 0xC7, isToday ? 0x3E : 0xCF, 255);
  }
}

// ---- PNG encode ----
function crc32(b) {
  let c = ~0;
  for (let i = 0; i < b.length; i++) {
    c ^= b[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG() {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((S * 4 + 1) * S);
  for (let y = 0; y < S; y++) {
    raw[y * (S * 4 + 1)] = 0; // filter type 0
    buf.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const png = encodePNG();

// ---- ICO wrap (single 256px PNG-compressed entry) ----
const dir = Buffer.alloc(6);
dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16);
entry[0] = 0; entry[1] = 0; // 256 -> stored as 0
entry[2] = 0; entry[3] = 0;
entry.writeUInt16LE(1, 4); // planes
entry.writeUInt16LE(32, 6); // bpp
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(6 + 16, 12);
const ico = Buffer.concat([dir, entry, png]);

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon.png'), png);
fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
console.log('Wrote build/icon.png (' + png.length + ' bytes) and build/icon.ico (' + ico.length + ' bytes)');

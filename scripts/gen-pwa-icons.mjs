// Erzeugt die PWA-Icons ohne externe Bild-Tools (kein sharp/imagemagick auf
// dem Build-Host verfügbar). Flaches Emerald-Feld mit weißer, abgerundeter
// Marke in der maskierbaren Sicherheitszone. Bei Bedarf später durch ein
// richtiges Logo ersetzen – die Dateinamen bleiben gleich.
//
//   node scripts/gen-pwa-icons.mjs
//
// schreibt public/icon-192.png, public/icon-512.png, public/apple-touch-icon.png

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const BG = [4, 120, 87]; // #047857 emerald-700
const FG = [255, 255, 255];

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "latin1");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function pngRGBA(size, pixel) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // rest 0

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size);
      const o = y * (stride + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Emerald-Hintergrund, weiße abgerundete Fläche im inneren ~58% (maskierbar).
function markPixel(x, y, size) {
  const inset = size * 0.21;
  const r = size * 0.12; // Eckenradius
  const min = inset;
  const max = size - inset;
  let inside = x >= min && x <= max && y >= min && y <= max;
  // Ecken abrunden
  const cx = x < min + r ? min + r : x > max - r ? max - r : x;
  const cy = y < min + r ? min + r : y > max - r ? max - r : y;
  if (inside) {
    const dx = x - cx;
    const dy = y - cy;
    if (dx * dx + dy * dy > r * r) inside = false;
  }
  return inside ? [...FG, 255] : [...BG, 255];
}

for (const [name, size] of [
  ["public/icon-192.png", 192],
  ["public/icon-512.png", 512],
  ["public/apple-touch-icon.png", 180],
]) {
  writeFileSync(new URL(`../${name}`, import.meta.url), pngRGBA(size, markPixel));
  console.log("geschrieben:", name, `${size}x${size}`);
}

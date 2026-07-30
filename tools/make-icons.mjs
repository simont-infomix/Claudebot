/**
 * Generates the PWA icons in `web/public/` — a post-it pinned to cork, matching the board view.
 *
 * Everything is rasterised here by hand (no image tooling, no downloads, no dependencies), so the
 * icons can be regenerated on any machine with `npm run icons`. The output PNGs are committed;
 * this script only exists to document where they came from and to allow tweaking the artwork.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = join(import.meta.dirname, '..', 'web', 'public');

// --- minimal PNG encoder ------------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** `rgb` is a flat Uint8Array of size*size*3. */
function encodePng(size, rgb) {
  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgb.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- artwork -----------------------------------------------------------------------------------

const CORK = [0xc1, 0x9a, 0x6b];
const CORK_LIT = [0xd6, 0xb0, 0x80];
const CORK_DIM = [0x9a, 0x74, 0x48];
const PAPER = [0xfd, 0xf0, 0x7a];
const PAPER_DIM = [0xe8, 0xd8, 0x5e];
const INK = [0x33, 0x30, 0x1f];
const PIN = [0xd2, 0x4b, 0x42];
const PIN_LIT = [0xf0, 0x8a, 0x84];

const TILT = (-7 * Math.PI) / 180;
const COS = Math.cos(TILT);
const SIN = Math.sin(TILT);

const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Signed distance to an axis-aligned rect centred on the origin; negative inside. */
function sdRect(u, v, hw, hh) {
  const dx = Math.abs(u) - hw;
  const dy = Math.abs(v) - hh;
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0);
}

/** Colour of a single sample, in unit coordinates with the icon centre at (0, 0). */
function sample(x, y, half) {
  // cork: lit from the top-left, darker towards the bottom-right
  const lit = clamp01(0.5 - (x + y) * 0.8);
  let colour = mix(mix(CORK, CORK_DIM, clamp01((x + y) * 0.9 + 0.2)), CORK_LIT, lit * 0.5);

  // note geometry, rotated by TILT around the centre (slightly below it, to leave room for the pin)
  const cy = y - half * 0.04;
  const u = x * COS + cy * SIN;
  const v = -x * SIN + cy * COS;

  // soft drop shadow, offset down-right
  const sd = sdRect(u - half * 0.05, v - half * 0.07, half, half * 0.92);
  if (sd < half * 0.14) {
    const alpha = clamp01(1 - sd / (half * 0.14)) * 0.5;
    colour = mix(colour, [0x2a, 0x18, 0x08], alpha);
  }

  if (sdRect(u, v, half, half * 0.92) <= 0) {
    // paper, with a hint of shading towards the bottom-right corner
    colour = mix(PAPER, PAPER_DIM, clamp01((u / half) * 0.35 + (v / half) * 0.5 + 0.15));

    // three handwriting lines, bottom-up: the last one is short, like an unfinished thought
    const widths = [0.4, 0.72, 0.72];
    for (let i = 0; i < widths.length; i++) {
      const lineY = (-0.34 + i * 0.31) * half;
      const lineX = (-0.72 + widths[i]) * half;
      if (sdRect(u - lineX, v - lineY, widths[i] * half, half * 0.05) <= 0) colour = INK;
    }
  }

  // pin head, sitting on the top edge of the note
  const pinY = y - half * 0.86;
  const r = Math.hypot(x, pinY);
  const pinR = half * 0.2;
  if (r <= pinR) {
    colour = mix(PIN, PIN_LIT, clamp01(1 - (x + pinY + pinR) / pinR) * 0.9);
    if (r > pinR * 0.82) colour = mix(colour, [0x7a, 0x22, 0x1c], 0.55);
  }

  return colour;
}

const SS = 3; // supersampling factor: cheap antialiasing

function render(size, noteHalf) {
  const rgb = new Uint8Array(size * size * 3);
  const step = 1 / (size * SS);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px * SS + sx + 0.5) * step - 0.5;
          const y = (py * SS + sy + 0.5) * step - 0.5;
          const c = sample(x, -y, noteHalf);
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const n = SS * SS;
      const i = (py * size + px) * 3;
      rgb[i] = Math.round(r / n);
      rgb[i + 1] = Math.round(g / n);
      rgb[i + 2] = Math.round(b / n);
    }
  }

  return encodePng(size, rgb);
}

// `noteHalf` is the note's half-width in unit coordinates: 0.3 leaves a normal margin, 0.235 keeps
// the whole note inside the maskable safe zone (the inner 80% circle) whatever shape the OS crops to.
const ICONS = [
  ['icon-192.png', 192, 0.3],
  ['icon-512.png', 512, 0.3],
  ['icon-maskable-512.png', 512, 0.235],
  ['apple-touch-icon.png', 180, 0.3],
];

for (const [name, size, noteHalf] of ICONS) {
  const png = render(size, noteHalf);
  writeFileSync(join(OUT_DIR, name), png);
  console.log(`${name}  ${size}x${size}  ${(png.length / 1024).toFixed(1)} kB`);
}

/**
 * Icon generator for LARK.
 *
 * Rasterises icons/lark.svg into the four PNG sizes the manifest needs. The SVG is
 * the single source of truth for the mark's geometry — this file only parses the
 * `d` attributes out of it, so editing the shape means editing the SVG.
 *
 * No dependencies, in keeping with the rest of the project: the path is flattened
 * to polylines, filled with a non-zero winding test, and 4x4 supersampled so the
 * curves and the rounded background come out cleanly anti-aliased at 16px.
 *
 * Run: node create-icons.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CANVAS = 128;             // the SVG viewBox the coordinates are written in
const SS = 4;                   // supersampling factor per axis
const BG_RADIUS = 24;           // matches rx on the SVG background rect
const PAPER = [0xF0, 0xEE, 0xE6];
const CLAY = [0xB8, 0x5C, 0x38];

// ---- PNG encoding ------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  return table;
})();

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);

  return Buffer.concat([length, typeBuffer, data, crc]);
}

function createPNG(width, height, pixelData) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);   // bit depth
  ihdr.writeUInt8(6, 9);   // colour type: RGBA
  ihdr.writeUInt8(0, 10);  // compression
  ihdr.writeUInt8(0, 11);  // filter
  ihdr.writeUInt8(0, 12);  // interlace

  const rawData = Buffer.alloc(height * (1 + width * 4));
  let offset = 0;
  let pixelOffset = 0;
  for (let y = 0; y < height; y++) {
    rawData[offset++] = 0; // filter type: none
    for (let x = 0; x < width * 4; x++) rawData[offset++] = pixelData[pixelOffset++];
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    createChunk('IHDR', ihdr),
    createChunk('IDAT', zlib.deflateSync(rawData, { level: 9 })),
    createChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- Path parsing and flattening ---------------------------------------------

// Handles the subset the mark uses: absolute M, L, C and Z. Returns an array of
// closed subpaths, each a flat list of {x, y} points.
function flattenPath(d) {
  const tokens = d.match(/[MLCZmlcz]|-?\d*\.?\d+/g) || [];
  const subpaths = [];
  let current = null;
  let cursor = { x: 0, y: 0 };
  let i = 0;

  const num = () => parseFloat(tokens[i++]);

  while (i < tokens.length) {
    const cmd = tokens[i++];
    switch (cmd) {
      case 'M': {
        if (current && current.length > 1) subpaths.push(current);
        cursor = { x: num(), y: num() };
        current = [cursor];
        break;
      }
      case 'L': {
        cursor = { x: num(), y: num() };
        current.push(cursor);
        break;
      }
      case 'C': {
        const p0 = cursor;
        const p1 = { x: num(), y: num() };
        const p2 = { x: num(), y: num() };
        const p3 = { x: num(), y: num() };
        const STEPS = 32;
        for (let s = 1; s <= STEPS; s++) {
          const t = s / STEPS;
          const u = 1 - t;
          current.push({
            x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
            y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
          });
        }
        cursor = p3;
        break;
      }
      case 'Z':
      case 'z': {
        if (current && current.length > 1) subpaths.push(current);
        current = null;
        break;
      }
      default:
        throw new Error(`Unsupported path command "${cmd}" — extend flattenPath()`);
    }
  }

  if (current && current.length > 1) subpaths.push(current);
  return subpaths;
}

// Non-zero winding test against the flattened subpaths.
function isInside(subpaths, x, y) {
  let winding = 0;
  for (const points of subpaths) {
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if (a.y <= y) {
        if (b.y > y && (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y) > 0) winding++;
      } else if (b.y <= y) {
        if ((b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y) < 0) winding--;
      }
    }
  }
  return winding !== 0;
}

// Rounded-rect coverage, in canvas coordinates.
function insideBackground(x, y) {
  const r = BG_RADIUS;
  if (x < 0 || y < 0 || x > CANVAS || y > CANVAS) return false;
  const cx = x < r ? r : x > CANVAS - r ? CANVAS - r : x;
  const cy = y < r ? r : y > CANVAS - r ? CANVAS - r : y;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

// ---- Rendering ----------------------------------------------------------------

function renderIcon(size, birdSubpaths) {
  const pixels = Buffer.alloc(size * size * 4);
  const scale = CANVAS / size;
  const step = 1 / SS;
  const samples = SS * SS;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bgHits = 0;
      let birdHits = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) * step) * scale;
          const y = (py + (sy + 0.5) * step) * scale;
          const onPaper = insideBackground(x, y);
          if (!onPaper) continue;
          bgHits++;
          if (isInside(birdSubpaths, x, y)) birdHits++;
        }
      }

      const idx = (py * size + px) * 4;
      if (bgHits === 0) continue; // stays fully transparent

      // The bird is only ever drawn over paper, so its coverage is a fraction of
      // the background coverage — compositing the two keeps the rounded edge clean.
      const birdRatio = birdHits / bgHits;
      pixels[idx]     = Math.round(PAPER[0] * (1 - birdRatio) + CLAY[0] * birdRatio);
      pixels[idx + 1] = Math.round(PAPER[1] * (1 - birdRatio) + CLAY[1] * birdRatio);
      pixels[idx + 2] = Math.round(PAPER[2] * (1 - birdRatio) + CLAY[2] * birdRatio);
      pixels[idx + 3] = Math.round((bgHits / samples) * 255);
    }
  }

  return pixels;
}

// ---- Main ---------------------------------------------------------------------

const iconsDir = path.join(__dirname, 'icons');
const master = fs.readFileSync(path.join(iconsDir, 'lark.svg'), 'utf8');

const birdMatch = master.match(/id="bird"[^>]*\sd="([^"]+)"/);
if (!birdMatch) throw new Error('Could not find the bird path in icons/lark.svg');
const birdSubpaths = flattenPath(birdMatch[1]);

for (const size of [16, 32, 48, 128]) {
  const png = createPNG(size, size, renderIcon(size, birdSubpaths));
  fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), png);
  // Keep the per-size SVGs in step with the master; the viewBox does the scaling.
  fs.writeFileSync(
    path.join(iconsDir, `icon${size}.svg`),
    master.replace('width="128" height="128"', `width="${size}" height="${size}"`)
  );
  console.log(`  ok  icon${size}.png + icon${size}.svg`);
}

console.log('\nIcons written from icons/lark.svg');

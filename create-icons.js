/**
 * Icon Generator for LLM Content Extractor
 * 
 * This script creates PNG icons for the Chrome extension.
 * It uses pure JavaScript to generate valid PNG files.
 * 
 * Run: node create-icons.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// PNG constants
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

function crc32(data) {
  let crc = 0xFFFFFFFF;
  const table = new Uint32Array(256);
  
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  
  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  
  const typeBuffer = Buffer.from(type);
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData), 0);
  
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function createPNG(width, height, pixelData) {
  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);   // bit depth
  ihdr.writeUInt8(6, 9);   // color type (RGBA)
  ihdr.writeUInt8(0, 10);  // compression
  ihdr.writeUInt8(0, 11);  // filter
  ihdr.writeUInt8(0, 12);  // interlace
  
  // Raw image data with filter bytes
  const rawData = Buffer.alloc(height * (1 + width * 4));
  let offset = 0;
  let pixelOffset = 0;
  
  for (let y = 0; y < height; y++) {
    rawData[offset++] = 0; // filter type: none
    for (let x = 0; x < width; x++) {
      rawData[offset++] = pixelData[pixelOffset++]; // R
      rawData[offset++] = pixelData[pixelOffset++]; // G
      rawData[offset++] = pixelData[pixelOffset++]; // B
      rawData[offset++] = pixelData[pixelOffset++]; // A
    }
  }
  
  // Compress with zlib
  const compressed = zlib.deflateSync(rawData, { level: 9 });
  
  // Build PNG
  const ihdrChunk = createChunk('IHDR', ihdr);
  const idatChunk = createChunk('IDAT', compressed);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));
  
  return Buffer.concat([PNG_SIGNATURE, ihdrChunk, idatChunk, iendChunk]);
}

function generateIconPixels(size) {
  const pixels = [];
  const radius = size * 0.1875; // Rounded corner radius
  
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Check if pixel is in rounded rect
      let inRect = true;
      
      // Check corners
      if (x < radius && y < radius) {
        const dx = radius - x;
        const dy = radius - y;
        inRect = (dx * dx + dy * dy) <= radius * radius;
      } else if (x >= size - radius && y < radius) {
        const dx = x - (size - radius);
        const dy = radius - y;
        inRect = (dx * dx + dy * dy) <= radius * radius;
      } else if (x < radius && y >= size - radius) {
        const dx = radius - x;
        const dy = y - (size - radius);
        inRect = (dx * dx + dy * dy) <= radius * radius;
      } else if (x >= size - radius && y >= size - radius) {
        const dx = x - (size - radius);
        const dy = y - (size - radius);
        inRect = (dx * dx + dy * dy) <= radius * radius;
      }
      
      if (inRect) {
        // Gradient from #ff6b35 to #f7c94b
        const ratio = (x + y) / (2 * size);
        const r = Math.round(255 * (1 - ratio) + 247 * ratio);
        const g = Math.round(107 * (1 - ratio) + 201 * ratio);
        const b = Math.round(53 * (1 - ratio) + 75 * ratio);
        
        pixels.push(r, g, b, 255);
      } else {
        pixels.push(0, 0, 0, 0); // Transparent
      }
    }
  }
  
  // Draw the stacked layers icon
  const cx = size / 2;
  const scale = size / 128;
  
  // Icon coordinates
  const points = {
    top: 28 * scale,
    mid1: 46 * scale,
    mid2: 64 * scale,
    mid3: 82 * scale,
    bottom: 100 * scale,
    left: 28 * scale,
    right: 100 * scale
  };
  
  // Draw lines (simplified - just darken pixels along the paths)
  const lineWidth = Math.max(2, 6 * scale);
  const darkColor = [10, 10, 15, 255];
  
  function setPixel(px, py, color) {
    if (px >= 0 && px < size && py >= 0 && py < size) {
      const idx = (Math.floor(py) * size + Math.floor(px)) * 4;
      // Only draw on non-transparent pixels
      if (pixels[idx + 3] > 0) {
        pixels[idx] = color[0];
        pixels[idx + 1] = color[1];
        pixels[idx + 2] = color[2];
        pixels[idx + 3] = color[3];
      }
    }
  }
  
  function drawLine(x1, y1, x2, y2, width, color) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(length * 2);
    
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = x1 + dx * t;
      const py = y1 + dy * t;
      
      // Draw thick line
      for (let ox = -width/2; ox <= width/2; ox++) {
        for (let oy = -width/2; oy <= width/2; oy++) {
          if (ox * ox + oy * oy <= (width/2) * (width/2)) {
            setPixel(px + ox, py + oy, color);
          }
        }
      }
    }
  }
  
  // Draw the three-layer stack icon
  // Top diamond
  drawLine(cx, points.top, points.left, points.mid1, lineWidth, darkColor);
  drawLine(points.left, points.mid1, cx, points.mid2, lineWidth, darkColor);
  drawLine(cx, points.mid2, points.right, points.mid1, lineWidth, darkColor);
  drawLine(points.right, points.mid1, cx, points.top, lineWidth, darkColor);
  
  // Middle layer
  drawLine(points.left, points.mid2, cx, points.mid3, lineWidth, darkColor);
  drawLine(cx, points.mid3, points.right, points.mid2, lineWidth, darkColor);
  
  // Bottom layer
  drawLine(points.left, points.mid3, cx, points.bottom, lineWidth, darkColor);
  drawLine(cx, points.bottom, points.right, points.mid3, lineWidth, darkColor);
  
  return Buffer.from(pixels);
}

// Generate icons
const sizes = [16, 32, 48, 128];
const iconsDir = path.join(__dirname, 'icons');

// Ensure icons directory exists
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir);
}

sizes.forEach(size => {
  console.log(`Generating ${size}x${size} icon...`);
  const pixels = generateIconPixels(size);
  const png = createPNG(size, size, pixels);
  const filePath = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(filePath, png);
  console.log(`  ✓ Created ${filePath}`);
});

console.log('\n✅ All icons generated successfully!');
console.log('\nYou can now load the extension in Chrome:');
console.log('1. Go to chrome://extensions/');
console.log('2. Enable "Developer mode"');
console.log('3. Click "Load unpacked"');
console.log('4. Select this folder');


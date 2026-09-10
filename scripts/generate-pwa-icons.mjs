import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'

const outDir = resolve(process.cwd(), 'public')
const targets = [
  { size: 192, file: 'zivifactura-app-192-v42.png' },
  { size: 512, file: 'zivifactura-app-512-v42.png' },
]

const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n += 1) {
  let c = n
  for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crcTable[n] = c >>> 0
}

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data = Buffer.alloc(0)) {
  const name = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0)
  return Buffer.concat([length, name, data, crc])
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

function mix(c1, c2, t) {
  return [
    Math.round(lerp(c1[0], c2[0], t)),
    Math.round(lerp(c1[1], c2[1], t)),
    Math.round(lerp(c1[2], c2[2], t)),
    Math.round(lerp(c1[3] ?? 255, c2[3] ?? 255, t)),
  ]
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

function makeCanvas(size) {
  return new Uint8ClampedArray(size * size * 4)
}

function blendPixel(canvas, size, x, y, color) {
  if (x < 0 || y < 0 || x >= size || y >= size) return
  const i = (Math.round(y) * size + Math.round(x)) * 4
  const a = clamp((color[3] ?? 255) / 255, 0, 1)
  const ia = 1 - a
  canvas[i] = Math.round(color[0] * a + canvas[i] * ia)
  canvas[i + 1] = Math.round(color[1] * a + canvas[i + 1] * ia)
  canvas[i + 2] = Math.round(color[2] * a + canvas[i + 2] * ia)
  canvas[i + 3] = Math.round(255 * a + canvas[i + 3] * ia)
}

function roundedRectCoverage(px, py, x, y, w, h, r) {
  const cx = clamp(px, x + r, x + w - r)
  const cy = clamp(py, y + r, y + h - r)
  const d = Math.hypot(px - cx, py - cy)
  return clamp(r + 0.75 - d, 0, 1)
}

function drawRoundedRect(canvas, size, x, y, w, h, r, color) {
  const minX = Math.max(0, Math.floor(x - 1))
  const maxX = Math.min(size - 1, Math.ceil(x + w + 1))
  const minY = Math.max(0, Math.floor(y - 1))
  const maxY = Math.min(size - 1, Math.ceil(y + h + 1))
  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const cov = roundedRectCoverage(px + 0.5, py + 0.5, x, y, w, h, r)
      if (cov > 0) blendPixel(canvas, size, px, py, [color[0], color[1], color[2], Math.round((color[3] ?? 255) * cov)])
    }
  }
}

function drawCircle(canvas, size, cx, cy, radius, color) {
  const minX = Math.max(0, Math.floor(cx - radius - 2))
  const maxX = Math.min(size - 1, Math.ceil(cx + radius + 2))
  const minY = Math.max(0, Math.floor(cy - radius - 2))
  const maxY = Math.min(size - 1, Math.ceil(cy + radius + 2))
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      const cov = clamp(radius + 0.85 - d, 0, 1)
      if (cov > 0) blendPixel(canvas, size, x, y, [color[0], color[1], color[2], Math.round((color[3] ?? 255) * cov)])
    }
  }
}

function cubicPoint(p0, p1, p2, p3, t) {
  const mt = 1 - t
  const a = mt * mt * mt
  const b = 3 * mt * mt * t
  const c = 3 * mt * t * t
  const d = t * t * t
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  }
}

function drawRibbon(canvas, size, points, radius, from, to, alpha = 255) {
  const steps = Math.max(90, Math.round(size * 0.82))
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    const p = cubicPoint(points[0], points[1], points[2], points[3], t)
    const c = mix(from, to, t)
    drawCircle(canvas, size, p.x * size, p.y * size, radius * size, [c[0], c[1], c[2], alpha])
  }
}

function drawRibbonHighlight(canvas, size, points, radius, alpha = 95) {
  const shifted = points.map(p => ({ x: p.x - 0.006, y: p.y - 0.016 }))
  drawRibbon(canvas, size, shifted, radius, [255, 255, 255, alpha], [255, 255, 255, 0], alpha)
}

function drawLine(canvas, size, x1, y1, x2, y2, width, color) {
  const dx = x2 - x1
  const dy = y2 - y1
  const steps = Math.max(1, Math.round(Math.hypot(dx, dy) * size * 1.2))
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    drawCircle(canvas, size, lerp(x1, x2, t) * size, lerp(y1, y2, t) * size, width * size, color)
  }
}

function drawDollar(canvas, size, cx, cy, scale, color) {
  drawLine(canvas, size, cx, cy - scale * 0.2, cx, cy + scale * 0.22, scale * 0.035, color)
  drawLine(canvas, size, cx - scale * 0.12, cy - scale * 0.12, cx + scale * 0.1, cy - scale * 0.12, scale * 0.04, color)
  drawLine(canvas, size, cx - scale * 0.11, cy, cx + scale * 0.1, cy, scale * 0.04, color)
  drawLine(canvas, size, cx - scale * 0.1, cy + scale * 0.12, cx + scale * 0.12, cy + scale * 0.12, scale * 0.04, color)
  drawCircle(canvas, size, cx - scale * 0.115, cy - scale * 0.075, scale * 0.05, color)
  drawCircle(canvas, size, cx + scale * 0.115, cy + scale * 0.075, scale * 0.05, color)
}

function paintBackground(canvas, size) {
  const inset = size * 0.06
  const baseRadius = size * 0.18
  drawRoundedRect(canvas, size, inset + size * 0.01, inset + size * 0.018, size - inset * 2, size - inset * 2, baseRadius, [16, 122, 218, 62])
  drawRoundedRect(canvas, size, inset, inset, size - inset * 2, size - inset * 2, baseRadius, [218, 244, 255, 255])

  for (let y = Math.floor(inset); y < size - inset; y += 1) {
    for (let x = Math.floor(inset); x < size - inset; x += 1) {
      const cov = roundedRectCoverage(x + 0.5, y + 0.5, inset, inset, size - inset * 2, size - inset * 2, baseRadius)
      if (!cov) continue
      const t = (x + y) / (size * 2)
      const glow = clamp(1 - Math.hypot(x - size * 0.35, y - size * 0.26) / (size * 0.58), 0, 1)
      blendPixel(canvas, size, x, y, [255, 255, 255, Math.round((90 * (1 - t) + 55 * glow) * cov)])
      blendPixel(canvas, size, x, y, [17, 165, 240, Math.round(34 * t * cov)])
    }
  }

  drawRibbon(canvas, size,
    [{ x: 0.12, y: 0.28 }, { x: 0.32, y: 0.12 }, { x: 0.55, y: 0.24 }, { x: 0.83, y: 0.19 }],
    0.034, [255, 255, 255, 92], [255, 255, 255, 4], 74)
}

function drawDocument(canvas, size) {
  const x = 0.61 * size
  const y = 0.43 * size
  const w = 0.23 * size
  const h = 0.31 * size
  const r = 0.045 * size
  drawRoundedRect(canvas, size, x + size * 0.01, y + size * 0.013, w, h, r, [19, 72, 138, 44])
  drawRoundedRect(canvas, size, x, y, w, h, r, [252, 254, 255, 250])

  const fold = 0.075 * size
  for (let py = Math.floor(y); py <= y + fold; py += 1) {
    for (let px = Math.floor(x + w - fold); px <= x + w; px += 1) {
      if (px + py <= x + w + y + 2) blendPixel(canvas, size, px, py, [192, 228, 255, 240])
    }
  }
  drawLine(canvas, size, 0.655, 0.505, 0.765, 0.505, 0.009, [46, 111, 186, 210])
  drawLine(canvas, size, 0.655, 0.565, 0.785, 0.565, 0.009, [46, 111, 186, 210])
  drawLine(canvas, size, 0.655, 0.625, 0.735, 0.625, 0.009, [46, 111, 186, 210])
  drawDollar(canvas, size, 0.79, 0.67, 0.16, [0, 162, 229, 255])
}

function drawZiviRibbon(canvas, size) {
  drawRibbon(canvas, size,
    [{ x: 0.19, y: 0.28 }, { x: 0.37, y: 0.39 }, { x: 0.62, y: 0.15 }, { x: 0.83, y: 0.24 }],
    0.055, [0, 61, 143, 58], [0, 61, 143, 42], 58)
  drawRibbon(canvas, size,
    [{ x: 0.79, y: 0.28 }, { x: 0.67, y: 0.38 }, { x: 0.48, y: 0.49 }, { x: 0.33, y: 0.62 }],
    0.068, [120, 69, 8, 55], [85, 14, 118, 42], 56)
  drawRibbon(canvas, size,
    [{ x: 0.33, y: 0.65 }, { x: 0.47, y: 0.78 }, { x: 0.64, y: 0.61 }, { x: 0.80, y: 0.75 }],
    0.058, [83, 8, 145, 54], [117, 0, 89, 48], 54)

  const top = [{ x: 0.18, y: 0.26 }, { x: 0.35, y: 0.39 }, { x: 0.58, y: 0.14 }, { x: 0.84, y: 0.23 }]
  drawRibbon(canvas, size, top, 0.049, [12, 204, 229, 255], [0, 58, 210, 255])
  drawRibbonHighlight(canvas, size, top, 0.012, 110)

  const mid = [{ x: 0.79, y: 0.29 }, { x: 0.70, y: 0.42 }, { x: 0.47, y: 0.50 }, { x: 0.30, y: 0.64 }]
  drawRibbon(canvas, size, mid, 0.065, [255, 215, 50, 255], [245, 130, 0, 255])
  drawRibbonHighlight(canvas, size, mid, 0.014, 118)

  const bottom = [{ x: 0.31, y: 0.66 }, { x: 0.45, y: 0.80 }, { x: 0.63, y: 0.61 }, { x: 0.80, y: 0.75 }]
  drawRibbon(canvas, size, bottom, 0.055, [128, 9, 178, 255], [255, 25, 156, 255])
  drawRibbonHighlight(canvas, size, bottom, 0.012, 120)
}

function drawIcon(size) {
  const canvas = makeCanvas(size)
  paintBackground(canvas, size)
  drawDocument(canvas, size)
  drawZiviRibbon(canvas, size)

  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1)
    raw[rowStart] = 0
    for (let x = 0; x < size; x += 1) {
      const source = (y * size + x) * 4
      const dest = rowStart + 1 + x * 4
      raw[dest] = canvas[source]
      raw[dest + 1] = canvas[source + 1]
      raw[dest + 2] = canvas[source + 2]
      raw[dest + 3] = canvas[source + 3]
    }
  }
  return raw
}

function png(width, height, raw) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND')])
}

mkdirSync(outDir, { recursive: true })
for (const target of targets) {
  const filePath = resolve(outDir, target.file)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, png(target.size, target.size, drawIcon(target.size)))
  console.log(`Generated ${target.file} (${target.size}x${target.size})`)
}

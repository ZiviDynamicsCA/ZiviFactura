import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'

const outDir = resolve(process.cwd(), 'public')
const targets = [
  { size: 192, file: 'zivifactura-app-192-v40.png' },
  { size: 512, file: 'zivifactura-app-512-v40.png' },
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

function roundedRectMask(x, y, size, inset, radius) {
  const left = inset
  const top = inset
  const right = size - inset - 1
  const bottom = size - inset - 1
  const cx = x < left + radius ? left + radius : x > right - radius ? right - radius : x
  const cy = y < top + radius ? top + radius : y > bottom - radius ? bottom - radius : y
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= radius * radius
}

function blend(a, b, t) {
  return Math.round(a + (b - a) * t)
}

function setPixel(raw, offset, r, g, b, a = 255) {
  raw[offset] = r
  raw[offset + 1] = g
  raw[offset + 2] = b
  raw[offset + 3] = a
}

function drawIcon(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  const cx = size / 2
  const cy = size / 2
  const cardInset = Math.round(size * 0.13)
  const cardRadius = Math.round(size * 0.2)
  const paperX = Math.round(size * 0.31)
  const paperY = Math.round(size * 0.24)
  const paperW = Math.round(size * 0.38)
  const paperH = Math.round(size * 0.52)
  const paperRadius = Math.round(size * 0.055)
  const fold = Math.round(size * 0.12)

  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1)
    raw[rowStart] = 0
    for (let x = 0; x < size; x += 1) {
      const o = rowStart + 1 + x * 4
      const d = Math.hypot(x - cx, y - cy) / (size * 0.72)
      const t = Math.min(1, Math.max(0, (x + y) / (size * 2)))
      let r = blend(6, 7, t)
      let g = blend(81, 181, t)
      let b = blend(190, 238, t)

      // Soft app-icon base, with safe area for maskable usage.
      if (!roundedRectMask(x, y, size, cardInset, cardRadius)) {
        setPixel(raw, o, 246, 250, 255, 255)
        continue
      }

      const glow = Math.max(0, 1 - d)
      r = Math.min(255, r + Math.round(26 * glow))
      g = Math.min(255, g + Math.round(38 * glow))
      b = Math.min(255, b + Math.round(45 * glow))
      setPixel(raw, o, r, g, b, 255)

      // Accent ring.
      const ringOuter = size * 0.39
      const ringInner = size * 0.355
      const dist = Math.hypot(x - cx, y - cy)
      if (dist < ringOuter && dist > ringInner) setPixel(raw, o, 39, 231, 245, 255)

      // Document sheet.
      const inPaper = roundedRectMask(x - paperX, y - paperY, Math.max(paperW, paperH), 0, paperRadius) && x >= paperX && x <= paperX + paperW && y >= paperY && y <= paperY + paperH
      if (inPaper) setPixel(raw, o, 248, 252, 255, 255)

      // Fold.
      if (x > paperX + paperW - fold && y < paperY + fold && x + y < paperX + paperW + paperY + 1) setPixel(raw, o, 213, 232, 255, 255)

      // Receipt lines.
      const lineH = Math.max(2, Math.round(size * 0.012))
      const lineX = paperX + Math.round(size * 0.07)
      const lineW = paperW - Math.round(size * 0.14)
      const lineYs = [0.39, 0.49, 0.59].map(v => Math.round(size * v))
      if (x >= lineX && x <= lineX + lineW && lineYs.some(ly => Math.abs(y - ly) <= lineH)) setPixel(raw, o, 30, 112, 222, 255)

      // Z mark.
      const zLeft = Math.round(size * 0.27)
      const zRight = Math.round(size * 0.73)
      const zTop = Math.round(size * 0.34)
      const zBottom = Math.round(size * 0.67)
      const stroke = Math.max(8, Math.round(size * 0.055))
      const onTop = y >= zTop && y <= zTop + stroke && x >= zLeft && x <= zRight
      const onBottom = y >= zBottom - stroke && y <= zBottom && x >= zLeft && x <= zRight
      const targetX = zRight - ((y - zTop) / Math.max(1, zBottom - zTop)) * (zRight - zLeft)
      const onDiag = y >= zTop && y <= zBottom && Math.abs(x - targetX) <= stroke * 0.62
      if (onTop || onBottom || onDiag) setPixel(raw, o, 255, 255, 255, 255)
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

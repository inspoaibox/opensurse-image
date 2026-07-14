import exifr from 'exifr'
import fs from 'node:fs'
import { imageSize } from 'image-size'

const exifOptions = {
  tiff: true,
  ifd0: true,
  ifd1: true,
  exif: true,
  gps: true,
  interop: true,
  makerNote: true,
  userComment: true,
  xmp: true,
  icc: true,
  iptc: true,
  jfif: true,
  ihdr: true,
  translateKeys: true,
  translateValues: true,
  reviveValues: true,
  sanitize: true,
  mergeOutput: false,
  silentErrors: true,
}

const normalizeMetadataValue = (value, seen = new WeakSet()) => {
  if (value === undefined) return undefined
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Error) return value.message
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return `[二进制数据 ${value.byteLength} 字节]`
  if (value instanceof ArrayBuffer) return `[二进制数据 ${value.byteLength} 字节]`
  if (typeof value !== 'object') return String(value)
  if (seen.has(value)) return '[循环引用]'

  seen.add(value)
  if (Array.isArray(value)) return value.map((item) => normalizeMetadataValue(item, seen)).filter((item) => item !== undefined)
  const normalized = {}
  for (const [key, item] of Object.entries(value)) {
    const normalizedItem = normalizeMetadataValue(item, seen)
    if (normalizedItem !== undefined) normalized[key] = normalizedItem
  }
  return normalized
}

export const extractImageMetadata = async (source) => {
  const buffer = Buffer.isBuffer(source) ? source : fs.readFileSync(source)
  let dimensions = {}
  let exif = {}

  try {
    dimensions = imageSize(buffer)
  } catch {
    // Some valid image subtypes are not supported by the dimension parser.
  }

  try {
    exif = normalizeMetadataValue(await exifr.parse(buffer, exifOptions)) || {}
  } catch {
    // Images without EXIF or with malformed metadata remain valid uploads.
  }

  return {
    width: Number.isFinite(dimensions.width) ? dimensions.width : null,
    height: Number.isFinite(dimensions.height) ? dimensions.height : null,
    format: typeof dimensions.type === 'string' ? dimensions.type.toLowerCase() : null,
    exif,
  }
}

export const parseStoredExif = (value) => {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

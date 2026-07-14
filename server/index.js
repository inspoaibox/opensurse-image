import bcrypt from 'bcryptjs'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import Database from 'better-sqlite3'
import express from 'express'
import jwt from 'jsonwebtoken'
import multer from 'multer'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { extractImageMetadata, parseStoredExif } from './image-metadata.js'
import {
  defaultImageProcessingSettings,
  ImageProcessingError,
  normalizeImageProcessingSettings,
  processUploadedImage,
  validateUploadFilename,
} from './image-processing.js'
import { createStorageManager, StorageManagerError } from './storage.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const uploadsDir = path.join(__dirname, 'uploads')
const dataDir = path.join(__dirname, 'data')
const uploadTempDir = path.join(dataDir, 'tmp')
const seedFile = path.join(dataDir, 'images.json')
const databaseFile = path.resolve(process.env.PICNEST_DB_PATH || path.join(dataDir, 'picnest.db'))
const secretFile = path.join(dataDir, '.session-secret')
const configuredApiMonthlyLimit = Number(process.env.PICNEST_API_MONTHLY_LIMIT || 50000)
const apiMonthlyLimit = Number.isFinite(configuredApiMonthlyLimit) && configuredApiMonthlyLimit > 0
  ? Math.floor(configuredApiMonthlyLimit)
  : 50000
const configuredPublicUrl = String(process.env.PICNEST_PUBLIC_URL || '').trim().replace(/\/+$/, '')

fs.mkdirSync(uploadsDir, { recursive: true })
fs.mkdirSync(dataDir, { recursive: true })
fs.mkdirSync(uploadTempDir, { recursive: true })

const sessionSecret = process.env.PICNEST_SESSION_SECRET || (() => {
  if (fs.existsSync(secretFile)) return fs.readFileSync(secretFile, 'utf8').trim()
  const value = crypto.randomBytes(48).toString('hex')
  fs.writeFileSync(secretFile, value, { encoding: 'utf8', mode: 0o600 })
  return value
})()
const storageEncryptionSecret = process.env.PICNEST_STORAGE_SECRET || sessionSecret

const db = new Database(databaseFile)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin', 'member')),
    quota INTEGER NOT NULL DEFAULT 5368709120,
    storage_provider_id TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS storage_providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    config_encrypted TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    filename TEXT,
    storage_provider_id TEXT,
    storage_key TEXT,
    url TEXT NOT NULL,
    type TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    width INTEGER,
    height INTEGER,
    album TEXT NOT NULL DEFAULT '未分类',
    starred INTEGER NOT NULL DEFAULT 0,
    views INTEGER NOT NULL DEFAULT 0,
    exif_json TEXT,
    processing_json TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_images_owner_created ON images(owner_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS albums (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(owner_id, name)
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix TEXT NOT NULL,
    secret_encrypted TEXT,
    created_at TEXT NOT NULL,
    last_used_at TEXT
  );

  CREATE TABLE IF NOT EXISTS api_usage_monthly (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    month TEXT NOT NULL,
    calls INTEGER NOT NULL DEFAULT 0,
    success_calls INTEGER NOT NULL DEFAULT 0,
    failed_calls INTEGER NOT NULL DEFAULT 0,
    response_ms_total INTEGER NOT NULL DEFAULT 0,
    traffic_bytes INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, month)
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`)

db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_storage_one_default ON storage_providers(is_default) WHERE is_default = 1')

const userColumns = db.prepare('PRAGMA table_info(users)').all()
if (!userColumns.some((column) => column.name === 'storage_provider_id')) {
  db.exec('ALTER TABLE users ADD COLUMN storage_provider_id TEXT')
}
const imageColumns = db.prepare('PRAGMA table_info(images)').all()
if (!imageColumns.some((column) => column.name === 'guest_uploaded')) {
  db.exec('ALTER TABLE images ADD COLUMN guest_uploaded INTEGER NOT NULL DEFAULT 0')
}
if (!imageColumns.some((column) => column.name === 'storage_provider_id')) {
  db.exec('ALTER TABLE images ADD COLUMN storage_provider_id TEXT')
}
if (!imageColumns.some((column) => column.name === 'storage_key')) {
  db.exec('ALTER TABLE images ADD COLUMN storage_key TEXT')
}
if (!imageColumns.some((column) => column.name === 'exif_json')) {
  db.exec('ALTER TABLE images ADD COLUMN exif_json TEXT')
}
if (!imageColumns.some((column) => column.name === 'processing_json')) {
  db.exec('ALTER TABLE images ADD COLUMN processing_json TEXT')
}
db.prepare(`
  UPDATE images SET storage_provider_id = 'local', storage_key = owner_id || '/' || filename
  WHERE filename IS NOT NULL AND (storage_provider_id IS NULL OR storage_key IS NULL)
`).run()
const albumColumns = db.prepare('PRAGMA table_info(albums)').all()
if (!albumColumns.some((column) => column.name === 'is_default')) {
  db.exec('ALTER TABLE albums ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0')
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_albums_one_default_per_owner ON albums(owner_id) WHERE is_default = 1')
const apiKeyColumns = db.prepare('PRAGMA table_info(api_keys)').all()
if (!apiKeyColumns.some((column) => column.name === 'secret_encrypted')) {
  db.exec('ALTER TABLE api_keys ADD COLUMN secret_encrypted TEXT')
}
db.prepare('INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)')
  .run('guest_upload_enabled', 'false', new Date().toISOString())
db.prepare('INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)')
  .run('image_processing', JSON.stringify(defaultImageProcessingSettings), new Date().toISOString())

const getImageProcessingSettings = () => {
  const value = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('image_processing')?.value
  try {
    return normalizeImageProcessingSettings(value ? JSON.parse(value) : {}, defaultImageProcessingSettings)
  } catch {
    return { ...defaultImageProcessingSettings }
  }
}

const parseBooleanField = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'boolean') return value
  if (String(value).toLowerCase() === 'true') return true
  if (String(value).toLowerCase() === 'false') return false
  throw new ImageProcessingError('布尔参数必须是 true 或 false', 400)
}

const uploadProcessingSettings = (body = {}, allowOverrides = true) => {
  const defaults = getImageProcessingSettings()
  if (!defaults.enabled || !allowOverrides) return defaults
  const requestedFormat = String(body.format || 'default').trim().toLowerCase()
  const outputFormat = requestedFormat === 'default' || !requestedFormat ? defaults.outputFormat : requestedFormat
  return normalizeImageProcessingSettings({
    ...defaults,
    outputFormat,
    quality: body.quality === undefined || body.quality === '' ? defaults.quality : Number(body.quality),
    autoOrient: parseBooleanField(body.autoOrient, defaults.autoOrient),
    stripMetadata: parseBooleanField(body.stripMetadata, defaults.stripMetadata),
  }, defaults)
}

const mapUser = (row) => row ? ({
  id: row.id,
  name: row.name,
  email: row.email,
  role: row.role,
  quota: Number(row.quota),
  storageProviderId: row.storage_provider_id || null,
  createdAt: row.created_at,
}) : null

const formatAliases = {
  jpeg: 'jpg',
  jpe: 'jpg',
  tif: 'tiff',
  'svg+xml': 'svg',
  'x-icon': 'ico',
  'vnd.microsoft.icon': 'ico',
}
const mimeTypesByFormat = {
  jpg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  tiff: 'image/tiff',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
}
const normalizeImageFormat = (value) => {
  const normalized = String(value || '').trim().toLowerCase().replace(/^image\//, '').replace(/^\./, '')
  return formatAliases[normalized] || normalized || 'image'
}
const imageFormatFor = (row) => normalizeImageFormat(row.type || row.mime_type || path.extname(row.name || row.filename || ''))
const imageExtensionFor = (row) => {
  const format = imageFormatFor(row)
  return format === 'image' ? '' : `.${format}`
}
const publicImageFilename = (row) => {
  const original = normalizeUploadFilename(row.name || row.filename || `image-${row.id}`)
  const extension = imageExtensionFor(row)
  const currentExtension = path.extname(original).toLowerCase()
  if (!extension || normalizeImageFormat(currentExtension) === normalizeImageFormat(extension)) return original
  return `${path.basename(original, currentExtension)}${extension}`
}
const managedImagePath = (row) => `/media/${row.id}/${encodeURIComponent(publicImageFilename(row))}`
const requestOrigin = (req) => {
  if (configuredPublicUrl) return configuredPublicUrl
  if (!req) return ''
  const forwardedProtocol = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim()
  const protocol = forwardedProtocol || req.protocol || 'http'
  const host = forwardedHost || req.get('host')
  return host ? `${protocol}://${host}` : ''
}
const absolutePublicUrl = (url, req) => {
  if (!url || /^[a-z][a-z\d+.-]*:\/\//i.test(url)) return url
  const origin = requestOrigin(req)
  return origin ? new URL(url, `${origin}/`).href : url
}
const escapeReferenceText = (value) => String(value).replace(/([\\\[\]])/g, '\\$1')
const escapeReferenceAttribute = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const parseStoredJson = (value) => {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
const mapImage = (row, req) => {
  const name = normalizeUploadFilename(row.name)
  const format = imageFormatFor(row)
  const filename = publicImageFilename(row)
  const extension = path.extname(filename).toLowerCase() || imageExtensionFor(row)
  const relativeUrl = row.storage_provider_id && (row.storage_key || row.filename) ? managedImagePath(row) : row.url
  const url = absolutePublicUrl(relativeUrl, req)
  return {
    id: row.id,
    name,
    filename,
    url,
    path: relativeUrl,
    type: format.toUpperCase(),
    format,
    extension,
    mimeType: mimeTypesByFormat[format] || row.mime_type,
    size: Number(row.size),
    width: row.width === null ? null : Number(row.width),
    height: row.height === null ? null : Number(row.height),
    album: row.album,
    starred: Boolean(row.starred),
    views: Number(row.views),
    guestUploaded: Boolean(row.guest_uploaded),
    processing: parseStoredJson(row.processing_json),
    links: {
      direct: url,
      markdown: `![${escapeReferenceText(name)}](${url})`,
      bbcode: `[img]${url}[/img]`,
      html: `<img src="${escapeReferenceAttribute(url)}" alt="${escapeReferenceAttribute(name)}" />`,
    },
    createdAt: row.created_at,
  }
}

const hashApiKey = (value) => crypto.createHash('sha256').update(value).digest('hex')
const apiKeyEncryptionKey = crypto.createHash('sha256').update(String(storageEncryptionSecret)).digest()
const encryptApiKeySecret = (value) => {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', apiKeyEncryptionKey, iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.')
}
const decryptApiKeySecret = (value) => {
  const [version, ivValue, tagValue, encryptedValue] = String(value || '').split('.')
  if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) throw new Error('invalid encrypted API key')
  const decipher = crypto.createDecipheriv('aes-256-gcm', apiKeyEncryptionKey, Buffer.from(ivValue, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]).toString('utf8')
}
const safeEmail = (value) => String(value || '').trim().toLowerCase()

const normalizeUploadFilename = (value) => {
  let name = String(value || 'image').split(/[\\/]/).pop() || 'image'
  const decoded = Buffer.from(name, 'latin1').toString('utf8')
  const isMisdecodedUtf8 = decoded !== name
    && !decoded.includes('\uFFFD')
    && Buffer.from(decoded, 'utf8').toString('latin1') === name

  if (isMisdecodedUtf8) name = decoded
  return name.replace(/[\u0000-\u001f\u007f]/g, '').trim().normalize('NFC') || 'image'
}

const repairStoredImageNames = db.transaction(() => {
  const update = db.prepare('UPDATE images SET name = ? WHERE id = ?')
  for (const image of db.prepare('SELECT id, name FROM images').all()) {
    const normalized = normalizeUploadFilename(image.name)
    if (normalized !== image.name) update.run(normalized, image.id)
  }
})

repairStoredImageNames()

const storageManager = createStorageManager({
  db,
  uploadsDir,
  encryptionSecret: storageEncryptionSecret,
})

const ensureDefaultAlbum = (ownerId) => {
  const current = db.prepare('SELECT name FROM albums WHERE owner_id = ? AND is_default = 1 LIMIT 1').get(ownerId)
  if (current) return current.name

  let album = db.prepare(`
    SELECT id, name FROM albums WHERE owner_id = ?
    ORDER BY CASE WHEN name = '未分类' THEN 0 ELSE 1 END, created_at ASC LIMIT 1
  `).get(ownerId)
  if (!album) {
    album = { id: crypto.randomUUID(), name: '未分类' }
    db.prepare('INSERT INTO albums (id, owner_id, name, is_default, created_at) VALUES (?, ?, ?, 1, ?)')
      .run(album.id, ownerId, album.name, new Date().toISOString())
    return album.name
  }

  db.prepare('UPDATE albums SET is_default = 1 WHERE id = ? AND owner_id = ?').run(album.id, ownerId)
  return album.name
}

for (const existingUser of db.prepare('SELECT id FROM users').all()) ensureDefaultAlbum(existingUser.id)

const getCurrentMonth = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

const recordApiUsage = (userId, statusCode, responseMs, trafficBytes) => {
  const month = getCurrentMonth()
  const success = statusCode >= 200 && statusCode < 400 ? 1 : 0
  db.prepare(`
    INSERT INTO api_usage_monthly (user_id, month, calls, success_calls, failed_calls, response_ms_total, traffic_bytes)
    VALUES (?, ?, 1, ?, ?, ?, ?)
    ON CONFLICT(user_id, month) DO UPDATE SET
      calls = calls + 1,
      success_calls = success_calls + excluded.success_calls,
      failed_calls = failed_calls + excluded.failed_calls,
      response_ms_total = response_ms_total + excluded.response_ms_total,
      traffic_bytes = traffic_bytes + excluded.traffic_bytes
  `).run(userId, month, success, success ? 0 : 1, responseMs, trafficBytes)
}

const createSession = (res, user) => {
  const token = jwt.sign({ sub: user.id }, sessionSecret, { expiresIn: '7d', issuer: 'picnest' })
  res.cookie('picnest_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  })
}

const resolveUser = (req) => {
  const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7).trim() : ''
  if (bearer) {
    const apiKey = db.prepare(`
      SELECT users.*, api_keys.id AS api_key_id FROM api_keys
      JOIN users ON users.id = api_keys.user_id
      WHERE api_keys.key_hash = ?
    `).get(hashApiKey(bearer))
    if (apiKey) {
      db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(new Date().toISOString(), apiKey.api_key_id)
      req.apiKeyAuth = { id: apiKey.api_key_id }
      return mapUser(apiKey)
    }
  }

  const token = req.cookies.picnest_session
  if (!token) return null
  try {
    const payload = jwt.verify(token, sessionSecret, { issuer: 'picnest' })
    return mapUser(db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub))
  } catch {
    return null
  }
}

const authenticate = (req, res, next) => {
  const startedAt = process.hrtime.bigint()
  const user = resolveUser(req)
  if (!user) return res.status(401).json({ message: '请先登录' })
  req.user = user
  if (req.apiKeyAuth) {
    res.once('finish', () => {
      const responseMs = Math.max(1, Number((process.hrtime.bigint() - startedAt) / 1000000n))
      const requestBytes = Number(req.headers['content-length'] || 0)
      const responseBytes = Number(res.getHeader('content-length') || 0)
      const trafficBytes = (Number.isFinite(requestBytes) ? requestBytes : 0) + (Number.isFinite(responseBytes) ? responseBytes : 0)
      try {
        recordApiUsage(user.id, res.statusCode, responseMs, trafficBytes)
      } catch (error) {
        console.error('Failed to record API usage', error)
      }
    })
    const currentCalls = Number(db.prepare('SELECT calls FROM api_usage_monthly WHERE user_id = ? AND month = ?').get(user.id, getCurrentMonth())?.calls || 0)
    if (currentCalls >= apiMonthlyLimit) return res.status(429).json({ message: '本月 API 调用额度已用尽' })
  }
  next()
}

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: '仅管理员可以执行此操作' })
  next()
}

const requireSessionAuth = (req, res, next) => {
  if (req.apiKeyAuth) return res.status(403).json({ message: 'API 密钥管理必须使用网页登录会话' })
  next()
}

const seedFirstWorkspace = (ownerId) => {
  if (!fs.existsSync(seedFile)) return
  const count = db.prepare('SELECT COUNT(*) AS count FROM images').get().count
  if (count > 0) return
  const seeds = JSON.parse(fs.readFileSync(seedFile, 'utf8'))
  const insertImage = db.prepare(`
    INSERT INTO images (id, owner_id, name, filename, url, type, mime_type, size, width, height, album, starred, views, created_at)
    VALUES (@id, @ownerId, @name, NULL, @url, @type, @mimeType, @size, @width, @height, @album, @starred, @views, @createdAt)
  `)
  const insertAlbum = db.prepare('INSERT OR IGNORE INTO albums (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)')
  const transaction = db.transaction(() => {
    for (const image of seeds) {
      insertImage.run({ ...image, ownerId, starred: image.starred ? 1 : 0 })
      insertAlbum.run(crypto.randomUUID(), ownerId, image.album, new Date().toISOString())
    }
  })
  transaction()
}

const createUser = ({ name, email, password, role, quota, storageProviderId = null }) => {
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  const passwordHash = bcrypt.hashSync(password, 12)
  const storageQuota = quota || (role === 'admin' ? 10 * 1024 ** 3 : 5 * 1024 ** 3)
  db.prepare('INSERT INTO users (id, name, email, password_hash, role, quota, storage_provider_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, name.trim(), safeEmail(email), passwordHash, role, storageQuota, storageProviderId, createdAt)
  ensureDefaultAlbum(id)
  return mapUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id))
}

const minUserQuota = 100 * 1024 ** 2
const maxUserQuota = 100 * 1024 ** 4
const normalizeUserQuota = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback
  const quota = Number(value)
  if (!Number.isSafeInteger(quota) || quota < minUserQuota || quota > maxUserQuota) return null
  return quota
}

const normalizeStorageProviderId = (value, fallback = null) => {
  if (value === undefined) return fallback
  const providerId = String(value || '').trim() || null
  if (providerId && !db.prepare('SELECT 1 FROM storage_providers WHERE id = ?').get(providerId)) return undefined
  return providerId
}

const getUserSummary = (id) => {
  const row = db.prepare(`
    SELECT users.*, COUNT(images.id) AS image_count, COALESCE(SUM(images.size), 0) AS storage_used
    FROM users LEFT JOIN images ON images.owner_id = users.id
    WHERE users.id = ? GROUP BY users.id
  `).get(id)
  return row ? { ...mapUser(row), imageCount: Number(row.image_count), storageUsed: Number(row.storage_used) } : null
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadTempDir),
  filename: (_req, file, cb) => {
    const originalName = normalizeUploadFilename(file.originalname)
    file.originalname = originalName
    const extension = path.extname(originalName).toLowerCase()
    const stem = path.basename(originalName, extension)
      .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '-')
      .slice(0, 48)
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${stem || 'image'}${extension}`)
  }
})

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => {
    try {
      validateUploadFilename(normalizeUploadFilename(file.originalname), getImageProcessingSettings().allowedExtensions)
      cb(null, true)
    } catch (error) {
      cb(error)
    }
  }
})

const guestUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    try {
      validateUploadFilename(normalizeUploadFilename(file.originalname), getImageProcessingSettings().allowedExtensions)
      cb(null, true)
    } catch (error) {
      cb(error)
    }
  }
})

const cleanupPendingFiles = (files) => {
  for (const file of files || []) {
    if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path)
  }
}

const persistUploadedFiles = async ({ files, user, album, request, guestUploaded = false, processingSettings = getImageProcessingSettings() }) => {
  const providerId = storageManager.getUploadProviderId(user.storageProviderId)
  const stored = []
  try {
    const processed = []
    for (const file of files) {
      const result = await processUploadedImage(file, processingSettings)
      processed.push({ file, ...result })
    }

    const used = Number(db.prepare('SELECT COALESCE(SUM(size), 0) AS used FROM images WHERE owner_id = ?').get(user.id).used)
    const processedSize = processed.reduce((sum, item) => sum + item.file.size, 0)
    if (used + processedSize > user.quota) throw new ImageProcessingError('图片处理后的文件超过存储配额，请降低质量或清理空间后重试', 413)

    for (const { file, metadata, processing } of processed) {
      const location = await storageManager.storeFile(user.id, file, providerId)
      stored.push({ file, location, metadata, processing })
    }

    const insert = db.prepare(`
      INSERT INTO images (
        id, owner_id, name, filename, storage_provider_id, storage_key, url, type, mime_type,
        size, width, height, album, starred, views, guest_uploaded, exif_json, processing_json, created_at
      ) VALUES (
        @id, @ownerId, @name, @filename, @storageProviderId, @storageKey, @url, @type, @mimeType,
        @size, @width, @height, @album, 0, 0, @guestUploaded, @exifJson, @processingJson, @createdAt
      )
    `)
    const created = []
    const transaction = db.transaction(() => {
      db.prepare('INSERT OR IGNORE INTO albums (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)')
        .run(crypto.randomUUID(), user.id, album, new Date().toISOString())
      for (const { file, location, metadata, processing } of stored) {
        const imageId = crypto.randomUUID()
        const image = {
          id: imageId,
          ownerId: user.id,
          name: file.originalname,
          filename: file.filename,
          storageProviderId: location.providerId,
          storageKey: location.storageKey,
          url: managedImagePath({ id: imageId, name: file.originalname, type: file.detectedFormat }),
          type: file.detectedFormat.toUpperCase(),
          mimeType: mimeTypesByFormat[file.detectedFormat] || file.mimetype,
          size: file.size,
          width: metadata.width,
          height: metadata.height,
          album,
          guestUploaded: guestUploaded ? 1 : 0,
          exifJson: JSON.stringify(metadata.exif),
          processingJson: JSON.stringify(processing),
          createdAt: new Date().toISOString(),
        }
        insert.run(image)
        created.push(mapImage(db.prepare('SELECT * FROM images WHERE id = ?').get(image.id), request))
      }
    })
    transaction()
    return created
  } catch (error) {
    await Promise.allSettled(stored.map(({ file, location }) => storageManager.deleteStoredObject({
      owner_id: user.id,
      filename: file.filename,
      storage_provider_id: location.providerId,
      storage_key: location.storageKey,
    })))
    cleanupPendingFiles(files)
    throw error
  }
}

const guestAttempts = new Map()
const limitGuestUploads = (req, res, next) => {
  const now = Date.now()
  const key = req.ip || req.socket.remoteAddress || 'unknown'
  const recent = (guestAttempts.get(key) || []).filter((time) => now - time < 60 * 60 * 1000)
  if (recent.length >= 10) return res.status(429).json({ message: '游客上传过于频繁，请稍后再试' })
  recent.push(now)
  guestAttempts.set(key, recent)
  next()
}

const allowGuestUpload = (req, res, next) => {
  const enabled = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('guest_upload_enabled')?.value === 'true'
  if (!enabled) return res.status(403).json({ message: '游客上传当前未开放' })
  const owner = mapUser(db.prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1").get())
  if (!owner) return res.status(503).json({ message: '系统尚未完成初始化' })
  req.user = owner
  next()
}

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', 'loopback')
app.use(cors({ origin: true, credentials: true }))
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())
app.use('/uploads', express.static(uploadsDir, { maxAge: '7d' }))
app.use('/demo', express.static(path.join(projectRoot, 'public', 'demo'), { maxAge: '7d' }))

app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'PicNest', database: 'sqlite' }))

const streamManagedImage = async (req, res) => {
  const image = db.prepare('SELECT * FROM images WHERE id = ?').get(req.params.id)
  if (!image || !image.storage_provider_id || (!image.storage_key && !image.filename)) {
    return res.status(404).json({ message: '图片不存在' })
  }

  try {
    const object = await storageManager.openStoredObject(image)
    let cleaned = false
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      object.cleanup?.()
    }
    const etag = object.etag || `"${image.id}"`

    res.setHeader('Content-Type', object.contentType || image.mime_type || 'application/octet-stream')
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(publicImageFilename(image))}`)
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.setHeader('ETag', etag)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (Number.isFinite(Number(object.contentLength || image.size))) {
      res.setHeader('Content-Length', String(object.contentLength || image.size))
    }
    const lastModified = object.lastModified || image.created_at
    if (lastModified) res.setHeader('Last-Modified', new Date(lastModified).toUTCString())

    if (req.headers['if-none-match'] === etag) {
      object.body.destroy?.()
      cleanup()
      return res.status(304).end()
    }
    if (req.method === 'HEAD') {
      object.body.destroy?.()
      cleanup()
      return res.end()
    }

    res.once('finish', cleanup)
    res.once('close', cleanup)
    object.body.once('error', (error) => {
      cleanup()
      if (res.headersSent) res.destroy(error)
      else res.status(502).json({ message: '图片读取失败' })
    })
    object.body.pipe(res)
  } catch (error) {
    const status = error instanceof StorageManagerError ? error.status : 502
    if (status >= 500) console.error(`Failed to stream image ${image.id}`, error)
    res.status(status).json({ message: status === 404 ? '图片原文件不存在' : '图片读取失败' })
  }
}

app.get('/media/:id', streamManagedImage)
app.get('/media/:id/:filename', streamManagedImage)

app.get('/api/public/config', (_req, res) => {
  const enabled = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('guest_upload_enabled')?.value === 'true'
  res.json({
    guestUploadEnabled: enabled,
    maxFileSize: 10 * 1024 * 1024,
    maxFiles: 5,
    allowedExtensions: getImageProcessingSettings().allowedExtensions,
  })
})

app.post('/api/public/images', allowGuestUpload, limitGuestUploads, guestUpload.array('files', 5), async (req, res) => {
  const used = db.prepare('SELECT COALESCE(SUM(size), 0) AS used FROM images WHERE owner_id = ?').get(req.user.id).used
  const incoming = (req.files || []).reduce((sum, file) => sum + file.size, 0)
  if (!req.files?.length) return res.status(400).json({ message: '请选择需要上传的图片' })
  if (used + incoming > req.user.quota) {
    cleanupPendingFiles(req.files)
    return res.status(413).json({ message: '公共上传空间已满' })
  }
  const album = '游客上传'
  const created = await persistUploadedFiles({
    files: req.files,
    user: req.user,
    album,
    request: req,
    guestUploaded: true,
    processingSettings: uploadProcessingSettings({}, false),
  })
  res.status(201).json(created)
})

app.get('/api/auth/me', (req, res) => {
  const user = resolveUser(req)
  if (!user) {
    const setupRequired = db.prepare('SELECT COUNT(*) AS count FROM users').get().count === 0
    return res.status(401).json({ message: '请先登录', setupRequired })
  }
  res.json(user)
})

app.post('/api/auth/register', (req, res) => {
  const name = String(req.body.name || '').trim()
  const email = safeEmail(req.body.email)
  const password = String(req.body.password || '')
  if (name.length < 2) return res.status(400).json({ message: '昵称至少需要 2 个字符' })
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ message: '请输入有效的邮箱地址' })
  if (password.length < 8) return res.status(400).json({ message: '密码至少需要 8 个字符' })
  const isFirstUser = db.prepare('SELECT COUNT(*) AS count FROM users').get().count === 0
  if (!isFirstUser) return res.status(403).json({ message: '系统已完成初始化，请联系管理员创建账户' })
  const user = createUser({ name, email, password, role: 'admin' })
  seedFirstWorkspace(user.id)
  createSession(res, user)
  res.status(201).json(user)
})

app.post('/api/auth/login', (req, res) => {
  const email = safeEmail(req.body.email)
  const password = String(req.body.password || '')
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
  if (!row || !bcrypt.compareSync(password, row.password_hash)) return res.status(401).json({ message: '邮箱或密码不正确' })
  const user = mapUser(row)
  createSession(res, user)
  res.json(user)
})

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('picnest_session', { path: '/' })
  res.status(204).end()
})

app.patch('/api/settings/guest-upload', authenticate, requireAdmin, (req, res) => {
  const enabled = Boolean(req.body.enabled)
  db.prepare('UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ?')
    .run(enabled ? 'true' : 'false', new Date().toISOString(), 'guest_upload_enabled')
  res.json({ guestUploadEnabled: enabled })
})

app.get('/api/settings/image-processing', authenticate, (_req, res) => {
  res.json(getImageProcessingSettings())
})

app.patch('/api/settings/image-processing', authenticate, requireAdmin, (req, res) => {
  const settings = normalizeImageProcessingSettings(req.body || {}, getImageProcessingSettings())
  db.prepare('UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ?')
    .run(JSON.stringify(settings), new Date().toISOString(), 'image_processing')
  res.json(settings)
})

app.get('/api/storage/providers', authenticate, (_req, res) => {
  res.json(storageManager.listProviders())
})

app.post('/api/storage/providers', authenticate, requireAdmin, (req, res) => {
  const provider = storageManager.createProvider(req.body || {})
  res.status(201).json(provider)
})

app.patch('/api/storage/providers/:id', authenticate, requireAdmin, (req, res) => {
  res.json(storageManager.updateProvider(req.params.id, req.body || {}))
})

app.patch('/api/storage/providers/:id/default', authenticate, requireAdmin, async (req, res) => {
  await storageManager.testProvider(req.params.id)
  res.json(storageManager.setDefaultProvider(req.params.id))
})

app.post('/api/storage/providers/:id/test', authenticate, requireAdmin, async (req, res) => {
  await storageManager.testProvider(req.params.id)
  res.json({ ok: true })
})

app.delete('/api/storage/providers/:id', authenticate, requireAdmin, (req, res) => {
  storageManager.deleteProvider(req.params.id)
  res.status(204).end()
})

app.get('/api/users', authenticate, requireAdmin, (_req, res) => {
  const rows = db.prepare(`
    SELECT users.*, COUNT(images.id) AS image_count, COALESCE(SUM(images.size), 0) AS storage_used
    FROM users LEFT JOIN images ON images.owner_id = users.id
    GROUP BY users.id ORDER BY users.created_at ASC
  `).all()
  res.json(rows.map((row) => ({ ...mapUser(row), imageCount: Number(row.image_count), storageUsed: Number(row.storage_used) })))
})

app.post('/api/users', authenticate, requireAdmin, (req, res) => {
  const name = String(req.body.name || '').trim()
  const email = safeEmail(req.body.email)
  const password = String(req.body.password || '')
  const role = req.body.role === 'admin' ? 'admin' : 'member'
  const defaultQuota = role === 'admin' ? 10 * 1024 ** 3 : 5 * 1024 ** 3
  const quota = normalizeUserQuota(req.body.quota, defaultQuota)
  const storageProviderId = normalizeStorageProviderId(req.body.storageProviderId)
  if (name.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return res.status(400).json({ message: '请完整填写昵称、邮箱和至少 8 位密码' })
  if (quota === null) return res.status(400).json({ message: '存储配额必须在 100 MB 到 100 TB 之间' })
  if (storageProviderId === undefined) return res.status(400).json({ message: '选择的存储策略不存在' })
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(409).json({ message: '该邮箱已经存在' })
  const user = createUser({ name, email, password, role, quota, storageProviderId })
  res.status(201).json({ ...user, imageCount: 0, storageUsed: 0 })
})

app.patch('/api/users/:id', authenticate, requireAdmin, (req, res) => {
  const current = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)
  if (!current) return res.status(404).json({ message: '用户不存在' })

  const name = Object.hasOwn(req.body, 'name') ? String(req.body.name || '').trim() : current.name
  const email = Object.hasOwn(req.body, 'email') ? safeEmail(req.body.email) : current.email
  const role = Object.hasOwn(req.body, 'role') ? (req.body.role === 'admin' ? 'admin' : 'member') : current.role
  const quota = normalizeUserQuota(req.body.quota, Number(current.quota))
  const storageProviderId = normalizeStorageProviderId(req.body.storageProviderId, current.storage_provider_id || null)
  const password = Object.hasOwn(req.body, 'password') ? String(req.body.password || '') : ''

  if (name.length < 2 || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ message: '请填写有效的成员称呼和登录邮箱' })
  if (req.params.id === req.user.id && role !== current.role) return res.status(400).json({ message: '不能修改自己的管理员角色' })
  if (quota === null) return res.status(400).json({ message: '存储配额必须在 100 MB 到 100 TB 之间' })
  if (storageProviderId === undefined) return res.status(400).json({ message: '选择的存储策略不存在' })
  if (password && password.length < 8) return res.status(400).json({ message: '新密码至少需要 8 个字符' })
  if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id <> ?').get(email, current.id)) return res.status(409).json({ message: '该邮箱已经存在' })

  const used = Number(db.prepare('SELECT COALESCE(SUM(size), 0) AS used FROM images WHERE owner_id = ?').get(current.id).used)
  if (quota < used) return res.status(409).json({ message: `存储配额不能低于当前已用空间 ${Math.ceil(used / 1024 ** 2)} MB` })

  const passwordHash = password ? bcrypt.hashSync(password, 12) : current.password_hash
  db.prepare('UPDATE users SET name = ?, email = ?, password_hash = ?, role = ?, quota = ?, storage_provider_id = ? WHERE id = ?')
    .run(name, email, passwordHash, role, quota, storageProviderId, current.id)
  res.json(getUserSummary(current.id))
})

app.get('/api/images', authenticate, (req, res) => {
  const images = db.prepare('SELECT * FROM images WHERE owner_id = ? ORDER BY created_at DESC').all(req.user.id)
  res.json(images.map((image) => mapImage(image, req)))
})

app.get('/api/images/:id', authenticate, (req, res) => {
  const image = db.prepare('SELECT * FROM images WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id)
  if (!image) return res.status(404).json({ message: '图片不存在' })
  res.json(mapImage(image, req))
})

const readStoredImage = async (image) => {
  const object = await storageManager.openStoredObject(image)
  try {
    if (Number(object.contentLength || 0) > 25 * 1024 * 1024) throw new Error('原文件超过元数据读取限制')
    const chunks = []
    let total = 0
    for await (const chunk of object.body) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += buffer.byteLength
      if (total > 25 * 1024 * 1024) throw new Error('原文件超过元数据读取限制')
      chunks.push(buffer)
    }
    return Buffer.concat(chunks, total)
  } finally {
    object.body.destroy?.()
    object.cleanup?.()
  }
}

app.get('/api/images/:id/metadata', authenticate, async (req, res) => {
  let image = db.prepare('SELECT * FROM images WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id)
  if (!image) return res.status(404).json({ message: '图片不存在' })

  if (image.exif_json === null) {
    try {
      const metadata = await extractImageMetadata(await readStoredImage(image))
      db.prepare('UPDATE images SET width = ?, height = ?, exif_json = ? WHERE id = ? AND owner_id = ?')
        .run(metadata.width, metadata.height, JSON.stringify(metadata.exif), image.id, req.user.id)
      image = db.prepare('SELECT * FROM images WHERE id = ?').get(image.id)
    } catch (error) {
      console.error(`Failed to extract metadata for image ${image.id}`, error)
      return res.status(422).json({ message: '无法从原文件读取图片元数据' })
    }
  }

  res.json({
    width: image.width === null ? null : Number(image.width),
    height: image.height === null ? null : Number(image.height),
    exif: parseStoredExif(image.exif_json),
  })
})

app.post('/api/images', authenticate, upload.array('files', 20), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ message: '请选择需要上传的图片' })
  const requestedAlbum = String(req.body.album || '').trim()
  const album = requestedAlbum || ensureDefaultAlbum(req.user.id)
  const used = db.prepare('SELECT COALESCE(SUM(size), 0) AS used FROM images WHERE owner_id = ?').get(req.user.id).used
  const incoming = (req.files || []).reduce((sum, file) => sum + file.size, 0)
  if (used + incoming > req.user.quota) {
    cleanupPendingFiles(req.files)
    return res.status(413).json({ message: '存储配额不足，请清理空间后重试' })
  }
  const created = await persistUploadedFiles({
    files: req.files,
    user: req.user,
    album,
    request: req,
    processingSettings: uploadProcessingSettings(req.body),
  })
  res.status(201).json(created)
})

app.patch('/api/images/:id', authenticate, (req, res) => {
  const image = db.prepare('SELECT * FROM images WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id)
  if (!image) return res.status(404).json({ message: '图片不存在' })
  const name = Object.hasOwn(req.body, 'name') ? String(req.body.name).trim() : image.name
  const album = Object.hasOwn(req.body, 'album') ? String(req.body.album).trim() || '未分类' : image.album
  const starred = Object.hasOwn(req.body, 'starred') ? (req.body.starred ? 1 : 0) : image.starred
  db.prepare('UPDATE images SET name = ?, album = ?, starred = ? WHERE id = ? AND owner_id = ?')
    .run(name, album, starred, req.params.id, req.user.id)
  db.prepare('INSERT OR IGNORE INTO albums (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)')
    .run(crypto.randomUUID(), req.user.id, album, new Date().toISOString())
  res.json(mapImage(db.prepare('SELECT * FROM images WHERE id = ?').get(req.params.id), req))
})

const removeOwnedImage = async (image, userId) => {
  await storageManager.deleteStoredObject(image)
  db.prepare('DELETE FROM images WHERE id = ? AND owner_id = ?').run(image.id, userId)
}

app.delete('/api/images/:id', authenticate, async (req, res) => {
  const image = db.prepare('SELECT * FROM images WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id)
  if (!image) return res.status(404).json({ message: '图片不存在' })
  await removeOwnedImage(image, req.user.id)
  res.status(204).end()
})

app.post('/api/images/bulk-delete', authenticate, async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : []
  const owned = db.prepare('SELECT * FROM images WHERE owner_id = ?').all(req.user.id).filter((image) => ids.includes(image.id))
  for (const image of owned) await removeOwnedImage(image, req.user.id)
  res.json({ deleted: owned.length })
})

app.get('/api/albums', authenticate, (req, res) => {
  ensureDefaultAlbum(req.user.id)
  const rows = db.prepare(`
    SELECT albums.id, albums.name, albums.is_default, albums.created_at,
      COUNT(images.id) AS image_count, COALESCE(SUM(images.size), 0) AS storage_used,
      (SELECT url FROM images cover WHERE cover.owner_id = albums.owner_id AND cover.album = albums.name ORDER BY cover.created_at DESC LIMIT 1) AS cover
    FROM albums LEFT JOIN images ON images.owner_id = albums.owner_id AND images.album = albums.name
    WHERE albums.owner_id = ? GROUP BY albums.id ORDER BY albums.created_at ASC
  `).all(req.user.id)
  res.json(rows.map((row) => ({ id: row.id, name: row.name, isDefault: Boolean(row.is_default), createdAt: row.created_at, imageCount: Number(row.image_count), storageUsed: Number(row.storage_used), cover: row.cover })))
})

app.post('/api/albums', authenticate, (req, res) => {
  const name = String(req.body.name || '').trim()
  if (!name) return res.status(400).json({ message: '请输入相册名称' })
  try {
    const album = { id: crypto.randomUUID(), name, createdAt: new Date().toISOString() }
    db.prepare('INSERT INTO albums (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)').run(album.id, req.user.id, name, album.createdAt)
    res.status(201).json({ ...album, isDefault: false, imageCount: 0, storageUsed: 0, cover: null })
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return res.status(409).json({ message: '相册名称已经存在' })
    throw error
  }
})

app.patch('/api/albums/:id/default', authenticate, (req, res) => {
  const album = db.prepare('SELECT id, name FROM albums WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id)
  if (!album) return res.status(404).json({ message: '相册不存在' })
  const transaction = db.transaction(() => {
    db.prepare('UPDATE albums SET is_default = 0 WHERE owner_id = ?').run(req.user.id)
    db.prepare('UPDATE albums SET is_default = 1 WHERE id = ? AND owner_id = ?').run(album.id, req.user.id)
  })
  transaction()
  res.json({ id: album.id, name: album.name, isDefault: true })
})

app.get('/api/api-keys', authenticate, requireSessionAuth, (req, res) => {
  const rows = db.prepare('SELECT id, label, key_prefix, secret_encrypted, created_at, last_used_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id)
  res.json(rows.map((row) => ({
    id: row.id,
    label: row.label,
    prefix: row.key_prefix,
    recoverable: Boolean(row.secret_encrypted),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  })))
})

app.post('/api/api-keys', authenticate, requireSessionAuth, (req, res) => {
  const label = String(req.body.label || '').trim()
  if (label.length < 2 || label.length > 50) return res.status(400).json({ message: '密钥名称需要 2 到 50 个字符' })
  const secret = `pn_live_${crypto.randomBytes(18).toString('base64url')}`
  const item = { id: crypto.randomUUID(), label, prefix: `${secret.slice(0, 15)}••••••••`, recoverable: true, createdAt: new Date().toISOString(), lastUsedAt: null }
  db.prepare('INSERT INTO api_keys (id, user_id, label, key_hash, key_prefix, secret_encrypted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(item.id, req.user.id, item.label, hashApiKey(secret), item.prefix, encryptApiKeySecret(secret), item.createdAt)
  res.status(201).json({ ...item, secret })
})

app.get('/api/api-keys/:id/secret', authenticate, requireSessionAuth, (req, res) => {
  const row = db.prepare('SELECT secret_encrypted FROM api_keys WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)
  if (!row) return res.status(404).json({ message: 'API 密钥不存在' })
  if (!row.secret_encrypted) return res.status(409).json({ message: '该密钥创建于查看功能启用前，无法恢复完整内容，请删除后重新创建' })
  try {
    res.json({ secret: decryptApiKeySecret(row.secret_encrypted) })
  } catch (error) {
    console.error(`Failed to decrypt API key ${req.params.id}`, error)
    res.status(500).json({ message: '密钥无法解密，请确认 PICNEST_STORAGE_SECRET 没有改变' })
  }
})

app.delete('/api/api-keys/:id', authenticate, requireSessionAuth, (req, res) => {
  const result = db.prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id)
  if (!result.changes) return res.status(404).json({ message: 'API 密钥不存在' })
  res.status(204).end()
})

app.get('/api/stats', authenticate, (req, res) => {
  const aggregate = db.prepare('SELECT COUNT(*) AS images, COALESCE(SUM(size), 0) AS used FROM images WHERE owner_id = ?').get(req.user.id)
  const month = getCurrentMonth()
  const usage = db.prepare(`
    SELECT calls, success_calls, failed_calls, response_ms_total, traffic_bytes
    FROM api_usage_monthly WHERE user_id = ? AND month = ?
  `).get(req.user.id, month) || { calls: 0, success_calls: 0, failed_calls: 0, response_ms_total: 0, traffic_bytes: 0 }
  const calls = Number(usage.calls)
  res.json({
    images: Number(aggregate.images),
    used: Number(aggregate.used),
    limit: req.user.quota,
    traffic: Number(usage.traffic_bytes),
    apiCalls: calls,
    apiLimit: apiMonthlyLimit,
    apiSuccessRate: calls ? (Number(usage.success_calls) / calls) * 100 : 0,
    apiAverageResponseMs: calls ? Math.round(Number(usage.response_ms_total) / calls) : 0,
  })
})

const distDir = path.join(projectRoot, 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get('*splat', (_req, res) => res.sendFile(path.join(distDir, 'index.html')))
}

app.use((error, req, res, _next) => {
  cleanupPendingFiles(req.files)
  if (error instanceof multer.MulterError) {
    const limit = req.path.startsWith('/api/public/') ? '10MB' : '20MB'
    return res.status(400).json({ message: error.code === 'LIMIT_FILE_SIZE' ? `单张图片不能超过 ${limit}` : error.message })
  }
  if (error instanceof ImageProcessingError) return res.status(error.status).json({ message: error.message })
  if (error instanceof StorageManagerError) return res.status(error.status).json({ message: error.message })
  if (req.path.startsWith('/api/storage/') || req.path.includes('/images')) {
    console.error(error)
    return res.status(502).json({ message: '远程存储操作失败，请检查地址、区域、Bucket 和访问密钥' })
  }
  console.error(error)
  res.status(500).json({ message: '服务暂时不可用' })
})

const port = Number(process.env.PORT || 18765)
app.listen(port, '127.0.0.1', () => {
  console.log(`PicNest server running at http://127.0.0.1:${port} (${path.basename(databaseFile)})`)
})

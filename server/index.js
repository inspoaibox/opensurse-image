import bcrypt from 'bcryptjs'
import cookieParser from 'cookie-parser'
import Database from 'better-sqlite3'
import express from 'express'
import { rateLimit } from 'express-rate-limit'
import helmet from 'helmet'
import jwt from 'jsonwebtoken'
import multer from 'multer'
import sharp from 'sharp'
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
import { downloadRemoteFile, parseRemoteSource, RemoteDownloadError, remoteDownloadDefaults } from './remote-download.js'
import { createStorageManager, StorageManagerError } from './storage.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const uploadsDir = path.join(__dirname, 'uploads')
const dataDir = path.join(__dirname, 'data')
const uploadTempDir = path.join(dataDir, 'tmp')
const databaseFile = path.resolve(process.env.PICNEST_DB_PATH || path.join(dataDir, 'picnest.db'))
const secretFile = path.join(dataDir, '.session-secret')
const defaultHotlinkProtectionSettings = Object.freeze({
  imageEnabled: true,
  videoEnabled: true,
  trustedDomains: Object.freeze([]),
})
const isProduction = process.env.NODE_ENV === 'production'
const configuredVideoMaxMb = Number(process.env.PICNEST_VIDEO_MAX_MB || 500)
const videoMaxBytes = Number.isFinite(configuredVideoMaxMb) && configuredVideoMaxMb > 0
  ? Math.floor(configuredVideoMaxMb * 1024 * 1024)
  : 500 * 1024 * 1024
const configuredFileMaxMb = Number(process.env.PICNEST_FILE_MAX_MB || 1024)
const fileMaxBytes = Number.isFinite(configuredFileMaxMb) && configuredFileMaxMb > 0
  ? Math.floor(configuredFileMaxMb * 1024 * 1024)
  : 1024 * 1024 * 1024
const remoteMaxBytes = Math.max(20 * 1024 * 1024, videoMaxBytes, fileMaxBytes)
const configuredRemoteMaxActive = Number(process.env.PICNEST_REMOTE_MAX_ACTIVE || 2)
const remoteMaxActive = Number.isInteger(configuredRemoteMaxActive) && configuredRemoteMaxActive > 0
  ? Math.min(configuredRemoteMaxActive, 8)
  : 2
const configuredApiMonthlyLimit = Number(process.env.PICNEST_API_MONTHLY_LIMIT || 50000)
const apiMonthlyLimit = Number.isFinite(configuredApiMonthlyLimit) && configuredApiMonthlyLimit > 0
  ? Math.floor(configuredApiMonthlyLimit)
  : 50000
const configuredPublicUrl = String(process.env.PICNEST_PUBLIC_URL || '').trim().replace(/\/+$/, '')
const analyticsTimeZone = String(process.env.PICNEST_ANALYTICS_TIMEZONE || 'Asia/Shanghai').trim() || 'Asia/Shanghai'
try {
  new Intl.DateTimeFormat('en-US', { timeZone: analyticsTimeZone }).format()
} catch {
  throw new Error('PICNEST_ANALYTICS_TIMEZONE 必须是有效的 IANA 时区')
}

const validateProductionEnvironment = () => {
  if (!isProduction) return
  const sessionValue = String(process.env.PICNEST_SESSION_SECRET || '')
  const storageValue = String(process.env.PICNEST_STORAGE_SECRET || '')
  const invalidSecret = (value) => value.length < 32 || /replace-with|change-me|example/i.test(value)
  if (invalidSecret(sessionValue)) throw new Error('生产环境必须配置至少 32 个字符的 PICNEST_SESSION_SECRET')
  if (invalidSecret(storageValue)) throw new Error('生产环境必须配置独立且至少 32 个字符的 PICNEST_STORAGE_SECRET')
  if (process.env.COOKIE_SECURE !== 'true') throw new Error('生产环境必须设置 COOKIE_SECURE=true')
  try {
    const url = new URL(configuredPublicUrl)
    if (url.protocol !== 'https:') throw new Error('not https')
  } catch {
    throw new Error('生产环境必须配置有效的 HTTPS PICNEST_PUBLIC_URL')
  }
}

validateProductionEnvironment()

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
db.pragma('busy_timeout = 5000')
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
    hotlink_protection_enabled INTEGER NOT NULL DEFAULT 1,
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

  CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    filename TEXT,
    storage_provider_id TEXT,
    storage_key TEXT,
    url TEXT NOT NULL,
    type TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    hotlink_protection_enabled INTEGER NOT NULL DEFAULT 1,
    size INTEGER NOT NULL DEFAULT 0,
    album TEXT NOT NULL DEFAULT '视频',
    starred INTEGER NOT NULL DEFAULT 0,
    views INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_videos_owner_created ON videos(owner_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS files (
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
    group_name TEXT NOT NULL DEFAULT '文件',
    starred INTEGER NOT NULL DEFAULT 0,
    views INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_files_owner_created ON files(owner_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS albums (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(owner_id, name)
  );

  CREATE TABLE IF NOT EXISTS video_categories (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(owner_id, name)
  );

  CREATE INDEX IF NOT EXISTS idx_video_categories_owner_created ON video_categories(owner_id, created_at ASC);

  CREATE TABLE IF NOT EXISTS file_groups (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(owner_id, name)
  );

  CREATE INDEX IF NOT EXISTS idx_file_groups_owner_created ON file_groups(owner_id, created_at ASC);

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

  CREATE TABLE IF NOT EXISTS media_traffic_daily (
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_type TEXT NOT NULL CHECK(media_type IN ('image', 'video', 'file')),
    media_id TEXT NOT NULL,
    traffic_date TEXT NOT NULL,
    requests INTEGER NOT NULL DEFAULT 0,
    bytes INTEGER NOT NULL DEFAULT 0,
    external_requests INTEGER NOT NULL DEFAULT 0,
    external_bytes INTEGER NOT NULL DEFAULT 0,
    direct_requests INTEGER NOT NULL DEFAULT 0,
    direct_bytes INTEGER NOT NULL DEFAULT 0,
    internal_requests INTEGER NOT NULL DEFAULT 0,
    internal_bytes INTEGER NOT NULL DEFAULT 0,
    range_requests INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (owner_id, media_type, media_id, traffic_date)
  );

  CREATE INDEX IF NOT EXISTS idx_media_traffic_owner_date
    ON media_traffic_daily(owner_id, traffic_date DESC);

  CREATE TABLE IF NOT EXISTS media_referrer_daily (
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_type TEXT NOT NULL CHECK(media_type IN ('image', 'video', 'file')),
    media_id TEXT NOT NULL,
    traffic_date TEXT NOT NULL,
    referrer_host TEXT NOT NULL,
    requests INTEGER NOT NULL DEFAULT 0,
    bytes INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (owner_id, media_type, media_id, traffic_date, referrer_host)
  );

  CREATE INDEX IF NOT EXISTS idx_media_referrer_owner_date
    ON media_referrer_daily(owner_id, traffic_date DESC);

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`)

db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_storage_one_default ON storage_providers(is_default) WHERE is_default = 1')
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_file_groups_one_default_per_owner ON file_groups(owner_id) WHERE is_default = 1')

const sqliteTableSql = (name) => db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)?.sql || ''
const migrateMediaTrafficTypeCheck = () => {
  if (sqliteTableSql('media_traffic_daily').includes("CHECK(media_type IN ('image', 'video'))")) {
    db.exec(`
      DROP INDEX IF EXISTS idx_media_traffic_owner_date;
      ALTER TABLE media_traffic_daily RENAME TO media_traffic_daily_legacy;
      CREATE TABLE media_traffic_daily (
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        media_type TEXT NOT NULL CHECK(media_type IN ('image', 'video', 'file')),
        media_id TEXT NOT NULL,
        traffic_date TEXT NOT NULL,
        requests INTEGER NOT NULL DEFAULT 0,
        bytes INTEGER NOT NULL DEFAULT 0,
        external_requests INTEGER NOT NULL DEFAULT 0,
        external_bytes INTEGER NOT NULL DEFAULT 0,
        direct_requests INTEGER NOT NULL DEFAULT 0,
        direct_bytes INTEGER NOT NULL DEFAULT 0,
        internal_requests INTEGER NOT NULL DEFAULT 0,
        internal_bytes INTEGER NOT NULL DEFAULT 0,
        range_requests INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (owner_id, media_type, media_id, traffic_date)
      );
      INSERT OR IGNORE INTO media_traffic_daily (
        owner_id, media_type, media_id, traffic_date, requests, bytes,
        external_requests, external_bytes, direct_requests, direct_bytes,
        internal_requests, internal_bytes, range_requests
      )
      SELECT
        owner_id, media_type, media_id, traffic_date, requests, bytes,
        external_requests, external_bytes, direct_requests, direct_bytes,
        internal_requests, internal_bytes, range_requests
      FROM media_traffic_daily_legacy;
      DROP TABLE media_traffic_daily_legacy;
      CREATE INDEX IF NOT EXISTS idx_media_traffic_owner_date
        ON media_traffic_daily(owner_id, traffic_date DESC);
    `)
  }
  if (sqliteTableSql('media_referrer_daily').includes("CHECK(media_type IN ('image', 'video'))")) {
    db.exec(`
      DROP INDEX IF EXISTS idx_media_referrer_owner_date;
      ALTER TABLE media_referrer_daily RENAME TO media_referrer_daily_legacy;
      CREATE TABLE media_referrer_daily (
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        media_type TEXT NOT NULL CHECK(media_type IN ('image', 'video', 'file')),
        media_id TEXT NOT NULL,
        traffic_date TEXT NOT NULL,
        referrer_host TEXT NOT NULL,
        requests INTEGER NOT NULL DEFAULT 0,
        bytes INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (owner_id, media_type, media_id, traffic_date, referrer_host)
      );
      INSERT OR IGNORE INTO media_referrer_daily (
        owner_id, media_type, media_id, traffic_date, referrer_host, requests, bytes
      )
      SELECT owner_id, media_type, media_id, traffic_date, referrer_host, requests, bytes
      FROM media_referrer_daily_legacy;
      DROP TABLE media_referrer_daily_legacy;
      CREATE INDEX IF NOT EXISTS idx_media_referrer_owner_date
        ON media_referrer_daily(owner_id, traffic_date DESC);
    `)
  }
}
migrateMediaTrafficTypeCheck()

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
if (!imageColumns.some((column) => column.name === 'hotlink_protection_enabled')) {
  db.exec('ALTER TABLE images ADD COLUMN hotlink_protection_enabled INTEGER NOT NULL DEFAULT 1')
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
const videoColumns = db.prepare('PRAGMA table_info(videos)').all()
if (!videoColumns.some((column) => column.name === 'hotlink_protection_enabled')) {
  db.exec('ALTER TABLE videos ADD COLUMN hotlink_protection_enabled INTEGER NOT NULL DEFAULT 1')
}
const apiKeyColumns = db.prepare('PRAGMA table_info(api_keys)').all()
if (!apiKeyColumns.some((column) => column.name === 'secret_encrypted')) {
  db.exec('ALTER TABLE api_keys ADD COLUMN secret_encrypted TEXT')
}
db.prepare('INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)')
  .run('guest_upload_enabled', 'false', new Date().toISOString())
db.prepare('INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)')
  .run('image_processing', JSON.stringify(defaultImageProcessingSettings), new Date().toISOString())
db.prepare('INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)')
  .run('hotlink_protection', JSON.stringify(defaultHotlinkProtectionSettings), new Date().toISOString())

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

const parseStrictBooleanField = (value, fallback) => {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new ImageProcessingError('布尔参数必须是 true 或 false', 400)
  return value
}

const normalizeHotlinkDomain = (value) => {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) throw new ImageProcessingError('可信引用域名不能为空', 400)
  let parsed
  try {
    parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    throw new ImageProcessingError(`可信引用域名无效：${raw}`, 400)
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '')
  if (
    parsed.username
    || parsed.password
    || parsed.port
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
    || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/i.test(hostname)
  ) {
    throw new ImageProcessingError(`可信引用域名无效：${raw}`, 400)
  }
  return hostname
}

const normalizeHotlinkProtectionSettings = (input = {}, fallback = defaultHotlinkProtectionSettings) => {
  const source = input && typeof input === 'object' ? input : {}
  const trustedDomains = source.trustedDomains === undefined ? fallback.trustedDomains : source.trustedDomains
  if (!Array.isArray(trustedDomains)) throw new ImageProcessingError('可信引用域名必须是数组', 400)
  if (trustedDomains.length > 50) throw new ImageProcessingError('最多可以配置 50 个可信引用域名', 400)
  const normalizedDomains = []
  for (const domain of trustedDomains) {
    const normalized = normalizeHotlinkDomain(domain)
    if (!normalizedDomains.includes(normalized)) normalizedDomains.push(normalized)
  }
  return {
    imageEnabled: parseStrictBooleanField(source.imageEnabled, fallback.imageEnabled),
    videoEnabled: parseStrictBooleanField(source.videoEnabled, fallback.videoEnabled),
    trustedDomains: normalizedDomains,
  }
}

const getHotlinkProtectionSettings = () => {
  const value = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('hotlink_protection')?.value
  try {
    return normalizeHotlinkProtectionSettings(value ? JSON.parse(value) : {}, defaultHotlinkProtectionSettings)
  } catch {
    return { ...defaultHotlinkProtectionSettings, trustedDomains: [] }
  }
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
const videoMimeTypesByFormat = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
}
const allowedVideoExtensions = Object.freeze(Object.keys(videoMimeTypesByFormat))
const fileMimeTypesByFormat = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
  json: 'application/json',
  xml: 'application/xml',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  rtf: 'application/rtf',
  epub: 'application/epub+zip',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  psd: 'image/vnd.adobe.photoshop',
  ai: 'application/postscript',
  sketch: 'application/octet-stream',
  fig: 'application/octet-stream',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  aac: 'audio/aac',
  flac: 'audio/flac',
  js: 'text/javascript',
  ts: 'text/typescript',
  css: 'text/css',
  html: 'text/html',
  htm: 'text/html',
  sql: 'application/sql',
  log: 'text/plain',
}
const allowedFileExtensions = Object.freeze(Object.keys(fileMimeTypesByFormat))
const videoFormatFor = (row) => {
  const storedType = String(row.type || '').trim().toLowerCase().replace(/^video\//, '').replace(/^\./, '')
  if (allowedVideoExtensions.includes(storedType)) return storedType
  const filenameExtension = path.extname(row.filename || row.name || '').slice(1).toLowerCase()
  return allowedVideoExtensions.includes(filenameExtension) ? filenameExtension : ''
}
const fileFormatFor = (row) => {
  const storedType = String(row.type || '').trim().toLowerCase().replace(/^\./, '')
  if (allowedFileExtensions.includes(storedType)) return storedType
  const filenameExtension = path.extname(row.filename || row.name || '').slice(1).toLowerCase()
  return allowedFileExtensions.includes(filenameExtension) ? filenameExtension : ''
}
const fileMimeTypeFor = (extension, fallback = '') => fileMimeTypesByFormat[extension] || fallback || 'application/octet-stream'
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
const publicVideoFilename = (row) => {
  const name = normalizeUploadFilename(row.name || row.filename || `video-${row.id}`)
  const format = videoFormatFor(row)
  const currentExtension = path.extname(name).slice(1).toLowerCase()
  if (!format || currentExtension === format) return name
  const stem = path.basename(name, path.extname(name))
  return `${stem}.${format}`
}
const managedVideoPath = (row) => `/media/video/${row.id}/${encodeURIComponent(publicVideoFilename(row))}`
const publicFileFilename = (row) => {
  const name = normalizeUploadFilename(row.name || row.filename || `file-${row.id}`)
  const format = fileFormatFor(row)
  const currentExtension = path.extname(name).slice(1).toLowerCase()
  if (!format || currentExtension === format) return name
  const stem = path.basename(name, path.extname(name))
  return `${stem}.${format}`
}
const managedFilePath = (row) => `/media/file/${row.id}/${encodeURIComponent(publicFileFilename(row))}`
const requestOrigin = (req) => {
  if (configuredPublicUrl) return configuredPublicUrl
  if (!req) return ''
  const protocol = req.protocol || 'http'
  const host = req.get('host')
  return host ? `${protocol}://${host}` : ''
}
const absolutePublicUrl = (url, req) => {
  if (!url || /^[a-z][a-z\d+.-]*:\/\//i.test(url)) return url
  const origin = requestOrigin(req)
  return origin ? new URL(url, `${origin}/`).href : url
}
const analyticsDateKey = (value = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: analyticsTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const values = Object.fromEntries(parts.filter(({ type }) => type !== 'literal').map(({ type, value: partValue }) => [type, partValue]))
  return `${values.year}-${values.month}-${values.day}`
}
const shiftAnalyticsDate = (dateKey, offset) => {
  const date = new Date(`${dateKey}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}
const analyticsDateRange = (days) => {
  const today = analyticsDateKey()
  return { start: shiftAnalyticsDate(today, -(days - 1)), end: today }
}
const classifyMediaRequest = (req) => {
  const referer = String(req.get('referer') || '').trim()
  const fetchSite = String(req.get('sec-fetch-site') || '').trim().toLowerCase()
  if (referer) {
    try {
      const parsed = new URL(referer)
      if (['http:', 'https:'].includes(parsed.protocol)) {
        const parsedHost = parsed.host.toLowerCase().slice(0, 255)
        try {
          const ownHost = new URL(requestOrigin(req)).host.toLowerCase()
          if (ownHost && parsed.host.toLowerCase() === ownHost) return { sourceType: 'internal', referrerHost: '' }
        } catch {
          // Fall through and treat an unknown origin as an external referrer.
        }
        return { sourceType: 'external', referrerHost: parsedHost }
      }
    } catch {
      // A malformed Referer is not used as a stored hostname.
    }
  }
  if (fetchSite === 'cross-site') return { sourceType: 'external', referrerHost: '(跨站未知来源)' }
  return { sourceType: 'direct', referrerHost: '' }
}
const hotlinkDomainMatches = (hostname, trustedDomain) => hostname === trustedDomain || hostname.endsWith(`.${trustedDomain}`)
const hotlinkRequestAllowed = (req, settings) => {
  const referer = String(req.get('referer') || '').trim()
  const fetchSite = String(req.get('sec-fetch-site') || '').trim().toLowerCase()
  const requestOriginValue = String(req.get('origin') || '').trim()
  const ownOrigin = requestOrigin(req)
  const ownHost = (() => {
    try { return new URL(ownOrigin).host.toLowerCase() } catch { return '' }
  })()
  const trustedDomains = settings.trustedDomains
  const trustedOrigin = (value) => {
    try {
      const parsed = new URL(value)
      if (!['http:', 'https:'].includes(parsed.protocol)) return false
      return parsed.host.toLowerCase() === ownHost
        || trustedDomains.some((domain) => hotlinkDomainMatches(parsed.hostname.toLowerCase(), domain))
    } catch {
      return false
    }
  }

  if (referer) return trustedOrigin(referer)
  if (requestOriginValue && requestOriginValue !== 'null') return trustedOrigin(requestOriginValue)
  return fetchSite !== 'cross-site'
}
const upsertMediaTraffic = db.prepare(`
  INSERT INTO media_traffic_daily (
    owner_id, media_type, media_id, traffic_date, requests, bytes,
    external_requests, external_bytes, direct_requests, direct_bytes,
    internal_requests, internal_bytes, range_requests
  ) VALUES (
    @ownerId, @mediaType, @mediaId, @trafficDate, 1, @bytes,
    @externalRequests, @externalBytes, @directRequests, @directBytes,
    @internalRequests, @internalBytes, @rangeRequests
  )
  ON CONFLICT(owner_id, media_type, media_id, traffic_date) DO UPDATE SET
    requests = requests + excluded.requests,
    bytes = bytes + excluded.bytes,
    external_requests = external_requests + excluded.external_requests,
    external_bytes = external_bytes + excluded.external_bytes,
    direct_requests = direct_requests + excluded.direct_requests,
    direct_bytes = direct_bytes + excluded.direct_bytes,
    internal_requests = internal_requests + excluded.internal_requests,
    internal_bytes = internal_bytes + excluded.internal_bytes,
    range_requests = range_requests + excluded.range_requests
`)
const upsertMediaReferrer = db.prepare(`
  INSERT INTO media_referrer_daily (
    owner_id, media_type, media_id, traffic_date, referrer_host, requests, bytes
  ) VALUES (@ownerId, @mediaType, @mediaId, @trafficDate, @referrerHost, 1, @bytes)
  ON CONFLICT(owner_id, media_type, media_id, traffic_date, referrer_host) DO UPDATE SET
    requests = requests + excluded.requests,
    bytes = bytes + excluded.bytes
`)
const recordMediaTraffic = ({ media, mediaType, req, bytes }) => {
  if (!Number.isSafeInteger(bytes) || bytes <= 0) return
  const { sourceType, referrerHost } = classifyMediaRequest(req)
  const trafficDate = analyticsDateKey()
  const values = {
    ownerId: media.owner_id,
    mediaType,
    mediaId: media.id,
    trafficDate,
    bytes,
    externalRequests: sourceType === 'external' ? 1 : 0,
    externalBytes: sourceType === 'external' ? bytes : 0,
    directRequests: sourceType === 'direct' ? 1 : 0,
    directBytes: sourceType === 'direct' ? bytes : 0,
    internalRequests: sourceType === 'internal' ? 1 : 0,
    internalBytes: sourceType === 'internal' ? bytes : 0,
    rangeRequests: req.headers.range ? 1 : 0,
  }
  try {
    upsertMediaTraffic.run(values)
    if (sourceType === 'external' && referrerHost) upsertMediaReferrer.run({ ...values, referrerHost })
  } catch (error) {
    console.error(`Failed to record media traffic for ${mediaType} ${media.id}`, error)
  }
}
const escapeReferenceText = (value) => String(value).replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]')
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
    hotlinkProtectionEnabled: row.hotlink_protection_enabled !== 0,
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

const mapVideo = (row, req) => {
  const name = normalizeUploadFilename(row.name)
  const format = videoFormatFor(row)
  const filename = publicVideoFilename(row)
  const relativeUrl = row.storage_provider_id && (row.storage_key || row.filename) ? managedVideoPath(row) : row.url
  const url = absolutePublicUrl(relativeUrl, req)
  return {
    id: row.id,
    name,
    filename,
    url,
    path: relativeUrl,
    type: format.toUpperCase(),
    format,
    extension: path.extname(filename).toLowerCase() || `.${format}`,
    mimeType: videoMimeTypesByFormat[format] || row.mime_type || 'video/mp4',
    size: Number(row.size),
    album: row.album || '视频',
    category: row.album || '视频',
    starred: Boolean(row.starred),
    hotlinkProtectionEnabled: row.hotlink_protection_enabled !== 0,
    views: Number(row.views),
    links: {
      direct: url,
      markdown: `[${escapeReferenceText(name)}](${url})`,
      bbcode: `[video]${url}[/video]`,
      html: `<video controls preload="metadata" src="${escapeReferenceAttribute(url)}"></video>`,
    },
    createdAt: row.created_at,
  }
}

const mapFile = (row, req) => {
  const name = normalizeUploadFilename(row.name)
  const format = fileFormatFor(row)
  const filename = publicFileFilename(row)
  const relativeUrl = row.storage_provider_id && (row.storage_key || row.filename) ? managedFilePath(row) : row.url
  const url = absolutePublicUrl(relativeUrl, req)
  return {
    id: row.id,
    name,
    filename,
    url,
    path: relativeUrl,
    type: format ? format.toUpperCase() : 'FILE',
    format,
    extension: path.extname(filename).toLowerCase(),
    mimeType: fileMimeTypeFor(format, row.mime_type),
    size: Number(row.size),
    group: row.group_name || '文件',
    groupName: row.group_name || '文件',
    starred: Boolean(row.starred),
    views: Number(row.views),
    links: {
      direct: url,
      markdown: `[${escapeReferenceText(name)}](${url})`,
      bbcode: `[url=${url}]${escapeReferenceText(name)}[/url]`,
      html: `<a href="${escapeReferenceAttribute(url)}" download>${escapeReferenceAttribute(name)}</a>`,
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
const validEmail = (value) => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
const validPassword = (value) => value.length >= 8 && value.length <= 128
const validDisplayName = (value) => value.length >= 2 && value.length <= 80
const validAlbumName = (value) => value.length >= 1 && value.length <= 100
const validImageName = (value) => value.length >= 1 && value.length <= 255

const validateVideoFilename = (filename, mimetype = '') => {
  const normalizedFilename = String(filename || '')
  if (normalizedFilename.length > 255) throw new ImageProcessingError('视频文件名不能超过 255 个字符', 400)
  const extension = path.extname(normalizedFilename).replace(/^\./, '').toLowerCase()
  if (!extension || !allowedVideoExtensions.includes(extension)) {
    throw new ImageProcessingError(`不允许上传 .${extension || '无扩展名'} 视频，允许类型：${allowedVideoExtensions.map((item) => item.toUpperCase()).join('、')}`, 400)
  }
  const normalizedMime = String(mimetype || '').toLowerCase().split(';', 1)[0]
  if (normalizedMime && normalizedMime !== 'application/octet-stream' && normalizedMime !== videoMimeTypesByFormat[extension]) {
    throw new ImageProcessingError(`视频文件类型与 .${extension} 扩展名不匹配`, 400)
  }
  return extension
}

const validateFileFilename = (filename) => {
  const normalizedFilename = String(filename || '')
  if (normalizedFilename.length > 255) throw new ImageProcessingError('文件名不能超过 255 个字符', 400)
  const extension = path.extname(normalizedFilename).replace(/^\./, '').toLowerCase()
  if (!extension || !allowedFileExtensions.includes(extension)) {
    throw new ImageProcessingError(`不允许上传 .${extension || '无扩展名'} 文件，允许类型：${allowedFileExtensions.map((item) => item.toUpperCase()).join('、')}`, 400)
  }
  return extension
}

const normalizeUploadFilename = (value) => {
  let name = String(value || 'image').split(/[\\/]/).pop() || 'image'
  const decoded = Buffer.from(name, 'latin1').toString('utf8')
  const isMisdecodedUtf8 = decoded !== name
    && !decoded.includes('\uFFFD')
    && Buffer.from(decoded, 'utf8').toString('latin1') === name

  if (isMisdecodedUtf8) name = decoded
  return Array.from(name)
    .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
    .join('').trim().normalize('NFC') || 'image'
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

const ensureVideoCategory = (ownerId, name) => {
  const normalizedName = String(name || '').trim()
  if (!validAlbumName(normalizedName)) return null
  db.prepare('INSERT OR IGNORE INTO video_categories (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)')
    .run(crypto.randomUUID(), ownerId, normalizedName, new Date().toISOString())
  return normalizedName
}

const ensureDefaultVideoCategory = (ownerId) => {
  let category = db.prepare(`
    SELECT id, name FROM video_categories WHERE owner_id = ?
    ORDER BY is_default DESC, CASE WHEN name = '视频' THEN 0 ELSE 1 END, created_at ASC, id ASC LIMIT 1
  `).get(ownerId)
  if (!category) {
    category = { id: crypto.randomUUID(), name: '视频' }
    db.prepare('INSERT INTO video_categories (id, owner_id, name, is_default, created_at) VALUES (?, ?, ?, 1, ?)')
      .run(category.id, ownerId, category.name, new Date().toISOString())
    return category.name
  }

  db.prepare('UPDATE video_categories SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE owner_id = ?')
    .run(category.id, ownerId)
  return category.name
}

const ensureVideoCategories = (ownerId) => {
  const defaultName = ensureDefaultVideoCategory(ownerId)
  db.prepare(`
    UPDATE videos SET album = ?
    WHERE owner_id = ? AND (album IS NULL OR TRIM(album) = '')
  `).run(defaultName, ownerId)
  for (const row of db.prepare('SELECT DISTINCT album AS name FROM videos WHERE owner_id = ?').all(ownerId)) {
    ensureVideoCategory(ownerId, row.name)
  }
  return defaultName
}

const ensureFileGroup = (ownerId, name) => {
  const normalizedName = String(name || '').trim()
  if (!validAlbumName(normalizedName)) return null
  db.prepare('INSERT OR IGNORE INTO file_groups (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)')
    .run(crypto.randomUUID(), ownerId, normalizedName, new Date().toISOString())
  return normalizedName
}

const ensureDefaultFileGroup = (ownerId) => {
  let group = db.prepare(`
    SELECT id, name FROM file_groups WHERE owner_id = ?
    ORDER BY is_default DESC, CASE WHEN name = '文件' THEN 0 ELSE 1 END, created_at ASC, id ASC LIMIT 1
  `).get(ownerId)
  if (!group) {
    group = { id: crypto.randomUUID(), name: '文件' }
    db.prepare('INSERT INTO file_groups (id, owner_id, name, is_default, created_at) VALUES (?, ?, ?, 1, ?)')
      .run(group.id, ownerId, group.name, new Date().toISOString())
    return group.name
  }

  db.prepare('UPDATE file_groups SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE owner_id = ?')
    .run(group.id, ownerId)
  return group.name
}

const ensureFileGroups = (ownerId) => {
  const defaultName = ensureDefaultFileGroup(ownerId)
  db.prepare(`
    UPDATE files SET group_name = ?
    WHERE owner_id = ? AND (group_name IS NULL OR TRIM(group_name) = '')
  `).run(defaultName, ownerId)
  for (const row of db.prepare('SELECT DISTINCT group_name AS name FROM files WHERE owner_id = ?').all(ownerId)) {
    ensureFileGroup(ownerId, row.name)
  }
  return defaultName
}

for (const existingUser of db.prepare('SELECT id FROM users').all()) {
  ensureDefaultAlbum(existingUser.id)
  ensureVideoCategories(existingUser.id)
  ensureFileGroups(existingUser.id)
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_video_categories_one_default_per_owner ON video_categories(owner_id) WHERE is_default = 1')

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

const createUser = ({ name, email, password, role, quota, storageProviderId = null }) => {
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  const passwordHash = bcrypt.hashSync(password, 12)
  const storageQuota = quota || (role === 'admin' ? 10 * 1024 ** 3 : 5 * 1024 ** 3)
  db.prepare('INSERT INTO users (id, name, email, password_hash, role, quota, storage_provider_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, name.trim(), safeEmail(email), passwordHash, role, storageQuota, storageProviderId, createdAt)
  ensureDefaultAlbum(id)
  ensureDefaultVideoCategory(id)
  ensureDefaultFileGroup(id)
  return mapUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id))
}

const registerFirstUser = db.transaction(({ name, email, password }) => {
  if (db.prepare('SELECT COUNT(*) AS count FROM users').get().count !== 0) return null
  return createUser({ name, email, password, role: 'admin' })
})

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
    SELECT users.*,
      (SELECT COUNT(*) FROM images WHERE images.owner_id = users.id) AS image_count,
      (SELECT COUNT(*) FROM videos WHERE videos.owner_id = users.id) AS video_count,
      (SELECT COUNT(*) FROM files WHERE files.owner_id = users.id) AS file_count,
      (
        COALESCE((SELECT SUM(size) FROM images WHERE images.owner_id = users.id), 0)
        + COALESCE((SELECT SUM(size) FROM videos WHERE videos.owner_id = users.id), 0)
        + COALESCE((SELECT SUM(size) FROM files WHERE files.owner_id = users.id), 0)
      ) AS storage_used
    FROM users
    WHERE users.id = ?
  `).get(id)
  return row ? {
    ...mapUser(row),
    imageCount: Number(row.image_count),
    videoCount: Number(row.video_count),
    fileCount: Number(row.file_count),
    storageUsed: Number(row.storage_used),
  } : null
}

const getUserStorageUsed = (userId) => Number(db.prepare(`
  SELECT
    COALESCE((SELECT SUM(size) FROM images WHERE owner_id = ?), 0)
    + COALESCE((SELECT SUM(size) FROM videos WHERE owner_id = ?), 0)
    + COALESCE((SELECT SUM(size) FROM files WHERE owner_id = ?), 0) AS used
`).get(userId, userId, userId).used)

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

const videoUpload = multer({
  storage,
  limits: { fileSize: videoMaxBytes, files: 10 },
  fileFilter: (_req, file, cb) => {
    try {
      validateVideoFilename(normalizeUploadFilename(file.originalname), file.mimetype)
      cb(null, true)
    } catch (error) {
      cb(error)
    }
  },
})

const fileUpload = multer({
  storage,
  limits: { fileSize: fileMaxBytes, files: 20 },
  fileFilter: (_req, file, cb) => {
    try {
      validateFileFilename(normalizeUploadFilename(file.originalname))
      cb(null, true)
    } catch (error) {
      cb(error)
    }
  },
})

const cleanupPendingFiles = (files) => {
  for (const file of files || []) {
    if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path)
  }
}

const uploadReservations = new Map()
const persistUploadedFiles = async ({ files, user, album, request, guestUploaded = false, processingSettings = getImageProcessingSettings() }) => {
  const providerId = storageManager.getUploadProviderId(user.storageProviderId)
  const stored = []
  let reservedBytes = 0
  try {
    const processed = []
    for (const file of files) {
      const result = await processUploadedImage(file, processingSettings)
      processed.push({ file, ...result })
    }

    const used = getUserStorageUsed(user.id)
    const processedSize = processed.reduce((sum, item) => sum + item.file.size, 0)
    const pendingSize = uploadReservations.get(user.id) || 0
    if (used + pendingSize + processedSize > user.quota) throw new ImageProcessingError('图片处理后的文件超过存储配额，请降低质量或清理空间后重试', 413)
    reservedBytes = processedSize
    uploadReservations.set(user.id, pendingSize + reservedBytes)

    for (const { file, metadata, processing } of processed) {
      const location = await storageManager.storeFile(user.id, file, providerId, 'image')
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
  } finally {
    if (reservedBytes > 0) {
      const remaining = (uploadReservations.get(user.id) || reservedBytes) - reservedBytes
      if (remaining > 0) uploadReservations.set(user.id, remaining)
      else uploadReservations.delete(user.id)
    }
  }
}

const persistUploadedVideos = async ({ files, user, request, category }) => {
  const providerId = storageManager.getUploadProviderId(user.storageProviderId)
  const stored = []
  let reservedBytes = 0
  try {
    for (const file of files) {
      validateVideoFilename(file.originalname, file.mimetype)
      if (file.size > videoMaxBytes) throw new ImageProcessingError(`单个视频不能超过 ${Math.round(videoMaxBytes / 1024 / 1024)}MB`, 413)
    }
    const used = getUserStorageUsed(user.id)
    const incoming = files.reduce((sum, file) => sum + file.size, 0)
    const pendingSize = uploadReservations.get(user.id) || 0
    if (used + pendingSize + incoming > user.quota) throw new ImageProcessingError('视频文件超过存储配额，请清理空间后重试', 413)
    reservedBytes = incoming
    uploadReservations.set(user.id, pendingSize + reservedBytes)

    for (const file of files) {
      const location = await storageManager.storeFile(user.id, file, providerId, 'video')
      stored.push({ file, location })
    }

    const insert = db.prepare(`
      INSERT INTO videos (
        id, owner_id, name, filename, storage_provider_id, storage_key, url, type, mime_type,
        size, album, starred, views, created_at
      ) VALUES (
        @id, @ownerId, @name, @filename, @storageProviderId, @storageKey, @url, @type, @mimeType,
        @size, @album, 0, 0, @createdAt
      )
    `)
    const created = []
    const transaction = db.transaction(() => {
      for (const { file, location } of stored) {
        const videoId = crypto.randomUUID()
        const format = validateVideoFilename(file.originalname, file.mimetype)
        const video = {
          id: videoId,
          ownerId: user.id,
          name: file.originalname,
          filename: file.filename,
          storageProviderId: location.providerId,
          storageKey: location.storageKey,
          url: managedVideoPath({ id: videoId, name: file.originalname, filename: file.filename }),
          type: format,
          mimeType: videoMimeTypesByFormat[format] || file.mimetype || 'application/octet-stream',
          size: file.size,
          album: category || '视频',
          createdAt: new Date().toISOString(),
        }
        insert.run(video)
        created.push(mapVideo(db.prepare('SELECT * FROM videos WHERE id = ?').get(video.id), request))
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
  } finally {
    if (reservedBytes > 0) {
      const remaining = (uploadReservations.get(user.id) || reservedBytes) - reservedBytes
      if (remaining > 0) uploadReservations.set(user.id, remaining)
      else uploadReservations.delete(user.id)
    }
  }
}

const persistUploadedGeneralFiles = async ({ files, user, request, group }) => {
  const providerId = storageManager.getUploadProviderId(user.storageProviderId)
  const stored = []
  let reservedBytes = 0
  try {
    for (const file of files) {
      validateFileFilename(file.originalname)
      if (file.size > fileMaxBytes) throw new ImageProcessingError(`单个文件不能超过 ${Math.round(fileMaxBytes / 1024 / 1024)}MB`, 413)
    }
    const used = getUserStorageUsed(user.id)
    const incoming = files.reduce((sum, file) => sum + file.size, 0)
    const pendingSize = uploadReservations.get(user.id) || 0
    if (used + pendingSize + incoming > user.quota) throw new ImageProcessingError('文件超过存储配额，请清理空间后重试', 413)
    reservedBytes = incoming
    uploadReservations.set(user.id, pendingSize + reservedBytes)

    for (const file of files) {
      const location = await storageManager.storeFile(user.id, file, providerId, 'file')
      stored.push({ file, location })
    }

    const insert = db.prepare(`
      INSERT INTO files (
        id, owner_id, name, filename, storage_provider_id, storage_key, url, type, mime_type,
        size, group_name, starred, views, created_at
      ) VALUES (
        @id, @ownerId, @name, @filename, @storageProviderId, @storageKey, @url, @type, @mimeType,
        @size, @groupName, 0, 0, @createdAt
      )
    `)
    const created = []
    const transaction = db.transaction(() => {
      ensureFileGroup(user.id, group)
      for (const { file, location } of stored) {
        const fileId = crypto.randomUUID()
        const format = validateFileFilename(file.originalname)
        const item = {
          id: fileId,
          ownerId: user.id,
          name: file.originalname,
          filename: file.filename,
          storageProviderId: location.providerId,
          storageKey: location.storageKey,
          url: managedFilePath({ id: fileId, name: file.originalname, filename: file.filename, type: format }),
          type: format,
          mimeType: fileMimeTypeFor(format, file.mimetype),
          size: file.size,
          groupName: group || '文件',
          createdAt: new Date().toISOString(),
        }
        insert.run(item)
        created.push(mapFile(db.prepare('SELECT * FROM files WHERE id = ?').get(item.id), request))
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
  } finally {
    if (reservedBytes > 0) {
      const remaining = (uploadReservations.get(user.id) || reservedBytes) - reservedBytes
      if (remaining > 0) uploadReservations.set(user.id, remaining)
      else uploadReservations.delete(user.id)
    }
  }
}

const remoteImportTasks = new Map()
const activeRemoteTask = (task) => ['queued', 'downloading', 'processing'].includes(task.status)
const remoteSourceLabel = (url) => {
  try {
    const parsed = new URL(url)
    return `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}`
  } catch {
    return '远程文件'
  }
}

const publicRemoteTask = (task) => ({
  id: task.id,
  status: task.status,
  phase: task.phase,
  sourceLabel: task.sourceLabel,
  filename: task.filename,
  mediaType: task.mediaType,
  progress: task.progress,
  downloadedBytes: task.downloadedBytes,
  totalBytes: task.totalBytes,
  speed: task.speed,
  eta: task.eta,
  downloader: task.downloader,
  connections: task.connections,
  result: task.result,
  error: task.error,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
})

const updateRemoteTask = (task, changes) => {
  Object.assign(task, changes, { updatedAt: new Date().toISOString() })
}

const remoteExtensionForMime = (mimeType, mediaTypes) => {
  const normalized = String(mimeType || '').toLowerCase().split(';', 1)[0]
  const table = mediaTypes === 'image'
    ? mimeTypesByFormat
    : mediaTypes === 'video'
      ? videoMimeTypesByFormat
      : fileMimeTypesByFormat
  return Object.entries(table).find(([, mime]) => mime === normalized)?.[0] || ''
}

const prepareRemoteFile = async ({ filePath, filename, contentType, taskId }) => {
  const imageMetadata = await sharp(filePath, { animated: true, failOn: 'none' }).metadata().catch(() => null)

  const detectedImageFormat = imageMetadata?.format ? normalizeImageFormat(imageMetadata.format) : ''
  const imageSettings = getImageProcessingSettings()
  if (detectedImageFormat && !imageSettings.allowedExtensions.includes(detectedImageFormat)) {
    throw new ImageProcessingError(`远程图片格式 .${detectedImageFormat} 未在当前允许列表中`, 400)
  }
  const imageExtension = detectedImageFormat || ''
  const sourceExtension = path.extname(filename).slice(1).toLowerCase()
  const videoExtension = allowedVideoExtensions.includes(sourceExtension)
    ? sourceExtension
    : remoteExtensionForMime(contentType, 'video')
  const fileExtension = allowedFileExtensions.includes(sourceExtension)
    ? sourceExtension
    : remoteExtensionForMime(contentType, 'file')
  const extension = imageExtension || videoExtension || fileExtension
  const mediaType = imageExtension ? 'image' : videoExtension ? 'video' : fileExtension ? 'file' : ''
  if (!mediaType || !extension) {
    throw new ImageProcessingError(`无法识别远程文件格式，仅支持图片（${imageSettings.allowedExtensions.join('、').toUpperCase()}）、视频（${allowedVideoExtensions.join('、').toUpperCase()}）或文件（${allowedFileExtensions.join('、').toUpperCase()}）`, 400)
  }

  const normalizedFilename = normalizeUploadFilename(filename)
  const currentExtension = path.extname(normalizedFilename)
  const stem = path.basename(normalizedFilename, currentExtension) || `remote-${taskId.slice(0, 8)}`
  const originalname = `${stem}.${extension}`
  const storedStem = stem.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '-').slice(0, 48) || 'remote'
  const storedFilename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${storedStem}.${extension}`
  const mimetype = mediaType === 'image'
    ? mimeTypesByFormat[extension] || contentType || 'application/octet-stream'
    : mediaType === 'video'
      ? videoMimeTypesByFormat[extension] || contentType || 'application/octet-stream'
      : fileMimeTypeFor(extension, contentType)
  const stat = fs.statSync(filePath)
  return {
    fieldname: 'files',
    originalname,
    encoding: '7bit',
    mimetype,
    destination: uploadTempDir,
    filename: storedFilename,
    path: filePath,
    size: stat.size,
    mediaType,
  }
}

const runRemoteImport = async (task) => {
  const filePath = path.join(uploadTempDir, `remote-${task.id}.part`)
  let lastLoaded = 0
  let lastProgressAt = performance.now()
  let smoothedSpeed = 0
  try {
    updateRemoteTask(task, { status: 'downloading', phase: 'downloading' })
    const downloaded = await downloadRemoteFile({
      input: task.url,
      destination: filePath,
      connections: task.connections,
      maxBytes: remoteMaxBytes,
      onMetadata: (metadata) => {
        updateRemoteTask(task, {
          filename: metadata.filename,
          totalBytes: metadata.contentLength,
          downloader: null,
        })
      },
      onProgress: (loaded, total) => {
        const now = performance.now()
        const deltaBytes = loaded - lastLoaded
        const deltaMs = now - lastProgressAt
        if (deltaBytes > 0) {
          const instantSpeed = deltaBytes / Math.max(1, deltaMs) * 1000
          smoothedSpeed = smoothedSpeed ? smoothedSpeed * 0.7 + instantSpeed * 0.3 : instantSpeed
          lastLoaded = loaded
          lastProgressAt = now
        }
        const actualTotal = total || task.totalBytes || loaded
        updateRemoteTask(task, {
          downloadedBytes: loaded,
          totalBytes: actualTotal,
          progress: actualTotal > 0 ? Math.min(100, Math.round((loaded / actualTotal) * 100)) : 0,
          speed: smoothedSpeed,
          eta: smoothedSpeed > 0 && actualTotal > loaded ? (actualTotal - loaded) / smoothedSpeed : null,
        })
      },
    })
    updateRemoteTask(task, {
      status: 'processing',
      phase: 'detecting',
      downloadedBytes: downloaded.size,
      totalBytes: downloaded.size,
      progress: 100,
      speed: 0,
      eta: null,
      downloader: downloaded.downloader,
      connections: downloaded.connections,
    })
    const file = await prepareRemoteFile({
      filePath,
      filename: downloaded.filename,
      contentType: downloaded.contentType,
      taskId: task.id,
    })
    if (file.mediaType === 'image' && file.size > 20 * 1024 * 1024) {
      throw new ImageProcessingError('远程图片不能超过 20 MB', 413)
    }
    updateRemoteTask(task, { phase: 'storing', filename: file.originalname, mediaType: file.mediaType })
    const created = file.mediaType === 'image'
      ? await persistUploadedFiles({
          files: [file],
          user: task.user,
          album: task.album,
          request: task.request,
          processingSettings: getImageProcessingSettings(),
        })
      : file.mediaType === 'video'
        ? await persistUploadedVideos({
            files: [file],
            user: task.user,
            request: task.request,
            category: task.category,
          })
        : await persistUploadedGeneralFiles({
            files: [file],
            user: task.user,
            request: task.request,
            group: task.fileGroup,
          })
    updateRemoteTask(task, {
      status: 'completed',
      phase: 'completed',
      progress: 100,
      downloadedBytes: downloaded.size,
      totalBytes: downloaded.size,
      speed: 0,
      eta: null,
      result: created[0] || null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '远程导入失败，请重试'
    updateRemoteTask(task, { status: 'failed', phase: 'failed', error: message, eta: null })
  } finally {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    const expiry = setTimeout(() => remoteImportTasks.delete(task.id), 60 * 60 * 1000)
    expiry.unref?.()
  }
}

const allowGuestUpload = (req, res, next) => {
  const enabled = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('guest_upload_enabled')?.value === 'true'
  if (!enabled) return res.status(403).json({ message: '游客上传当前未开放' })
  const owner = mapUser(db.prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1").get())
  if (!owner) return res.status(503).json({ message: '系统尚未完成初始化' })
  req.user = owner
  next()
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ message: '登录尝试过于频繁，请 15 分钟后再试' }),
})

const guestUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ message: '游客上传过于频繁，请稍后再试' }),
})

const requireSameOriginSessionRequest = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !req.cookies.picnest_session) return next()
  if (req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ message: '拒绝跨站请求' })
  const origin = req.get('origin')
  if (!origin) return next()
  try {
    const expectedOrigin = new URL(requestOrigin(req)).origin
    if (new URL(origin).origin !== expectedOrigin) return res.status(403).json({ message: '请求来源无效' })
  } catch {
    return res.status(403).json({ message: '请求来源无效' })
  }
  next()
}

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', 'loopback')
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:'],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      upgradeInsecureRequests: isProduction ? [] : null,
    },
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  strictTransportSecurity: isProduction ? undefined : false,
}))
app.use(express.json({ limit: '1mb' }))
app.use((req, _res, next) => {
  if (req.body === undefined) req.body = {}
  next()
})
app.use(cookieParser())
app.use(requireSameOriginSessionRequest)
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  next()
})
app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'PicNest', database: 'sqlite' }))

const streamManagedMedia = async (req, res, { table, filenameFor, missingMessage, failureMessage, mediaType, disposition = 'inline' }) => {
  const media = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id)
  if (!media || !media.storage_provider_id || (!media.storage_key && !media.filename)) {
    return res.status(404).json({ message: missingMessage })
  }

  const resolvedMediaType = mediaType || (table === 'videos' ? 'video' : table === 'files' ? 'file' : 'image')
  const mediaLabel = resolvedMediaType === 'video' ? '视频' : resolvedMediaType === 'file' ? '文件' : '图片'
  const hotlinkSettings = getHotlinkProtectionSettings()
  const hotlinkProtectionEnabled = resolvedMediaType !== 'file' && hotlinkSettings[`${resolvedMediaType}Enabled`] && media.hotlink_protection_enabled !== 0
  if (hotlinkProtectionEnabled && !hotlinkRequestAllowed(req, hotlinkSettings)) {
    return res.status(403).json({ message: `该${mediaLabel}已启用防盗链，仅允许站内或已配置的可信域名访问` })
  }

  res.setHeader('Accept-Ranges', 'bytes')
  try {
    const object = await storageManager.openStoredObject(media, { rangeHeader: req.headers.range })
    let cleaned = false
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      object.cleanup?.()
    }
    const etag = object.etag || `"${media.id}"`

    res.setHeader('Content-Type', object.contentType || media.mime_type || 'application/octet-stream')
    res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(filenameFor(media))}`)
    res.setHeader('Cache-Control', hotlinkProtectionEnabled ? 'private, no-store' : 'public, max-age=31536000, immutable')
    if (hotlinkProtectionEnabled) res.setHeader('Vary', 'Referer, Origin, Sec-Fetch-Site')
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'")
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    res.setHeader('ETag', etag)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (object.acceptRanges) res.setHeader('Accept-Ranges', object.acceptRanges)
    if (object.contentRange) res.setHeader('Content-Range', object.contentRange)
    const contentLength = object.contentLength ?? media.size
    if (Number.isFinite(Number(contentLength))) {
      res.setHeader('Content-Length', String(contentLength))
    }
    const lastModified = object.lastModified || media.created_at
    if (lastModified) res.setHeader('Last-Modified', new Date(lastModified).toUTCString())
    if (object.statusCode) res.status(object.statusCode)

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

    db.prepare(`UPDATE ${table} SET views = views + 1 WHERE id = ?`).run(media.id)

    let streamedBytes = 0
    let trafficRecorded = false
    const recordTraffic = () => {
      if (trafficRecorded) return
      trafficRecorded = true
      recordMediaTraffic({
        media,
        mediaType: resolvedMediaType,
        req,
        bytes: streamedBytes,
      })
    }
    object.body.on('data', (chunk) => {
      streamedBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk))
    })
    res.once('finish', recordTraffic)
    res.once('close', recordTraffic)
    res.once('finish', cleanup)
    res.once('close', cleanup)
    object.body.once('error', (error) => {
      cleanup()
      recordTraffic()
      if (res.headersSent) res.destroy(error)
      else res.status(502).json({ message: `${failureMessage}读取失败` })
    })
    object.body.pipe(res)
  } catch (error) {
    const status = error instanceof StorageManagerError ? error.status : 502
    if (status >= 500) console.error(`Failed to stream ${table.slice(0, -1)} ${media.id}`, error)
    if (status === 416) res.setHeader('Content-Range', `bytes */${media.size}`)
    res.status(status).json({ message: status === 404 ? `${failureMessage}原文件不存在` : `${failureMessage}读取失败` })
  }
}

const streamManagedImage = (req, res) => streamManagedMedia(req, res, {
  table: 'images',
  filenameFor: publicImageFilename,
  missingMessage: '图片不存在',
  failureMessage: '图片',
  mediaType: 'image',
})

const streamManagedVideo = (req, res) => streamManagedMedia(req, res, {
  table: 'videos',
  filenameFor: publicVideoFilename,
  missingMessage: '视频不存在',
  failureMessage: '视频',
  mediaType: 'video',
})

const streamManagedFile = (req, res) => streamManagedMedia(req, res, {
  table: 'files',
  filenameFor: publicFileFilename,
  missingMessage: '文件不存在',
  failureMessage: '文件',
  mediaType: 'file',
  disposition: 'attachment',
})

app.get('/media/file/:id', streamManagedFile)
app.get('/media/file/:id/:filename', streamManagedFile)
app.get('/media/video/:id', streamManagedVideo)
app.get('/media/video/:id/:filename', streamManagedVideo)
app.get('/media/:id', streamManagedImage)
app.get('/media/:id/:filename', streamManagedImage)

app.get('/api/public/config', (_req, res) => {
  const enabled = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('guest_upload_enabled')?.value === 'true'
  res.json({
    guestUploadEnabled: enabled,
    maxFileSize: 10 * 1024 * 1024,
    maxFiles: 5,
    allowedExtensions: getImageProcessingSettings().allowedExtensions,
    videoMaxFileSize: videoMaxBytes,
    videoMaxFiles: 10,
    videoExtensions: allowedVideoExtensions,
    fileMaxFileSize: fileMaxBytes,
    fileMaxFiles: 20,
    fileExtensions: allowedFileExtensions,
  })
})

app.post('/api/public/images', allowGuestUpload, guestUploadLimiter, guestUpload.array('files', 5), async (req, res) => {
  const used = getUserStorageUsed(req.user.id)
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

app.post('/api/auth/register', authLimiter, (req, res) => {
  const name = String(req.body.name || '').trim()
  const email = safeEmail(req.body.email)
  const password = String(req.body.password || '')
  if (!validDisplayName(name)) return res.status(400).json({ message: '昵称需要 2 到 80 个字符' })
  if (!validEmail(email)) return res.status(400).json({ message: '请输入有效的邮箱地址' })
  if (!validPassword(password)) return res.status(400).json({ message: '密码需要 8 到 128 个字符' })
  const user = registerFirstUser({ name, email, password })
  if (!user) return res.status(403).json({ message: '系统已完成初始化，请联系管理员创建账户' })
  createSession(res, user)
  res.status(201).json(user)
})

const dummyPasswordHash = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 12)

app.post('/api/auth/login', authLimiter, (req, res) => {
  const email = safeEmail(req.body.email)
  const password = String(req.body.password || '')
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
  const passwordMatches = bcrypt.compareSync(password.slice(0, 128), row?.password_hash || dummyPasswordHash)
  if (!row || !passwordMatches || password.length > 128) return res.status(401).json({ message: '邮箱或密码不正确' })
  const user = mapUser(row)
  createSession(res, user)
  res.json(user)
})

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('picnest_session', { path: '/' })
  res.status(204).end()
})

app.patch('/api/settings/guest-upload', authenticate, requireSessionAuth, requireAdmin, (req, res) => {
  if (typeof req.body.enabled !== 'boolean') return res.status(400).json({ message: 'enabled 必须是布尔值' })
  const enabled = req.body.enabled
  db.prepare('UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ?')
    .run(enabled ? 'true' : 'false', new Date().toISOString(), 'guest_upload_enabled')
  res.json({ guestUploadEnabled: enabled })
})

app.get('/api/settings/image-processing', authenticate, (_req, res) => {
  res.json(getImageProcessingSettings())
})

app.patch('/api/settings/image-processing', authenticate, requireSessionAuth, requireAdmin, (req, res) => {
  const settings = normalizeImageProcessingSettings(req.body || {}, getImageProcessingSettings())
  db.prepare('UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ?')
    .run(JSON.stringify(settings), new Date().toISOString(), 'image_processing')
  res.json(settings)
})

app.get('/api/settings/hotlink-protection', authenticate, (_req, res) => {
  res.json(getHotlinkProtectionSettings())
})

app.patch('/api/settings/hotlink-protection', authenticate, requireSessionAuth, requireAdmin, (req, res) => {
  const settings = normalizeHotlinkProtectionSettings(req.body || {}, getHotlinkProtectionSettings())
  db.prepare('UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ?')
    .run(JSON.stringify(settings), new Date().toISOString(), 'hotlink_protection')
  res.json(settings)
})

app.get('/api/storage/providers', authenticate, requireSessionAuth, (_req, res) => {
  res.json(storageManager.listProviders())
})

app.post('/api/storage/providers', authenticate, requireSessionAuth, requireAdmin, (req, res) => {
  const provider = storageManager.createProvider(req.body || {})
  res.status(201).json(provider)
})

app.patch('/api/storage/providers/:id', authenticate, requireSessionAuth, requireAdmin, (req, res) => {
  res.json(storageManager.updateProvider(req.params.id, req.body || {}))
})

app.patch('/api/storage/providers/:id/default', authenticate, requireSessionAuth, requireAdmin, async (req, res) => {
  await storageManager.testProvider(req.params.id)
  res.json(storageManager.setDefaultProvider(req.params.id))
})

app.post('/api/storage/providers/:id/test', authenticate, requireSessionAuth, requireAdmin, async (req, res) => {
  await storageManager.testProvider(req.params.id)
  res.json({ ok: true })
})

app.delete('/api/storage/providers/:id', authenticate, requireSessionAuth, requireAdmin, (req, res) => {
  storageManager.deleteProvider(req.params.id)
  res.status(204).end()
})

app.get('/api/users', authenticate, requireSessionAuth, requireAdmin, (_req, res) => {
  const rows = db.prepare(`
    SELECT users.*,
      (SELECT COUNT(*) FROM images WHERE images.owner_id = users.id) AS image_count,
      (SELECT COUNT(*) FROM videos WHERE videos.owner_id = users.id) AS video_count,
      (SELECT COUNT(*) FROM files WHERE files.owner_id = users.id) AS file_count,
      (
        COALESCE((SELECT SUM(size) FROM images WHERE images.owner_id = users.id), 0)
        + COALESCE((SELECT SUM(size) FROM videos WHERE videos.owner_id = users.id), 0)
        + COALESCE((SELECT SUM(size) FROM files WHERE files.owner_id = users.id), 0)
      ) AS storage_used
    FROM users
    ORDER BY users.created_at ASC
  `).all()
  res.json(rows.map((row) => ({
    ...mapUser(row),
    imageCount: Number(row.image_count),
    videoCount: Number(row.video_count),
    fileCount: Number(row.file_count),
    storageUsed: Number(row.storage_used),
  })))
})

app.post('/api/users', authenticate, requireSessionAuth, requireAdmin, (req, res) => {
  const name = String(req.body.name || '').trim()
  const email = safeEmail(req.body.email)
  const password = String(req.body.password || '')
  if (!['admin', 'member'].includes(req.body.role)) return res.status(400).json({ message: '空间角色只能是管理员或普通成员' })
  const role = req.body.role
  const defaultQuota = role === 'admin' ? 10 * 1024 ** 3 : 5 * 1024 ** 3
  const quota = normalizeUserQuota(req.body.quota, defaultQuota)
  const storageProviderId = normalizeStorageProviderId(req.body.storageProviderId)
  if (!validDisplayName(name) || !validEmail(email) || !validPassword(password)) return res.status(400).json({ message: '请填写 2 到 80 个字符的昵称、有效邮箱和 8 到 128 个字符的密码' })
  if (quota === null) return res.status(400).json({ message: '存储配额必须在 100 MB 到 100 TB 之间' })
  if (storageProviderId === undefined) return res.status(400).json({ message: '选择的存储策略不存在' })
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(409).json({ message: '该邮箱已经存在' })
  const user = createUser({ name, email, password, role, quota, storageProviderId })
  res.status(201).json({ ...user, imageCount: 0, videoCount: 0, fileCount: 0, storageUsed: 0 })
})

app.patch('/api/users/:id', authenticate, requireSessionAuth, requireAdmin, (req, res) => {
  const current = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)
  if (!current) return res.status(404).json({ message: '用户不存在' })

  const name = Object.hasOwn(req.body, 'name') ? String(req.body.name || '').trim() : current.name
  const email = Object.hasOwn(req.body, 'email') ? safeEmail(req.body.email) : current.email
  if (Object.hasOwn(req.body, 'role') && !['admin', 'member'].includes(req.body.role)) return res.status(400).json({ message: '空间角色只能是管理员或普通成员' })
  const role = Object.hasOwn(req.body, 'role') ? req.body.role : current.role
  const quota = normalizeUserQuota(req.body.quota, Number(current.quota))
  const storageProviderId = normalizeStorageProviderId(req.body.storageProviderId, current.storage_provider_id || null)
  const password = Object.hasOwn(req.body, 'password') ? String(req.body.password || '') : ''

  if (!validDisplayName(name) || !validEmail(email)) return res.status(400).json({ message: '请填写 2 到 80 个字符的成员称呼和有效登录邮箱' })
  if (req.params.id === req.user.id && role !== current.role) return res.status(400).json({ message: '不能修改自己的管理员角色' })
  if (quota === null) return res.status(400).json({ message: '存储配额必须在 100 MB 到 100 TB 之间' })
  if (storageProviderId === undefined) return res.status(400).json({ message: '选择的存储策略不存在' })
  if (password && !validPassword(password)) return res.status(400).json({ message: '新密码需要 8 到 128 个字符' })
  if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id <> ?').get(email, current.id)) return res.status(409).json({ message: '该邮箱已经存在' })

  const used = getUserStorageUsed(current.id)
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
  if (requestedAlbum && !validAlbumName(requestedAlbum)) {
    cleanupPendingFiles(req.files)
    return res.status(400).json({ message: '相册名称需要 1 到 100 个字符' })
  }
  const album = requestedAlbum || ensureDefaultAlbum(req.user.id)
  const used = getUserStorageUsed(req.user.id)
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

app.get('/api/videos', authenticate, (req, res) => {
  const videos = db.prepare('SELECT * FROM videos WHERE owner_id = ? ORDER BY created_at DESC').all(req.user.id)
  res.json(videos.map((video) => mapVideo(video, req)))
})

app.get('/api/videos/:id', authenticate, (req, res) => {
  const video = db.prepare('SELECT * FROM videos WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id)
  if (!video) return res.status(404).json({ message: '视频不存在' })
  res.json(mapVideo(video, req))
})

app.post('/api/videos', authenticate, videoUpload.array('files', 10), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ message: '请选择需要上传的视频' })
  const requestedCategory = String(req.body.category || req.body.album || '').trim()
  if (requestedCategory && !validAlbumName(requestedCategory)) {
    cleanupPendingFiles(req.files)
    return res.status(400).json({ message: '视频分类名称需要 1 到 100 个字符' })
  }
  const category = requestedCategory || ensureDefaultVideoCategory(req.user.id)
  ensureVideoCategory(req.user.id, category)
  const created = await persistUploadedVideos({
    files: req.files,
    user: req.user,
    request: req,
    category,
  })
  res.status(201).json(created)
})

app.get('/api/files', authenticate, (req, res) => {
  const files = db.prepare('SELECT * FROM files WHERE owner_id = ? ORDER BY created_at DESC').all(req.user.id)
  res.json(files.map((file) => mapFile(file, req)))
})

app.get('/api/files/:id', authenticate, (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id)
  if (!file) return res.status(404).json({ message: '文件不存在' })
  res.json(mapFile(file, req))
})

app.post('/api/files', authenticate, fileUpload.array('files', 20), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ message: '请选择需要上传的文件' })
  const requestedGroup = String(req.body.group || req.body.groupName || '').trim()
  if (requestedGroup && !validAlbumName(requestedGroup)) {
    cleanupPendingFiles(req.files)
    return res.status(400).json({ message: '文件分组名称需要 1 到 100 个字符' })
  }
  const group = requestedGroup || ensureDefaultFileGroup(req.user.id)
  ensureFileGroup(req.user.id, group)
  const created = await persistUploadedGeneralFiles({
    files: req.files,
    user: req.user,
    request: req,
    group,
  })
  res.status(201).json(created)
})

app.post('/api/remote-imports', authenticate, (req, res) => {
  const activeCount = Array.from(remoteImportTasks.values())
    .filter((task) => task.ownerId === req.user.id && activeRemoteTask(task)).length
  if (activeCount >= remoteMaxActive) {
    return res.status(429).json({ message: `同时最多进行 ${remoteMaxActive} 个远程导入任务` })
  }

  let parsed
  try {
    parsed = parseRemoteSource(String(req.body.source || req.body.url || ''))
  } catch (error) {
    if (error instanceof RemoteDownloadError) return res.status(error.status).json({ message: error.message })
    throw error
  }

  const requestedAlbum = String(req.body.album || '').trim()
  const requestedCategory = String(req.body.category || '').trim()
  const requestedFileGroup = String(req.body.fileGroup || req.body.group || '').trim()
  if (requestedAlbum && !validAlbumName(requestedAlbum)) return res.status(400).json({ message: '相册名称需要 1 到 100 个字符' })
  if (requestedCategory && !validAlbumName(requestedCategory)) return res.status(400).json({ message: '视频分类名称需要 1 到 100 个字符' })
  if (requestedFileGroup && !validAlbumName(requestedFileGroup)) return res.status(400).json({ message: '文件分组名称需要 1 到 100 个字符' })
  const connections = Number(req.body.connections || remoteDownloadDefaults.defaultConnections)
  if (!Number.isInteger(connections) || connections < 1 || connections > remoteDownloadDefaults.maxConnections) {
    return res.status(400).json({ message: `下载连接数需要是 1 到 ${remoteDownloadDefaults.maxConnections} 的整数` })
  }

  const task = {
    id: crypto.randomUUID(),
    ownerId: req.user.id,
    user: req.user,
    request: req,
    url: parsed.url,
    sourceLabel: remoteSourceLabel(parsed.url),
    album: requestedAlbum || ensureDefaultAlbum(req.user.id),
    category: requestedCategory || ensureDefaultVideoCategory(req.user.id),
    fileGroup: requestedFileGroup || ensureDefaultFileGroup(req.user.id),
    connections,
    status: 'queued',
    phase: 'queued',
    filename: '',
    mediaType: '',
    progress: 0,
    downloadedBytes: 0,
    totalBytes: null,
    speed: 0,
    eta: null,
    downloader: null,
    result: null,
    error: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  remoteImportTasks.set(task.id, task)
  void runRemoteImport(task)
  res.status(202).json(publicRemoteTask(task))
})

app.get('/api/remote-imports/:id', authenticate, (req, res) => {
  const task = remoteImportTasks.get(req.params.id)
  if (!task || task.ownerId !== req.user.id) return res.status(404).json({ message: '远程导入任务不存在' })
  res.json(publicRemoteTask(task))
})

app.patch('/api/videos/:id', authenticate, (req, res) => {
  const video = db.prepare('SELECT * FROM videos WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id)
  if (!video) return res.status(404).json({ message: '视频不存在' })
  const name = Object.hasOwn(req.body, 'name') ? String(req.body.name).trim() : video.name
  const requestedCategory = Object.hasOwn(req.body, 'category')
    ? String(req.body.category || '').trim()
    : Object.hasOwn(req.body, 'album')
      ? String(req.body.album || '').trim()
      : video.album || ensureDefaultVideoCategory(req.user.id)
  const category = requestedCategory || ensureDefaultVideoCategory(req.user.id)
  const starred = Object.hasOwn(req.body, 'starred') ? (req.body.starred ? 1 : 0) : video.starred
  const hotlinkProtectionEnabled = Object.hasOwn(req.body, 'hotlinkProtectionEnabled')
    ? (req.body.hotlinkProtectionEnabled ? 1 : 0)
    : video.hotlink_protection_enabled
  if (!validImageName(name)) return res.status(400).json({ message: '视频名称需要 1 到 255 个字符' })
  if (!validAlbumName(category)) return res.status(400).json({ message: '视频分类名称需要 1 到 100 个字符' })
  if (Object.hasOwn(req.body, 'starred') && typeof req.body.starred !== 'boolean') return res.status(400).json({ message: 'starred 必须是布尔值' })
  if (Object.hasOwn(req.body, 'hotlinkProtectionEnabled') && typeof req.body.hotlinkProtectionEnabled !== 'boolean') return res.status(400).json({ message: 'hotlinkProtectionEnabled 必须是布尔值' })
  ensureVideoCategory(req.user.id, category)
  db.prepare('UPDATE videos SET name = ?, album = ?, starred = ?, hotlink_protection_enabled = ? WHERE id = ? AND owner_id = ?')
    .run(name, category, starred, hotlinkProtectionEnabled, req.params.id, req.user.id)
  res.json(mapVideo(db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id), req))
})

const removeOwnedVideo = async (video, userId) => {
  await storageManager.deleteStoredObject(video)
  db.prepare('DELETE FROM videos WHERE id = ? AND owner_id = ?').run(video.id, userId)
}

app.delete('/api/videos/:id', authenticate, async (req, res) => {
  const video = db.prepare('SELECT * FROM videos WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id)
  if (!video) return res.status(404).json({ message: '视频不存在' })
  await removeOwnedVideo(video, req.user.id)
  res.status(204).end()
})

app.post('/api/videos/bulk-delete', authenticate, async (req, res) => {
  if (!Array.isArray(req.body.ids) || req.body.ids.length === 0) return res.status(400).json({ message: '请选择需要删除的视频' })
  if (req.body.ids.length > 200) return res.status(400).json({ message: '单次最多删除 200 个视频' })
  const ids = new Set(req.body.ids.filter((id) => typeof id === 'string' && id.length <= 100))
  if (!ids.size) return res.status(400).json({ message: '视频 ID 格式无效' })
  const owned = db.prepare('SELECT * FROM videos WHERE owner_id = ?').all(req.user.id).filter((video) => ids.has(video.id))
  for (const video of owned) await removeOwnedVideo(video, req.user.id)
  res.json({ deleted: owned.length })
})

app.patch('/api/files/:id', authenticate, (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id)
  if (!file) return res.status(404).json({ message: '文件不存在' })
  const name = Object.hasOwn(req.body, 'name') ? String(req.body.name).trim() : file.name
  const requestedGroup = Object.hasOwn(req.body, 'group')
    ? String(req.body.group || '').trim()
    : Object.hasOwn(req.body, 'groupName')
      ? String(req.body.groupName || '').trim()
      : file.group_name || ensureDefaultFileGroup(req.user.id)
  const group = requestedGroup || ensureDefaultFileGroup(req.user.id)
  const starred = Object.hasOwn(req.body, 'starred') ? (req.body.starred ? 1 : 0) : file.starred
  if (!validImageName(name)) return res.status(400).json({ message: '文件名称需要 1 到 255 个字符' })
  if (!validAlbumName(group)) return res.status(400).json({ message: '文件分组名称需要 1 到 100 个字符' })
  if (Object.hasOwn(req.body, 'starred') && typeof req.body.starred !== 'boolean') return res.status(400).json({ message: 'starred 必须是布尔值' })
  ensureFileGroup(req.user.id, group)
  db.prepare('UPDATE files SET name = ?, group_name = ?, starred = ? WHERE id = ? AND owner_id = ?')
    .run(name, group, starred, req.params.id, req.user.id)
  res.json(mapFile(db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id), req))
})

const removeOwnedFile = async (file, userId) => {
  await storageManager.deleteStoredObject(file)
  db.prepare('DELETE FROM files WHERE id = ? AND owner_id = ?').run(file.id, userId)
}

app.delete('/api/files/:id', authenticate, async (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id)
  if (!file) return res.status(404).json({ message: '文件不存在' })
  await removeOwnedFile(file, req.user.id)
  res.status(204).end()
})

app.post('/api/files/bulk-delete', authenticate, async (req, res) => {
  if (!Array.isArray(req.body.ids) || req.body.ids.length === 0) return res.status(400).json({ message: '请选择需要删除的文件' })
  if (req.body.ids.length > 500) return res.status(400).json({ message: '单次最多删除 500 个文件' })
  const ids = new Set(req.body.ids.filter((id) => typeof id === 'string' && id.length <= 100))
  if (!ids.size) return res.status(400).json({ message: '文件 ID 格式无效' })
  const owned = db.prepare('SELECT * FROM files WHERE owner_id = ?').all(req.user.id).filter((file) => ids.has(file.id))
  for (const file of owned) await removeOwnedFile(file, req.user.id)
  res.json({ deleted: owned.length })
})

app.patch('/api/images/:id', authenticate, (req, res) => {
  const image = db.prepare('SELECT * FROM images WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id)
  if (!image) return res.status(404).json({ message: '图片不存在' })
  const name = Object.hasOwn(req.body, 'name') ? String(req.body.name).trim() : image.name
  const album = Object.hasOwn(req.body, 'album') ? String(req.body.album).trim() || '未分类' : image.album
  const starred = Object.hasOwn(req.body, 'starred') ? (req.body.starred ? 1 : 0) : image.starred
  const hotlinkProtectionEnabled = Object.hasOwn(req.body, 'hotlinkProtectionEnabled')
    ? (req.body.hotlinkProtectionEnabled ? 1 : 0)
    : image.hotlink_protection_enabled
  if (!validImageName(name)) return res.status(400).json({ message: '图片名称需要 1 到 255 个字符' })
  if (!validAlbumName(album)) return res.status(400).json({ message: '相册名称需要 1 到 100 个字符' })
  if (Object.hasOwn(req.body, 'starred') && typeof req.body.starred !== 'boolean') return res.status(400).json({ message: 'starred 必须是布尔值' })
  if (Object.hasOwn(req.body, 'hotlinkProtectionEnabled') && typeof req.body.hotlinkProtectionEnabled !== 'boolean') return res.status(400).json({ message: 'hotlinkProtectionEnabled 必须是布尔值' })
  db.prepare('UPDATE images SET name = ?, album = ?, starred = ?, hotlink_protection_enabled = ? WHERE id = ? AND owner_id = ?')
    .run(name, album, starred, hotlinkProtectionEnabled, req.params.id, req.user.id)
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
  if (!Array.isArray(req.body.ids) || req.body.ids.length === 0) return res.status(400).json({ message: '请选择需要删除的图片' })
  if (req.body.ids.length > 500) return res.status(400).json({ message: '单次最多删除 500 张图片' })
  const ids = new Set(req.body.ids.filter((id) => typeof id === 'string' && id.length <= 100))
  if (!ids.size) return res.status(400).json({ message: '图片 ID 格式无效' })
  const owned = db.prepare('SELECT * FROM images WHERE owner_id = ?').all(req.user.id).filter((image) => ids.has(image.id))
  for (const image of owned) await removeOwnedImage(image, req.user.id)
  res.json({ deleted: owned.length })
})

app.get('/api/video-categories', authenticate, (req, res) => {
  ensureVideoCategories(req.user.id)
  const rows = db.prepare(`
    SELECT video_categories.id, video_categories.name, video_categories.is_default, video_categories.created_at,
      COUNT(videos.id) AS video_count, COALESCE(SUM(videos.size), 0) AS storage_used,
      (SELECT url FROM videos cover WHERE cover.owner_id = video_categories.owner_id AND cover.album = video_categories.name ORDER BY cover.created_at DESC LIMIT 1) AS cover
    FROM video_categories
    LEFT JOIN videos ON videos.owner_id = video_categories.owner_id AND videos.album = video_categories.name
    WHERE video_categories.owner_id = ?
    GROUP BY video_categories.id
    ORDER BY video_categories.is_default DESC, video_categories.created_at ASC
  `).all(req.user.id)
  res.json(rows.map((row) => ({
    id: row.id,
    name: row.name,
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at,
    videoCount: Number(row.video_count),
    storageUsed: Number(row.storage_used),
    cover: row.cover ? absolutePublicUrl(row.cover, req) : null,
  })))
})

app.post('/api/video-categories', authenticate, (req, res) => {
  const name = String(req.body.name || '').trim()
  if (!validAlbumName(name)) return res.status(400).json({ message: '视频分类名称需要 1 到 100 个字符' })
  if (db.prepare('SELECT COUNT(*) AS count FROM video_categories WHERE owner_id = ?').get(req.user.id).count >= 500) {
    return res.status(409).json({ message: '每位用户最多创建 500 个视频分类' })
  }
  try {
    const category = { id: crypto.randomUUID(), name, createdAt: new Date().toISOString() }
    db.prepare('INSERT INTO video_categories (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)')
      .run(category.id, req.user.id, name, category.createdAt)
    res.status(201).json({ ...category, isDefault: false, videoCount: 0, storageUsed: 0, cover: null })
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return res.status(409).json({ message: '视频分类名称已经存在' })
    throw error
  }
})

app.patch('/api/video-categories/:id/default', authenticate, (req, res) => {
  const category = db.prepare('SELECT id, name FROM video_categories WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id)
  if (!category) return res.status(404).json({ message: '视频分类不存在' })
  const transaction = db.transaction(() => {
    db.prepare('UPDATE video_categories SET is_default = 0 WHERE owner_id = ?').run(req.user.id)
    db.prepare('UPDATE video_categories SET is_default = 1 WHERE id = ? AND owner_id = ?').run(category.id, req.user.id)
  })
  transaction()
  res.json({ id: category.id, name: category.name, isDefault: true })
})

app.get('/api/file-groups', authenticate, (req, res) => {
  ensureFileGroups(req.user.id)
  const rows = db.prepare(`
    SELECT file_groups.id, file_groups.name, file_groups.is_default, file_groups.created_at,
      COUNT(files.id) AS file_count, COALESCE(SUM(files.size), 0) AS storage_used
    FROM file_groups
    LEFT JOIN files ON files.owner_id = file_groups.owner_id AND files.group_name = file_groups.name
    WHERE file_groups.owner_id = ?
    GROUP BY file_groups.id
    ORDER BY file_groups.is_default DESC, file_groups.created_at ASC
  `).all(req.user.id)
  res.json(rows.map((row) => ({
    id: row.id,
    name: row.name,
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at,
    fileCount: Number(row.file_count),
    storageUsed: Number(row.storage_used),
  })))
})

app.post('/api/file-groups', authenticate, (req, res) => {
  const name = String(req.body.name || '').trim()
  if (!validAlbumName(name)) return res.status(400).json({ message: '文件分组名称需要 1 到 100 个字符' })
  if (db.prepare('SELECT COUNT(*) AS count FROM file_groups WHERE owner_id = ?').get(req.user.id).count >= 500) {
    return res.status(409).json({ message: '每位用户最多创建 500 个文件分组' })
  }
  try {
    const group = { id: crypto.randomUUID(), name, createdAt: new Date().toISOString() }
    db.prepare('INSERT INTO file_groups (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)')
      .run(group.id, req.user.id, name, group.createdAt)
    res.status(201).json({ ...group, isDefault: false, fileCount: 0, storageUsed: 0 })
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return res.status(409).json({ message: '文件分组名称已经存在' })
    throw error
  }
})

app.patch('/api/file-groups/:id/default', authenticate, (req, res) => {
  const group = db.prepare('SELECT id, name FROM file_groups WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id)
  if (!group) return res.status(404).json({ message: '文件分组不存在' })
  const transaction = db.transaction(() => {
    db.prepare('UPDATE file_groups SET is_default = 0 WHERE owner_id = ?').run(req.user.id)
    db.prepare('UPDATE file_groups SET is_default = 1 WHERE id = ? AND owner_id = ?').run(group.id, req.user.id)
  })
  transaction()
  res.json({ id: group.id, name: group.name, isDefault: true })
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
  if (!validAlbumName(name)) return res.status(400).json({ message: '相册名称需要 1 到 100 个字符' })
  if (db.prepare('SELECT COUNT(*) AS count FROM albums WHERE owner_id = ?').get(req.user.id).count >= 500) return res.status(409).json({ message: '每位用户最多创建 500 个相册' })
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
  if (db.prepare('SELECT COUNT(*) AS count FROM api_keys WHERE user_id = ?').get(req.user.id).count >= 50) return res.status(409).json({ message: '每位用户最多创建 50 把 API 密钥' })
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
  const aggregate = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM images WHERE owner_id = ?) AS images,
      (SELECT COUNT(*) FROM videos WHERE owner_id = ?) AS videos,
      (SELECT COUNT(*) FROM files WHERE owner_id = ?) AS files,
      (
        COALESCE((SELECT SUM(size) FROM images WHERE owner_id = ?), 0)
        + COALESCE((SELECT SUM(size) FROM videos WHERE owner_id = ?), 0)
        + COALESCE((SELECT SUM(size) FROM files WHERE owner_id = ?), 0)
      ) AS used
  `).get(req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id)
  const month = getCurrentMonth()
  const usage = db.prepare(`
    SELECT calls, success_calls, failed_calls, response_ms_total, traffic_bytes
    FROM api_usage_monthly WHERE user_id = ? AND month = ?
  `).get(req.user.id, month) || { calls: 0, success_calls: 0, failed_calls: 0, response_ms_total: 0, traffic_bytes: 0 }
  const calls = Number(usage.calls)
  res.json({
    images: Number(aggregate.images),
    videos: Number(aggregate.videos),
    files: Number(aggregate.files),
    used: Number(aggregate.used),
    limit: req.user.quota,
    traffic: Number(usage.traffic_bytes),
    apiCalls: calls,
    apiLimit: apiMonthlyLimit,
    apiSuccessRate: calls ? (Number(usage.success_calls) / calls) * 100 : 0,
    apiAverageResponseMs: calls ? Math.round(Number(usage.response_ms_total) / calls) : 0,
  })
})

app.get('/api/analytics/traffic', authenticate, requireSessionAuth, (req, res) => {
  const requestedDays = Number(req.query.days || 30)
  if (!Number.isInteger(requestedDays) || requestedDays < 1 || requestedDays > 365) {
    return res.status(400).json({ message: '统计范围需要是 1 到 365 天的整数' })
  }
  const { start, end } = analyticsDateRange(requestedDays)
  const dailyRows = db.prepare(`
    SELECT
      traffic_date AS date,
      SUM(requests) AS requests,
      SUM(bytes) AS bytes,
      SUM(external_requests) AS external_requests,
      SUM(external_bytes) AS external_bytes,
      SUM(direct_requests) AS direct_requests,
      SUM(direct_bytes) AS direct_bytes,
      SUM(internal_requests) AS internal_requests,
      SUM(internal_bytes) AS internal_bytes,
      SUM(range_requests) AS range_requests
    FROM media_traffic_daily
    WHERE owner_id = ? AND traffic_date BETWEEN ? AND ?
    GROUP BY traffic_date
    ORDER BY traffic_date ASC
  `).all(req.user.id, start, end)
  const dailyByDate = new Map(dailyRows.map((row) => [row.date, row]))
  const daily = Array.from({ length: requestedDays }, (_unused, index) => {
    const date = shiftAnalyticsDate(start, index)
    return dailyByDate.get(date) || {
      date,
      requests: 0,
      bytes: 0,
      external_requests: 0,
      external_bytes: 0,
      direct_requests: 0,
      direct_bytes: 0,
      internal_requests: 0,
      internal_bytes: 0,
      range_requests: 0,
    }
  })
  const topMedia = db.prepare(`
    SELECT
      traffic.media_type AS media_type,
      traffic.media_id AS media_id,
      COALESCE(images.name, videos.name, files.name, '已删除媒体') AS name,
      COALESCE(images.filename, videos.filename, files.filename, '') AS filename,
      SUM(traffic.requests) AS requests,
      SUM(traffic.bytes) AS bytes,
      SUM(traffic.external_requests) AS external_requests,
      SUM(traffic.external_bytes) AS external_bytes,
      SUM(traffic.range_requests) AS range_requests
    FROM media_traffic_daily AS traffic
    LEFT JOIN images ON traffic.media_type = 'image' AND images.id = traffic.media_id
    LEFT JOIN videos ON traffic.media_type = 'video' AND videos.id = traffic.media_id
    LEFT JOIN files ON traffic.media_type = 'file' AND files.id = traffic.media_id
    WHERE traffic.owner_id = ? AND traffic.traffic_date BETWEEN ? AND ?
    GROUP BY traffic.media_type, traffic.media_id
    ORDER BY bytes DESC, external_bytes DESC
    LIMIT 12
  `).all(req.user.id, start, end)
  const referrers = db.prepare(`
    SELECT
      referrer_host AS host,
      SUM(requests) AS requests,
      SUM(bytes) AS bytes,
      COUNT(DISTINCT media_id) AS media_count
    FROM media_referrer_daily
    WHERE owner_id = ? AND traffic_date BETWEEN ? AND ?
    GROUP BY referrer_host
    ORDER BY bytes DESC, requests DESC
    LIMIT 12
  `).all(req.user.id, start, end)
  const summary = daily.reduce((result, row) => ({
    requests: result.requests + Number(row.requests),
    bytes: result.bytes + Number(row.bytes),
    externalRequests: result.externalRequests + Number(row.external_requests),
    externalBytes: result.externalBytes + Number(row.external_bytes),
    directRequests: result.directRequests + Number(row.direct_requests),
    directBytes: result.directBytes + Number(row.direct_bytes),
    internalRequests: result.internalRequests + Number(row.internal_requests),
    internalBytes: result.internalBytes + Number(row.internal_bytes),
    rangeRequests: result.rangeRequests + Number(row.range_requests),
  }), {
    requests: 0,
    bytes: 0,
    externalRequests: 0,
    externalBytes: 0,
    directRequests: 0,
    directBytes: 0,
    internalRequests: 0,
    internalBytes: 0,
    rangeRequests: 0,
  })
  const peakDay = daily.reduce((peak, row) => Number(row.bytes) > Number(peak?.bytes || 0) ? row : peak, null)
  const peakExternalDay = daily.reduce((peak, row) => Number(row.external_bytes) > Number(peak?.external_bytes || 0) ? row : peak, null)
  const activeDays = daily.filter((row) => Number(row.bytes) > 0).length
  const externalActiveDays = daily.filter((row) => Number(row.external_bytes) > 0).length
  res.json({
    timezone: analyticsTimeZone,
    days: requestedDays,
    startDate: start,
    endDate: end,
    summary: {
      ...summary,
      activeDays,
      externalSharePercent: summary.bytes ? Number(((summary.externalBytes / summary.bytes) * 100).toFixed(1)) : 0,
      averageBytes: activeDays ? Math.round(summary.bytes / activeDays) : 0,
      averageExternalBytes: externalActiveDays ? Math.round(summary.externalBytes / externalActiveDays) : 0,
      peakDate: peakDay?.date || null,
      peakBytes: peakDay ? Number(peakDay.bytes) : 0,
      peakExternalDate: peakExternalDay?.date || null,
      peakExternalBytes: peakExternalDay ? Number(peakExternalDay.external_bytes) : 0,
    },
    daily: daily.map((row) => ({
      date: row.date,
      requests: Number(row.requests),
      bytes: Number(row.bytes),
      externalRequests: Number(row.external_requests),
      externalBytes: Number(row.external_bytes),
      directRequests: Number(row.direct_requests),
      directBytes: Number(row.direct_bytes),
      internalRequests: Number(row.internal_requests),
      internalBytes: Number(row.internal_bytes),
      rangeRequests: Number(row.range_requests),
    })),
    topMedia: topMedia.map((row) => ({
      mediaType: row.media_type,
      mediaId: row.media_id,
      name: row.name,
      filename: row.filename,
      requests: Number(row.requests),
      bytes: Number(row.bytes),
      externalRequests: Number(row.external_requests),
      externalBytes: Number(row.external_bytes),
      rangeRequests: Number(row.range_requests),
    })),
    referrers: referrers.map((row) => ({
      host: row.host,
      requests: Number(row.requests),
      bytes: Number(row.bytes),
      mediaCount: Number(row.media_count),
    })),
  })
})

const distDir = path.join(projectRoot, 'dist')
const renderStatusPage = (status, title, message) => `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${status} · PicNest</title><style>html{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f4f6f2;color:#1b2c2a}body{min-height:100vh;margin:0;display:grid;place-items:center;padding:24px}.card{width:min(520px,100%);box-sizing:border-box;background:#fff;border:1px solid #e2e8e3;border-radius:18px;padding:42px;box-shadow:0 18px 50px rgba(32,60,55,.08)}small{color:#e77856;font-weight:700}h1{margin:8px 0 10px;font-size:30px}p{color:#74817e;line-height:1.7}a{display:inline-flex;margin-top:12px;padding:11px 17px;border-radius:10px;background:#163b38;color:#fff;text-decoration:none}</style></head>
<body><main class="card"><small>PicNest · ${status}</small><h1>${title}</h1><p>${message}</p><a href="/">返回首页</a></main></body></html>`

app.use('/api', (_req, res) => res.status(404).json({ message: '接口不存在' }))

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir, { index: false }))
  app.get('/', (_req, res) => res.sendFile(path.join(distDir, 'index.html')))
}

app.use((_req, res) => res.status(404).type('html').send(renderStatusPage(404, '页面不存在', '你访问的地址不存在、已移动或已经被删除。')))

app.use((error, req, res, _next) => {
  cleanupPendingFiles(req.files)
  if (error?.type === 'entity.too.large') return res.status(413).json({ message: '请求内容不能超过 1 MB' })
  if (error instanceof SyntaxError && error?.status === 400 && Object.hasOwn(error, 'body')) return res.status(400).json({ message: 'JSON 请求内容格式错误' })
  if (error instanceof multer.MulterError) {
    const uploadKind = req.path.startsWith('/api/videos')
      ? '视频'
      : req.path.startsWith('/api/files')
        ? '文件'
        : '图片'
    const limit = req.path.startsWith('/api/public/')
      ? '10MB'
      : req.path.startsWith('/api/videos')
        ? `${Math.round(videoMaxBytes / 1024 / 1024)}MB`
        : req.path.startsWith('/api/files')
          ? `${Math.round(fileMaxBytes / 1024 / 1024)}MB`
          : '20MB'
    const tooLarge = ['LIMIT_FILE_SIZE', 'LIMIT_FILE_COUNT'].includes(error.code)
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? `单个${uploadKind}不能超过 ${limit}`
      : error.code === 'LIMIT_FILE_COUNT'
        ? `单次上传${uploadKind}数量超过限制`
        : '上传请求格式不正确'
    return res.status(tooLarge ? 413 : 400).json({ message })
  }
  if (error instanceof ImageProcessingError) return res.status(error.status).json({ message: error.message })
  if (error instanceof StorageManagerError) return res.status(error.status).json({ message: error.message })
  const remoteStorageFailure = Boolean(error?.$metadata)
    || ['AbortError', 'TimeoutError'].includes(error?.name)
    || (error instanceof TypeError && (req.path.startsWith('/api/storage/') || req.path.includes('/images') || req.path.includes('/videos') || req.path.includes('/files')))
  if (remoteStorageFailure) {
    console.error(error)
    return res.status(502).json({ message: '远程存储操作失败，请检查地址、区域、Bucket、网络和访问密钥' })
  }
  console.error(error)
  if (req.path.startsWith('/api/') || req.path.startsWith('/media/')) return res.status(500).json({ message: '服务暂时不可用' })
  res.status(500).type('html').send(renderStatusPage(500, '服务暂时不可用', '服务器处理请求时出现异常，请稍后重试。'))
})

const port = Number(process.env.PORT || 18765)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是 1 到 65535 之间的整数')
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`PicNest server running at http://127.0.0.1:${port} (${path.basename(databaseFile)})`)
})

let shuttingDown = false
const shutdown = () => {
  if (shuttingDown) return
  shuttingDown = true
  server.close(() => {
    db.close()
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 10000).unref()
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

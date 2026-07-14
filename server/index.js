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

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const uploadsDir = path.join(__dirname, 'uploads')
const dataDir = path.join(__dirname, 'data')
const seedFile = path.join(dataDir, 'images.json')
const databaseFile = path.resolve(process.env.PICNEST_DB_PATH || path.join(dataDir, 'picnest.db'))
const secretFile = path.join(dataDir, '.session-secret')

fs.mkdirSync(uploadsDir, { recursive: true })
fs.mkdirSync(dataDir, { recursive: true })

const sessionSecret = process.env.PICNEST_SESSION_SECRET || (() => {
  if (fs.existsSync(secretFile)) return fs.readFileSync(secretFile, 'utf8').trim()
  const value = crypto.randomBytes(48).toString('hex')
  fs.writeFileSync(secretFile, value, { encoding: 'utf8', mode: 0o600 })
  return value
})()

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
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    filename TEXT,
    url TEXT NOT NULL,
    type TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    width INTEGER,
    height INTEGER,
    album TEXT NOT NULL DEFAULT '未分类',
    starred INTEGER NOT NULL DEFAULT 0,
    views INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_images_owner_created ON images(owner_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS albums (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(owner_id, name)
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`)

const imageColumns = db.prepare('PRAGMA table_info(images)').all()
if (!imageColumns.some((column) => column.name === 'guest_uploaded')) {
  db.exec('ALTER TABLE images ADD COLUMN guest_uploaded INTEGER NOT NULL DEFAULT 0')
}
db.prepare('INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)')
  .run('guest_upload_enabled', 'false', new Date().toISOString())

const mapUser = (row) => row ? ({
  id: row.id,
  name: row.name,
  email: row.email,
  role: row.role,
  quota: Number(row.quota),
  createdAt: row.created_at,
}) : null

const mapImage = (row) => ({
  id: row.id,
  name: row.name,
  filename: row.filename || undefined,
  url: row.url,
  type: row.type,
  mimeType: row.mime_type,
  size: Number(row.size),
  width: row.width === null ? null : Number(row.width),
  height: row.height === null ? null : Number(row.height),
  album: row.album,
  starred: Boolean(row.starred),
  views: Number(row.views),
  guestUploaded: Boolean(row.guest_uploaded),
  createdAt: row.created_at,
})

const hashApiKey = (value) => crypto.createHash('sha256').update(value).digest('hex')
const safeEmail = (value) => String(value || '').trim().toLowerCase()

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
      SELECT users.* FROM api_keys
      JOIN users ON users.id = api_keys.user_id
      WHERE api_keys.key_hash = ?
    `).get(hashApiKey(bearer))
    if (apiKey) {
      db.prepare('UPDATE api_keys SET last_used_at = ? WHERE key_hash = ?').run(new Date().toISOString(), hashApiKey(bearer))
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
  const user = resolveUser(req)
  if (!user) return res.status(401).json({ message: '请先登录' })
  req.user = user
  next()
}

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: '仅管理员可以执行此操作' })
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

const createUser = ({ name, email, password, role }) => {
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  const passwordHash = bcrypt.hashSync(password, 12)
  const quota = role === 'admin' ? 10 * 1024 ** 3 : 5 * 1024 ** 3
  db.prepare('INSERT INTO users (id, name, email, password_hash, role, quota, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, name.trim(), safeEmail(email), passwordHash, role, quota, createdAt)
  return mapUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id))
}

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const userDir = path.join(uploadsDir, req.user.id)
    fs.mkdirSync(userDir, { recursive: true })
    cb(null, userDir)
  },
  filename: (_req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase()
    const stem = path.basename(file.originalname, extension)
      .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '-')
      .slice(0, 48)
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${stem || 'image'}${extension}`)
  }
})

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype.startsWith('image/'))
})

const guestUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
    if (!allowed.has(file.mimetype)) return cb(new Error('游客上传仅支持 JPG、PNG、GIF 和 WebP'))
    cb(null, true)
  }
})

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

app.get('/api/public/config', (_req, res) => {
  const enabled = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('guest_upload_enabled')?.value === 'true'
  res.json({ guestUploadEnabled: enabled, maxFileSize: 10 * 1024 * 1024, maxFiles: 5 })
})

app.post('/api/public/images', allowGuestUpload, limitGuestUploads, guestUpload.array('files', 5), (req, res) => {
  const used = db.prepare('SELECT COALESCE(SUM(size), 0) AS used FROM images WHERE owner_id = ?').get(req.user.id).used
  const incoming = (req.files || []).reduce((sum, file) => sum + file.size, 0)
  if (!req.files?.length) return res.status(400).json({ message: '请选择需要上传的图片' })
  if (used + incoming > req.user.quota) {
    for (const file of req.files || []) fs.unlinkSync(file.path)
    return res.status(413).json({ message: '公共上传空间已满' })
  }
  const album = '游客上传'
  const insert = db.prepare(`
    INSERT INTO images (id, owner_id, name, filename, url, type, mime_type, size, width, height, album, starred, views, guest_uploaded, created_at)
    VALUES (@id, @ownerId, @name, @filename, @url, @type, @mimeType, @size, NULL, NULL, @album, 0, 0, 1, @createdAt)
  `)
  const created = []
  const transaction = db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO albums (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)')
      .run(crypto.randomUUID(), req.user.id, album, new Date().toISOString())
    for (const file of req.files || []) {
      const image = {
        id: crypto.randomUUID(),
        ownerId: req.user.id,
        name: file.originalname,
        filename: file.filename,
        url: `/uploads/${req.user.id}/${encodeURIComponent(file.filename)}`,
        type: path.extname(file.originalname).replace('.', '').toUpperCase() || 'IMAGE',
        mimeType: file.mimetype,
        size: file.size,
        album,
        createdAt: new Date().toISOString(),
      }
      insert.run(image)
      created.push(mapImage(db.prepare('SELECT * FROM images WHERE id = ?').get(image.id)))
    }
  })
  transaction()
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
  if (name.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return res.status(400).json({ message: '请完整填写昵称、邮箱和至少 8 位密码' })
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(409).json({ message: '该邮箱已经存在' })
  const user = createUser({ name, email, password, role })
  res.status(201).json({ ...user, imageCount: 0, storageUsed: 0 })
})

app.patch('/api/users/:id', authenticate, requireAdmin, (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ message: '不能修改自己的管理员角色' })
  const role = req.body.role === 'admin' ? 'admin' : 'member'
  const result = db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id)
  if (!result.changes) return res.status(404).json({ message: '用户不存在' })
  res.json(mapUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)))
})

app.get('/api/images', authenticate, (req, res) => {
  const images = db.prepare('SELECT * FROM images WHERE owner_id = ? ORDER BY created_at DESC').all(req.user.id)
  res.json(images.map(mapImage))
})

app.post('/api/images', authenticate, upload.array('files', 20), (req, res) => {
  const album = String(req.body.album || '未分类').trim() || '未分类'
  const used = db.prepare('SELECT COALESCE(SUM(size), 0) AS used FROM images WHERE owner_id = ?').get(req.user.id).used
  const incoming = (req.files || []).reduce((sum, file) => sum + file.size, 0)
  if (used + incoming > req.user.quota) {
    for (const file of req.files || []) fs.unlinkSync(file.path)
    return res.status(413).json({ message: '存储配额不足，请清理空间后重试' })
  }
  const insert = db.prepare(`
    INSERT INTO images (id, owner_id, name, filename, url, type, mime_type, size, width, height, album, starred, views, created_at)
    VALUES (@id, @ownerId, @name, @filename, @url, @type, @mimeType, @size, NULL, NULL, @album, 0, 0, @createdAt)
  `)
  const created = []
  const transaction = db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO albums (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)')
      .run(crypto.randomUUID(), req.user.id, album, new Date().toISOString())
    for (const file of req.files || []) {
      const image = {
        id: crypto.randomUUID(),
        ownerId: req.user.id,
        name: file.originalname,
        filename: file.filename,
        url: `/uploads/${req.user.id}/${encodeURIComponent(file.filename)}`,
        type: path.extname(file.originalname).replace('.', '').toUpperCase() || 'IMAGE',
        mimeType: file.mimetype,
        size: file.size,
        album,
        createdAt: new Date().toISOString(),
      }
      insert.run(image)
      created.push(mapImage(db.prepare('SELECT * FROM images WHERE id = ?').get(image.id)))
    }
  })
  transaction()
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
  res.json(mapImage(db.prepare('SELECT * FROM images WHERE id = ?').get(req.params.id)))
})

const removeOwnedImage = (image, userId) => {
  if (image.filename) {
    const target = path.join(uploadsDir, userId, image.filename)
    if (fs.existsSync(target)) fs.unlinkSync(target)
  }
  db.prepare('DELETE FROM images WHERE id = ? AND owner_id = ?').run(image.id, userId)
}

app.delete('/api/images/:id', authenticate, (req, res) => {
  const image = db.prepare('SELECT * FROM images WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id)
  if (!image) return res.status(404).json({ message: '图片不存在' })
  removeOwnedImage(image, req.user.id)
  res.status(204).end()
})

app.post('/api/images/bulk-delete', authenticate, (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : []
  const owned = db.prepare('SELECT * FROM images WHERE owner_id = ?').all(req.user.id).filter((image) => ids.includes(image.id))
  const transaction = db.transaction(() => owned.forEach((image) => removeOwnedImage(image, req.user.id)))
  transaction()
  res.json({ deleted: owned.length })
})

app.get('/api/albums', authenticate, (req, res) => {
  const rows = db.prepare(`
    SELECT albums.id, albums.name, albums.created_at,
      COUNT(images.id) AS image_count, COALESCE(SUM(images.size), 0) AS storage_used,
      (SELECT url FROM images cover WHERE cover.owner_id = albums.owner_id AND cover.album = albums.name ORDER BY cover.created_at DESC LIMIT 1) AS cover
    FROM albums LEFT JOIN images ON images.owner_id = albums.owner_id AND images.album = albums.name
    WHERE albums.owner_id = ? GROUP BY albums.id ORDER BY albums.created_at ASC
  `).all(req.user.id)
  res.json(rows.map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at, imageCount: Number(row.image_count), storageUsed: Number(row.storage_used), cover: row.cover })))
})

app.post('/api/albums', authenticate, (req, res) => {
  const name = String(req.body.name || '').trim()
  if (!name) return res.status(400).json({ message: '请输入相册名称' })
  try {
    const album = { id: crypto.randomUUID(), name, createdAt: new Date().toISOString() }
    db.prepare('INSERT INTO albums (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)').run(album.id, req.user.id, name, album.createdAt)
    res.status(201).json({ ...album, imageCount: 0, storageUsed: 0, cover: null })
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return res.status(409).json({ message: '相册名称已经存在' })
    throw error
  }
})

app.get('/api/api-keys', authenticate, (req, res) => {
  const rows = db.prepare('SELECT id, label, key_prefix, created_at, last_used_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id)
  res.json(rows.map((row) => ({ id: row.id, label: row.label, prefix: row.key_prefix, createdAt: row.created_at, lastUsedAt: row.last_used_at })))
})

app.post('/api/api-keys', authenticate, (req, res) => {
  const secret = `pn_live_${crypto.randomBytes(18).toString('base64url')}`
  const item = { id: crypto.randomUUID(), label: String(req.body.label || '生产环境密钥').trim(), prefix: `${secret.slice(0, 15)}••••••••`, createdAt: new Date().toISOString() }
  db.prepare('INSERT INTO api_keys (id, user_id, label, key_hash, key_prefix, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(item.id, req.user.id, item.label, hashApiKey(secret), item.prefix, item.createdAt)
  res.status(201).json({ ...item, secret })
})

app.delete('/api/api-keys/:id', authenticate, (req, res) => {
  db.prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id)
  res.status(204).end()
})

app.get('/api/stats', authenticate, (req, res) => {
  const aggregate = db.prepare('SELECT COUNT(*) AS images, COALESCE(SUM(size), 0) AS used FROM images WHERE owner_id = ?').get(req.user.id)
  res.json({
    images: Number(aggregate.images),
    used: Number(aggregate.used),
    limit: req.user.quota,
    traffic: 2.84 * 1024 ** 3,
    apiCalls: 12840,
  })
})

const distDir = path.join(projectRoot, 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get('*splat', (_req, res) => res.sendFile(path.join(distDir, 'index.html')))
}

app.use((error, req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const limit = req.path.startsWith('/api/public/') ? '10MB' : '20MB'
    return res.status(400).json({ message: error.code === 'LIMIT_FILE_SIZE' ? `单张图片不能超过 ${limit}` : error.message })
  }
  if (String(error.message).startsWith('游客上传')) return res.status(400).json({ message: error.message })
  console.error(error)
  res.status(500).json({ message: '服务暂时不可用' })
})

const port = Number(process.env.PORT || 18765)
app.listen(port, '127.0.0.1', () => {
  console.log(`PicNest server running at http://127.0.0.1:${port} (${path.basename(databaseFile)})`)
})

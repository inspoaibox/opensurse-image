import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const availablePort = () => new Promise((resolve, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    server.close(() => resolve(address.port))
  })
})

const waitForServer = async (baseUrl, processOutput) => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) return
    } catch {
      // The child process may still be starting.
    }
    if (processOutput.exited) throw new Error(`PicNest 提前退出：${processOutput.stderr}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`PicNest 启动超时：${processOutput.stderr}`)
}

const requestJson = async (url, options = {}) => {
  const response = await fetch(url, options)
  const text = await response.text()
  let body = null
  if (text) {
    try { body = JSON.parse(text) } catch { body = text }
  }
  return { response, body }
}

test('核心 API、权限隔离、上传和异常路由可用', async (context) => {
  const adminPassword = `A!${crypto.randomBytes(18).toString('base64url')}`
  const memberPassword = `M!${crypto.randomBytes(18).toString('base64url')}`
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'picnest-test-'))
  const port = await availablePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const processOutput = { stdout: '', stderr: '', exited: false }
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: workspace,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      PICNEST_DB_PATH: path.join(tempDirectory, 'picnest.db'),
      PICNEST_SESSION_SECRET: crypto.randomBytes(48).toString('hex'),
      PICNEST_STORAGE_SECRET: crypto.randomBytes(48).toString('hex'),
      COOKIE_SECURE: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => { processOutput.stdout += chunk })
  child.stderr.on('data', (chunk) => { processOutput.stderr += chunk })
  child.once('exit', () => { processOutput.exited = true })

  let memberId = ''
  context.after(async () => {
    if (!processOutput.exited) child.kill('SIGTERM')
    await new Promise((resolve) => {
      if (processOutput.exited) return resolve()
      child.once('exit', resolve)
      setTimeout(resolve, 3000)
    })
    if (memberId) await fs.rm(path.join(workspace, 'server', 'uploads', memberId), { recursive: true, force: true })
    await fs.rm(tempDirectory, { recursive: true, force: true })
  })

  await waitForServer(baseUrl, processOutput)

  const health = await fetch(`${baseUrl}/api/health`)
  assert.equal(health.status, 200)
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff')
  assert.match(health.headers.get('content-security-policy') || '', /default-src 'self'/)

  const malformedJson = await requestJson(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"email":',
  })
  assert.equal(malformedJson.response.status, 400)
  assert.equal(malformedJson.body.message, 'JSON 请求内容格式错误')

  const registration = await requestJson(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '测试管理员', email: 'admin@example.test', password: adminPassword }),
  })
  assert.equal(registration.response.status, 201)
  const adminCookie = registration.response.headers.get('set-cookie').split(';', 1)[0]

  const emptyImages = await requestJson(`${baseUrl}/api/images`, { headers: { Cookie: adminCookie } })
  assert.equal(emptyImages.response.status, 200)
  assert.deepEqual(emptyImages.body, [])

  const secondRegistration = await requestJson(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '第二管理员', email: 'second@example.test', password: adminPassword }),
  })
  assert.equal(secondRegistration.response.status, 403)

  const createdMember = await requestJson(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ name: '测试成员', email: 'member@example.test', password: memberPassword, role: 'member', quota: 1024 ** 3, storageProviderId: null }),
  })
  assert.equal(createdMember.response.status, 201)
  memberId = createdMember.body.id

  const adminApiKey = await requestJson(`${baseUrl}/api/api-keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ label: '管理员自动化' }),
  })
  assert.equal(adminApiKey.response.status, 201)
  const adminBearerUsers = await requestJson(`${baseUrl}/api/users`, { headers: { Authorization: `Bearer ${adminApiKey.body.secret}` } })
  assert.equal(adminBearerUsers.response.status, 403)
  const adminBearerSettings = await requestJson(`${baseUrl}/api/settings/guest-upload`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminApiKey.body.secret}` },
    body: JSON.stringify({ enabled: true }),
  })
  assert.equal(adminBearerSettings.response.status, 403)

  const invalidRole = await requestJson(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ name: '角色错误', email: 'role@example.test', password: memberPassword, role: 'owner' }),
  })
  assert.equal(invalidRole.response.status, 400)

  const memberLogin = await requestJson(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'member@example.test', password: memberPassword }),
  })
  assert.equal(memberLogin.response.status, 200)
  const memberCookie = memberLogin.response.headers.get('set-cookie').split(';', 1)[0]

  const forbiddenUsers = await requestJson(`${baseUrl}/api/users`, { headers: { Cookie: memberCookie } })
  assert.equal(forbiddenUsers.response.status, 403)

  const csrfRejected = await requestJson(`${baseUrl}/api/albums`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: memberCookie, Origin: 'https://evil.example' },
    body: JSON.stringify({ name: '跨站相册' }),
  })
  assert.equal(csrfRejected.response.status, 403)

  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#e77856' } }).png().toBuffer()
  const form = new FormData()
  form.append('files', new Blob([png], { type: 'image/png' }), '中文图片.png')
  const upload = await requestJson(`${baseUrl}/api/images`, { method: 'POST', headers: { Cookie: memberCookie }, body: form })
  assert.equal(upload.response.status, 201)
  assert.equal(upload.body.length, 1)
  const image = upload.body[0]
  assert.equal(image.name, '中文图片.png')
  assert.equal(image.format, 'png')
  assert.match(image.links.markdown, /中文图片\.png/)

  const media = await fetch(image.url)
  assert.equal(media.status, 200)
  assert.equal(media.headers.get('content-type'), 'image/png')
  assert.match(media.headers.get('content-security-policy') || '', /sandbox/)
  assert.equal(media.headers.get('cross-origin-resource-policy'), 'cross-origin')
  assert.deepEqual(Buffer.from(await media.arrayBuffer()), png)

  const crossOwnerRead = await requestJson(`${baseUrl}/api/images/${image.id}`, { headers: { Cookie: adminCookie } })
  assert.equal(crossOwnerRead.response.status, 404)

  const apiKey = await requestJson(`${baseUrl}/api/api-keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: memberCookie },
    body: JSON.stringify({ label: '集成测试' }),
  })
  assert.equal(apiKey.response.status, 201)
  assert.match(apiKey.body.secret, /^pn_live_/)

  const bearerImages = await requestJson(`${baseUrl}/api/images`, { headers: { Authorization: `Bearer ${apiKey.body.secret}` } })
  assert.equal(bearerImages.response.status, 200)
  assert.equal(bearerImages.body.length, 1)
  const bearerKeyManagement = await requestJson(`${baseUrl}/api/api-keys`, { headers: { Authorization: `Bearer ${apiKey.body.secret}` } })
  assert.equal(bearerKeyManagement.response.status, 403)
  const bearerStorage = await requestJson(`${baseUrl}/api/storage/providers`, { headers: { Authorization: `Bearer ${apiKey.body.secret}` } })
  assert.equal(bearerStorage.response.status, 403)

  const missingApi = await requestJson(`${baseUrl}/api/not-a-real-route`)
  assert.equal(missingApi.response.status, 404)
  assert.equal(missingApi.body.message, '接口不存在')
  const missingPage = await fetch(`${baseUrl}/not-a-real-page`)
  assert.equal(missingPage.status, 404)
  assert.match(await missingPage.text(), /页面不存在/)

  const deletion = await fetch(`${baseUrl}/api/images/${image.id}`, { method: 'DELETE', headers: { Cookie: memberCookie } })
  assert.equal(deletion.status, 204)
})

test('旧版 SQLite 结构会在启动时自动迁移', async (context) => {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'picnest-migration-'))
  const databasePath = path.join(tempDirectory, 'legacy.db')
  const legacy = new Database(databasePath)
  legacy.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL, quota INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE images (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, filename TEXT, url TEXT NOT NULL, type TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL, width INTEGER, height INTEGER, album TEXT NOT NULL, starred INTEGER NOT NULL, views INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE albums (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(owner_id, name));
    CREATE TABLE api_keys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, label TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, key_prefix TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT);
    INSERT INTO users VALUES ('legacy-user', '旧版用户', 'legacy@example.test', 'unused', 'admin', 1073741824, '2025-01-01T00:00:00.000Z');
    INSERT INTO albums VALUES ('legacy-album', 'legacy-user', '未分类', '2025-01-01T00:00:00.000Z');
  `)
  legacy.close()

  const port = await availablePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const processOutput = { stdout: '', stderr: '', exited: false }
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: workspace,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      PICNEST_DB_PATH: databasePath,
      PICNEST_SESSION_SECRET: crypto.randomBytes(48).toString('hex'),
      PICNEST_STORAGE_SECRET: crypto.randomBytes(48).toString('hex'),
      COOKIE_SECURE: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => { processOutput.stdout += chunk })
  child.stderr.on('data', (chunk) => { processOutput.stderr += chunk })
  child.once('exit', () => { processOutput.exited = true })
  context.after(async () => {
    if (!processOutput.exited) child.kill('SIGTERM')
    await new Promise((resolve) => setTimeout(resolve, 300))
    await fs.rm(tempDirectory, { recursive: true, force: true })
  })

  await waitForServer(baseUrl, processOutput)
  child.kill('SIGTERM')
  await new Promise((resolve) => child.once('exit', resolve))

  const migrated = new Database(databasePath, { readonly: true })
  const columnNames = (table) => migrated.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name)
  assert.equal(columnNames('users').includes('storage_provider_id'), true)
  for (const column of ['guest_uploaded', 'storage_provider_id', 'storage_key', 'exif_json', 'processing_json']) assert.equal(columnNames('images').includes(column), true)
  assert.equal(columnNames('albums').includes('is_default'), true)
  assert.equal(columnNames('api_keys').includes('secret_encrypted'), true)
  assert.equal(migrated.prepare('SELECT is_default FROM albums WHERE id = ?').get('legacy-album').is_default, 1)
  migrated.close()
})

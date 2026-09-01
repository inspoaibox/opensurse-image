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

  const statsBeforeVideo = await requestJson(`${baseUrl}/api/stats`, { headers: { Cookie: memberCookie } })
  assert.equal(statsBeforeVideo.response.status, 200)
  assert.equal(statsBeforeVideo.body.images, 1)
  assert.equal(statsBeforeVideo.body.videos, 0)

  const videoBytes = Buffer.from('PICNEST VIDEO RANGE TEST CONTENT')
  const videoForm = new FormData()
  videoForm.append('files', new Blob([videoBytes], { type: 'video/mp4' }), '演示视频.mp4')
  const videoUpload = await requestJson(`${baseUrl}/api/videos`, { method: 'POST', headers: { Cookie: memberCookie }, body: videoForm })
  assert.equal(videoUpload.response.status, 201)
  assert.equal(videoUpload.body.length, 1)
  const video = videoUpload.body[0]
  assert.equal(video.name, '演示视频.mp4')
  assert.equal(video.filename, '演示视频.mp4')
  assert.equal(video.type, 'MP4')
  assert.equal(video.format, 'mp4')
  assert.equal(video.extension, '.mp4')
  assert.equal(video.mimeType, 'video/mp4')
  assert.equal(video.size, videoBytes.length)
  assert.match(video.url, /\/media\/video\/[^/]+\/.+\.mp4$/)
  assert.equal(video.links.html.includes('<video controls'), true)

  const initialVideoCategories = await requestJson(`${baseUrl}/api/video-categories`, { headers: { Cookie: memberCookie } })
  assert.equal(initialVideoCategories.response.status, 200)
  assert.equal(initialVideoCategories.body.length, 1)
  assert.equal(initialVideoCategories.body[0].name, '视频')
  assert.equal(initialVideoCategories.body[0].isDefault, true)
  assert.equal(initialVideoCategories.body[0].videoCount, 1)

  const createdVideoCategory = await requestJson(`${baseUrl}/api/video-categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: memberCookie },
    body: JSON.stringify({ name: '产品演示' }),
  })
  assert.equal(createdVideoCategory.response.status, 201)
  assert.equal(createdVideoCategory.body.name, '产品演示')
  assert.equal(createdVideoCategory.body.isDefault, false)

  const duplicateVideoCategory = await requestJson(`${baseUrl}/api/video-categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: memberCookie },
    body: JSON.stringify({ name: '产品演示' }),
  })
  assert.equal(duplicateVideoCategory.response.status, 409)

  const categorizedVideoForm = new FormData()
  categorizedVideoForm.append('files', new Blob([videoBytes], { type: 'video/mp4' }), '分类视频.mp4')
  categorizedVideoForm.append('category', '产品演示')
  const categorizedVideoUpload = await requestJson(`${baseUrl}/api/videos`, { method: 'POST', headers: { Cookie: memberCookie }, body: categorizedVideoForm })
  assert.equal(categorizedVideoUpload.response.status, 201)
  const categorizedVideo = categorizedVideoUpload.body[0]
  assert.equal(categorizedVideo.category, '产品演示')

  const defaultVideoCategory = await requestJson(`${baseUrl}/api/video-categories/${createdVideoCategory.body.id}/default`, {
    method: 'PATCH',
    headers: { Cookie: memberCookie },
  })
  assert.equal(defaultVideoCategory.response.status, 200)
  assert.equal(defaultVideoCategory.body.isDefault, true)

  const defaultCategorizedVideoForm = new FormData()
  defaultCategorizedVideoForm.append('files', new Blob([videoBytes], { type: 'video/mp4' }), '默认分类视频.mp4')
  const defaultCategorizedVideoUpload = await requestJson(`${baseUrl}/api/videos`, { method: 'POST', headers: { Cookie: memberCookie }, body: defaultCategorizedVideoForm })
  assert.equal(defaultCategorizedVideoUpload.response.status, 201)
  const defaultCategorizedVideo = defaultCategorizedVideoUpload.body[0]
  assert.equal(defaultCategorizedVideo.category, '产品演示')

  const movedVideo = await requestJson(`${baseUrl}/api/videos/${video.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: memberCookie },
    body: JSON.stringify({ category: '产品演示' }),
  })
  assert.equal(movedVideo.response.status, 200)
  assert.equal(movedVideo.body.category, '产品演示')

  const categorizedVideoList = await requestJson(`${baseUrl}/api/video-categories`, { headers: { Cookie: memberCookie } })
  assert.equal(categorizedVideoList.response.status, 200)
  const productCategory = categorizedVideoList.body.find((category) => category.name === '产品演示')
  const legacyVideoCategory = categorizedVideoList.body.find((category) => category.name === '视频')
  assert.equal(productCategory.isDefault, true)
  assert.equal(productCategory.videoCount, 3)
  assert.equal(productCategory.storageUsed, videoBytes.length * 3)
  assert.equal(legacyVideoCategory.videoCount, 0)

  for (const categorized of [categorizedVideo, defaultCategorizedVideo]) {
    const categorizedDeletion = await fetch(`${baseUrl}/api/videos/${categorized.id}`, { method: 'DELETE', headers: { Cookie: memberCookie } })
    assert.equal(categorizedDeletion.status, 204)
  }

  const imageDirectory = path.join(tempDirectory, 'media-images')
  const videoDirectory = path.join(tempDirectory, 'media-videos')
  const localStorageUpdate = await requestJson(`${baseUrl}/api/storage/providers/local`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({
      name: '本地文件系统',
      config: { imagePathPrefix: imageDirectory, videoPathPrefix: videoDirectory },
    }),
  })
  assert.equal(localStorageUpdate.response.status, 200)
  assert.equal(localStorageUpdate.body.config.imagePathPrefix, path.normalize(imageDirectory))
  assert.equal(localStorageUpdate.body.config.videoPathPrefix, path.normalize(videoDirectory))

  const oldImageAfterStorageUpdate = await fetch(image.url)
  assert.equal(oldImageAfterStorageUpdate.status, 200)
  assert.deepEqual(Buffer.from(await oldImageAfterStorageUpdate.arrayBuffer()), png)
  const oldVideoAfterStorageUpdate = await fetch(video.url)
  assert.equal(oldVideoAfterStorageUpdate.status, 200)
  assert.deepEqual(Buffer.from(await oldVideoAfterStorageUpdate.arrayBuffer()), videoBytes)

  const videoList = await requestJson(`${baseUrl}/api/videos`, { headers: { Cookie: memberCookie } })
  assert.equal(videoList.response.status, 200)
  assert.equal(videoList.body.length, 1)
  assert.equal(videoList.body[0].id, video.id)

  const videoDetail = await requestJson(`${baseUrl}/api/videos/${video.id}`, { headers: { Cookie: memberCookie } })
  assert.equal(videoDetail.response.status, 200)
  assert.equal(videoDetail.body.id, video.id)

  const adminVideoList = await requestJson(`${baseUrl}/api/videos`, { headers: { Cookie: adminCookie } })
  assert.equal(adminVideoList.response.status, 200)
  assert.deepEqual(adminVideoList.body, [])
  const crossOwnerVideoRead = await requestJson(`${baseUrl}/api/videos/${video.id}`, { headers: { Cookie: adminCookie } })
  assert.equal(crossOwnerVideoRead.response.status, 404)
  const crossOwnerVideoCategory = await requestJson(`${baseUrl}/api/video-categories/${createdVideoCategory.body.id}/default`, {
    method: 'PATCH',
    headers: { Cookie: adminCookie },
  })
  assert.equal(crossOwnerVideoCategory.response.status, 404)

  const videoMedia = await fetch(video.url)
  assert.equal(videoMedia.status, 200)
  assert.equal(videoMedia.headers.get('content-type'), 'video/mp4')
  assert.equal(videoMedia.headers.get('accept-ranges'), 'bytes')
  assert.equal(videoMedia.headers.get('content-length'), String(videoBytes.length))
  assert.deepEqual(Buffer.from(await videoMedia.arrayBuffer()), videoBytes)

  const videoRange = await fetch(video.url, { headers: { Range: 'bytes=1-4' } })
  assert.equal(videoRange.status, 206)
  assert.equal(videoRange.headers.get('content-range'), `bytes 1-4/${videoBytes.length}`)
  assert.equal(videoRange.headers.get('content-length'), '4')
  assert.deepEqual(Buffer.from(await videoRange.arrayBuffer()), videoBytes.subarray(1, 5))

  const invalidVideoRange = await fetch(video.url, { headers: { Range: `bytes=${videoBytes.length}-` } })
  assert.equal(invalidVideoRange.status, 416)
  assert.equal(invalidVideoRange.headers.get('accept-ranges'), 'bytes')
  assert.equal(invalidVideoRange.headers.get('content-range'), `bytes */${videoBytes.length}`)

  const invalidVideoForm = new FormData()
  invalidVideoForm.append('files', new Blob([videoBytes], { type: 'video/mp4' }), 'not-a-video.txt')
  const invalidVideoUpload = await requestJson(`${baseUrl}/api/videos`, { method: 'POST', headers: { Cookie: memberCookie }, body: invalidVideoForm })
  assert.equal(invalidVideoUpload.response.status, 400)

  const renamedVideo = await requestJson(`${baseUrl}/api/videos/${video.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: memberCookie },
    body: JSON.stringify({ name: '改名.webm', starred: true }),
  })
  assert.equal(renamedVideo.response.status, 200)
  assert.equal(renamedVideo.body.filename, '改名.mp4')
  assert.match(renamedVideo.body.url, /\.mp4$/)
  assert.equal(renamedVideo.body.starred, true)

  const statsAfterVideo = await requestJson(`${baseUrl}/api/stats`, { headers: { Cookie: memberCookie } })
  assert.equal(statsAfterVideo.response.status, 200)
  assert.equal(statsAfterVideo.body.images, 1)
  assert.equal(statsAfterVideo.body.videos, 1)
  assert.equal(statsAfterVideo.body.used, statsBeforeVideo.body.used + videoBytes.length)

  const videoDeletion = await fetch(`${baseUrl}/api/videos/${video.id}`, { method: 'DELETE', headers: { Cookie: memberCookie } })
  assert.equal(videoDeletion.status, 204)
  const deletedVideoMedia = await fetch(video.url)
  assert.equal(deletedVideoMedia.status, 404)
  const statsAfterVideoDeletion = await requestJson(`${baseUrl}/api/stats`, { headers: { Cookie: memberCookie } })
  assert.equal(statsAfterVideoDeletion.body.videos, 0)
  assert.equal(statsAfterVideoDeletion.body.used, statsBeforeVideo.body.used)

  const separatedImageForm = new FormData()
  separatedImageForm.append('files', new Blob([png], { type: 'image/png' }), '分目录图片.png')
  const separatedImageUpload = await requestJson(`${baseUrl}/api/images`, { method: 'POST', headers: { Cookie: memberCookie }, body: separatedImageForm })
  assert.equal(separatedImageUpload.response.status, 201)
  const separatedImage = separatedImageUpload.body[0]
  const separatedImageFiles = await fs.readdir(path.join(imageDirectory, memberId))
  assert.equal(separatedImageFiles.length, 1)
  assert.deepEqual(await fs.readFile(path.join(imageDirectory, memberId, separatedImageFiles[0])), png)

  const separatedVideoForm = new FormData()
  separatedVideoForm.append('files', new Blob([videoBytes], { type: 'video/mp4' }), '分目录视频.mp4')
  const separatedVideoUpload = await requestJson(`${baseUrl}/api/videos`, { method: 'POST', headers: { Cookie: memberCookie }, body: separatedVideoForm })
  assert.equal(separatedVideoUpload.response.status, 201)
  const separatedVideo = separatedVideoUpload.body[0]
  const separatedVideoFiles = await fs.readdir(path.join(videoDirectory, memberId))
  assert.equal(separatedVideoFiles.length, 1)
  assert.deepEqual(await fs.readFile(path.join(videoDirectory, memberId, separatedVideoFiles[0])), videoBytes)
  assert.notEqual(path.resolve(imageDirectory), path.resolve(videoDirectory))

  const separatedImageDeletion = await fetch(`${baseUrl}/api/images/${separatedImage.id}`, { method: 'DELETE', headers: { Cookie: memberCookie } })
  assert.equal(separatedImageDeletion.status, 204)
  const separatedVideoDeletion = await fetch(`${baseUrl}/api/videos/${separatedVideo.id}`, { method: 'DELETE', headers: { Cookie: memberCookie } })
  assert.equal(separatedVideoDeletion.status, 204)

  const legacyDirectory = path.join(tempDirectory, 'legacy-media')
  const legacyStorageUpdate = await requestJson(`${baseUrl}/api/storage/providers/local`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ config: { pathPrefix: legacyDirectory } }),
  })
  assert.equal(legacyStorageUpdate.response.status, 200)
  assert.equal(legacyStorageUpdate.body.config.imagePathPrefix, path.normalize(legacyDirectory))
  assert.equal(legacyStorageUpdate.body.config.videoPathPrefix, path.normalize(legacyDirectory))

  const legacyImageForm = new FormData()
  legacyImageForm.append('files', new Blob([png], { type: 'image/png' }), '旧前缀兼容.png')
  const legacyImageUpload = await requestJson(`${baseUrl}/api/images`, { method: 'POST', headers: { Cookie: memberCookie }, body: legacyImageForm })
  assert.equal(legacyImageUpload.response.status, 201)
  const legacyImageFiles = await fs.readdir(path.join(legacyDirectory, memberId))
  assert.equal(legacyImageFiles.length, 1)
  assert.deepEqual(await fs.readFile(path.join(legacyDirectory, memberId, legacyImageFiles[0])), png)
  const legacyImageDeletion = await fetch(`${baseUrl}/api/images/${legacyImageUpload.body[0].id}`, { method: 'DELETE', headers: { Cookie: memberCookie } })
  assert.equal(legacyImageDeletion.status, 204)

  const clearedStorageUpdate = await requestJson(`${baseUrl}/api/storage/providers/local`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ config: { imagePathPrefix: '', videoPathPrefix: '' } }),
  })
  assert.equal(clearedStorageUpdate.response.status, 200)
  assert.equal(clearedStorageUpdate.body.config.imagePathPrefix, '')
  assert.equal(clearedStorageUpdate.body.config.videoPathPrefix, '')

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
  const bearerVideoForm = new FormData()
  bearerVideoForm.append('files', new Blob([videoBytes], { type: 'video/mp4' }), '开发者视频.mp4')
  const bearerVideoUpload = await requestJson(`${baseUrl}/api/videos`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey.body.secret}` }, body: bearerVideoForm })
  assert.equal(bearerVideoUpload.response.status, 201)
  assert.equal(bearerVideoUpload.body.length, 1)
  const bearerVideos = await requestJson(`${baseUrl}/api/videos`, { headers: { Authorization: `Bearer ${apiKey.body.secret}` } })
  assert.equal(bearerVideos.response.status, 200)
  assert.equal(bearerVideos.body.some((video) => video.id === bearerVideoUpload.body[0].id), true)
  const bearerVideoDetail = await requestJson(`${baseUrl}/api/videos/${bearerVideoUpload.body[0].id}`, { headers: { Authorization: `Bearer ${apiKey.body.secret}` } })
  assert.equal(bearerVideoDetail.response.status, 200)
  const bearerVideoCategories = await requestJson(`${baseUrl}/api/video-categories`, { headers: { Authorization: `Bearer ${apiKey.body.secret}` } })
  assert.equal(bearerVideoCategories.response.status, 200)
  assert.equal(bearerVideoCategories.body.length >= 1, true)
  const bearerVideoDeletion = await fetch(`${baseUrl}/api/videos/${bearerVideoUpload.body[0].id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${apiKey.body.secret}` } })
  assert.equal(bearerVideoDeletion.status, 204)
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
    CREATE TABLE videos (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, filename TEXT, storage_provider_id TEXT, storage_key TEXT, url TEXT NOT NULL, type TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL, album TEXT NOT NULL, starred INTEGER NOT NULL, views INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE albums (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(owner_id, name));
    CREATE TABLE api_keys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, label TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, key_prefix TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT);
    INSERT INTO users VALUES ('legacy-user', '旧版用户', 'legacy@example.test', 'unused', 'admin', 1073741824, '2025-01-01T00:00:00.000Z');
    INSERT INTO albums VALUES ('legacy-album', 'legacy-user', '未分类', '2025-01-01T00:00:00.000Z');
    INSERT INTO videos VALUES ('legacy-video', 'legacy-user', '旧视频.mp4', 'legacy-video.mp4', 'local', 'legacy-user/legacy-video.mp4', '/media/video/legacy-video/旧视频.mp4', 'mp4', 'video/mp4', 10, '', 0, 0, '2025-01-01T00:00:00.000Z');
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
  assert.equal(columnNames('video_categories').includes('is_default'), true)
  assert.equal(migrated.prepare('SELECT COUNT(*) AS count FROM video_categories').get().count, 1)
  assert.equal(migrated.prepare('SELECT album FROM videos WHERE id = ?').get('legacy-video').album, '视频')
  migrated.close()
})

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'

export const STORAGE_TYPES = new Set(['local', 'tencent-cos', 'aliyun-oss', 'huawei-obs', 'webdav', 's3-compatible'])

const S3_TYPES = new Set(['tencent-cos', 'aliyun-oss', 'huawei-obs', 's3-compatible'])
const SECRET_FIELDS = new Set(['accessKeyId', 'secretAccessKey', 'password'])

export class StorageManagerError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

const trimSlashes = (value) => String(value || '').trim().replace(/^\/+|\/+$/g, '')
const trimTrailingSlash = (value) => String(value || '').trim().replace(/\/+$/g, '')
const encodeObjectKey = (value) => String(value).split('/').map(encodeURIComponent).join('/')

const requireHttpUrl = (value, label) => {
  try {
    if (String(value).length > 2048) throw new StorageManagerError(`${label}不能超过 2048 个字符`)
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid protocol')
    if (url.username || url.password) throw new StorageManagerError(`${label}不能在地址中包含用户名或密码`)
    return trimTrailingSlash(url.href)
  } catch (error) {
    if (error instanceof StorageManagerError) throw error
    throw new StorageManagerError(`${label}必须是有效的 HTTP 或 HTTPS 地址`)
  }
}

const normalizePathPrefix = (value) => {
  const prefix = trimSlashes(value)
  if (prefix.length > 512) throw new StorageManagerError('对象路径前缀不能超过 512 个字符')
  if (prefix.split('/').some((part) => part === '.' || part === '..')) {
    throw new StorageManagerError('对象路径前缀不能包含 . 或 .. 路径段')
  }
  return prefix
}

export const endpointFor = (type, config) => {
  if (config.endpoint) return requireHttpUrl(config.endpoint, 'Endpoint')
  if (!config.region) throw new StorageManagerError('请填写存储区域 Region')
  if (type === 'tencent-cos') {
    return config.useInternalEndpoint
      ? `https://cos-internal.${config.region}.tencentcos.cn`
      : `https://cos.${config.region}.myqcloud.com`
  }
  if (type === 'aliyun-oss') {
    return config.useInternalEndpoint
      ? `https://s3.oss-${config.region}-internal.aliyuncs.com`
      : `https://s3.oss-${config.region}.aliyuncs.com`
  }
  if (type === 'huawei-obs') return `https://obs.${config.region}.myhuaweicloud.com`
  throw new StorageManagerError('S3 兼容存储必须填写 Endpoint')
}

const webdavHeaders = (config, extra = {}) => {
  const headers = { ...extra }
  if (config.username || config.password) {
    headers.Authorization = `Basic ${Buffer.from(`${config.username || ''}:${config.password || ''}`).toString('base64')}`
  }
  return headers
}

const webdavUrl = (config, key = '') => {
  const base = `${trimTrailingSlash(config.baseUrl)}/`
  return new URL(encodeObjectKey(trimSlashes(key)), base).href
}

const webdavRequest = async (config, method, key = '', options = {}) => {
  const response = await fetch(webdavUrl(config, key), {
    method,
    headers: webdavHeaders(config, options.headers),
    body: options.body,
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
    ...(options.body ? { duplex: 'half' } : {}),
  })
  return response
}

const ensureWebdavDirectories = async (config, key) => {
  const parts = trimSlashes(key).split('/').slice(0, -1)
  for (let index = 1; index <= parts.length; index += 1) {
    const response = await webdavRequest(config, 'MKCOL', parts.slice(0, index).join('/'))
    if (![200, 201, 204, 301, 405].includes(response.status)) {
      throw new StorageManagerError(`WebDAV 创建目录失败（HTTP ${response.status}）`, 502)
    }
  }
}

export function createStorageManager({ db, uploadsDir, encryptionSecret }) {
  const encryptionKey = crypto.createHash('sha256').update(String(encryptionSecret)).digest()
  const activeWrites = new Map()

  const encryptConfig = (config) => {
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv)
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(config), 'utf8'), cipher.final()])
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.')
  }

  const decryptConfig = (value) => {
    try {
      const [version, ivValue, tagValue, encryptedValue] = String(value).split('.')
      if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) throw new Error('invalid encrypted config')
      const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(ivValue, 'base64url'))
      decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
      const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()])
      return JSON.parse(decrypted.toString('utf8'))
    } catch {
      throw new StorageManagerError('存储配置无法解密，请确认 PICNEST_STORAGE_SECRET 没有改变', 500)
    }
  }

  const normalizeConfig = (type, incoming, current = {}) => {
    const source = incoming && typeof incoming === 'object' ? incoming : {}
    const allowed = type === 'webdav'
      ? ['baseUrl', 'username', 'password', 'pathPrefix']
      : type === 'local'
        ? []
        : ['region', 'endpoint', 'bucket', 'accessKeyId', 'secretAccessKey', 'pathPrefix', 'forcePathStyle', 'useInternalEndpoint']
    const config = {}

    for (const key of allowed) {
      if (key === 'forcePathStyle' || key === 'useInternalEndpoint') {
        if (Object.hasOwn(source, key) && typeof source[key] !== 'boolean') throw new StorageManagerError(`${key} 必须是布尔值`)
        config[key] = Object.hasOwn(source, key) ? source[key] : Boolean(current[key])
        continue
      }
      const value = Object.hasOwn(source, key) ? String(source[key] || '').trim() : ''
      if (value.length > 2048) throw new StorageManagerError(`${key} 不能超过 2048 个字符`)
      config[key] = SECRET_FIELDS.has(key) && !value ? String(current[key] || '') : value || String(current[key] || '')
    }

    config.pathPrefix = normalizePathPrefix(config.pathPrefix)
    if (type === 'webdav') {
      if (!config.baseUrl) throw new StorageManagerError('请填写 WebDAV 服务地址')
      config.baseUrl = requireHttpUrl(config.baseUrl, 'WebDAV 服务地址')
      return config
    }
    if (S3_TYPES.has(type)) {
      if (!['tencent-cos', 'aliyun-oss'].includes(type) || config.endpoint) config.useInternalEndpoint = false
      if (!config.bucket) throw new StorageManagerError('请填写 Bucket 名称')
      if (!config.accessKeyId || !config.secretAccessKey) throw new StorageManagerError('请填写完整的 AccessKey 和 SecretKey')
      if (!config.region && type !== 's3-compatible') throw new StorageManagerError('请填写存储区域 Region')
      if (type === 's3-compatible' && !config.endpoint) throw new StorageManagerError('请填写 S3 Endpoint')
      if (config.endpoint) config.endpoint = requireHttpUrl(config.endpoint, 'Endpoint')
      return config
    }
    return {}
  }

  const mapProvider = (row) => {
    const config = row.type === 'local' ? {} : decryptConfig(row.config_encrypted)
    const publicConfig = { ...config }
    const credentials = {}
    for (const field of SECRET_FIELDS) {
      credentials[field] = Boolean(publicConfig[field])
      delete publicConfig[field]
    }
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      isDefault: Boolean(row.is_default),
      config: publicConfig,
      credentials,
      imageCount: Number(row.image_count || 0),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  const providerRow = (id) => db.prepare('SELECT * FROM storage_providers WHERE id = ?').get(id)
  const providerWithConfig = (id) => {
    const row = providerRow(id)
    if (!row) throw new StorageManagerError('存储服务不存在', 404)
    return { ...row, config: row.type === 'local' ? {} : decryptConfig(row.config_encrypted) }
  }

  const ensureLocalProvider = () => {
    const now = new Date().toISOString()
    db.prepare(`
      INSERT OR IGNORE INTO storage_providers (id, name, type, config_encrypted, is_default, created_at, updated_at)
      VALUES ('local', '本地文件系统', 'local', ?, 0, ?, ?)
    `).run('local', now, now)
    const current = db.prepare('SELECT id FROM storage_providers WHERE is_default = 1 LIMIT 1').get()
    if (!current) db.prepare("UPDATE storage_providers SET is_default = CASE WHEN id = 'local' THEN 1 ELSE 0 END").run()
  }

  ensureLocalProvider()

  const listProviders = () => db.prepare(`
    SELECT storage_providers.*, COUNT(images.id) AS image_count
    FROM storage_providers
    LEFT JOIN images ON images.storage_provider_id = storage_providers.id
    GROUP BY storage_providers.id
    ORDER BY storage_providers.is_default DESC, storage_providers.created_at ASC
  `).all().map(mapProvider)

  const createProvider = ({ name, type, config }) => {
    if (db.prepare("SELECT COUNT(*) AS count FROM storage_providers WHERE id <> 'local'").get().count >= 50) throw new StorageManagerError('最多可以添加 50 个外部存储服务', 409)
    const normalizedType = String(type || '').trim()
    if (!STORAGE_TYPES.has(normalizedType) || normalizedType === 'local') throw new StorageManagerError('不支持该存储类型')
    const normalizedName = String(name || '').trim()
    if (normalizedName.length < 2 || normalizedName.length > 100) throw new StorageManagerError('存储名称需要 2 到 100 个字符')
    const normalizedConfig = normalizeConfig(normalizedType, config)
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    db.prepare('INSERT INTO storage_providers (id, name, type, config_encrypted, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)')
      .run(id, normalizedName, normalizedType, encryptConfig(normalizedConfig), now, now)
    return listProviders().find((provider) => provider.id === id)
  }

  const updateProvider = (id, { name, config }) => {
    if (id === 'local') throw new StorageManagerError('本地存储无需修改')
    const current = providerWithConfig(id)
    const normalizedName = String(name || current.name).trim()
    if (normalizedName.length < 2 || normalizedName.length > 100) throw new StorageManagerError('存储名称需要 2 到 100 个字符')
    const normalizedConfig = normalizeConfig(current.type, config, current.config)
    db.prepare('UPDATE storage_providers SET name = ?, config_encrypted = ?, updated_at = ? WHERE id = ?')
      .run(normalizedName, encryptConfig(normalizedConfig), new Date().toISOString(), id)
    return listProviders().find((provider) => provider.id === id)
  }

  const setDefaultProvider = (id) => {
    if (!providerRow(id)) throw new StorageManagerError('存储服务不存在', 404)
    const transaction = db.transaction(() => {
      db.prepare('UPDATE storage_providers SET is_default = 0').run()
      db.prepare('UPDATE storage_providers SET is_default = 1, updated_at = ? WHERE id = ?').run(new Date().toISOString(), id)
    })
    transaction()
    return listProviders().find((provider) => provider.id === id)
  }

  const deleteProvider = (id) => {
    if (id === 'local') throw new StorageManagerError('本地存储不能删除')
    const provider = providerRow(id)
    if (!provider) throw new StorageManagerError('存储服务不存在', 404)
    if (provider.is_default) throw new StorageManagerError('请先切换当前存储后再删除')
    if (activeWrites.get(id)) throw new StorageManagerError('该存储仍有上传任务正在进行，请稍后再删除', 409)
    const assignedUsers = Number(db.prepare('SELECT COUNT(*) AS count FROM users WHERE storage_provider_id = ?').get(id).count)
    if (assignedUsers > 0) throw new StorageManagerError(`该存储仍分配给 ${assignedUsers} 位用户，请先调整用户存储策略`, 409)
    const imageCount = Number(db.prepare('SELECT COUNT(*) AS count FROM images WHERE storage_provider_id = ?').get(id).count)
    if (imageCount > 0) throw new StorageManagerError(`该存储仍有 ${imageCount} 张图片，不能删除`, 409)
    db.prepare('DELETE FROM storage_providers WHERE id = ?').run(id)
  }

  const createS3Client = (provider) => new S3Client({
    region: provider.config.region || 'auto',
    endpoint: endpointFor(provider.type, provider.config),
    forcePathStyle: Boolean(provider.config.forcePathStyle),
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: provider.config.accessKeyId,
      secretAccessKey: provider.config.secretAccessKey,
    },
  })

  const testProvider = async (id) => {
    const provider = providerWithConfig(id)
    if (provider.type === 'local') {
      const testFile = path.join(uploadsDir, `.picnest-write-test-${crypto.randomUUID()}`)
      fs.writeFileSync(testFile, 'ok')
      fs.unlinkSync(testFile)
      return
    }
    if (S3_TYPES.has(provider.type)) {
      const client = createS3Client(provider)
      const testKey = provider.config.pathPrefix
        ? `${provider.config.pathPrefix}/.picnest-write-test-${crypto.randomUUID()}`
        : `.picnest-write-test-${crypto.randomUUID()}`
      try {
        await client.send(new PutObjectCommand({
          Bucket: provider.config.bucket,
          Key: testKey,
          Body: 'PicNest storage connection test',
          ContentLength: 31,
          ContentType: 'text/plain; charset=utf-8',
        }))
        try {
          const readResult = await client.send(new GetObjectCommand({ Bucket: provider.config.bucket, Key: testKey }))
          if (!readResult.Body) throw new StorageManagerError('对象存储读取检测没有返回文件内容', 502)
          const chunks = []
          for await (const chunk of readResult.Body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
          if (Buffer.concat(chunks).toString('utf8') !== 'PicNest storage connection test') {
            throw new StorageManagerError('对象存储读取检测返回的内容不一致', 502)
          }
        } finally {
          await client.send(new DeleteObjectCommand({ Bucket: provider.config.bucket, Key: testKey }))
        }
      } finally {
        client.destroy()
      }
      return
    }
    const testKey = provider.config.pathPrefix
      ? `${provider.config.pathPrefix}/.picnest-write-test-${crypto.randomUUID()}`
      : `.picnest-write-test-${crypto.randomUUID()}`
    await ensureWebdavDirectories(provider.config, testKey)
    const putResponse = await webdavRequest(provider.config, 'PUT', testKey, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: 'PicNest storage connection test',
    })
    if (![200, 201, 204].includes(putResponse.status)) throw new StorageManagerError(`WebDAV 写入检测失败（HTTP ${putResponse.status}）`, 502)
    let readError = null
    try {
      const getResponse = await webdavRequest(provider.config, 'GET', testKey)
      if (!getResponse.ok || await getResponse.text() !== 'PicNest storage connection test') {
        throw new StorageManagerError(`WebDAV 读取检测失败（HTTP ${getResponse.status}）`, 502)
      }
    } catch (error) {
      readError = error
    }
    const deleteResponse = await webdavRequest(provider.config, 'DELETE', testKey)
    if (![200, 204].includes(deleteResponse.status)) throw new StorageManagerError(`WebDAV 删除检测失败（HTTP ${deleteResponse.status}）`, 502)
    if (readError) throw readError
  }

  const storageKeyFor = (provider, userId, filename) => {
    const relativeKey = `${userId}/${filename}`
    return provider.config.pathPrefix ? `${provider.config.pathPrefix}/${relativeKey}` : relativeKey
  }

  const getDefaultProviderId = () => (db.prepare('SELECT id FROM storage_providers WHERE is_default = 1 LIMIT 1').get()?.id || 'local')

  const getUploadProviderId = (preferredProviderId) => {
    if (preferredProviderId && providerRow(preferredProviderId)) return preferredProviderId
    return getDefaultProviderId()
  }

  const storeFile = async (userId, file, providerId = getDefaultProviderId()) => {
    const selectedRow = providerRow(providerId)
    if (!selectedRow) throw new StorageManagerError('当前存储服务不存在', 500)
    activeWrites.set(providerId, (activeWrites.get(providerId) || 0) + 1)
    try {
      const provider = {
        ...selectedRow,
        config: selectedRow.type === 'local' ? {} : decryptConfig(selectedRow.config_encrypted),
      }
      const storageKey = storageKeyFor(provider, userId, file.filename)

      if (provider.type === 'local') {
        const destination = path.resolve(uploadsDir, storageKey)
        if (!destination.startsWith(`${path.resolve(uploadsDir)}${path.sep}`)) throw new StorageManagerError('本地存储路径无效', 500)
        fs.mkdirSync(path.dirname(destination), { recursive: true })
        fs.renameSync(file.path, destination)
        return { providerId: provider.id, storageKey }
      }

      if (S3_TYPES.has(provider.type)) {
        const client = createS3Client(provider)
        try {
          await client.send(new PutObjectCommand({
            Bucket: provider.config.bucket,
            Key: storageKey,
            Body: fs.createReadStream(file.path),
            ContentLength: file.size,
            ContentType: file.mimetype,
          }))
        } finally {
          client.destroy()
        }
        fs.unlinkSync(file.path)
        return { providerId: provider.id, storageKey }
      }

      await ensureWebdavDirectories(provider.config, storageKey)
      const response = await webdavRequest(provider.config, 'PUT', storageKey, {
        headers: { 'Content-Type': file.mimetype, 'Content-Length': String(file.size) },
        body: fs.createReadStream(file.path),
      })
      if (![200, 201, 204].includes(response.status)) throw new StorageManagerError(`WebDAV 上传失败（HTTP ${response.status}）`, 502)
      fs.unlinkSync(file.path)
      return { providerId: provider.id, storageKey }
    } finally {
      const remaining = (activeWrites.get(providerId) || 1) - 1
      if (remaining > 0) activeWrites.set(providerId, remaining)
      else activeWrites.delete(providerId)
    }
  }

  const deleteStoredObject = async (image) => {
    if (!image.filename && !image.storage_key) return
    const providerId = image.storage_provider_id || 'local'
    const provider = providerWithConfig(providerId)
    const storageKey = image.storage_key || `${image.owner_id}/${image.filename}`

    if (provider.type === 'local') {
      const target = path.resolve(uploadsDir, storageKey)
      if (target.startsWith(`${path.resolve(uploadsDir)}${path.sep}`) && fs.existsSync(target)) fs.unlinkSync(target)
      return
    }
    if (S3_TYPES.has(provider.type)) {
      const client = createS3Client(provider)
      try {
        await client.send(new DeleteObjectCommand({ Bucket: provider.config.bucket, Key: storageKey }))
      } finally {
        client.destroy()
      }
      return
    }
    const response = await webdavRequest(provider.config, 'DELETE', storageKey)
    if (![200, 204, 404].includes(response.status)) throw new StorageManagerError(`WebDAV 删除失败（HTTP ${response.status}）`, 502)
  }

  const openStoredObject = async (image) => {
    if (!image.filename && !image.storage_key) throw new StorageManagerError('图片原文件不存在', 404)
    const providerId = image.storage_provider_id || 'local'
    const provider = providerWithConfig(providerId)
    const storageKey = image.storage_key || `${image.owner_id}/${image.filename}`

    if (provider.type === 'local') {
      const target = path.resolve(uploadsDir, storageKey)
      if (!target.startsWith(`${path.resolve(uploadsDir)}${path.sep}`) || !fs.existsSync(target)) {
        throw new StorageManagerError('图片原文件不存在', 404)
      }
      const stat = fs.statSync(target)
      return { body: fs.createReadStream(target), contentLength: stat.size, cleanup: () => {} }
    }

    if (S3_TYPES.has(provider.type)) {
      const client = createS3Client(provider)
      try {
        const object = await client.send(new GetObjectCommand({ Bucket: provider.config.bucket, Key: storageKey }))
        if (!object.Body) throw new StorageManagerError('对象存储没有返回文件内容', 502)
        return {
          body: object.Body,
          contentLength: object.ContentLength,
          contentType: object.ContentType,
          etag: object.ETag,
          lastModified: object.LastModified,
          cleanup: () => client.destroy(),
        }
      } catch (error) {
        client.destroy()
        throw error
      }
    }

    const response = await webdavRequest(provider.config, 'GET', storageKey)
    if (response.status === 404) throw new StorageManagerError('图片原文件不存在', 404)
    if (!response.ok || !response.body) throw new StorageManagerError(`WebDAV 读取失败（HTTP ${response.status}）`, 502)
    return {
      body: Readable.fromWeb(response.body),
      contentLength: Number(response.headers.get('content-length') || 0) || undefined,
      contentType: response.headers.get('content-type') || undefined,
      etag: response.headers.get('etag') || undefined,
      lastModified: response.headers.get('last-modified') || undefined,
      cleanup: () => {},
    }
  }

  return {
    createProvider,
    deleteProvider,
    deleteStoredObject,
    getDefaultProviderId,
    getUploadProviderId,
    listProviders,
    openStoredObject,
    setDefaultProvider,
    storeFile,
    testProvider,
    updateProvider,
  }
}

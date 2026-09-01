import { once } from 'node:events'
import { spawn } from 'node:child_process'
import dns from 'node:dns/promises'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'

const maxRedirects = 5
const defaultConnections = 4
const maxConnections = 16
const remoteUserAgent = 'PicNest remote importer'

export class RemoteDownloadError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'RemoteDownloadError'
    this.status = status
  }
}

const normalizeInput = (value) => String(value || '').trim()

const isPrivateIpv4 = (value) => {
  const parts = value.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const number = (((parts[0] * 256) + parts[1]) * 256 + parts[2]) * 256 + parts[3]
  const ranges = [
    [0x00000000, 0x00ffffff],
    [0x0a000000, 0x0affffff],
    [0x64400000, 0x647fffff],
    [0x7f000000, 0x7fffffff],
    [0xa9fe0000, 0xa9feffff],
    [0xac100000, 0xac1fffff],
    [0xc0000000, 0xc00000ff],
    [0xc0000200, 0xc00002ff],
    [0xc0001000, 0xc00010ff],
    [0xc6120000, 0xc61200ff],
    [0xcb007100, 0xcb0071ff],
    [0xc0a80000, 0xc0a8ffff],
    [0xe0000000, 0xffffffff],
  ]
  return ranges.some(([start, end]) => number >= start && number <= end)
}

const isPrivateIpv6 = (value) => {
  const normalized = value.toLowerCase()
  if (normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  return Boolean(mapped && isPrivateIpv4(mapped[1]))
}

const isPrivateAddress = (value) => net.isIP(value) === 4 ? isPrivateIpv4(value) : isPrivateIpv6(value)

const validateBasicUrl = (value) => {
  if (value.length > 4096) throw new RemoteDownloadError('远程地址不能超过 4096 个字符')
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new RemoteDownloadError('请输入有效的 HTTP 或 HTTPS 地址')
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new RemoteDownloadError('远程导入仅支持 HTTP 或 HTTPS 地址')
  if (parsed.username || parsed.password) throw new RemoteDownloadError('远程地址不能包含用户名或密码')
  return parsed.href
}

export const parseRemoteSource = (value) => {
  const input = normalizeInput(value)
  if (!input) throw new RemoteDownloadError('请输入 HTTPS 地址或 curl 命令')
  const candidates = input.match(/https?:\/\/[^\s"'`<>]+/gi) || []
  if (candidates.length !== 1) throw new RemoteDownloadError('请提供一个 HTTP 或 HTTPS 地址，暂不支持一次导入多个地址')
  const candidate = candidates[0].replace(/[),.;]+$/g, '').replaceAll('\\"', '"').replaceAll("\\'", "'")
  return {
    source: input,
    url: validateBasicUrl(candidate),
  }
}

const assertSafeHostname = async (hostname) => {
  const normalized = String(hostname || '').toLowerCase().replace(/\.$/, '')
  if (!normalized || normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local')) {
    throw new RemoteDownloadError('为安全起见，不允许访问本机或局域网地址')
  }
  if (isPrivateAddress(normalized)) throw new RemoteDownloadError('为安全起见，不允许访问本机或局域网地址')
  let addresses
  try {
    addresses = await dns.lookup(normalized, { all: true, verbatim: true })
  } catch {
    throw new RemoteDownloadError('远程地址无法解析，请检查域名或网络连接', 502)
  }
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new RemoteDownloadError('为安全起见，不允许访问本机或局域网地址')
  }
}

const assertSafeUrl = async (value) => {
  const url = validateBasicUrl(value)
  await assertSafeHostname(new URL(url).hostname)
  return url
}

const filenameFromContentDisposition = (value) => {
  const header = String(value || '')
  const encoded = header.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i)?.[1]
  if (encoded) {
    try { return decodeURIComponent(encoded.trim().replace(/^["']|["']$/g, '')) } catch { /* Fall through to the plain filename. */ }
  }
  const plain = header.match(/filename\s*=\s*("?)([^";]+)\1/i)?.[2]
  return plain || ''
}

const cleanFilename = (value) => {
  const name = path.basename(String(value || '').replaceAll('\0', '').trim())
  const cleaned = Array.from(name).filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127).join('')
  return cleaned.slice(0, 180) || 'remote-download'
}

const filenameFromUrl = (value) => {
  try {
    const pathname = new URL(value).pathname
    return cleanFilename(decodeURIComponent(pathname.split('/').pop() || ''))
  } catch {
    return 'remote-download'
  }
}

const parseContentLength = (value) => {
  const length = Number(value)
  return Number.isSafeInteger(length) && length >= 0 ? length : null
}

export const inspectRemoteUrl = async (input) => {
  let url = await assertSafeUrl(input)
  let response = null
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    try {
      response = await fetch(url, {
        method: 'HEAD',
        redirect: 'manual',
        headers: { 'User-Agent': remoteUserAgent },
        signal: AbortSignal.timeout(15000),
      })
    } catch (error) {
      if (error instanceof RemoteDownloadError) throw error
      throw new RemoteDownloadError('连接远程地址失败，请检查网络后重试', 502)
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) break
    const location = response.headers.get('location')
    if (!location) throw new RemoteDownloadError('远程地址返回了无效的重定向')
    url = await assertSafeUrl(new URL(location, url).href)
  }
  if (!response) throw new RemoteDownloadError('远程地址检查失败', 502)
  if ([301, 302, 303, 307, 308].includes(response.status)) throw new RemoteDownloadError('远程地址重定向次数过多')
  if (![200, 204, 403, 405, 501].includes(response.status) && response.status >= 400) {
    throw new RemoteDownloadError(`远程地址返回 HTTP ${response.status}`, 502)
  }
  const contentType = String(response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase()
  const filename = cleanFilename(filenameFromContentDisposition(response.headers.get('content-disposition')) || filenameFromUrl(url))
  return {
    url,
    filename,
    contentType,
    contentLength: parseContentLength(response.headers.get('content-length')),
  }
}

const commandAvailable = (command) => new Promise((resolve) => {
  const child = spawn(command, ['--version'], { stdio: 'ignore', windowsHide: true })
  child.once('error', () => resolve(false))
  child.once('close', (code) => resolve(code === 0))
})

export const resolveDownloader = async () => {
  const configured = normalizeInput(process.env.PICNEST_REMOTE_DOWNLOADER).toLowerCase()
  if (configured === 'node') return 'node'
  if (configured === 'aria2c' && await commandAvailable('aria2c')) return 'aria2c'
  if (configured === 'curl' && await commandAvailable('curl')) return 'curl'
  if (configured && !['auto', 'aria2c', 'curl', 'node'].includes(configured)) {
    throw new RemoteDownloadError('PICNEST_REMOTE_DOWNLOADER 仅支持 auto、aria2c、curl 或 node', 500)
  }
  if ((!configured || configured === 'auto') && await commandAvailable('aria2c')) return 'aria2c'
  if ((!configured || configured === 'auto') && await commandAvailable('curl')) return 'curl'
  if (configured === 'aria2c' || configured === 'curl') throw new RemoteDownloadError(`服务器未找到 ${configured}，请安装后重试`, 503)
  return 'node'
}

const reportFileProgress = async (destination, totalBytes, maxBytes, onProgress) => {
  try {
    const stat = await fsp.stat(destination)
    const loaded = stat.size
    if (loaded > maxBytes) throw new RemoteDownloadError(`远程文件超过 ${Math.round(maxBytes / 1024 / 1024)} MB 限制`, 413)
    onProgress(loaded, totalBytes)
    return loaded
  } catch (error) {
    if (error instanceof RemoteDownloadError) throw error
    return 0
  }
}

const runCommandDownload = ({ command, args, destination, totalBytes, maxBytes, onProgress }) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
  let settled = false
  let monitor
  const finish = (error, value) => {
    if (settled) return
    settled = true
    if (monitor) clearInterval(monitor)
    if (error) reject(error)
    else resolve(value)
  }
  child.once('error', (error) => finish(new RemoteDownloadError(`无法启动 ${command} 下载器：${error.message}`, 503)))
  child.stderr.on('data', () => {})
  monitor = setInterval(() => {
    void reportFileProgress(destination, totalBytes, maxBytes, onProgress)
      .then((loaded) => {
        if (loaded > maxBytes) {
          child.kill('SIGTERM')
          finish(new RemoteDownloadError(`远程文件超过 ${Math.round(maxBytes / 1024 / 1024)} MB 限制`, 413))
        }
      })
      .catch((error) => {
        child.kill('SIGTERM')
        finish(error)
      })
  }, 250)
  child.once('close', (code, signal) => {
    if (code === 0) {
      void reportFileProgress(destination, totalBytes, maxBytes, onProgress)
        .then((loaded) => {
          if (!loaded) return finish(new RemoteDownloadError('远程下载完成但没有收到文件内容', 502))
          finish(null, loaded)
        })
        .catch(finish)
      return
    }
    finish(new RemoteDownloadError(signal ? `远程下载被 ${signal} 中断` : `远程下载失败（${command} 状态码 ${code ?? '未知'}）`, 502))
  })
})

const downloadWithAria2 = ({ url, destination, connections, totalBytes, maxBytes, onProgress }) => runCommandDownload({
  command: 'aria2c',
  args: [
    '--allow-overwrite=true',
    '--auto-file-renaming=false',
    '--check-certificate=true',
    '--connect-timeout=20',
    '--console-log-level=warn',
    '--download-result=hide',
    '--file-allocation=none',
    `--dir=${path.dirname(destination)}`,
    `--max-connection-per-server=${connections}`,
    `--max-file-size=${maxBytes}`,
    '--max-redirect=0',
    '--max-tries=3',
    '--min-split-size=5M',
    `--out=${path.basename(destination)}`,
    `--split=${connections}`,
    '--timeout=60',
    url,
  ],
  destination,
  totalBytes,
  maxBytes,
  onProgress,
})

const downloadWithCurl = ({ url, destination, totalBytes, maxBytes, onProgress }) => runCommandDownload({
  command: 'curl',
  args: [
    '--fail',
    '--silent',
    '--show-error',
    '--location',
    '--max-redirs', '0',
    '--retry', '2',
    '--retry-delay', '2',
    '--connect-timeout', '20',
    '--max-time', '0',
    '--output', destination,
    url,
  ],
  destination,
  totalBytes,
  maxBytes,
  onProgress,
})

const downloadWithNode = async ({ url, destination, totalBytes, maxBytes, onProgress }) => {
  let response
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': remoteUserAgent },
      redirect: 'manual',
      signal: AbortSignal.timeout(24 * 60 * 60 * 1000),
    })
  } catch {
    throw new RemoteDownloadError('连接远程地址失败，请检查网络后重试', 502)
  }
  if (!response.ok) throw new RemoteDownloadError(`远程地址返回 HTTP ${response.status}`, 502)
  if (!response.body) throw new RemoteDownloadError('远程地址没有返回文件内容', 502)
  const output = fs.createWriteStream(destination)
  let loaded = 0
  try {
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk)
      loaded += buffer.length
      if (loaded > maxBytes) throw new RemoteDownloadError(`远程文件超过 ${Math.round(maxBytes / 1024 / 1024)} MB 限制`, 413)
      if (!output.write(buffer)) await once(output, 'drain')
      onProgress(loaded, totalBytes)
    }
    await new Promise((resolve, reject) => {
      output.once('error', reject)
      output.end(resolve)
    })
  } catch (error) {
    output.destroy()
    throw error
  }
  if (!loaded) throw new RemoteDownloadError('远程下载完成但没有收到文件内容', 502)
  return loaded
}

export const downloadRemoteFile = async ({ input, destination, connections = defaultConnections, maxBytes, onMetadata = () => {}, onProgress = () => {} }) => {
  const metadata = await inspectRemoteUrl(input)
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RemoteDownloadError('远程下载大小限制配置无效', 500)
  if (metadata.contentLength !== null && metadata.contentLength > maxBytes) {
    throw new RemoteDownloadError(`远程文件超过 ${Math.round(maxBytes / 1024 / 1024)} MB 限制`, 413)
  }
  onMetadata(metadata)
  await fsp.rm(destination, { force: true })
  const normalizedConnections = Math.min(maxConnections, Math.max(1, Math.floor(Number(connections) || defaultConnections)))
  const downloader = await resolveDownloader()
  const options = {
    url: metadata.url,
    destination,
    connections: normalizedConnections,
    totalBytes: metadata.contentLength,
    maxBytes,
    onProgress,
  }
  const size = downloader === 'aria2c'
    ? await downloadWithAria2(options)
    : downloader === 'curl'
      ? await downloadWithCurl(options)
      : await downloadWithNode(options)
  return { ...metadata, size, downloader, connections: normalizedConnections }
}

export const remoteDownloadDefaults = {
  defaultConnections,
  maxConnections,
}

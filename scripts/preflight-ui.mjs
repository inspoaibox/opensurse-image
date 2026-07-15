import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import sharp from 'sharp'

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const commonBrowserPaths = process.platform === 'win32'
  ? [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    ]
  : ['/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']

const executablePath = process.env.PICNEST_BROWSER_PATH || await (async () => {
  for (const candidate of commonBrowserPaths) {
    try { await fs.access(candidate); return candidate } catch { /* Try the next installed browser. */ }
  }
  return ''
})()

if (!executablePath) throw new Error('未找到 Edge/Chrome/Chromium；可通过 PICNEST_BROWSER_PATH 指定浏览器路径')

const availablePort = () => new Promise((resolve, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    server.close(() => resolve(address.port))
  })
})

const waitForServer = async (baseUrl, output) => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) return
    } catch { /* The server is still starting. */ }
    if (output.exited) throw new Error(`PicNest 提前退出：${output.stderr}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`PicNest 启动超时：${output.stderr}`)
}

const outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'picnest-ui-'))
const adminPassword = `A!${crypto.randomBytes(18).toString('base64url')}`
const memberPassword = `M!${crypto.randomBytes(18).toString('base64url')}`
const port = await availablePort()
const baseUrl = `http://127.0.0.1:${port}`
const processOutput = { stderr: '', exited: false }
const child = spawn(process.execPath, ['server/index.js'], {
  cwd: workspace,
  env: {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    PICNEST_DB_PATH: path.join(outputDirectory, 'picnest.db'),
    PICNEST_SESSION_SECRET: crypto.randomBytes(48).toString('hex'),
    PICNEST_STORAGE_SECRET: crypto.randomBytes(48).toString('hex'),
    PICNEST_PUBLIC_URL: baseUrl,
    COOKIE_SECURE: 'false',
  },
  stdio: ['ignore', 'ignore', 'pipe'],
})
child.stderr.on('data', (chunk) => { processOutput.stderr += chunk })
child.once('exit', () => { processOutput.exited = true })

let browser
let createdUserId = ''
try {
  await waitForServer(baseUrl, processOutput)
  browser = await chromium.launch({ executablePath, headless: true })
  const mobileLoginContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' })
  const mobileLoginPage = await mobileLoginContext.newPage()
  await mobileLoginPage.goto(baseUrl, { waitUntil: 'networkidle' })
  await mobileLoginPage.getByRole('heading', { name: '创建你的空间' }).waitFor()
  const mobileLoginMetrics = await mobileLoginPage.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }))
  assert.equal(mobileLoginMetrics.scrollWidth <= mobileLoginMetrics.width + 1, true, `移动登录页出现横向溢出：${JSON.stringify(mobileLoginMetrics)}`)
  await mobileLoginPage.screenshot({ path: path.join(outputDirectory, 'mobile-login.png'), fullPage: true })
  await mobileLoginContext.close()

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const page = await context.newPage()
  const consoleErrors = []
  const pageErrors = []
  const httpErrors = []
  page.on('console', (message) => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) consoleErrors.push(message.text()) })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('response', (response) => { if (response.status() >= 400) httpErrors.push({ status: response.status(), url: response.url() }) })

  const firstResponse = await page.goto(baseUrl, { waitUntil: 'networkidle' })
  assert.equal(firstResponse.status(), 200)
  await page.getByRole('heading', { name: '创建你的空间' }).waitFor()
  await page.locator('input[autocomplete="name"]').fill('上线检查管理员')
  await page.locator('input[autocomplete="email"]').fill('preflight@example.test')
  await page.locator('input[autocomplete="new-password"]').fill(adminPassword)
  await page.getByRole('button', { name: '创建账户并进入' }).click()
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor()

  const meResponse = await page.request.get(`${baseUrl}/api/auth/me`)
  createdUserId = (await meResponse.json()).id
  assert.equal(await page.getByText('aurora-landing.png').count(), 0)

  const png = await sharp({ create: { width: 16, height: 12, channels: 4, background: '#e77856' } }).png().toBuffer()
  await page.locator('#file-picker').setInputFiles({ name: '上线检查.png', mimeType: 'image/png', buffer: png })
  await page.getByRole('heading', { name: '本次上传结果' }).waitFor()
  await page.getByRole('button', { name: '选择图片' }).waitFor()
  assert.equal(await page.locator('input[readonly][value*="/media/"]').count() > 0, true)
  await page.screenshot({ path: path.join(outputDirectory, 'desktop-workbench.png'), fullPage: true })

  await page.getByRole('button', { name: '图片库' }).click()
  await page.getByRole('heading', { name: '图片库', exact: true }).waitFor()
  await page.getByRole('button', { name: '查看大图 上线检查.png' }).click()
  await page.getByRole('button', { name: '图片信息' }).click()
  await page.getByText('EXIF 与原始元数据').waitFor()
  await page.getByRole('button', { name: '关闭大图查看' }).click()

  await page.getByRole('button', { name: '相册' }).click()
  await page.getByRole('heading', { name: '相册', exact: true }).waitFor()
  assert.equal(await page.getByText('默认相册').count() > 0, true)

  await page.getByRole('button', { name: '成员管理' }).click()
  await page.getByRole('heading', { name: '成员管理', exact: true }).waitFor()
  await page.getByRole('button', { name: '添加成员' }).click()
  await page.getByLabel('成员称呼').fill('上线检查成员')
  await page.getByLabel('登录邮箱').fill('ui-member@example.test')
  await page.getByLabel('初始密码').fill(memberPassword)
  await page.getByRole('button', { name: '创建成员' }).click()
  await page.getByText('ui-member@example.test').waitFor()

  await page.getByRole('button', { name: '开发者' }).click()
  await page.getByRole('heading', { name: '开发者', exact: true }).waitFor()
  await page.getByPlaceholder('密钥名称，例如：PicGo、生产服务器').fill('UI 验收')
  await page.getByRole('button', { name: '创建密钥' }).click()
  await page.getByText('UI 验收').waitFor()
  await page.getByRole('button', { name: '阅读 API 文档' }).click()
  await page.getByRole('heading', { name: 'API 文档' }).waitFor()
  await page.getByRole('button', { name: '关闭 API 文档' }).click()

  await page.getByRole('button', { name: '系统设置' }).click()
  await page.getByRole('heading', { name: '系统设置', exact: true }).waitFor()
  for (const section of ['安全设置', '图片处理', '通知', '存储与域名']) {
    await page.getByRole('button', { name: section, exact: true }).click()
  }
  await page.getByRole('heading', { name: '存储与域名', exact: true }).waitFor()
  await page.getByRole('button', { name: '检测' }).click()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '工作台', exact: true }).click()
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor()
  const viewportMetrics = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }))
  assert.equal(viewportMetrics.scrollWidth <= viewportMetrics.width + 1, true, `移动端出现横向溢出：${JSON.stringify(viewportMetrics)}`)
  await page.screenshot({ path: path.join(outputDirectory, 'mobile-workbench.png'), fullPage: true })

  await page.setViewportSize({ width: 768, height: 1024 })
  await page.getByRole('button', { name: '系统设置', exact: true }).click()
  await page.getByRole('heading', { name: '系统设置', exact: true }).waitFor()
  const tabletMetrics = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }))
  assert.equal(tabletMetrics.scrollWidth <= tabletMetrics.width + 1, true, `平板端出现横向溢出：${JSON.stringify(tabletMetrics)}`)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: '图片库' }).click()
  await page.getByRole('button', { name: '查看大图 上线检查.png' }).click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '删除图片' }).click()
  await page.getByText('图库还是空的').waitFor()

  const notFound = await page.goto(`${baseUrl}/missing-page`, { waitUntil: 'domcontentloaded' })
  assert.equal(notFound.status(), 404)
  await page.getByRole('heading', { name: '页面不存在' }).waitFor()
  const unexpectedHttpErrors = httpErrors.filter(({ status, url }) => !(
    (status === 401 && url === `${baseUrl}/api/auth/me`)
    || (status === 404 && url === `${baseUrl}/missing-page`)
  ))
  assert.deepEqual(consoleErrors, [])
  assert.deepEqual(pageErrors, [])
  assert.deepEqual(unexpectedHttpErrors, [])

  console.log(JSON.stringify({ ok: true, browser: executablePath, screenshots: [path.join(outputDirectory, 'mobile-login.png'), path.join(outputDirectory, 'desktop-workbench.png'), path.join(outputDirectory, 'mobile-workbench.png')] }, null, 2))
} finally {
  if (browser) await browser.close()
  if (!processOutput.exited) child.kill('SIGTERM')
  await new Promise((resolve) => setTimeout(resolve, 300))
  if (createdUserId) await fs.rm(path.join(workspace, 'server', 'uploads', createdUserId), { recursive: true, force: true })
}

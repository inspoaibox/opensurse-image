import { useEffect, useState } from 'react'
import { Check, Copy, X } from 'lucide-react'

const endpointGroups = [
  {
    title: '公开与认证',
    rows: [
      ['GET', '/api/health', '服务健康检查'],
      ['GET', '/api/public/config', '读取游客上传开关、限制与允许文件类型'],
      ['POST', '/api/public/images', '游客上传 1–5 张图片，需管理员开启'],
      ['GET', '/api/auth/me', '读取当前认证用户与游客上传状态'],
      ['POST', '/api/auth/register', '仅系统未初始化时创建首位管理员'],
      ['POST', '/api/auth/login', '登录并写入 HttpOnly 会话 Cookie'],
      ['POST', '/api/auth/logout', '退出当前网页登录会话'],
    ],
  },
  {
    title: '图片接口',
    rows: [
      ['GET', '/api/images', '列出当前用户的全部图片'],
      ['POST', '/api/images', '上传 1–20 张图片，multipart/form-data'],
      ['GET', '/api/images/:id', '获取当前用户的单张图片详情'],
      ['GET', '/api/images/:id/metadata', '读取尺寸、EXIF、GPS、XMP 等元数据'],
      ['PATCH', '/api/images/:id', '修改名称、相册或收藏状态'],
      ['DELETE', '/api/images/:id', '删除图片记录与原文件'],
      ['POST', '/api/images/bulk-delete', '按 ID 数组批量删除图片'],
      ['GET', '/api/settings/image-processing', '读取系统图片处理默认策略'],
    ],
  },
  {
    title: '相册与统计',
    rows: [
      ['GET', '/api/albums', '列出当前用户相册'],
      ['POST', '/api/albums', '创建相册'],
      ['PATCH', '/api/albums/:id/default', '设置默认上传相册'],
      ['GET', '/api/stats', '空间与本月 API 使用统计'],
    ],
  },
  {
    title: '图片访问',
    rows: [
      ['GET', '/media/:id/:filename.ext', '公开读取原图，返回正确 Content-Type'],
      ['GET', '/media/:id', '兼容旧版无文件名图片地址'],
    ],
  },
  {
    title: '会话与密钥管理',
    rows: [
      ['GET', '/api/api-keys', '列出多把 API 密钥，仅网页登录会话'],
      ['POST', '/api/api-keys', '创建 API 密钥，仅网页登录会话'],
      ['GET', '/api/api-keys/:id/secret', '查看完整密钥，仅网页登录会话'],
      ['DELETE', '/api/api-keys/:id', '删除指定密钥，仅网页登录会话'],
    ],
  },
  {
    title: '管理员接口',
    rows: [
      ['GET / POST', '/api/users', '列出或创建成员'],
      ['PATCH', '/api/users/:id', '编辑成员、配额与存储策略'],
      ['PATCH', '/api/settings/guest-upload', '开启或关闭游客上传'],
      ['PATCH', '/api/settings/image-processing', '修改允许上传类型与默认图片处理策略'],
      ['GET / POST', '/api/storage/providers', '列出或添加存储服务'],
      ['PATCH / DELETE', '/api/storage/providers/:id', '编辑或删除存储服务'],
      ['POST', '/api/storage/providers/:id/test', '检测读取、写入和删除能力'],
      ['PATCH', '/api/storage/providers/:id/default', '检测并设为系统当前存储'],
    ],
  },
]

const imageResponseExample = `[
  {
    "id": "90781e45-39ff-4dca-a53a-672b31fd3c01",
    "name": "cover.png",
    "filename": "cover.png",
    "url": "https://img.example.com/media/90781e45-39ff-4dca-a53a-672b31fd3c01/cover.png",
    "path": "/media/90781e45-39ff-4dca-a53a-672b31fd3c01/cover.png",
    "type": "PNG",
    "format": "png",
    "extension": ".png",
    "mimeType": "image/png",
    "size": 172032,
    "width": 1920,
    "height": 1080,
    "album": "未分类",
    "starred": false,
    "views": 0,
    "guestUploaded": false,
    "processing": {
      "applied": true,
      "converted": true,
      "sourceFormat": "jpg",
      "outputFormat": "png",
      "quality": 85,
      "autoOriented": false,
      "metadataStripped": false
    },
    "links": {
      "direct": "https://img.example.com/media/90781e45-39ff-4dca-a53a-672b31fd3c01/cover.png",
      "markdown": "![cover.png](https://img.example.com/media/90781e45-39ff-4dca-a53a-672b31fd3c01/cover.png)",
      "bbcode": "[img]https://img.example.com/media/90781e45-39ff-4dca-a53a-672b31fd3c01/cover.png[/img]",
      "html": "<img src=\"https://img.example.com/media/90781e45-39ff-4dca-a53a-672b31fd3c01/cover.png\" alt=\"cover.png\" />"
    },
    "createdAt": "2026-07-14T08:30:00.000Z"
  }
]`

const imageProcessingSettingsExample = `{
  "enabled": true,
  "outputFormat": "original",
  "quality": 85,
  "autoOrient": true,
  "stripMetadata": false,
  "allowedExtensions": ["jpg", "jpeg", "png", "gif", "webp", "svg"]
}`

const errorResponseExample = `{
  "message": "不允许上传 .heic 文件，允许类型：JPG、JPEG、PNG、GIF、WEBP、SVG"
}`

const imageFields = [
  ['url', '带域名和真实后缀的完整图片直链'],
  ['path', '站内相对路径，适合自行拼接域名'],
  ['format / extension', '标准格式名和实际文件后缀'],
  ['mimeType', '标准 MIME 类型，例如 image/png'],
  ['processing', '来源格式、实际输出、质量、旋转和元数据处理结果'],
  ['links', '直链、Markdown、BBCode、HTML 完整引用'],
  ['width / height', '从处理后图片读取的真实像素尺寸'],
  ['filename', '原文件主体名称与实际输出扩展名组成的公开文件名'],
]

const errorStatuses = [
  ['400', '参数或文件不符合要求'],
  ['401', '未登录或 Bearer 密钥无效'],
  ['403', '权限不足或游客上传关闭'],
  ['404', '资源不存在或不属于当前用户'],
  ['409', '名称冲突或资源状态冲突'],
  ['413', '文件过大或配额不足'],
  ['422', '无法读取原文件元数据'],
  ['429', 'API 月度额度或频率超限'],
  ['502', '远程存储读取、写入或删除失败'],
]

const uploadCurlExample = (baseUrl: string) => `curl -X POST "${baseUrl}/api/images" \\
  -H "Authorization: Bearer pn_live_xxx" \\
  -F "files=@cover.png" \\
  -F "files=@banner.jpg" \\
  -F "album=网站素材" \\
  -F "format=webp" \\
  -F "quality=82" \\
  -F "stripMetadata=true"`

const settingsCurlExample = (baseUrl: string) => `curl -X PATCH "${baseUrl}/api/settings/image-processing" \\
  -H "Authorization: Bearer pn_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{"allowedExtensions":["jpg","jpeg","png","gif","webp","svg","avif"]}'`

const markdownCodeBlock = (language: string, content: string) => `\`\`\`${language}\n${content}\n\`\`\``
const markdownTableCell = (value: string) => value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')

const buildMarkdownDocs = (baseUrl: string) => {
  const endpointSections = endpointGroups.flatMap((group) => [
    `### ${group.title}`,
    '',
    '| 方法 | 路径 | 说明 |',
    '| --- | --- | --- |',
    ...group.rows.map(([method, endpoint, description]) => `| ${markdownTableCell(method)} | \`${endpoint}\` | ${markdownTableCell(description)} |`),
    '',
  ])
  const fieldRows = imageFields.map(([field, description]) => `| \`${field}\` | ${description} |`)
  const statusRows = errorStatuses.map(([status, description]) => `| ${status} | ${description} |`)

  return [
    '# PicNest API 文档',
    '',
    `> API 基础地址：\`${baseUrl}\``,
    '',
    '接口返回 JSON，图片内容通过带真实后缀的 PicNest 媒体地址访问。生产部署建议设置 `PICNEST_PUBLIC_URL`，确保反向代理、脚本和返回图片地址使用一致的公网域名。',
    '',
    '## 基本约定',
    '',
    '- 请求与响应编码：`UTF-8`',
    '- 普通请求：`application/json`',
    '- 上传请求：`multipart/form-data`',
    '- 时间格式：ISO 8601，例如 `2026-07-14T08:30:00.000Z`',
    '',
    '## 身份认证',
    '',
    '自动化客户端在请求头中携带 Bearer 密钥。每把密钥只会访问其所属用户的图片、相册、配额和统计数据。',
    '',
    markdownCodeBlock('http', 'Authorization: Bearer pn_live_xxxxxxxxxxxxxxxxxxxxxxxx'),
    '',
    '密钥的创建、查看与删除只能通过网页登录会话执行，不能使用 Bearer 密钥管理其他密钥。',
    '',
    '## 上传图片',
    '',
    '`POST /api/images` 单次最多上传 20 张，每张最大 20 MB。重复提交 `files` 字段即可批量上传，`album` 可选；未填写时进入默认相册。',
    '',
    markdownCodeBlock('bash', uploadCurlExample(baseUrl)),
    '',
    '处理参数均可省略，省略时使用系统设置。`format` 支持 `default`、`original`、`jpg`、`png`、`webp`、`avif`；`quality` 为 1–100；`autoOrient` 和 `stripMetadata` 为布尔值。',
    '',
    '上传文件必须符合系统级 `allowedExtensions` 白名单，该白名单不能用单次请求覆盖。默认允许 `jpg`、`jpeg`、`png`、`gif`、`webp`、`svg`；请通过 `GET /api/public/config` 或 `GET /api/settings/image-processing` 读取当前值。',
    '',
    markdownCodeBlock('json', imageProcessingSettingsExample),
    '',
    '管理员可提交完整或部分设置；扩展名会转为小写、移除开头的点并自动去重，列表最多 32 项且不能为空。',
    '',
    markdownCodeBlock('bash', settingsCurlExample(baseUrl)),
    '',
    '上传接口始终返回数组，即使只上传一张。服务端会核对文件扩展名与二进制内容的真实格式、执行转换，并返回文件后缀、MIME 类型、处理结果和四种引用代码。游客上传不接受单次处理参数，始终使用系统默认策略和同一份白名单。',
    '',
    '## 图片对象完整响应',
    '',
    '`POST /api/images` 和 `GET /api/images` 返回图片对象数组；`GET /api/images/:id`、修改接口和游客上传中的单个元素使用同一字段结构。成功上传的 HTTP 状态为 `201`。',
    '',
    markdownCodeBlock('json', imageResponseExample),
    '',
    '### 字段说明',
    '',
    '| 字段 | 说明 |',
    '| --- | --- |',
    ...fieldRows,
    '',
    '服务端根据图片二进制内容识别格式。文件名扩展名与实际格式不一致或内容无法识别时返回 `400`；媒体响应发送正确的 `Content-Type`、内联文件名、缓存头和 ETag。',
    '',
    '## 全部接口',
    '',
    ...endpointSections,
    '## 错误格式与限制',
    '',
    markdownCodeBlock('json', errorResponseExample),
    '',
    '| 状态码 | 说明 |',
    '| --- | --- |',
    ...statusRows,
    '',
  ].join('\n')
}

const copyText = async (value: string) => {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value)
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('copy failed')
}

function ApiCode({ children }: { children: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await copyText(children)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }
  return <div className="api-doc-code"><pre>{children}</pre><button type="button" onClick={() => void copy()}>{copied ? <Check size={15} /> : <Copy size={15} />} {copied ? '已复制' : '复制'}</button></div>
}

export default function ApiDocsModal({ onClose }: { onClose: () => void }) {
  const [allCopyState, setAllCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  let baseUrl = window.location.origin
  try {
    baseUrl = window.localStorage.getItem('picnest-public-base-url')?.trim() || baseUrl
  } catch {
    // Use the current origin when browser storage is unavailable.
  }
  baseUrl = baseUrl.replace(/\/+$/, '')

  const copyAllMarkdown = async () => {
    try {
      await copyText(buildMarkdownDocs(baseUrl))
      setAllCopyState('copied')
    } catch {
      setAllCopyState('failed')
    }
    window.setTimeout(() => setAllCopyState('idle'), 1800)
  }

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.documentElement.classList.add('api-doc-open')
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.documentElement.classList.remove('api-doc-open')
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return <div className="modal-backdrop api-doc-backdrop" onMouseDown={onClose}>
    <div className="api-doc-modal" role="dialog" aria-modal="true" aria-labelledby="api-doc-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><span><small>PicNest Developer</small><h2>API 文档</h2><p>接口返回 JSON，图片内容通过带真实后缀的 PicNest 媒体地址访问。</p></span><div className="api-doc-header-actions"><button type="button" className="api-doc-copy-all" onClick={() => void copyAllMarkdown()} aria-live="polite" aria-label="复制全部 API 文档为 Markdown" title="复制全部 API 文档为 Markdown">{allCopyState === 'copied' ? <Check size={16} /> : <Copy size={16} />}<span>{allCopyState === 'copied' ? '已复制全部内容' : allCopyState === 'failed' ? '复制失败' : '复制全部 Markdown'}</span></button><button type="button" className="api-doc-close" onClick={onClose} aria-label="关闭 API 文档"><X size={19} /></button></div></header>
      <div className="api-doc-layout">
        <aside>
          <b>文档目录</b>
          <a href="#api-doc-overview">基本约定</a>
          <a href="#api-doc-auth">身份认证</a>
          <a href="#api-doc-upload">上传图片</a>
          <a href="#api-doc-response">图片对象</a>
          <a href="#api-doc-endpoints">全部接口</a>
          <a href="#api-doc-errors">错误与限制</a>
        </aside>
        <main>
          <section id="api-doc-overview">
            <h3 id="api-doc-title">基本约定</h3>
            <p>当前 API 基础地址为 <code>{baseUrl}</code>。生产部署建议设置 <code>PICNEST_PUBLIC_URL</code>，确保反向代理、脚本和返回图片地址使用一致的公网域名。</p>
            <ul><li>请求与响应编码：<code>UTF-8</code></li><li>普通请求：<code>application/json</code></li><li>上传请求：<code>multipart/form-data</code></li><li>时间格式：ISO 8601，例如 <code>2026-07-14T08:30:00.000Z</code></li></ul>
          </section>

          <section id="api-doc-auth">
            <h3>身份认证</h3>
            <p>自动化客户端在请求头中携带 Bearer 密钥。每把密钥只会访问其所属用户的图片、相册、配额和统计数据。</p>
            <ApiCode>{`Authorization: Bearer pn_live_xxxxxxxxxxxxxxxxxxxxxxxx`}</ApiCode>
            <p>密钥的创建、查看与删除只能通过网页登录会话执行，不能使用 Bearer 密钥管理其他密钥。</p>
          </section>

          <section id="api-doc-upload">
            <h3>上传图片</h3>
            <p><code>POST /api/images</code> 单次最多上传 20 张，每张最大 20 MB。重复提交 <code>files</code> 字段即可批量上传，<code>album</code> 可选；未填写时进入默认相册。</p>
            <ApiCode>{uploadCurlExample(baseUrl)}</ApiCode>
            <p>处理参数均可省略，省略时使用系统设置。<code>format</code> 支持 <code>default</code>、<code>original</code>、<code>jpg</code>、<code>png</code>、<code>webp</code>、<code>avif</code>；<code>quality</code> 为 1–100；<code>autoOrient</code> 和 <code>stripMetadata</code> 为布尔值。</p>
            <p>上传文件必须符合系统级 <code>allowedExtensions</code> 白名单，该白名单不能用单次请求覆盖。默认允许 <code>jpg</code>、<code>jpeg</code>、<code>png</code>、<code>gif</code>、<code>webp</code>、<code>svg</code>；请通过 <code>GET /api/public/config</code> 或 <code>GET /api/settings/image-processing</code> 读取当前值。</p>
            <ApiCode>{imageProcessingSettingsExample}</ApiCode>
            <p>管理员可提交完整或部分设置；扩展名会转为小写、移除开头的点并自动去重，列表最多 32 项且不能为空。</p>
            <ApiCode>{settingsCurlExample(baseUrl)}</ApiCode>
            <p>上传接口始终返回数组，即使只上传一张。服务端会核对文件扩展名与二进制内容的真实格式、执行转换，并返回文件后缀、MIME 类型、处理结果和四种引用代码。游客上传不接受单次处理参数，始终使用系统默认策略和同一份白名单。</p>
          </section>

          <section id="api-doc-response">
            <h3>图片对象完整响应</h3>
            <p><code>POST /api/images</code> 和 <code>GET /api/images</code> 返回图片对象数组；<code>GET /api/images/:id</code>、修改接口和游客上传中的单个元素使用同一字段结构。成功上传的 HTTP 状态为 <code>201</code>。</p>
            <ApiCode>{imageResponseExample}</ApiCode>
            <div className="api-doc-field-table">{imageFields.map(([field, description]) => <span key={field}><b>{field}</b><small>{description}</small></span>)}</div>
            <p className="api-doc-note">服务端根据图片二进制内容识别格式。文件名扩展名与实际格式不一致或内容无法识别时返回 <code>400</code>；媒体响应发送正确的 <code>Content-Type</code>、内联文件名、缓存头和 ETag。</p>
          </section>

          <section id="api-doc-endpoints">
            <h3>全部接口</h3>
            {endpointGroups.map((group) => <div className="api-doc-endpoint-group" key={group.title}><h4>{group.title}</h4><div>{group.rows.map(([method, endpoint, description]) => <span key={`${method}-${endpoint}`}><em>{method}</em><code>{endpoint}</code><small>{description}</small></span>)}</div></div>)}
          </section>

          <section id="api-doc-errors">
            <h3>错误格式与限制</h3>
            <ApiCode>{errorResponseExample}</ApiCode>
            <div className="api-doc-statuses">{errorStatuses.map(([status, description]) => <span key={status}><b>{status}</b>{description}</span>)}</div>
          </section>
        </main>
      </div>
    </div>
  </div>
}

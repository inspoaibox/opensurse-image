import { useEffect, useState } from 'react'
import { Check, Copy, X } from 'lucide-react'

const endpointGroups = [
  {
    title: '公开与认证',
    rows: [
      ['GET', '/api/health', '服务健康检查'],
      ['GET', '/api/public/config', '读取游客上传开关、图片/视频限制、文件上传上限'],
      ['POST', '/api/public/images', '游客上传 1–5 张图片，需管理员开启'],
      ['GET', '/api/auth/me', '读取当前认证用户；未登录时返回初始化状态'],
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
      ['PATCH', '/api/images/:id', '修改名称、相册、防盗链或收藏状态'],
      ['DELETE', '/api/images/:id', '删除图片记录与原文件'],
      ['POST', '/api/images/bulk-delete', '按 ID 数组批量删除图片'],
      ['GET', '/api/settings/image-processing', '读取系统图片处理默认策略'],
      ['GET', '/api/settings/hotlink-protection', '读取图片和视频防盗链策略'],
    ],
  },
  {
    title: '视频接口',
    rows: [
      ['GET', '/api/videos', '列出当前用户的全部视频'],
      ['POST', '/api/videos', '上传 1–10 个视频，multipart/form-data'],
      ['GET', '/api/videos/:id', '获取当前用户的单个视频详情'],
      ['PATCH', '/api/videos/:id', '修改视频名称、分类、防盗链或收藏状态'],
      ['DELETE', '/api/videos/:id', '删除视频记录与原文件'],
      ['POST', '/api/videos/bulk-delete', '按 ID 数组批量删除视频'],
    ],
  },
  {
    title: '文件接口',
    rows: [
      ['GET', '/api/files', '列出当前用户的全部文件'],
      ['POST', '/api/files', '上传 1–20 个通用文件，multipart/form-data'],
      ['GET', '/api/files/:id', '获取当前用户的单个文件详情'],
      ['PATCH', '/api/files/:id', '修改文件名称、分组或收藏状态'],
      ['DELETE', '/api/files/:id', '删除文件记录与原文件'],
      ['POST', '/api/files/bulk-delete', '按 ID 数组批量删除文件'],
      ['GET', '/api/file-groups', '列出文件分组及数量、空间统计'],
      ['POST', '/api/file-groups', '创建文件分组'],
      ['PATCH', '/api/file-groups/:id/default', '设置默认上传文件分组'],
    ],
  },
  {
    title: '远程导入',
    rows: [
      ['POST', '/api/remote-imports', '使用 URL 创建服务器端异步远程导入任务，支持图片、视频和文件'],
      ['GET', '/api/remote-imports/:id', '使用任务创建者的会话或 API 密钥查询下载进度和结果'],
    ],
  },
  {
    title: '相册与统计',
    rows: [
      ['GET', '/api/albums', '列出当前用户相册'],
      ['POST', '/api/albums', '创建相册'],
      ['PATCH', '/api/albums/:id/default', '设置默认上传相册'],
      ['GET', '/api/video-categories', '列出视频分类及数量、空间统计'],
      ['POST', '/api/video-categories', '创建视频分类'],
      ['PATCH', '/api/video-categories/:id/default', '设置默认上传视频分类'],
      ['GET', '/api/stats', '空间与本月 API 使用统计'],
      ['GET', '/api/analytics/traffic?days=30', '网页后台的每日媒体流量、外链来源与高消耗媒体统计'],
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
    title: '视频访问',
    rows: [
      ['GET', '/media/video/:id/:filename.ext', '公开读取视频，支持 Range 断点播放'],
      ['GET', '/media/video/:id', '兼容无文件名视频地址'],
    ],
  },
  {
    title: '文件访问',
    rows: [
      ['GET', '/media/file/:id/:filename.ext', '公开下载文件，返回真实 Content-Type 与下载文件名'],
      ['GET', '/media/file/:id', '兼容无文件名文件地址'],
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
      ['GET / POST', '/api/users', '列出或创建成员，仅管理员网页登录会话'],
      ['PATCH', '/api/users/:id', '编辑成员、配额与存储策略，仅管理员网页登录会话'],
      ['PATCH', '/api/settings/guest-upload', '开启或关闭游客上传，仅管理员网页登录会话'],
      ['PATCH', '/api/settings/image-processing', '修改允许上传类型与默认图片处理策略，仅管理员网页登录会话'],
      ['PATCH', '/api/settings/hotlink-protection', '修改图片和视频防盗链策略，仅管理员网页登录会话'],
      ['GET / POST', '/api/storage/providers', '列出或添加存储服务，仅网页登录会话；写操作要求管理员'],
      ['PATCH / DELETE', '/api/storage/providers/:id', '编辑或删除存储服务，仅管理员网页登录会话'],
      ['POST', '/api/storage/providers/:id/test', '检测读取、写入和删除能力，仅管理员网页登录会话'],
      ['PATCH', '/api/storage/providers/:id/default', '检测并设为系统当前存储，仅管理员网页登录会话'],
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
    "hotlinkProtectionEnabled": true,
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

const videoResponseExample = `[
  {
    "id": "1af72c3a-8a75-4df5-b7ad-1f7cc7be4b4b",
    "name": "演示视频.mp4",
    "filename": "演示视频.mp4",
    "url": "https://img.example.com/media/video/1af72c3a-8a75-4df5-b7ad-1f7cc7be4b4b/演示视频.mp4",
    "path": "/media/video/1af72c3a-8a75-4df5-b7ad-1f7cc7be4b4b/演示视频.mp4",
    "type": "MP4",
    "format": "mp4",
    "extension": ".mp4",
    "mimeType": "video/mp4",
    "size": 5242880,
    "album": "视频",
    "category": "视频",
    "starred": false,
    "hotlinkProtectionEnabled": true,
    "views": 0,
    "links": {
      "direct": "https://img.example.com/media/video/1af72c3a-8a75-4df5-b7ad-1f7cc7be4b4b/演示视频.mp4",
      "markdown": "[演示视频.mp4](https://img.example.com/media/video/1af72c3a-8a75-4df5-b7ad-1f7cc7be4b4b/演示视频.mp4)",
      "bbcode": "[video]https://img.example.com/media/video/1af72c3a-8a75-4df5-b7ad-1f7cc7be4b4b/演示视频.mp4[/video]",
      "html": "<video controls preload=\"metadata\" src=\"https://img.example.com/media/video/1af72c3a-8a75-4df5-b7ad-1f7cc7be4b4b/演示视频.mp4\"></video>"
    },
    "createdAt": "2026-07-14T08:30:00.000Z"
  }
]`

const fileResponseExample = `[
  {
    "id": "6e1ec44c-e642-49b4-bd4f-9224f5f08df8",
    "name": "项目合同.pdf",
    "filename": "项目合同.pdf",
    "url": "https://img.example.com/media/file/6e1ec44c-e642-49b4-bd4f-9224f5f08df8/项目合同.pdf",
    "path": "/media/file/6e1ec44c-e642-49b4-bd4f-9224f5f08df8/项目合同.pdf",
    "type": "PDF",
    "format": "pdf",
    "extension": ".pdf",
    "mimeType": "application/pdf",
    "size": 1048576,
    "group": "合同文档",
    "groupName": "合同文档",
    "starred": false,
    "views": 0,
    "links": {
      "direct": "https://img.example.com/media/file/6e1ec44c-e642-49b4-bd4f-9224f5f08df8/项目合同.pdf",
      "markdown": "[项目合同.pdf](https://img.example.com/media/file/6e1ec44c-e642-49b4-bd4f-9224f5f08df8/项目合同.pdf)",
      "bbcode": "[url=https://img.example.com/media/file/6e1ec44c-e642-49b4-bd4f-9224f5f08df8/项目合同.pdf]项目合同.pdf[/url]",
      "html": "<a href=\\"https://img.example.com/media/file/6e1ec44c-e642-49b4-bd4f-9224f5f08df8/项目合同.pdf\\" download>项目合同.pdf</a>"
    },
    "createdAt": "2026-07-14T08:30:00.000Z"
  }
]`

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
  ['hotlinkProtectionEnabled', '是否允许该图片参与系统防盗链校验；默认开启，可通过图片 PATCH 接口关闭'],
]

const videoFields = [
  ['url', '带域名和真实后缀的完整视频直链'],
  ['path', '站内相对路径，适合自行拼接域名'],
  ['format / extension', '标准格式名和实际文件后缀'],
  ['mimeType', '标准 MIME 类型，例如 video/mp4'],
  ['links', '直链、Markdown、BBCode、HTML5 video 完整引用'],
  ['filename', '视频公开文件名；重命名后仍会保持真实视频格式扩展名'],
  ['category', '视频所属分类；上传和修改时使用，未填写时使用默认分类'],
  ['album', '兼容旧客户端的分类字段别名'],
  ['views', '通过 PicNest 媒体地址播放或读取时累计的访问次数'],
  ['hotlinkProtectionEnabled', '是否允许该视频参与系统防盗链校验；默认开启，可通过视频 PATCH 接口关闭'],
]

const fileFields = [
  ['url', '带域名和真实后缀的完整文件直链'],
  ['path', '站内相对路径，适合自行拼接域名'],
  ['format / extension', '标准格式名和实际文件后缀'],
  ['mimeType', '标准 MIME 类型，例如 application/pdf'],
  ['links', '直链、Markdown、BBCode、HTML 下载链接'],
  ['filename', '文件公开文件名；重命名后仍会保持真实文件格式扩展名'],
  ['group / groupName', '文件所属分组；上传和修改时使用 group 或 groupName'],
  ['views', '通过 PicNest 文件地址下载或读取时累计的访问次数'],
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
  ['500', '服务器内部异常'],
]

const uploadCurlExample = (baseUrl: string) => `curl -X POST "${baseUrl}/api/images" \\
  -H "Authorization: Bearer pn_live_xxx" \\
  -F "files=@cover.png" \\
  -F "files=@banner.jpg" \\
  -F "album=网站素材" \\
  -F "format=webp" \\
  -F "quality=82" \\
  -F "stripMetadata=true"`

const videoUploadCurlExample = (baseUrl: string) => `curl -X POST "${baseUrl}/api/videos" \\
  -H "Authorization: Bearer pn_live_xxx" \\
  -F "files=@demo.mp4" \\
  -F "files=@screen-recording.webm" \\
  -F "category=产品演示"`

const fileUploadCurlExample = (baseUrl: string) => `curl -X POST "${baseUrl}/api/files" \\
  -H "Authorization: Bearer pn_live_xxx" \\
  -F "files=@contract.pdf" \\
  -F "files=@brief.zip" \\
  -F "group=合同文档"`

const remoteImportCurlExample = (baseUrl: string) => `# 创建远程导入任务
curl -X POST "${baseUrl}/api/remote-imports" \\
  -H "Authorization: Bearer pn_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://static.atlascloud.ai/prompt/seedance/seedance-2-0-prompts_4512_1.mp4","category":"远程视频","fileGroup":"远程文件","connections":8}'

# 使用返回的任务 ID 查询进度
curl "${baseUrl}/api/remote-imports/TASK_ID" \\
  -H "Authorization: Bearer pn_live_xxx"`

const videoManagementCurlExample = (baseUrl: string) => `# 查询视频列表
curl "${baseUrl}/api/videos" \\
  -H "Authorization: Bearer pn_live_xxx"

# 修改视频名称、分类或收藏状态
curl -X PATCH "${baseUrl}/api/videos/video-id" \\
  -H "Authorization: Bearer pn_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"新版演示.mp4","category":"产品演示","starred":true}'

# 批量删除视频
curl -X POST "${baseUrl}/api/videos/bulk-delete" \\
  -H "Authorization: Bearer pn_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{"ids":["video-id-1","video-id-2"]}'`

const videoCategoryCurlExample = (baseUrl: string) => `# 查询视频分类
curl "${baseUrl}/api/video-categories" \\
  -H "Authorization: Bearer pn_live_xxx"

# 创建视频分类
curl -X POST "${baseUrl}/api/video-categories" \\
  -H "Authorization: Bearer pn_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"产品演示"}'

# 设置默认视频分类
curl -X PATCH "${baseUrl}/api/video-categories/category-id/default" \\
  -H "Authorization: Bearer pn_live_xxx"`

const fileManagementCurlExample = (baseUrl: string) => `# 查询文件列表
curl "${baseUrl}/api/files" \\
  -H "Authorization: Bearer pn_live_xxx"

# 修改文件名称、分组或收藏状态
curl -X PATCH "${baseUrl}/api/files/file-id" \\
  -H "Authorization: Bearer pn_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"新版合同.pdf","group":"合同文档","starred":true}'

# 批量删除文件
curl -X POST "${baseUrl}/api/files/bulk-delete" \\
  -H "Authorization: Bearer pn_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{"ids":["file-id-1","file-id-2"]}'`

const fileGroupCurlExample = (baseUrl: string) => `# 查询文件分组
curl "${baseUrl}/api/file-groups" \\
  -H "Authorization: Bearer pn_live_xxx"

# 创建文件分组
curl -X POST "${baseUrl}/api/file-groups" \\
  -H "Authorization: Bearer pn_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"合同文档"}'

# 设置默认文件分组
curl -X PATCH "${baseUrl}/api/file-groups/group-id/default" \\
  -H "Authorization: Bearer pn_live_xxx"`

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
  const fileFieldRows = fileFields.map(([field, description]) => `| \`${field}\` | ${description} |`)
  const statusRows = errorStatuses.map(([status, description]) => `| ${status} | ${description} |`)

  return [
    '# PicNest API 文档',
    '',
    `> API 基础地址：\`${baseUrl}\``,
    '',
    '接口返回 JSON，图片、视频和文件内容通过带真实后缀的 PicNest 资源地址访问。生产部署建议设置 `PICNEST_PUBLIC_URL`，确保反向代理、脚本和返回资源地址使用一致的公网域名。',
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
    '自动化客户端在请求头中携带 Bearer 密钥。每把密钥只会访问其所属用户的图片、视频、文件、分组、配额和统计数据。',
    '',
    markdownCodeBlock('http', 'Authorization: Bearer $PICNEST_TOKEN'),
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
    '上传图片必须符合系统级 `allowedExtensions` 白名单，该白名单不能用单次请求覆盖。默认允许 `jpg`、`jpeg`、`png`、`gif`、`webp`、`svg`；请通过 `GET /api/public/config` 或 `GET /api/settings/image-processing` 读取当前值。文件库不使用这份白名单限制通用文件扩展名。',
    '',
    markdownCodeBlock('json', imageProcessingSettingsExample),
    '',
    '管理员可通过网页登录会话提交完整或部分设置；扩展名会转为小写、移除开头的点并自动去重，列表最多 32 项且不能为空。Bearer 密钥不能修改成员、存储和系统设置。',
    '',
    '上传接口始终返回数组，即使只上传一张。服务端会核对文件扩展名与二进制内容的真实格式、执行转换，并返回文件后缀、MIME 类型、处理结果和四种引用代码。游客上传不接受单次处理参数，始终使用系统默认策略和同一份白名单。',
    '',
    '## 上传视频',
    '',
    '`POST /api/videos` 单次最多上传 10 个视频，单个大小上限由服务端环境变量 `PICNEST_VIDEO_MAX_MB` 控制，默认 500 MB。重复提交 `files` 字段即可批量上传；支持 `mp4`、`webm`、`mov`、`m4v`、`avi`、`mkv`。可选的 `category` 字段指定视频分类；未填写时使用默认视频分类，也兼容旧字段 `album`。',
    '',
    markdownCodeBlock('bash', videoUploadCurlExample(baseUrl)),
    '',
    '视频不会经过图片处理引擎，服务端会校验扩展名与请求 MIME 类型，并按原始字节保存。返回对象包含可公开访问的直链、Markdown、BBCode 和 HTML5 video 引用，以及 `category` 分类字段。视频媒体地址支持 `Range` 请求，浏览器可以按需加载、拖动进度和断点播放。',
    '',
    '## 上传文件',
    '',
    '`POST /api/files` 单次最多上传 20 个通用文件，单个大小上限由服务端环境变量 `PICNEST_FILE_MAX_MB` 控制，默认 1024 MB。重复提交 `files` 字段即可批量上传；可选的 `group` 或 `groupName` 字段指定文件分组，未填写时使用默认文件分组。',
    '',
    markdownCodeBlock('bash', fileUploadCurlExample(baseUrl)),
    '',
    '文件不会经过图片或视频处理引擎，也不限制具体扩展名；服务端只校验文件名长度、扩展名是否包含路径分隔符/控制字符/常见非法文件名字符、大小和配额，并按原始字节保存。请通过 `GET /api/public/config` 读取当前文件大小上限。',
    '',
    '## 远程导入',
    '',
    '`POST /api/remote-imports` 接收 JSON 中的 `url` 或 `source`，由 PicNest 服务器直接下载远程 HTTP/HTTPS 资源。支持 Bearer API 密钥或网页登录会话；接口立即返回 `202` 和任务对象，客户端应使用 `GET /api/remote-imports/:id` 轮询状态。',
    '',
    markdownCodeBlock('bash', remoteImportCurlExample(baseUrl)),
    '',
    '`category` 仅在最终识别为视频时使用，`album` 仅在最终识别为图片时使用，`fileGroup` 或 `group` 仅在最终识别为文件时使用；`connections` 可选，范围为 1–16。服务端会根据实际图片格式、视频扩展名/MIME 类型或文件扩展名/MIME 类型自动分流，任务完成后 `result` 返回对应的图片、视频或文件对象。仅允许 HTTP/HTTPS，默认拒绝本机、局域网和其他私有地址。',
    '',
    '## 媒体防盗链',
    '',
    '`GET /api/settings/hotlink-protection` 读取系统级策略；管理员网页登录会话可以使用 `PATCH /api/settings/hotlink-protection` 修改策略。图片和视频默认都开启，两个类型可以独立控制；`trustedDomains` 填写不带协议、路径或端口的域名，配置 `example.com` 后其子域名也会被允许引用。',
    '',
    markdownCodeBlock('json', `{
  "imageEnabled": true,
  "videoEnabled": true,
  "trustedDomains": ["player.example.com", "cdn.example.com"]
}`),
    '',
    '单个图片或视频还可以通过各自的 PATCH 接口覆盖默认值。系统类型开关和单媒体开关需要同时开启才会执行防盗链校验；关闭单媒体开关后，该媒体允许外部网站直接引用。',
    '',
    markdownCodeBlock('bash', `# 关闭单张图片的防盗链
curl -X PATCH "${baseUrl}/api/images/IMAGE_ID" \\
  -H "Authorization: Bearer pn_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{"hotlinkProtectionEnabled":false}'

# 开启单个视频的防盗链
curl -X PATCH "${baseUrl}/api/videos/VIDEO_ID" \\
  -H "Authorization: Bearer pn_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{"hotlinkProtectionEnabled":true}'`),
    '',
    '受保护媒体会检查 `Referer`、`Origin` 和浏览器的跨站请求标记：站内来源、可信域名及其子域名允许；无来源的直接访问默认允许，以兼容 curl、播放器和隐私浏览器；明确的外部来源返回 `403`。视频的 Range 请求也使用同一规则。',
    '',
    '防盗链开启时媒体响应使用 `Cache-Control: private, no-store`，并返回按来源变化的 `Vary`，避免 CDN 将一个允许来源的响应复用给其他来源。若前置 CDN 会直接缓存或回源策略覆盖响应头，还应在 CDN 层同步配置防盗链规则。此功能主要防止网页盗嵌，不能替代登录授权或签名 URL。',
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
    '## 视频对象完整响应',
    '',
    '`POST /api/videos` 和 `GET /api/videos` 返回视频对象数组；`GET /api/videos/:id` 与修改接口返回单个视频对象。成功上传的 HTTP 状态为 `201`。',
    '',
    markdownCodeBlock('json', videoResponseExample),
    '',
    '### 字段说明',
    '',
    '| 字段 | 说明 |',
    '| --- | --- |',
    ...videoFields.map(([field, description]) => `| \`${field}\` | ${description} |`),
    '',
    '视频公开地址不要求登录，删除和列表接口仍只允许所有者或其 Bearer 密钥访问。媒体响应支持 `Accept-Ranges: bytes`；请求 `Range: bytes=0-1048575` 时返回 `206 Partial Content`。',
    '',
    '## 文件对象完整响应',
    '',
    '`POST /api/files` 和 `GET /api/files` 返回文件对象数组；`GET /api/files/:id` 与修改接口返回单个文件对象。成功上传的 HTTP 状态为 `201`。',
    '',
    markdownCodeBlock('json', fileResponseExample),
    '',
    '### 字段说明',
    '',
    '| 字段 | 说明 |',
    '| --- | --- |',
    ...fileFieldRows,
    '',
    '文件公开地址不要求登录，删除和列表接口仍只允许所有者或其 Bearer 密钥访问。文件响应默认使用 `Content-Disposition: attachment`，浏览器会按下载处理，适合分享文档、压缩包和交付文件。',
    '',
    '## 文件管理',
    '',
    '使用 `GET /api/files` 查询列表，使用 `GET /api/files/:id` 查询单个文件；`PATCH /api/files/:id` 可修改 `name`、`group` 和 `starred`，`POST /api/files/bulk-delete` 可按 ID 数组批量删除。',
    '',
    markdownCodeBlock('bash', fileManagementCurlExample(baseUrl)),
    '',
    '## 文件分组',
    '',
    '`GET /api/file-groups` 返回当前用户的文件分组、默认分组标记、文件数量和占用空间。`POST /api/file-groups` 创建分组，名称长度为 1–100 个字符，每位用户最多 500 个分组；`PATCH /api/file-groups/:id/default` 设置默认上传分组。文件分组与图片相册、视频分类独立管理。',
    '',
    markdownCodeBlock('bash', fileGroupCurlExample(baseUrl)),
    '',
    '## 视频管理',
    '',
    '使用 `GET /api/videos` 查询列表，使用 `GET /api/videos/:id` 查询单个视频；`PATCH /api/videos/:id` 可修改 `name`、`category` 和 `starred`，`POST /api/videos/bulk-delete` 可按 ID 数组批量删除。',
    '',
    markdownCodeBlock('bash', videoManagementCurlExample(baseUrl)),
    '',
    '## 视频分类',
    '',
    '`GET /api/video-categories` 返回当前用户的视频分类、默认分类标记、视频数量、占用空间和最近视频封面。`POST /api/video-categories` 创建分类，名称长度为 1–100 个字符，每位用户最多 500 个分类；`PATCH /api/video-categories/:id/default` 设置默认上传分类。视频分类与图片相册独立管理。',
    '',
    markdownCodeBlock('bash', videoCategoryCurlExample(baseUrl)),
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
  const baseUrl = window.location.origin.replace(/\/+$/, '')

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
      <header><span><small>PicNest Developer</small><h2>API 文档</h2><p>接口返回 JSON，图片、视频和文件内容通过带真实后缀的 PicNest 资源地址访问。</p></span><div className="api-doc-header-actions"><button type="button" className="api-doc-copy-all" onClick={() => void copyAllMarkdown()} aria-live="polite" aria-label="复制全部 API 文档为 Markdown" title="复制全部 API 文档为 Markdown">{allCopyState === 'copied' ? <Check size={16} /> : <Copy size={15} />}<span>{allCopyState === 'copied' ? '已复制全部内容' : allCopyState === 'failed' ? '复制失败' : '复制全部 Markdown'}</span></button><button type="button" className="api-doc-close" onClick={onClose} aria-label="关闭 API 文档"><X size={19} /></button></div></header>
      <div className="api-doc-layout">
        <aside>
          <b>文档目录</b>
          <a href="#api-doc-overview">基本约定</a>
          <a href="#api-doc-auth">身份认证</a>
          <a href="#api-doc-upload">上传图片</a>
          <a href="#api-doc-response">图片对象</a>
          <a href="#api-doc-video-upload">上传视频</a>
          <a href="#api-doc-video-response">视频对象</a>
          <a href="#api-doc-video-management">视频管理</a>
          <a href="#api-doc-video-categories">视频分类</a>
          <a href="#api-doc-file-upload">上传文件</a>
          <a href="#api-doc-file-response">文件对象</a>
          <a href="#api-doc-file-management">文件管理</a>
          <a href="#api-doc-file-groups">文件分组</a>
          <a href="#api-doc-remote-import">远程导入</a>
          <a href="#api-doc-hotlink-protection">媒体防盗链</a>
          <a href="#api-doc-endpoints">全部接口</a>
          <a href="#api-doc-errors">错误与限制</a>
        </aside>
        <main>
          <section id="api-doc-overview">
            <h3 id="api-doc-title">基本约定</h3>
            <p>当前 API 基础地址为 <code>{baseUrl}</code>。生产部署建议设置 <code>PICNEST_PUBLIC_URL</code>，确保反向代理、脚本和返回资源地址使用一致的公网域名。</p>
            <ul><li>请求与响应编码：<code>UTF-8</code></li><li>普通请求：<code>application/json</code></li><li>上传请求：<code>multipart/form-data</code></li><li>时间格式：ISO 8601，例如 <code>2026-07-14T08:30:00.000Z</code></li></ul>
          </section>

          <section id="api-doc-auth">
            <h3>身份认证</h3>
            <p>自动化客户端在请求头中携带 Bearer 密钥。每把密钥只会访问其所属用户的图片、视频、文件、分组、配额和统计数据。</p>
            <ApiCode>{`Authorization: Bearer $PICNEST_TOKEN`}</ApiCode>
            <p>密钥的创建、查看与删除只能通过网页登录会话执行，不能使用 Bearer 密钥管理其他密钥。</p>
          </section>

          <section id="api-doc-upload">
            <h3>上传图片</h3>
            <p><code>POST /api/images</code> 单次最多上传 20 张，每张最大 20 MB。重复提交 <code>files</code> 字段即可批量上传，<code>album</code> 可选；未填写时进入默认相册。</p>
            <ApiCode>{uploadCurlExample(baseUrl)}</ApiCode>
            <p>处理参数均可省略，省略时使用系统设置。<code>format</code> 支持 <code>default</code>、<code>original</code>、<code>jpg</code>、<code>png</code>、<code>webp</code>、<code>avif</code>；<code>quality</code> 为 1–100；<code>autoOrient</code> 和 <code>stripMetadata</code> 为布尔值。</p>
            <p>上传图片必须符合系统级 <code>allowedExtensions</code> 白名单，该白名单不能用单次请求覆盖。默认允许 <code>jpg</code>、<code>jpeg</code>、<code>png</code>、<code>gif</code>、<code>webp</code>、<code>svg</code>；请通过 <code>GET /api/public/config</code> 或 <code>GET /api/settings/image-processing</code> 读取当前值。文件库不使用这份白名单限制通用文件扩展名。</p>
            <ApiCode>{imageProcessingSettingsExample}</ApiCode>
            <p>管理员可通过网页登录会话提交完整或部分设置；扩展名会转为小写、移除开头的点并自动去重，列表最多 32 项且不能为空。Bearer 密钥不能修改成员、存储和系统设置。</p>
            <p>上传接口始终返回数组，即使只上传一张。服务端会核对文件扩展名与二进制内容的真实格式、执行转换，并返回文件后缀、MIME 类型、处理结果和四种引用代码。游客上传不接受单次处理参数，始终使用系统默认策略和同一份白名单。</p>
          </section>

          <section id="api-doc-response">
            <h3>图片对象完整响应</h3>
            <p><code>POST /api/images</code> 和 <code>GET /api/images</code> 返回图片对象数组；<code>GET /api/images/:id</code>、修改接口和游客上传中的单个元素使用同一字段结构。成功上传的 HTTP 状态为 <code>201</code>。</p>
            <ApiCode>{imageResponseExample}</ApiCode>
            <div className="api-doc-field-table">{imageFields.map(([field, description]) => <span key={field}><b>{field}</b><small>{description}</small></span>)}</div>
            <p className="api-doc-note">服务端根据图片二进制内容识别格式。文件名扩展名与实际格式不一致或内容无法识别时返回 <code>400</code>；媒体响应发送正确的 <code>Content-Type</code>、内联文件名、缓存头和 ETag。</p>
          </section>

          <section id="api-doc-video-upload">
            <h3>上传视频</h3>
            <p><code>POST /api/videos</code> 单次最多上传 10 个视频，单个大小上限由服务端环境变量 <code>PICNEST_VIDEO_MAX_MB</code> 控制，默认 500 MB。支持 <code>mp4</code>、<code>webm</code>、<code>mov</code>、<code>m4v</code>、<code>avi</code>、<code>mkv</code>；可选 <code>category</code> 指定视频分类，未填写时使用默认分类，也兼容旧字段 <code>album</code>。</p>
            <ApiCode>{videoUploadCurlExample(baseUrl)}</ApiCode>
            <p>视频不会经过图片处理引擎，服务端会校验扩展名与请求 MIME 类型，并按原始字节保存。返回对象包含直链、Markdown、BBCode 和 HTML5 video 引用，以及 <code>category</code> 分类字段；视频媒体地址支持 <code>Range</code> 请求，适合浏览器按需加载和拖动进度。</p>
          </section>

          <section id="api-doc-file-upload">
            <h3>上传文件</h3>
            <p><code>POST /api/files</code> 单次最多上传 20 个通用文件，单个大小上限由服务端环境变量 <code>PICNEST_FILE_MAX_MB</code> 控制，默认 1024 MB。可选 <code>group</code> 或 <code>groupName</code> 指定文件分组，未填写时使用默认文件分组。</p>
            <ApiCode>{fileUploadCurlExample(baseUrl)}</ApiCode>
            <p>文件不会经过图片或视频处理引擎，也不限制具体扩展名；服务端只校验文件名长度、扩展名是否包含路径分隔符/控制字符/常见非法文件名字符、大小和配额，并按原始字节保存。请通过 <code>GET /api/public/config</code> 读取当前文件大小上限。</p>
          </section>

          <section id="api-doc-remote-import">
            <h3>远程导入</h3>
            <p><code>POST /api/remote-imports</code> 接收 JSON 中的 <code>url</code> 或 <code>source</code>，由 PicNest 服务器直接下载远程 HTTP/HTTPS 资源。支持 Bearer API 密钥或网页登录会话；接口立即返回 <code>202</code> 和任务对象，客户端应使用 <code>GET /api/remote-imports/:id</code> 轮询状态。</p>
            <ApiCode>{remoteImportCurlExample(baseUrl)}</ApiCode>
            <p><code>category</code> 仅在最终识别为视频时使用，<code>album</code> 仅在最终识别为图片时使用，<code>fileGroup</code> 或 <code>group</code> 仅在最终识别为文件时使用；<code>connections</code> 可选，范围为 1–16。服务端会根据实际图片格式、视频扩展名/MIME 类型或文件扩展名/MIME 类型自动分流，任务完成后 <code>result</code> 返回对应的图片、视频或文件对象。仅允许 HTTP/HTTPS，默认拒绝本机、局域网和其他私有地址。</p>
          </section>

          <section id="api-doc-hotlink-protection">
            <h3>媒体防盗链</h3>
            <p><code>GET /api/settings/hotlink-protection</code> 读取系统级策略；管理员网页登录会话可以使用 <code>PATCH /api/settings/hotlink-protection</code> 修改策略。图片和视频默认都开启，两个类型可以独立控制；<code>trustedDomains</code> 填写不带协议、路径或端口的域名，配置 <code>example.com</code> 后其子域名也会被允许引用。</p>
            <ApiCode>{`{
  "imageEnabled": true,
  "videoEnabled": true,
  "trustedDomains": ["player.example.com", "cdn.example.com"]
}`}</ApiCode>
            <p>单个图片或视频还可以通过各自的 PATCH 接口覆盖默认值。系统类型开关和单媒体开关需要同时开启才会执行防盗链校验；关闭单媒体开关后，该媒体允许外部网站直接引用。</p>
            <ApiCode>{`# 关闭单张图片的防盗链
curl -X PATCH "${baseUrl}/api/images/IMAGE_ID" \\
  -H "Authorization: Bearer pn_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{"hotlinkProtectionEnabled":false}'

# 开启单个视频的防盗链
curl -X PATCH "${baseUrl}/api/videos/VIDEO_ID" \\
  -H "Authorization: Bearer pn_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{"hotlinkProtectionEnabled":true}'`}</ApiCode>
            <p>受保护媒体会检查 <code>Referer</code>、<code>Origin</code> 和浏览器的跨站请求标记：站内来源、可信域名及其子域名允许；无来源的直接访问默认允许，以兼容 curl、播放器和隐私浏览器；明确的外部来源返回 <code>403</code>。视频的 Range 请求也使用同一规则。</p>
            <p className="api-doc-note">防盗链开启时媒体响应使用 <code>Cache-Control: private, no-store</code>，并返回按来源变化的 <code>Vary</code>，避免 CDN 将一个允许来源的响应复用给其他来源。若前置 CDN 会直接缓存或回源策略覆盖响应头，还应在 CDN 层同步配置防盗链规则。此功能主要防止网页盗嵌，不能替代登录授权或签名 URL。</p>
          </section>

          <section id="api-doc-video-response">
            <h3>视频对象完整响应</h3>
            <p><code>POST /api/videos</code> 和 <code>GET /api/videos</code> 返回视频对象数组；<code>GET /api/videos/:id</code> 与修改接口返回单个视频对象。成功上传的 HTTP 状态为 <code>201</code>。</p>
            <ApiCode>{videoResponseExample}</ApiCode>
            <div className="api-doc-field-table">{videoFields.map(([field, description]) => <span key={field}><b>{field}</b><small>{description}</small></span>)}</div>
            <p className="api-doc-note">视频公开地址不要求登录，删除和列表接口仍只允许所有者或其 Bearer 密钥访问。媒体响应支持 <code>Accept-Ranges: bytes</code>；请求 <code>Range: bytes=0-1048575</code> 时返回 <code>206 Partial Content</code>。</p>
          </section>

          <section id="api-doc-video-management">
            <h3>视频管理</h3>
            <p>使用 <code>GET /api/videos</code> 查询视频列表，使用 <code>GET /api/videos/:id</code> 查询单个视频；<code>PATCH /api/videos/:id</code> 可修改 <code>name</code>、<code>category</code> 和 <code>starred</code>，<code>POST /api/videos/bulk-delete</code> 可按 ID 数组批量删除。</p>
            <ApiCode>{videoManagementCurlExample(baseUrl)}</ApiCode>
          </section>

          <section id="api-doc-video-categories">
            <h3>视频分类</h3>
            <p><code>GET /api/video-categories</code> 返回当前用户的视频分类、默认分类标记、视频数量、占用空间和最近视频封面。<code>POST /api/video-categories</code> 创建分类，名称长度为 1–100 个字符，每位用户最多 500 个分类；<code>PATCH /api/video-categories/:id/default</code> 设置默认上传分类。视频分类与图片相册独立管理。</p>
            <ApiCode>{videoCategoryCurlExample(baseUrl)}</ApiCode>
          </section>

          <section id="api-doc-file-response">
            <h3>文件对象完整响应</h3>
            <p><code>POST /api/files</code> 和 <code>GET /api/files</code> 返回文件对象数组；<code>GET /api/files/:id</code> 与修改接口返回单个文件对象。成功上传的 HTTP 状态为 <code>201</code>。</p>
            <ApiCode>{fileResponseExample}</ApiCode>
            <div className="api-doc-field-table">{fileFields.map(([field, description]) => <span key={field}><b>{field}</b><small>{description}</small></span>)}</div>
            <p className="api-doc-note">文件公开地址不要求登录，删除和列表接口仍只允许所有者或其 Bearer 密钥访问。文件响应默认使用 <code>Content-Disposition: attachment</code>，浏览器会按下载处理，适合分享文档、压缩包和交付文件。</p>
          </section>

          <section id="api-doc-file-management">
            <h3>文件管理</h3>
            <p>使用 <code>GET /api/files</code> 查询列表，使用 <code>GET /api/files/:id</code> 查询单个文件；<code>PATCH /api/files/:id</code> 可修改 <code>name</code>、<code>group</code> 和 <code>starred</code>，<code>POST /api/files/bulk-delete</code> 可按 ID 数组批量删除。</p>
            <ApiCode>{fileManagementCurlExample(baseUrl)}</ApiCode>
          </section>

          <section id="api-doc-file-groups">
            <h3>文件分组</h3>
            <p><code>GET /api/file-groups</code> 返回当前用户的文件分组、默认分组标记、文件数量和占用空间。<code>POST /api/file-groups</code> 创建分组，名称长度为 1–100 个字符，每位用户最多 500 个分组；<code>PATCH /api/file-groups/:id/default</code> 设置默认上传分组。文件分组与图片相册、视频分类独立管理。</p>
            <ApiCode>{fileGroupCurlExample(baseUrl)}</ApiCode>
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

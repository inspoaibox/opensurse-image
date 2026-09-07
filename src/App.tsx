import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Album,
  ArrowRight,
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  Clipboard,
  Cloud,
  Code2,
  Copy,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  Files,
  FolderPlus,
  Gauge,
  Grid2X2,
  HardDrive,
  Heart,
  Image as ImageIcon,
  Images,
  KeyRound,
  LayoutDashboard,
  LoaderCircle,
  Link2,
  List,
  Lock,
  LogOut,
  Mail,
  Maximize2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings,
  Share2,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  Star,
  Trash2,
  Upload,
  UserPlus,
  Users,
  Video,
  X,
} from 'lucide-react'
import type { AlbumItem, ApiKeyItem, FileGroupItem, FileItem, HotlinkProtectionSettings, ImageItem, ImageMetadata, ImageProcessingSettings, RemoteImportTask, Stats, StorageProviderItem, StorageProviderType, TrafficAnalytics, User, UserSummary, VideoCategoryItem, VideoItem, ViewName } from './types'
import ApiDocsModal from './ApiDocsModal'

const defaultStats: Stats = {
  images: 0,
  videos: 0,
  files: 0,
  used: 0,
  limit: 10 * 1024 ** 3,
  traffic: 0,
  apiCalls: 0,
  apiLimit: 50000,
  apiSuccessRate: 0,
  apiAverageResponseMs: 0,
}

const defaultAllowedExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg']
const defaultVideoExtensions = ['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv']
const defaultFileExtensions = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'md', 'json', 'xml', 'zip', 'rar', '7z']
const defaultVideoMaxFileSize = 500 * 1024 * 1024
const defaultFileMaxFileSize = 1024 * 1024 * 1024
const defaultHotlinkProtection: HotlinkProtectionSettings = {
  imageEnabled: true,
  videoEnabled: true,
  trustedDomains: [],
}
const extensionAccept = (extensions: string[]) => extensions.map((extension) => `.${extension}`).join(',')
const extensionSummary = (extensions: string[]) => extensions.map((extension) => extension.toUpperCase()).join('、')
const mediaExtensionAccept = (imageExtensions: string[], videoExtensions: string[], fileExtensions: string[]) => [...imageExtensions, ...videoExtensions, ...fileExtensions].map((extension) => `.${extension}`).join(',')
const uploadFileMatches = (file: File, extensions: string[]) => {
  const extension = file.name.split('.').pop()?.toLowerCase()
  return Boolean(extension && file.name.includes('.') && extensions.includes(extension))
}

const validateUploadSelection = (files: File[], extensions: string[], maxFiles: number, maxFileSize: number) => {
  if (!files.length) return '请选择需要上传的图片'
  if (files.length > maxFiles) return `单次最多上传 ${maxFiles} 张图片`
  const invalidType = files.find((file) => !uploadFileMatches(file, extensions))
  if (invalidType) return `${invalidType.name} 的文件类型不在允许列表中`
  const oversized = files.find((file) => file.size > maxFileSize)
  if (oversized) return `${oversized.name} 超过 ${Math.round(maxFileSize / 1024 / 1024)} MB 限制`
  return ''
}

const videoFileMatches = (file: File, extensions: string[]) => {
  const extension = file.name.split('.').pop()?.toLowerCase()
  return Boolean(extension && file.name.includes('.') && extensions.includes(extension))
}
const generalFileMatches = (file: File, extensions: string[]) => {
  const extension = file.name.split('.').pop()?.toLowerCase()
  return Boolean(extension && file.name.includes('.') && extensions.includes(extension))
}
const mediaFileMatches = (file: File, imageExtensions: string[], videoExtensions: string[], fileExtensions: string[]) => uploadFileMatches(file, imageExtensions) || videoFileMatches(file, videoExtensions) || generalFileMatches(file, fileExtensions)

const viewMeta: Record<ViewName, { title: string; eyebrow: string }> = {
  dashboard: { title: '工作台', eyebrow: '今天也要好好整理灵感' },
  gallery: { title: '图片库', eyebrow: '查找、整理与分享全部素材' },
  media: { title: '媒体库', eyebrow: '分别管理图片相册与视频分类' },
  files: { title: '文件库', eyebrow: '上传、分组与分享通用文件' },
  analytics: { title: '统计分析', eyebrow: '查看引用分享流量与异常访问' },
  users: { title: '成员管理', eyebrow: '管理团队成员与空间权限' },
  developer: { title: '开发者', eyebrow: 'API、密钥与自动化工作流' },
  settings: { title: '系统设置', eyebrow: '存储、安全与个性化偏好' },
}

const storageTypeLabels: Record<StorageProviderType, string> = {
  local: '本地文件系统',
  'tencent-cos': '腾讯云 COS',
  'aliyun-oss': '阿里云 OSS',
  'huawei-obs': '华为云 OBS',
  webdav: 'WebDAV',
  's3-compatible': 'S3 兼容存储',
}

const storageProviderSummary = (provider: StorageProviderItem) => {
  const imagePath = provider.config.imagePathPrefix || (provider.type === 'local' ? 'server/uploads' : '根目录')
  const videoPath = provider.config.videoPathPrefix || (provider.type === 'local' ? 'server/uploads' : '根目录')
  const filePath = provider.config.filePathPrefix || (provider.type === 'local' ? 'server/uploads' : '根目录')
  if (provider.type === 'local') return `图片：${imagePath} · 视频：${videoPath} · 文件：${filePath} · SQLite 元数据`
  if (provider.type === 'webdav') return `${provider.config.baseUrl || '尚未配置服务地址'} · 图片：${imagePath} · 视频：${videoPath} · 文件：${filePath}`
  return [
    provider.config.bucket,
    provider.config.region || provider.config.endpoint,
    provider.config.useInternalEndpoint ? '内网读写' : '',
    `图片：${imagePath}`,
    `视频：${videoPath}`,
    `文件：${filePath}`,
  ].filter(Boolean).join(' · ')
}

const formatBytes = (value: number) => {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  const amount = value / 1024 ** exponent
  return `${amount >= 10 || exponent === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[exponent]}`
}

const formatDate = (value: string) => {
  const date = new Date(value)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  if (diff < 24 * 60 * 60 * 1000 && date.getDate() === now.getDate()) {
    return `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
  }
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

const formatAnalyticsDate = (value: string) => {
  const date = new Date(`${value}T12:00:00`)
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

const videoCategoryName = (video: VideoItem) => video.category || video.album || '视频'
const fileGroupName = (file: FileItem) => file.groupName || file.group || '文件'

type VideoUploadPhase = 'uploading' | 'processing'
type UploadPhase = 'images' | 'videos' | 'files' | null

interface VideoUploadStatus {
  phase: VideoUploadPhase
  loaded: number
  total: number
  percent: number
  speed: number
  eta: number | null
  stalled: boolean
}

const formatTransferRate = (bytesPerSecond: number) => `${formatBytes(bytesPerSecond)}/秒`

const formatEta = (seconds: number | null) => {
  if (seconds === null || !Number.isFinite(seconds)) return '正在估算'
  if (seconds < 60) return `约 ${Math.max(1, Math.round(seconds))} 秒`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  return `约 ${minutes} 分 ${remainingSeconds} 秒`
}

function uploadMultipartRequest<T extends unknown[]>(
  url: string,
  form: FormData,
  onProgress: (loaded: number, total: number) => void,
  onUploadComplete = () => {},
  errorLabel = '上传',
) {
  return new Promise<T>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', url)
    request.responseType = 'json'
    request.withCredentials = true
    request.setRequestHeader('Accept', 'application/json')
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total)
    })
    request.upload.addEventListener('load', onUploadComplete)
    request.addEventListener('load', () => {
      const body = request.response as { message?: string } | T | null
      if (request.status < 200 || request.status >= 300) {
        const message = body && !Array.isArray(body) && typeof body.message === 'string' ? body.message : `${errorLabel}失败`
        reject(new Error(message))
        return
      }
      if (!Array.isArray(body)) {
        reject(new Error(`${errorLabel}返回格式不正确`))
        return
      }
      resolve(body as T)
    })
    request.addEventListener('error', () => reject(new Error('上传连接失败，请检查网络后重试')))
    request.addEventListener('abort', () => reject(new Error('上传已取消')))
    request.send(form)
  })
}

const uploadImageRequest = (
  form: FormData,
  onProgress: (loaded: number, total: number) => void,
) => uploadMultipartRequest<ImageItem[]>('/api/images', form, onProgress, undefined, '图片上传')

const uploadVideoRequest = (
  form: FormData,
  onProgress: (loaded: number, total: number) => void,
  onProcessing: () => void,
) => uploadMultipartRequest<VideoItem[]>('/api/videos', form, onProgress, onProcessing, '视频上传')

const uploadFileRequest = (
  form: FormData,
  onProgress: (loaded: number, total: number) => void,
) => uploadMultipartRequest<FileItem[]>('/api/files', form, onProgress, undefined, '文件上传')

const formatDateTime = (value: string) => new Date(value).toLocaleString('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

const absoluteUrl = (url: string) => {
  return new URL(url, `${window.location.origin}/`).href
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

const escapeHtmlAttribute = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')

const escapeMarkdownAlt = (value: string) => value.replace(/([\\\[\]])/g, '\\$1')

const buildImageReferences = (image: ImageItem) => {
  const direct = image.links?.direct || absoluteUrl(image.url)
  return [
    { key: 'direct', label: '图片直链', value: direct },
    { key: 'bbcode', label: 'BBCode（论坛）', value: image.links?.bbcode || `[img]${direct}[/img]` },
    { key: 'markdown', label: 'Markdown', value: image.links?.markdown || `![${escapeMarkdownAlt(image.name)}](${direct})` },
    { key: 'html', label: 'HTML', value: image.links?.html || `<img src="${direct}" alt="${escapeHtmlAttribute(image.name)}" />` },
  ]
}

const buildVideoReferences = (video: VideoItem) => {
  const direct = video.links?.direct || absoluteUrl(video.url)
  return [
    { key: 'direct', label: '视频直链', value: direct },
    { key: 'markdown', label: 'Markdown', value: video.links?.markdown || `[${escapeMarkdownAlt(video.name)}](${direct})` },
    { key: 'bbcode', label: 'BBCode（论坛）', value: video.links?.bbcode || `[video]${direct}[/video]` },
    { key: 'html', label: 'HTML5 视频', value: video.links?.html || `<video controls preload="metadata" src="${escapeHtmlAttribute(direct)}"></video>` },
  ]
}

const buildFileReferences = (file: FileItem) => {
  const direct = file.links?.direct || absoluteUrl(file.url)
  return [
    { key: 'direct', label: '文件直链', value: direct },
    { key: 'markdown', label: 'Markdown', value: file.links?.markdown || `[${escapeMarkdownAlt(file.name)}](${direct})` },
    { key: 'bbcode', label: 'BBCode（论坛）', value: file.links?.bbcode || `[url=${direct}]${escapeMarkdownAlt(file.name)}[/url]` },
    { key: 'html', label: 'HTML 下载链接', value: file.links?.html || `<a href="${escapeHtmlAttribute(direct)}" download>${escapeHtmlAttribute(file.name)}</a>` },
  ]
}

const metadataSectionLabels: Record<string, string> = {
  ifd0: '图像与设备',
  exif: '拍摄参数',
  gps: 'GPS 位置信息',
  interop: '互操作信息',
  ifd1: '内嵌缩略图',
  xmp: 'XMP 元数据',
  iptc: 'IPTC 元数据',
  icc: 'ICC 色彩配置',
  jfif: 'JFIF 信息',
  ihdr: 'PNG 图像信息',
  makerNote: '厂商 MakerNote',
  userComment: '用户备注',
  errors: '解析提示',
}

const metadataFieldLabels: Record<string, string> = {
  Make: '相机制造商',
  Model: '相机型号',
  LensMake: '镜头制造商',
  LensModel: '镜头型号',
  Software: '处理软件',
  Artist: '作者',
  Copyright: '版权',
  DateTimeOriginal: '拍摄时间',
  CreateDate: '创建时间',
  ModifyDate: '修改时间',
  ExposureTime: '曝光时间',
  FNumber: '光圈值',
  ISO: 'ISO 感光度',
  FocalLength: '焦距',
  FocalLengthIn35mmFormat: '等效焦距',
  ExposureProgram: '曝光程序',
  ExposureMode: '曝光模式',
  MeteringMode: '测光模式',
  WhiteBalance: '白平衡',
  Flash: '闪光灯',
  ColorSpace: '色彩空间',
  Orientation: '方向',
  GPSLatitude: '纬度',
  GPSLongitude: '经度',
  GPSAltitude: '海拔',
  latitude: '十进制纬度',
  longitude: '十进制经度',
}

const formatMetadataValue = (value: unknown): string => {
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(formatMetadataValue).join(', ')
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const flattenMetadata = (value: unknown, prefix = ''): Array<{ key: string; value: string }> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
      const childKey = prefix ? `${prefix}.${key}` : key
      return flattenMetadata(child, childKey)
    })
  }
  const rawKey = prefix || 'value'
  const fieldName = rawKey.split('.').pop() || rawKey
  const friendlyName = metadataFieldLabels[fieldName]
  return [{ key: friendlyName ? `${friendlyName} · ${rawKey}` : rawKey, value: formatMetadataValue(value) }]
}

const buildMetadataSections = (metadata: Record<string, unknown>) => Object.entries(metadata)
  .map(([key, value]) => ({
    key,
    title: metadataSectionLabels[key] || key,
    entries: flattenMetadata(value),
  }))
  .filter((section) => section.entries.length > 0)

function App() {
  const [activeView, setActiveView] = useState<ViewName>('dashboard')
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState('')
  const [setupRequired, setSetupRequired] = useState(false)
  const [guestUploadEnabled, setGuestUploadEnabled] = useState(false)
  const [allowedExtensions, setAllowedExtensions] = useState<string[]>(defaultAllowedExtensions)
  const [images, setImages] = useState<ImageItem[]>([])
  const [videos, setVideos] = useState<VideoItem[]>([])
  const [files, setFiles] = useState<FileItem[]>([])
  const [videoExtensions, setVideoExtensions] = useState<string[]>(defaultVideoExtensions)
  const [videoMaxFileSize, setVideoMaxFileSize] = useState(defaultVideoMaxFileSize)
  const [fileExtensions, setFileExtensions] = useState<string[]>(defaultFileExtensions)
  const [fileMaxFileSize, setFileMaxFileSize] = useState(defaultFileMaxFileSize)
  const [albums, setAlbums] = useState<AlbumItem[]>([])
  const [videoCategories, setVideoCategories] = useState<VideoCategoryItem[]>([])
  const [fileGroups, setFileGroups] = useState<FileGroupItem[]>([])
  const [selectedUploadAlbum, setSelectedUploadAlbum] = useState('')
  const [selectedUploadVideoCategory, setSelectedUploadVideoCategory] = useState('')
  const [selectedUploadFileGroup, setSelectedUploadFileGroup] = useState('')
  const [galleryAlbum, setGalleryAlbum] = useState('全部相册')
  const [videoCategory, setVideoCategory] = useState('全部分类')
  const [fileGroup, setFileGroup] = useState('全部分组')
  const [mediaTab, setMediaTab] = useState<'albums' | 'videos'>('albums')
  const [stats, setStats] = useState<Stats>(defaultStats)
  const [loading, setLoading] = useState(true)
  const [dataError, setDataError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>(null)
  const [videoUploadStatus, setVideoUploadStatus] = useState<VideoUploadStatus | null>(null)
  const [uploadResults, setUploadResults] = useState<ImageItem[]>([])
  const [videoUploadResults, setVideoUploadResults] = useState<VideoItem[]>([])
  const [fileUploadResults, setFileUploadResults] = useState<FileItem[]>([])
  const [shareImage, setShareImage] = useState<ImageItem | null>(null)
  const [shareVideo, setShareVideo] = useState<VideoItem | null>(null)
  const [shareFile, setShareFile] = useState<FileItem | null>(null)
  const [toast, setToast] = useState('')
  const toastTimer = useRef<number | null>(null)

  const notify = useCallback((message: string) => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
    setToast(message)
    toastTimer.current = window.setTimeout(() => setToast(''), 2600)
  }, [])

  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    setDataError('')
    try {
      const [imageResponse, videoResponse, fileResponse, statsResponse, albumResponse, videoCategoryResponse, fileGroupResponse] = await Promise.all([fetch('/api/images'), fetch('/api/videos'), fetch('/api/files'), fetch('/api/stats'), fetch('/api/albums'), fetch('/api/video-categories'), fetch('/api/file-groups')])
      if ([imageResponse, videoResponse, fileResponse, statsResponse, albumResponse, videoCategoryResponse, fileGroupResponse].some((response) => response.status === 401)) {
        setUser(null)
        throw new Error('登录会话已失效，请重新登录')
      }
      if (!imageResponse.ok || !videoResponse.ok || !fileResponse.ok || !statsResponse.ok || !albumResponse.ok || !videoCategoryResponse.ok || !fileGroupResponse.ok) throw new Error('空间数据加载失败')
      const [imageData, videoData, fileData, statsData, albumData, videoCategoryData, fileGroupData]: [ImageItem[], VideoItem[], FileItem[], Stats, AlbumItem[], VideoCategoryItem[], FileGroupItem[]] = await Promise.all([imageResponse.json(), videoResponse.json(), fileResponse.json(), statsResponse.json(), albumResponse.json(), videoCategoryResponse.json(), fileGroupResponse.json()])
      setImages(imageData)
      setVideos(videoData)
      setFiles(fileData)
      setStats({ ...defaultStats, ...statsData })
      setAlbums(albumData)
      setVideoCategories(videoCategoryData)
      setFileGroups(fileGroupData)
      setSelectedUploadAlbum((current) => current && albumData.some((album) => album.name === current) ? current : '')
      setSelectedUploadVideoCategory((current) => current && videoCategoryData.some((category) => category.name === current) ? current : '')
      setSelectedUploadFileGroup((current) => current && fileGroupData.some((group) => group.name === current) ? current : '')
    } catch (error) {
      const message = error instanceof Error ? error.message : '空间数据加载失败'
      setDataError(message)
      notify(message)
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    const checkSession = async () => {
      try {
        setAuthError('')
        const [response, publicConfigResponse] = await Promise.all([fetch('/api/auth/me'), fetch('/api/public/config')])
        if (publicConfigResponse.ok) {
          const publicConfig = await publicConfigResponse.json()
          setGuestUploadEnabled(Boolean(publicConfig.guestUploadEnabled))
          if (Array.isArray(publicConfig.allowedExtensions) && publicConfig.allowedExtensions.length) {
            setAllowedExtensions(publicConfig.allowedExtensions)
          }
          if (Array.isArray(publicConfig.videoExtensions) && publicConfig.videoExtensions.length) {
            setVideoExtensions(publicConfig.videoExtensions)
          }
          if (Number.isFinite(publicConfig.videoMaxFileSize) && publicConfig.videoMaxFileSize > 0) {
            setVideoMaxFileSize(publicConfig.videoMaxFileSize)
          }
          if (Array.isArray(publicConfig.fileExtensions) && publicConfig.fileExtensions.length) {
            setFileExtensions(publicConfig.fileExtensions)
          }
          if (Number.isFinite(publicConfig.fileMaxFileSize) && publicConfig.fileMaxFileSize > 0) {
            setFileMaxFileSize(publicConfig.fileMaxFileSize)
          }
        }
        if (!response.ok) {
          const detail = await response.json().catch(() => ({ setupRequired: false }))
          setSetupRequired(Boolean(detail.setupRequired))
          return
        }
        const currentUser: User = await response.json()
        setUser(currentUser)
        await loadData()
      } catch {
        setAuthError('无法连接 PicNest 服务，请确认后端已经启动。')
      } finally {
        setAuthLoading(false)
      }
    }
    void checkSession()
  }, [loadData])

  const handleAuthenticated = async (authenticatedUser: User) => {
    setUser(authenticatedUser)
    setSetupRequired(false)
    setGalleryAlbum('全部相册')
    setActiveView('dashboard')
    await loadData()
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setUser(null)
    setImages([])
    setVideos([])
    setFiles([])
    setAlbums([])
    setVideoCategories([])
    setFileGroups([])
    setSelectedUploadAlbum('')
    setSelectedUploadVideoCategory('')
    setSelectedUploadFileGroup('')
    setGalleryAlbum('全部相册')
    setVideoCategory('全部分类')
    setFileGroup('全部分组')
    setMediaTab('albums')
    setUploadResults([])
    setVideoUploadResults([])
    setFileUploadResults([])
    setUploadPhase(null)
    setVideoUploadStatus(null)
    setShareImage(null)
    setShareVideo(null)
    setShareFile(null)
    setStats(defaultStats)
    setActiveView('dashboard')
  }

  const uploadImageBatch = async (files: File[], albumName: string) => {
    const totalFileBytes = files.reduce((sum, file) => sum + file.size, 0)
    const form = new FormData()
    files.forEach((file) => form.append('files', file))
    if (albumName) form.append('album', albumName)
    const created = await uploadImageRequest(form, (loaded, total) => {
      const actualTotal = total > 0 ? total : totalFileBytes
      setUploadProgress(actualTotal > 0 ? Math.min(100, Math.round((loaded / actualTotal) * 100)) : 0)
    })
    setUploadProgress(100)
    setImages((current) => [...created, ...current])
    setStats((current) => ({
      ...current,
      images: current.images + created.length,
      used: current.used + created.reduce((sum, item) => sum + item.size, 0),
    }))
    setShareImage(null)
    setUploadResults(created)
    return created
  }

  const patchImage = async (id: string, changes: Partial<ImageItem>) => {
    try {
      const response = await fetch(`/api/images/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      })
      const detail = await response.json().catch(() => ({ message: '更新失败，请重试' }))
      if (!response.ok) {
        notify(detail.message || '更新失败，请重试')
        return false
      }
      const updated = detail as ImageItem
      setImages((current) => current.map((item) => (item.id === id ? updated : item)))
      if (shareImage?.id === id) setShareImage(updated)
      return true
    } catch {
      notify('更新失败，请重试')
      return false
    }
  }

  const deleteImages = async (ids: string[]) => {
    if (!ids.length) return
    const removed = images.filter((item) => ids.includes(item.id))
    const response = ids.length === 1
      ? await fetch(`/api/images/${ids[0]}`, { method: 'DELETE' })
      : await fetch('/api/images/bulk-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        })
    if (!response.ok) return notify('删除失败，请重试')
    setImages((current) => current.filter((item) => !ids.includes(item.id)))
    setStats((current) => ({
      ...current,
      images: Math.max(0, current.images - removed.length),
      used: Math.max(0, current.used - removed.reduce((sum, item) => sum + item.size, 0)),
    }))
    setShareImage(null)
    notify(`${removed.length} 张图片已永久删除`)
  }

  const uploadVideoBatch = async (files: File[], categoryName: string) => {
    const totalFileBytes = files.reduce((sum, file) => sum + file.size, 0)
    const startedAt = performance.now()
    let lastLoaded = 0
    let lastProgressAt = startedAt
    let smoothedSpeed = 0
    setVideoUploadStatus({
      phase: 'uploading',
      loaded: 0,
      total: totalFileBytes,
      percent: 0,
      speed: 0,
      eta: null,
      stalled: false,
    })
    const activityMonitor = window.setInterval(() => {
      setVideoUploadStatus((current) => {
        if (!current || current.phase !== 'uploading') return current
        const stalled = performance.now() - lastProgressAt >= 8000
        return current.stalled === stalled ? current : { ...current, stalled }
      })
    }, 180)
    try {
      const form = new FormData()
      files.forEach((file) => form.append('files', file))
      if (categoryName) form.append('category', categoryName)
      const created = await uploadVideoRequest(
        form,
        (loaded, total) => {
          const now = performance.now()
          const elapsed = Math.max(1, now - startedAt)
          const deltaBytes = loaded - lastLoaded
          const deltaMs = now - lastProgressAt
          if (deltaBytes > 0) {
            const instantSpeed = deltaBytes / Math.max(1, deltaMs) * 1000
            smoothedSpeed = smoothedSpeed ? smoothedSpeed * 0.7 + instantSpeed * 0.3 : instantSpeed
            lastLoaded = loaded
            lastProgressAt = now
          }
          const actualTotal = total > 0 ? total : totalFileBytes
          const percent = actualTotal > 0 ? Math.min(100, Math.round((loaded / actualTotal) * 100)) : Math.min(99, Math.round((elapsed / 1000) * 2))
          setUploadProgress(percent)
          setVideoUploadStatus({
            phase: 'uploading',
            loaded,
            total: actualTotal,
            percent,
            speed: smoothedSpeed,
            eta: smoothedSpeed > 0 && actualTotal > loaded ? (actualTotal - loaded) / smoothedSpeed : null,
            stalled: false,
          })
        },
        () => {
          setUploadProgress(100)
          setVideoUploadStatus((current) => current ? {
            ...current,
            phase: 'processing',
            loaded: current.total,
            percent: 100,
            eta: null,
            stalled: false,
          } : current)
        },
      )
      setUploadProgress(100)
      setVideos((current) => [...created, ...current])
      setVideoCategories((current) => current.map((category) => {
        const added = created.filter((video) => videoCategoryName(video) === category.name)
        return added.length
          ? {
              ...category,
              videoCount: category.videoCount + added.length,
              storageUsed: category.storageUsed + added.reduce((sum, video) => sum + video.size, 0),
            }
          : category
      }))
      setStats((current) => ({
        ...current,
        videos: current.videos + created.length,
        used: current.used + created.reduce((sum, item) => sum + item.size, 0),
      }))
      setShareVideo(null)
      setVideoUploadResults(created)
      return created
    } catch (error) {
      throw error
    } finally {
      window.clearInterval(activityMonitor)
    }
  }

  const uploadFileBatch = async (items: File[], groupName: string) => {
    const totalFileBytes = items.reduce((sum, item) => sum + item.size, 0)
    const form = new FormData()
    items.forEach((item) => form.append('files', item))
    if (groupName) form.append('group', groupName)
    const created = await uploadFileRequest(form, (loaded, total) => {
      const actualTotal = total > 0 ? total : totalFileBytes
      setUploadProgress(actualTotal > 0 ? Math.min(100, Math.round((loaded / actualTotal) * 100)) : 0)
    })
    setUploadProgress(100)
    setFiles((current) => [...created, ...current])
    setFileGroups((current) => current.map((group) => {
      const added = created.filter((file) => fileGroupName(file) === group.name)
      return added.length
        ? {
            ...group,
            fileCount: group.fileCount + added.length,
            storageUsed: group.storageUsed + added.reduce((sum, file) => sum + file.size, 0),
          }
        : group
    }))
    setStats((current) => ({
      ...current,
      files: current.files + created.length,
      used: current.used + created.reduce((sum, item) => sum + item.size, 0),
    }))
    setShareFile(null)
    setFileUploadResults(created)
    return created
  }

  const uploadMedia = async (files: File[], albumName = selectedUploadAlbum, categoryName = selectedUploadVideoCategory, groupName = selectedUploadFileGroup) => {
    if (!files.length || uploading) return
    const imageFiles = files.filter((file) => uploadFileMatches(file, allowedExtensions))
    const videoFiles = files.filter((file) => !uploadFileMatches(file, allowedExtensions) && videoFileMatches(file, videoExtensions))
    const fileItems = files.filter((file) => !uploadFileMatches(file, allowedExtensions) && !videoFileMatches(file, videoExtensions) && generalFileMatches(file, fileExtensions))
    const invalidType = files.find((file) => !mediaFileMatches(file, allowedExtensions, videoExtensions, fileExtensions))
    if (invalidType) return notify(`${invalidType.name} 的文件类型不在允许列表中`)
    if (imageFiles.length > 20) return notify('单次最多上传 20 张图片')
    if (videoFiles.length > 10) return notify('单次最多上传 10 个视频')
    if (fileItems.length > 20) return notify('单次最多上传 20 个文件')
    const oversizedImage = imageFiles.find((file) => file.size > 20 * 1024 * 1024)
    if (oversizedImage) return notify(`${oversizedImage.name} 超过 20 MB 限制`)
    const oversizedVideo = videoFiles.find((file) => file.size > videoMaxFileSize)
    if (oversizedVideo) return notify(`${oversizedVideo.name} 超过 ${Math.round(videoMaxFileSize / 1024 / 1024)} MB 限制`)
    const oversizedFile = fileItems.find((file) => file.size > fileMaxFileSize)
    if (oversizedFile) return notify(`${oversizedFile.name} 超过 ${Math.round(fileMaxFileSize / 1024 / 1024)} MB 限制`)

    setUploading(true)
    setUploadResults([])
    setVideoUploadResults([])
    setFileUploadResults([])
    setUploadProgress(0)
    setUploadPhase(null)
    setVideoUploadStatus(null)
    try {
      if (imageFiles.length) {
        setUploadPhase('images')
        await uploadImageBatch(imageFiles, albumName)
      }
      if (videoFiles.length) {
        setUploadPhase('videos')
        await uploadVideoBatch(videoFiles, categoryName)
      }
      if (fileItems.length) {
        setUploadPhase('files')
        await uploadFileBatch(fileItems, groupName)
      }
      const resultLabel = [
        imageFiles.length ? `${imageFiles.length} 张图片` : '',
        videoFiles.length ? `${videoFiles.length} 个视频` : '',
        fileItems.length ? `${fileItems.length} 个文件` : '',
      ].filter(Boolean).join('、')
      notify(`${resultLabel}已安全入库`)
    } catch (error) {
      notify(error instanceof Error ? error.message : '上传失败，请重试')
    } finally {
      window.setTimeout(() => {
        setUploading(false)
        setUploadProgress(0)
        setUploadPhase(null)
        setVideoUploadStatus(null)
      }, 500)
    }
  }

  const startRemoteImport = async (source: string, connections: number) => {
    if (uploading) throw new Error('当前正在上传本地媒体，请完成后再开始远程导入')
    const response = await fetch('/api/remote-imports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source,
        connections,
        album: selectedUploadAlbum,
        category: selectedUploadVideoCategory,
        fileGroup: selectedUploadFileGroup,
      }),
    })
    const detail = await response.json().catch(() => ({ message: '远程导入请求失败，请重试' }))
    if (!response.ok) throw new Error(detail.message || '远程导入请求失败，请重试')
    return detail as RemoteImportTask
  }

  const refreshRemoteResult = async (task: RemoteImportTask) => {
    await loadData()
    if (task.mediaType === 'video') notify('远程视频已进入视频分类')
    else if (task.mediaType === 'image') notify('远程图片已进入图片相册')
    else if (task.mediaType === 'file') notify('远程文件已进入文件分组')
  }

  const patchVideo = async (id: string, changes: Partial<VideoItem>) => {
    try {
      const response = await fetch(`/api/videos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      })
      const detail = await response.json().catch(() => ({ message: '视频更新失败，请重试' }))
      if (!response.ok) {
        notify(detail.message || '视频更新失败，请重试')
        return false
      }
      const updated = detail as VideoItem
      const previous = videos.find((item) => item.id === id)
      setVideos((current) => current.map((item) => (item.id === id ? updated : item)))
      if (previous && videoCategoryName(previous) !== videoCategoryName(updated)) {
        setVideoCategories((current) => current.map((category) => {
          if (category.name === videoCategoryName(previous)) {
            return {
              ...category,
              videoCount: Math.max(0, category.videoCount - 1),
              storageUsed: Math.max(0, category.storageUsed - previous.size),
            }
          }
          if (category.name === videoCategoryName(updated)) {
            return {
              ...category,
              videoCount: category.videoCount + 1,
              storageUsed: category.storageUsed + updated.size,
            }
          }
          return category
        }))
      }
      if (shareVideo?.id === id) setShareVideo(updated)
      return true
    } catch {
      notify('视频更新失败，请重试')
      return false
    }
  }

  const deleteVideos = async (ids: string[]) => {
    if (!ids.length) return
    const removed = videos.filter((item) => ids.includes(item.id))
    const response = ids.length === 1
      ? await fetch(`/api/videos/${ids[0]}`, { method: 'DELETE' })
      : await fetch('/api/videos/bulk-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        })
    if (!response.ok) return notify('视频删除失败，请重试')
    setVideos((current) => current.filter((item) => !ids.includes(item.id)))
    setVideoCategories((current) => current.map((category) => {
      const removedInCategory = removed.filter((video) => videoCategoryName(video) === category.name)
      return removedInCategory.length
        ? {
            ...category,
            videoCount: Math.max(0, category.videoCount - removedInCategory.length),
            storageUsed: Math.max(0, category.storageUsed - removedInCategory.reduce((sum, video) => sum + video.size, 0)),
          }
        : category
    }))
    setStats((current) => ({
      ...current,
      videos: Math.max(0, current.videos - removed.length),
      used: Math.max(0, current.used - removed.reduce((sum, item) => sum + item.size, 0)),
    }))
    setShareVideo(null)
    notify(`${removed.length} 个视频已永久删除`)
  }

  const patchFile = async (id: string, changes: Partial<FileItem>) => {
    try {
      const response = await fetch(`/api/files/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      })
      const detail = await response.json().catch(() => ({ message: '文件更新失败，请重试' }))
      if (!response.ok) {
        notify(detail.message || '文件更新失败，请重试')
        return false
      }
      const updated = detail as FileItem
      const previous = files.find((item) => item.id === id)
      setFiles((current) => current.map((item) => (item.id === id ? updated : item)))
      if (previous && fileGroupName(previous) !== fileGroupName(updated)) {
        setFileGroups((current) => current.map((group) => {
          if (group.name === fileGroupName(previous)) {
            return {
              ...group,
              fileCount: Math.max(0, group.fileCount - 1),
              storageUsed: Math.max(0, group.storageUsed - previous.size),
            }
          }
          if (group.name === fileGroupName(updated)) {
            return {
              ...group,
              fileCount: group.fileCount + 1,
              storageUsed: group.storageUsed + updated.size,
            }
          }
          return group
        }))
      }
      if (shareFile?.id === id) setShareFile(updated)
      return true
    } catch {
      notify('文件更新失败，请重试')
      return false
    }
  }

  const deleteFiles = async (ids: string[]) => {
    if (!ids.length) return
    const removed = files.filter((item) => ids.includes(item.id))
    const response = ids.length === 1
      ? await fetch(`/api/files/${ids[0]}`, { method: 'DELETE' })
      : await fetch('/api/files/bulk-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        })
    if (!response.ok) return notify('文件删除失败，请重试')
    setFiles((current) => current.filter((item) => !ids.includes(item.id)))
    setFileGroups((current) => current.map((group) => {
      const removedInGroup = removed.filter((file) => fileGroupName(file) === group.name)
      return removedInGroup.length
        ? {
            ...group,
            fileCount: Math.max(0, group.fileCount - removedInGroup.length),
            storageUsed: Math.max(0, group.storageUsed - removedInGroup.reduce((sum, file) => sum + file.size, 0)),
          }
        : group
    }))
    setStats((current) => ({
      ...current,
      files: Math.max(0, current.files - removed.length),
      used: Math.max(0, current.used - removed.reduce((sum, item) => sum + item.size, 0)),
    }))
    setShareFile(null)
    notify(`${removed.length} 个文件已永久删除`)
  }

  const jumpToUpload = () => {
    setActiveView('dashboard')
    window.setTimeout(() => document.getElementById('file-picker')?.click(), 0)
  }

  const navigateToView = (view: ViewName) => {
    if (view === 'gallery') setGalleryAlbum('全部相册')
    if (view === 'media') setMediaTab('albums')
    if (view === 'files') setFileGroup('全部分组')
    setActiveView(view)
  }

  const openAlbum = (albumName: string) => {
    setGalleryAlbum(albumName)
    setActiveView('gallery')
  }

  const addAlbum = (album: AlbumItem) => setAlbums((current) => [...current, album])

  const addVideoCategory = (category: VideoCategoryItem) => setVideoCategories((current) => [...current, category])

  const addFileGroup = (group: FileGroupItem) => setFileGroups((current) => [...current, group])

  const setDefaultAlbum = async (albumId: string) => {
    const response = await fetch(`/api/albums/${albumId}/default`, { method: 'PATCH' })
    const detail = await response.json().catch(() => ({ message: '设置失败' }))
    if (!response.ok) return notify(detail.message)
    setAlbums((current) => current.map((album) => ({ ...album, isDefault: album.id === albumId })))
    setSelectedUploadAlbum((current) => current === detail.name ? '' : current)
    notify(`“${detail.name}”已设为默认相册`)
  }

  const setDefaultVideoCategory = async (categoryId: string) => {
    const response = await fetch(`/api/video-categories/${categoryId}/default`, { method: 'PATCH' })
    const detail = await response.json().catch(() => ({ message: '设置失败' }))
    if (!response.ok) return notify(detail.message)
    setVideoCategories((current) => current.map((category) => ({ ...category, isDefault: category.id === categoryId })))
    setSelectedUploadVideoCategory((current) => current === detail.name ? '' : current)
    notify(`“${detail.name}”已设为默认视频分类`)
  }

  const setDefaultFileGroup = async (groupId: string) => {
    const response = await fetch(`/api/file-groups/${groupId}/default`, { method: 'PATCH' })
    const detail = await response.json().catch(() => ({ message: '设置失败' }))
    if (!response.ok) return notify(detail.message)
    setFileGroups((current) => current.map((group) => ({ ...group, isDefault: group.id === groupId })))
    setSelectedUploadFileGroup((current) => current === detail.name ? '' : current)
    notify(`“${detail.name}”已设为默认文件分组`)
  }

  const handleManagedUserUpdate = (updated: UserSummary) => {
    if (updated.id !== user?.id) return
    setUser((current) => current ? { ...current, ...updated } : current)
    setStats((current) => ({ ...current, limit: updated.quota }))
  }

  const renderView = () => {
    if (dataError) return <DataLoadError message={dataError} onRetry={() => void loadData()} />
    switch (activeView) {
      case 'gallery':
        return <GalleryView images={images} albums={albums} selectedAlbum={galleryAlbum} onAlbumChange={setGalleryAlbum} loading={loading} onShare={setShareImage} onPatch={patchImage} onDelete={deleteImages} />
      case 'media':
        return <MediaLibraryView tab={mediaTab} onTabChange={setMediaTab} albums={albums} images={images} onOpenGallery={openAlbum} onAlbumCreated={addAlbum} onSetDefault={setDefaultAlbum} videoCategories={videoCategories} videos={videos} onCategoryCreated={addVideoCategory} onSetDefaultCategory={setDefaultVideoCategory} selectedCategory={videoCategory} onCategoryChange={setVideoCategory} loading={loading} onShare={setShareVideo} onPatch={patchVideo} onDelete={deleteVideos} notify={notify} />
      case 'files':
        return <FileLibraryView files={files} groups={fileGroups} selectedGroup={fileGroup} onGroupChange={setFileGroup} onGroupCreated={addFileGroup} onSetDefaultGroup={setDefaultFileGroup} loading={loading} onShare={setShareFile} onPatch={patchFile} onDelete={deleteFiles} notify={notify} />
      case 'analytics':
        return <AnalyticsView notify={notify} />
      case 'users':
        return user?.role === 'admin' ? <UsersView currentUser={user} notify={notify} onUserUpdated={handleManagedUserUpdate} /> : null
      case 'developer':
        return <DeveloperView stats={stats} notify={notify} />
      case 'settings':
        return <SettingsView notify={notify} user={user!} guestUploadEnabled={guestUploadEnabled} onGuestUploadChange={setGuestUploadEnabled} onAllowedExtensionsChange={setAllowedExtensions} />
      default:
        return (
          <DashboardView
            uploading={uploading}
            uploadProgress={uploadProgress}
            uploadPhase={uploadPhase}
            videoUploadStatus={videoUploadStatus}
            uploadResults={uploadResults}
            videoUploadResults={videoUploadResults}
            fileUploadResults={fileUploadResults}
            albums={albums}
            videoCategories={videoCategories}
            fileGroups={fileGroups}
            allowedExtensions={allowedExtensions}
            videoExtensions={videoExtensions}
            videoMaxFileSize={videoMaxFileSize}
            fileExtensions={fileExtensions}
            fileMaxFileSize={fileMaxFileSize}
            selectedAlbum={selectedUploadAlbum}
            onAlbumChange={setSelectedUploadAlbum}
            selectedVideoCategory={selectedUploadVideoCategory}
            onVideoCategoryChange={setSelectedUploadVideoCategory}
            selectedFileGroup={selectedUploadFileGroup}
            onFileGroupChange={setSelectedUploadFileGroup}
            onUpload={uploadMedia}
            onRemoteImport={startRemoteImport}
            onRemoteCompleted={refreshRemoteResult}
            onClearResults={() => {
              setUploadResults([])
              setVideoUploadResults([])
              setFileUploadResults([])
            }}
            notify={notify}
          />
        )
    }
  }

  if (window.location.pathname !== '/') return <NotFoundPage />
  if (authLoading) return <AppLoading />
  if (authError) return <ServiceErrorPage message={authError} />
  if (!user) return <AuthScreen setupRequired={setupRequired} guestUploadEnabled={guestUploadEnabled} allowedExtensions={allowedExtensions} onAuthenticated={handleAuthenticated} />

  return (
    <div className="app-shell">
      <Sidebar activeView={activeView} onChange={navigateToView} stats={stats} user={user} onLogout={logout} />
      <main className="main-shell">
        <Header activeView={activeView} onUpload={jumpToUpload} />
        <div className="page-content">{renderView()}</div>
      </main>
      {shareImage && (
        <ShareModal
          image={shareImage}
          onClose={() => setShareImage(null)}
          onPatch={patchImage}
          onDelete={() => {
            if (window.confirm(`确认永久删除“${shareImage.name}”吗？此操作无法撤销。`)) void deleteImages([shareImage.id])
          }}
          notify={notify}
        />
      )}
      {shareVideo && (
        <VideoShareModal
          video={shareVideo}
          categories={videoCategories}
          onClose={() => setShareVideo(null)}
          onPatch={patchVideo}
          onDelete={() => {
            if (window.confirm(`确认永久删除“${shareVideo.name}”吗？此操作无法撤销。`)) void deleteVideos([shareVideo.id])
          }}
          notify={notify}
        />
      )}
      {shareFile && (
        <FileShareModal
          file={shareFile}
          groups={fileGroups}
          onClose={() => setShareFile(null)}
          onPatch={patchFile}
          onDelete={() => {
            if (window.confirm(`确认永久删除“${shareFile.name}”吗？此操作无法撤销。`)) void deleteFiles([shareFile.id])
          }}
          notify={notify}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          <span>{toast}</span>
        </div>
      )}
    </div>
  )
}

function AppLoading() {
  return (
    <div className="app-loading">
      <span className="brand-mark"><ImageIcon size={22} /></span>
      <b>PicNest</b>
      <i />
    </div>
  )
}

function ServiceErrorPage({ message }: { message: string }) {
  return <main className="status-page"><section><span>503</span><h1>服务暂时不可用</h1><p>{message}</p><button className="button button-primary" onClick={() => window.location.reload()}>重新连接</button></section></main>
}

function NotFoundPage() {
  return <main className="status-page"><section><span>404</span><h1>页面不存在</h1><p>你访问的地址不存在、已移动或已经被删除。</p><a className="button button-primary" href="/">返回首页</a></section></main>
}

function DataLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="empty-state error-state"><span><Server size={28} /></span><h3>空间数据加载失败</h3><p>{message}</p><button className="button button-primary" onClick={onRetry}>重新加载</button></div>
}

function AuthScreen({ setupRequired, guestUploadEnabled, allowedExtensions, onAuthenticated }: { setupRequired: boolean; guestUploadEnabled: boolean; allowedExtensions: string[]; onAuthenticated: (user: User) => Promise<void> }) {
  const mode: 'login' | 'register' = setupRequired ? 'register' : 'login'
  const [guestMode, setGuestMode] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const response = await fetch(`/api/auth/${mode === 'login' ? 'login' : 'register'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      })
      const detail = await response.json().catch(() => ({ message: '请求失败，请重试' }))
      if (!response.ok) throw new Error(detail.message)
      await onAuthenticated(detail as User)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '请求失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-story">
        <div className="auth-brand"><span className="brand-mark"><ImageIcon size={21} /></span><span><b>PicNest</b><small>图屿</small></span></div>
        <div className="auth-story-copy"><span className="eyebrow-pill"><Sparkles size={13} /> 为创作者而生</span><h1>让每一张图片，<br />都有安全的归属。</h1><p>一个安静、可靠的团队图床。上传、整理、分享，一切都留在你自己的空间。</p></div>
        <div className="auth-collage" aria-hidden="true"><span><img src="/demo/aurora.svg" alt="" /></span><span><img src="/demo/garden.svg" alt="" /></span><span><img src="/demo/arch.svg" alt="" /></span></div>
        <div className="auth-security"><ShieldCheck size={17} /><span><b>数据完全由你掌控</b><small>独立账户 · 本地存储 · 安全隔离</small></span></div>
      </section>
      <section className="auth-panel">
        <div className="auth-mobile-brand"><span className="brand-mark"><ImageIcon size={20} /></span><span><b>PicNest</b><small>图屿</small></span></div>
        {guestMode ? <GuestUploadPanel allowedExtensions={allowedExtensions} onBack={() => setGuestMode(false)} /> : <form className="auth-form" onSubmit={submit}>
          {setupRequired && <span className="setup-badge"><KeyRound size={14} /> 首位注册用户将成为系统管理员</span>}
          <div className="auth-heading"><h2>{mode === 'login' ? '欢迎回来' : '创建你的空间'}</h2><p>{mode === 'login' ? '登录后继续管理你的图片资产。' : '只需要一分钟，就能拥有自己的图床。'}</p></div>
          <div className="auth-mode-note">{setupRequired ? <><UserPlus size={15} /><span><b>初始化管理员</b><small>完成后可在成员管理中创建其他账户</small></span></> : <><Lock size={15} /><span><b>账户登录</b><small>新成员账户由空间管理员创建</small></span></>}</div>
          {mode === 'register' && <label><span>你的称呼</span><div><Users size={17} /><input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="例如：设计师小苏" minLength={2} maxLength={80} required /></div></label>}
          <label><span>邮箱地址</span><div><Mail size={17} /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="name@example.com" maxLength={254} required /></div></label>
          <label><span>密码</span><div><Lock size={17} /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="至少 8 个字符" minLength={8} maxLength={128} required /></div></label>
          {error && <p className="auth-error">{error}</p>}
          <button className="auth-submit" disabled={submitting}>{submitting ? '正在进入空间…' : mode === 'login' ? '登录 PicNest' : '创建账户并进入'}<ArrowRight size={17} /></button>
          <p className="auth-footnote">继续即表示你同意在此设备上安全保存登录会话。</p>
          {guestUploadEnabled && !setupRequired && <button type="button" className="guest-entry-button" onClick={() => setGuestMode(true)}><Upload size={17} /><span><b>无需登录，游客上传</b><small>上传后直接获取分享链接</small></span><ArrowRight size={16} /></button>}
        </form>}
      </section>
    </main>
  )
}

function GuestUploadPanel({ allowedExtensions, onBack }: { allowedExtensions: string[]; onBack: () => void }) {
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState<ImageItem[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const uploadGuestFiles = useCallback(async (files: File[]) => {
    if (uploading) return
    const validationError = validateUploadSelection(files, allowedExtensions, 5, 10 * 1024 * 1024)
    if (validationError) return setError(validationError)
    const images = files
    setUploading(true)
    setError('')
    try {
      const form = new FormData()
      images.forEach((file) => form.append('files', file))
      const response = await fetch('/api/public/images', { method: 'POST', body: form })
      const detail = await response.json().catch(() => ({ message: '上传失败，请重试' }))
      if (!response.ok) throw new Error(detail.message)
      setResults(detail as ImageItem[])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '上传失败，请重试')
    } finally {
      setUploading(false)
    }
  }, [allowedExtensions, uploading])

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.items || [])
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file))
        .filter((file) => uploadFileMatches(file, allowedExtensions))
      if (files.length) {
        event.preventDefault()
        void uploadGuestFiles(files)
      }
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [allowedExtensions, uploadGuestFiles])

  return (
    <div className="auth-form guest-form">
      <button className="back-to-login" onClick={onBack}><ArrowRight size={15} /> 返回账户登录</button>
      <div className="auth-heading"><h2>{results.length ? '上传完成' : '游客快速上传'}</h2><p>{results.length ? '链接已经生成，请在离开前保存。' : '无需注册，上传后立即获得可分享的图片链接。'}</p></div>
      {results.length ? (
        <div className="guest-results">
          {results.map((image) => {
            return <div className="guest-result" key={image.id}><img src={image.url} alt={image.name} /><span><b>{image.name}</b><small>{formatBytes(image.size)}</small></span><ReferenceFields image={image} /></div>
          })}
          <button className="auth-submit" onClick={() => setResults([])}><Upload size={16} /> 继续上传</button>
        </div>
      ) : (
        <>
          <div className={`guest-dropzone ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void uploadGuestFiles(Array.from(event.dataTransfer.files)) }}>
            <input ref={inputRef} type="file" accept={extensionAccept(allowedExtensions)} multiple hidden onChange={(event) => { void uploadGuestFiles(Array.from(event.target.files || [])); event.currentTarget.value = '' }} />
            <span><Upload size={24} /></span><h3>{uploading ? '图片正在上传…' : '拖曳图片到这里'}</h3><p>也可以直接粘贴，或从设备中选择</p><button className="button button-secondary" onClick={() => inputRef.current?.click()} disabled={uploading}>{uploading ? '请稍候' : '选择图片'}</button>
            <div><kbd>Ctrl V</kbd> 粘贴上传</div>
          </div>
          {error && <p className="auth-error">{error}</p>}
          <div className="guest-rules"><ShieldCheck size={16} /><span><b>受控公共上传</b><small>最多 5 张，单张 10MB；允许 {extensionSummary(allowedExtensions)}。游客无法浏览图库。</small></span></div>
        </>
      )}
    </div>
  )
}

function Sidebar({ activeView, onChange, stats, user, onLogout }: { activeView: ViewName; onChange: (view: ViewName) => void; stats: Stats; user: User; onLogout: () => void }) {
  type NavItem = { id: ViewName; label: string; icon: typeof LayoutDashboard; count?: number }
  const primary: NavItem[] = [
    { id: 'dashboard' as const, label: '工作台', icon: LayoutDashboard },
    { id: 'gallery' as const, label: '图片库', icon: Images, count: stats.images },
    { id: 'media' as const, label: '媒体库', icon: Images, count: stats.images + stats.videos },
    { id: 'files' as const, label: '文件库', icon: Files, count: stats.files },
  ]
  const secondary: NavItem[] = [
    { id: 'analytics' as const, label: '统计分析', icon: BarChart3 },
    ...(user.role === 'admin' ? [{ id: 'users' as ViewName, label: '成员管理', icon: Users }] : []),
    { id: 'developer' as const, label: '开发者', icon: Code2 },
    { id: 'settings' as const, label: '系统设置', icon: Settings },
  ]
  const percentage = Math.min(100, (stats.used / stats.limit) * 100)

  const renderItem = ({ id, label, icon: Icon, count }: NavItem) => (
    <button className={`nav-item ${activeView === id ? 'active' : ''}`} onClick={() => onChange(id)} key={id}>
      <Icon size={19} strokeWidth={1.8} />
      <span>{label}</span>
      {count !== undefined ? <em>{count}</em> : null}
    </button>
  )

  return (
    <aside className="sidebar">
      <button className="brand" onClick={() => onChange('dashboard')} aria-label="返回工作台">
        <span className="brand-mark"><ImageIcon size={20} /></span>
        <span className="brand-word"><b>PicNest</b><small>图屿</small></span>
      </button>
      <nav className="sidebar-nav">
        <p>空间</p>
        {primary.map(renderItem)}
        <p className="nav-section">管理</p>
        {secondary.map(renderItem)}
      </nav>
      <div className="sidebar-bottom">
        <div className="storage-mini">
          <div className="storage-mini-title"><span><Cloud size={16} /> 存储空间</span><b>{Math.round(percentage)}%</b></div>
          <div className="mini-progress"><i style={{ width: `${Math.max(percentage, 4)}%` }} /></div>
          <small>{formatBytes(stats.used)} / {formatBytes(stats.limit)}</small>
        </div>
        <div className="account-row">
          <span className="avatar">{user.name.slice(0, 1)}</span>
          <span><b>{user.name}</b><small>{user.role === 'admin' ? '管理员' : '空间成员'}</small></span>
          <button className="logout-button" onClick={() => void onLogout()} aria-label="退出登录"><LogOut size={17} /></button>
        </div>
      </div>
    </aside>
  )
}

function Header({ activeView, onUpload }: { activeView: ViewName; onUpload: () => void }) {
  return (
    <header className="topbar">
      <div className="page-title">
        <p>{viewMeta[activeView].eyebrow}</p>
        <h1>{viewMeta[activeView].title}</h1>
      </div>
      <div className="header-actions">
        <button className="button button-primary" onClick={onUpload}><Upload size={17} /> 上传媒体/文件</button>
      </div>
    </header>
  )
}

function DashboardView({
  uploading,
  uploadProgress,
  uploadPhase,
  videoUploadStatus,
  uploadResults,
  videoUploadResults,
  fileUploadResults,
  albums,
  videoCategories,
  fileGroups,
  allowedExtensions,
  videoExtensions,
  videoMaxFileSize,
  fileExtensions,
  fileMaxFileSize,
  selectedAlbum,
  onAlbumChange,
  selectedVideoCategory,
  onVideoCategoryChange,
  selectedFileGroup,
  onFileGroupChange,
  onUpload,
  onRemoteImport,
  onRemoteCompleted,
  onClearResults,
  notify,
}: {
  uploading: boolean
  uploadProgress: number
  uploadPhase: UploadPhase
  videoUploadStatus: VideoUploadStatus | null
  uploadResults: ImageItem[]
  videoUploadResults: VideoItem[]
  fileUploadResults: FileItem[]
  albums: AlbumItem[]
  videoCategories: VideoCategoryItem[]
  fileGroups: FileGroupItem[]
  allowedExtensions: string[]
  videoExtensions: string[]
  videoMaxFileSize: number
  fileExtensions: string[]
  fileMaxFileSize: number
  selectedAlbum: string
  onAlbumChange: (album: string) => void
  selectedVideoCategory: string
  onVideoCategoryChange: (category: string) => void
  selectedFileGroup: string
  onFileGroupChange: (group: string) => void
  onUpload: (files: File[], albumName?: string, categoryName?: string, groupName?: string) => void
  onRemoteImport: (source: string, connections: number) => Promise<RemoteImportTask>
  onRemoteCompleted: (task: RemoteImportTask) => Promise<void>
  onClearResults: () => void
  notify: (message: string) => void
}) {
  const hasResults = uploadResults.length > 0 || videoUploadResults.length > 0 || fileUploadResults.length > 0
  return (
    <div className="dashboard-upload-focus">
      <div className="dashboard-upload-panel">
        <UploadZone
          selectedAlbum={selectedAlbum}
          selectedVideoCategory={selectedVideoCategory}
          selectedFileGroup={selectedFileGroup}
          allowedExtensions={allowedExtensions}
          videoExtensions={videoExtensions}
          videoMaxFileSize={videoMaxFileSize}
          fileExtensions={fileExtensions}
          fileMaxFileSize={fileMaxFileSize}
          uploading={uploading}
          uploadPhase={uploadPhase}
          progress={uploadProgress}
          videoUploadStatus={videoUploadStatus}
          onUpload={onUpload}
        />
        <UploadDestinations
          albums={albums}
          videoCategories={videoCategories}
          fileGroups={fileGroups}
          selectedAlbum={selectedAlbum}
          selectedVideoCategory={selectedVideoCategory}
          selectedFileGroup={selectedFileGroup}
          uploading={uploading}
          onAlbumChange={onAlbumChange}
          onVideoCategoryChange={onVideoCategoryChange}
          onFileGroupChange={onFileGroupChange}
        />
        <RemoteImportPanel
          selectedAlbum={selectedAlbum}
          selectedVideoCategory={selectedVideoCategory}
          selectedFileGroup={selectedFileGroup}
          onStart={onRemoteImport}
          onCompleted={onRemoteCompleted}
        />
      </div>
      {hasResults && (
        <InlineUploadResults images={uploadResults} videos={videoUploadResults} files={fileUploadResults} onClear={onClearResults} notify={notify} />
      )}
    </div>
  )
}

function InlineUploadResults({ images, videos, files, onClear, notify }: { images: ImageItem[]; videos: VideoItem[]; files: FileItem[]; onClear: () => void; notify: (message: string) => void }) {
  const total = images.length + videos.length + files.length
  const copyAllDirectLinks = async () => {
    try {
      await copyText([...images.map((image) => absoluteUrl(image.url)), ...videos.map((video) => absoluteUrl(video.url)), ...files.map((file) => absoluteUrl(file.url))].join('\n'))
      notify(`${total} 条媒体直链已复制`)
    } catch {
      notify('复制失败，请逐条复制媒体直链')
    }
  }

  return (
    <section className="upload-results-inline" aria-live="polite">
      <div className="upload-results-heading">
        <div><span><CheckCircle2 size={19} /></span><div><h2>本次上传结果</h2><p>{[images.length ? `${images.length} 张图片` : '', videos.length ? `${videos.length} 个视频` : '', files.length ? `${files.length} 个文件` : ''].filter(Boolean).join('、')}已保存，系统已按格式分流。</p></div></div>
        <div className="upload-results-actions">
          {total > 1 && <button className="button button-secondary" onClick={() => void copyAllDirectLinks()}><Copy size={15} /> 复制全部直链</button>}
          <button className="button button-ghost" onClick={onClear}><X size={15} /> 清空结果</button>
        </div>
      </div>
      <div className={`upload-results-grid ${total === 1 ? 'single' : ''}`}>
        {images.map((image) => (
          <article className="section-card upload-result-card" key={image.id}>
            <div className="upload-result-card-head">
              <img src={image.url} alt={image.name} />
              <span><small>{image.album}</small><h3>{image.name}</h3><p>{image.type} · {formatBytes(image.size)}</p></span>
              <CheckCircle2 size={18} />
            </div>
            <div className="link-list"><ReferenceFields image={image} notify={notify} /></div>
          </article>
        ))}
        {videos.map((video) => (
          <article className="section-card upload-result-card" key={video.id}>
            <div className="upload-result-card-head">
              <video src={video.url} preload="metadata" muted playsInline />
              <span><small>{videoCategoryName(video)}</small><h3>{video.name}</h3><p>{video.type} · {formatBytes(video.size)}</p></span>
              <CheckCircle2 size={18} />
            </div>
            <div className="link-list"><VideoReferenceFields video={video} notify={notify} /></div>
          </article>
        ))}
        {files.map((file) => (
          <article className="section-card upload-result-card" key={file.id}>
            <div className="upload-result-card-head file-result-head">
              <span className="file-result-icon"><FileText size={22} /></span>
              <span><small>{fileGroupName(file)}</small><h3>{file.name}</h3><p>{file.type} · {formatBytes(file.size)}</p></span>
              <CheckCircle2 size={18} />
            </div>
            <div className="link-list"><FileReferenceFields file={file} notify={notify} /></div>
          </article>
        ))}
      </div>
    </section>
  )
}

function UploadZone({ selectedAlbum, selectedVideoCategory, selectedFileGroup, allowedExtensions, videoExtensions, videoMaxFileSize, fileExtensions, fileMaxFileSize, uploading, uploadPhase, progress, videoUploadStatus, onUpload }: {
  selectedAlbum: string
  selectedVideoCategory: string
  selectedFileGroup: string
  allowedExtensions: string[]
  videoExtensions: string[]
  videoMaxFileSize: number
  fileExtensions: string[]
  fileMaxFileSize: number
  uploading: boolean
  uploadPhase: UploadPhase
  progress: number
  videoUploadStatus: VideoUploadStatus | null
  onUpload: (files: File[], albumName?: string, categoryName?: string, groupName?: string) => void
}) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const receive = (fileList: FileList | null) => {
    if (fileList) onUpload(Array.from(fileList), selectedAlbum, selectedVideoCategory, selectedFileGroup)
  }

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const pastedMedia = Array.from(event.clipboardData?.items || [])
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file))
        .filter((file) => mediaFileMatches(file, allowedExtensions, videoExtensions, fileExtensions))
      if (pastedMedia.length) {
        event.preventDefault()
        onUpload(pastedMedia, selectedAlbum, selectedVideoCategory, selectedFileGroup)
      }
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [onUpload, selectedAlbum, selectedVideoCategory, selectedFileGroup, allowedExtensions, videoExtensions, fileExtensions])

  const phaseTitle = uploadPhase === 'videos' ? '视频正在上传…' : uploadPhase === 'files' ? '文件正在上传…' : uploadPhase === 'images' ? '图片正在上传…' : '媒体正在整理…'
  const uploadDescription = uploadPhase === 'videos'
    ? '大文件上传期间请不要关闭页面'
    : uploadPhase === 'files'
      ? '文件正在上传，请不要关闭页面'
    : uploadPhase === 'images'
      ? '图片正在上传，请稍候'
      : '上传期间请不要关闭页面'

  return (
    <section
      className={`upload-zone ${dragging ? 'dragging' : ''}`}
      onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => { event.preventDefault(); setDragging(false); receive(event.dataTransfer.files) }}
    >
      <input id="file-picker" ref={inputRef} type="file" accept={mediaExtensionAccept(allowedExtensions, videoExtensions, fileExtensions)} multiple hidden onChange={(event) => { receive(event.target.files); event.currentTarget.value = '' }} />
      <span className="upload-icon"><Upload size={27} /></span>
      <div className="upload-copy">
        <h3>{uploading ? phaseTitle : '把图片、视频或文件拖到这里'}</h3>
        <p>{uploading ? uploadDescription : `图片 ${extensionSummary(allowedExtensions)} · 视频 ${extensionSummary(videoExtensions)} · 文件 ${extensionSummary(fileExtensions.slice(0, 12))}${fileExtensions.length > 12 ? ' 等' : ''}，按格式自动分流；图片 20MB / 个，视频 ${Math.round(videoMaxFileSize / 1024 / 1024)}MB / 个，文件 ${Math.round(fileMaxFileSize / 1024 / 1024)}MB / 个`}</p>
      </div>
      {uploading ? (
        uploadPhase === 'videos'
          ? <VideoUploadProgress status={videoUploadStatus} />
          : <div className="upload-progress-wrap">
              <div className="upload-progress"><i style={{ width: `${progress}%` }} /></div>
              <b>{progress}%</b>
            </div>
      ) : (
        <>
          <button className="button button-secondary" onClick={() => inputRef.current?.click()}>选择图片、视频或文件</button>
          <div className="upload-hints"><span><Check size={13} /> 支持批量混合上传</span><span><Clipboard size={13} /> 可直接粘贴</span><span><ShieldCheck size={13} /> 按格式自动归类</span></div>
        </>
      )}
    </section>
  )
}

function UploadDestinations({ albums, videoCategories, fileGroups, selectedAlbum, selectedVideoCategory, selectedFileGroup, uploading, onAlbumChange, onVideoCategoryChange, onFileGroupChange }: {
  albums: AlbumItem[]
  videoCategories: VideoCategoryItem[]
  fileGroups: FileGroupItem[]
  selectedAlbum: string
  selectedVideoCategory: string
  selectedFileGroup: string
  uploading: boolean
  onAlbumChange: (album: string) => void
  onVideoCategoryChange: (category: string) => void
  onFileGroupChange: (group: string) => void
}) {
  const defaultAlbum = albums.find((album) => album.isDefault)
  const defaultCategory = videoCategories.find((category) => category.isDefault)
  const defaultFileGroup = fileGroups.find((group) => group.isDefault)
  return (
    <div className="upload-destination-row">
      <label className="upload-album-select">
        <Album size={16} />
        <span>图片存入</span>
        <select value={selectedAlbum} disabled={uploading} onChange={(event) => onAlbumChange(event.target.value)} aria-label="上传到相册">
          <option value="">默认相册 · {defaultAlbum?.name || '未分类'}</option>
          {albums.filter((album) => !album.isDefault).map((album) => <option key={album.id} value={album.name}>{album.name}</option>)}
        </select>
      </label>
      <label className="upload-album-select">
        <Video size={16} />
        <span>视频存入</span>
        <select value={selectedVideoCategory} disabled={uploading} onChange={(event) => onVideoCategoryChange(event.target.value)} aria-label="上传到视频分类">
          <option value="">默认分类 · {defaultCategory?.name || '视频'}</option>
          {videoCategories.filter((category) => !category.isDefault).map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}
        </select>
      </label>
      <label className="upload-album-select">
        <FileText size={16} />
        <span>文件存入</span>
        <select value={selectedFileGroup} disabled={uploading} onChange={(event) => onFileGroupChange(event.target.value)} aria-label="上传到文件分组">
          <option value="">默认分组 · {defaultFileGroup?.name || '文件'}</option>
          {fileGroups.filter((group) => !group.isDefault).map((group) => <option key={group.id} value={group.name}>{group.name}</option>)}
        </select>
      </label>
      <small className="upload-destination-note">上传前可分别指定图片相册、视频分类和文件分组，未指定时使用各自默认项。</small>
    </div>
  )
}

function RemoteImportPanel({ selectedAlbum, selectedVideoCategory, selectedFileGroup, onStart, onCompleted }: {
  selectedAlbum: string
  selectedVideoCategory: string
  selectedFileGroup: string
  onStart: (source: string, connections: number) => Promise<RemoteImportTask>
  onCompleted: (task: RemoteImportTask) => Promise<void>
}) {
  const [source, setSource] = useState('')
  const [connections, setConnections] = useState(4)
  const [task, setTask] = useState<RemoteImportTask | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const completedTask = useRef('')
  const taskId = task?.id
  const taskStatus = task?.status

  useEffect(() => {
    if (!taskId || taskStatus === 'completed' || taskStatus === 'failed') return
    let cancelled = false
    const poll = async () => {
      try {
        const response = await fetch(`/api/remote-imports/${taskId}`)
        const detail = await response.json().catch(() => ({ message: '远程任务状态读取失败' }))
        if (!response.ok) throw new Error(detail.message || '远程任务状态读取失败')
        if (cancelled) return
        const next = detail as RemoteImportTask
        setTask(next)
        if (next.status === 'completed' && completedTask.current !== next.id) {
          completedTask.current = next.id
          await onCompleted(next)
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '远程任务状态读取失败')
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 1000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [onCompleted, taskId, taskStatus])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const value = source.trim()
    if (!value || submitting || (task && ['queued', 'downloading', 'processing'].includes(task.status))) return
    setSubmitting(true)
    setError('')
    try {
      const next = await onStart(value, connections)
      setTask(next)
      setSource('')
      completedTask.current = ''
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '远程导入请求失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  const active = Boolean(task && ['queued', 'downloading', 'processing'].includes(task.status))
  const albumLabel = selectedAlbum || '各自默认相册'
  const videoCategoryLabel = selectedVideoCategory || '各自默认分类'
  const fileGroupLabel = selectedFileGroup || '默认文件分组'
  return (
    <section className="remote-import-panel">
      <div className="remote-import-heading">
        <span className="remote-import-icon"><Cloud size={20} /></span>
        <div><h3>远程导入</h3><p>粘贴 HTTPS 地址或 curl 命令，由服务器直接下载到当前空间。</p></div>
      </div>
      <form className="remote-import-form" onSubmit={(event) => void submit(event)}>
        <label className="remote-import-source">
          <span>远程地址或 curl 命令</span>
          <textarea value={source} disabled={active || submitting} onChange={(event) => setSource(event.target.value)} aria-label="远程地址或 curl 命令" placeholder="https://example.com/assets/demo.mp4&#10;或：curl -L https://example.com/assets/demo.png" rows={3} />
        </label>
        <div className="remote-import-actions">
          <label className="remote-connections"><span>并发连接</span><select value={connections} disabled={active || submitting} onChange={(event) => setConnections(Number(event.target.value))} aria-label="远程下载并发连接数">{[1, 2, 4, 8, 16].map((value) => <option key={value} value={value}>{value} 线程</option>)}</select></label>
          <button className="button button-secondary" disabled={active || submitting || !source.trim()}><Download size={16} /> {submitting ? '正在创建任务…' : '开始远程导入'}</button>
        </div>
      </form>
      <p className="remote-import-note">图片将存入“{albumLabel}”，视频将存入“{videoCategoryLabel}”，文件将存入“{fileGroupLabel}”；系统会按下载后的真实格式自动归类。</p>
      {error && <p className="remote-import-error">{error}</p>}
      {task && <RemoteImportProgress task={task} />}
    </section>
  )
}

function RemoteImportProgress({ task }: { task: RemoteImportTask }) {
  const phaseLabel = task.status === 'queued'
    ? '等待下载'
    : task.phase === 'downloading'
      ? '服务器正在下载'
      : task.phase === 'detecting'
        ? '正在识别媒体格式'
        : task.phase === 'storing'
          ? '正在写入资源库'
          : task.status === 'completed'
            ? '远程导入完成'
            : '远程导入失败'
  const progress = task.status === 'completed' ? 100 : Math.max(0, Math.min(100, task.progress))
  const total = task.totalBytes
  const transferLabel = total ? `${formatBytes(task.downloadedBytes)} / ${formatBytes(total)}` : `${formatBytes(task.downloadedBytes)} 已下载`
  const downloaderLabel = task.downloader === 'aria2c' ? 'aria2c 多线程' : task.downloader === 'curl' ? 'curl' : task.downloader === 'node' ? 'Node 流式下载' : '等待选择下载器'
  return (
    <div className={`remote-import-progress ${task.status === 'failed' ? 'failed' : ''}`} aria-live="polite">
      <div className="remote-import-progress-heading"><span>{task.status === 'completed' ? <CheckCircle2 size={15} /> : task.status === 'failed' ? <X size={15} /> : <LoaderCircle size={15} className="spin" />} {phaseLabel}</span><b>{progress}%</b></div>
      <div className="remote-import-progress-track" role="progressbar" aria-label="远程下载进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ width: `${progress}%` }} /></div>
      <div className="remote-import-progress-meta"><span title={task.sourceLabel}>{task.filename || task.sourceLabel}</span><span>{transferLabel} · {downloaderLabel} · {task.connections} 线程</span></div>
      {task.status === 'downloading' && <div className="remote-import-progress-detail">{task.speed > 0 ? `${formatTransferRate(task.speed)} · 预计剩余 ${formatEta(task.eta)}` : '正在等待远程服务器返回数据…'}</div>}
      {task.status === 'failed' && <div className="remote-import-progress-detail error">{task.error}</div>}
      {task.status === 'completed' && task.result && <div className="remote-import-progress-detail success">{task.mediaType === 'video' ? '已进入视频分类' : task.mediaType === 'file' ? '已进入文件分组' : '已进入图片相册'} · {task.result.name}</div>}
    </div>
  )
}

function GalleryView({ images, albums, selectedAlbum, onAlbumChange, loading, onShare, onPatch, onDelete }: {
  images: ImageItem[]
  albums: AlbumItem[]
  selectedAlbum: string
  onAlbumChange: (album: string) => void
  loading: boolean
  onShare: (image: ImageItem) => void
  onPatch: (id: string, changes: Partial<ImageItem>) => void
  onDelete: (ids: string[]) => void
}) {
  const [query, setQuery] = useState('')
  const [type, setType] = useState('全部格式')
  const [layout, setLayout] = useState<'grid' | 'list'>('grid')
  const [selected, setSelected] = useState<string[]>([])
  const albumOptions = useMemo(() => ['全部相册', ...Array.from(new Set([...albums.map((album) => album.name), ...images.map((image) => image.album)]))], [albums, images])
  const typeOptions = useMemo(() => ['全部格式', ...Array.from(new Set(images.map((image) => image.type))).sort()], [images])
  const filtered = images.filter((image) => {
    const matchQuery = image.name.toLowerCase().includes(query.toLowerCase())
    const matchAlbum = selectedAlbum === '全部相册' || image.album === selectedAlbum
    const matchType = type === '全部格式' || image.type === type
    return matchQuery && matchAlbum && matchType
  })

  useEffect(() => setSelected([]), [selectedAlbum])

  const toggleSelect = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])

  return (
    <div className="gallery-page">
      <section className="gallery-toolbar section-card">
        <label className="gallery-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="按文件名搜索" /></label>
        <select value={selectedAlbum} onChange={(event) => onAlbumChange(event.target.value)} aria-label="筛选相册">{albumOptions.map((name) => <option key={name}>{name}</option>)}</select>
        <select value={type} onChange={(event) => setType(event.target.value)} aria-label="筛选格式">{typeOptions.map((name) => <option key={name}>{name}</option>)}</select>
        <div className="layout-toggle"><button className={layout === 'grid' ? 'active' : ''} onClick={() => setLayout('grid')} aria-label="网格视图"><Grid2X2 size={17} /></button><button className={layout === 'list' ? 'active' : ''} onClick={() => setLayout('list')} aria-label="列表视图"><List size={18} /></button></div>
      </section>

      <div className="gallery-summary">
        <div><h3>{filtered.length} 张图片</h3><p>{selectedAlbum === '全部相册' ? '你的全部图片资产' : `相册 · ${selectedAlbum}`}</p></div>
        {selected.length > 0 && (
          <div className="bulk-actions"><span>已选择 {selected.length} 项</span><button onClick={() => { if (window.confirm(`确认永久删除选中的 ${selected.length} 张图片吗？此操作无法撤销。`)) { void onDelete(selected); setSelected([]) } }}><Trash2 size={15} /> 删除</button><button onClick={() => setSelected([])}><X size={15} /> 取消</button></div>
        )}
      </div>

      {loading ? <CardSkeletons /> : filtered.length === 0 ? (
        <div className="empty-state"><span><ImageIcon size={28} /></span><h3>{images.length ? '没有找到图片' : '图库还是空的'}</h3><p>{images.length ? '试试调整关键词或筛选条件。' : '前往工作台选择、拖曳或粘贴图片开始上传。'}</p></div>
      ) : layout === 'grid' ? (
        <div className="gallery-grid">
          {filtered.map((image) => <ImageCard key={image.id} image={image} onShare={onShare} onPatch={onPatch} selected={selected.includes(image.id)} onSelect={() => toggleSelect(image.id)} />)}
        </div>
      ) : (
        <div className="image-list section-card">
          {filtered.map((image) => (
            <div className={`image-list-row ${selected.includes(image.id) ? 'selected' : ''}`} key={image.id}>
              <button className={`select-box ${selected.includes(image.id) ? 'selected' : ''}`} onClick={() => toggleSelect(image.id)}>{selected.includes(image.id) && <Check size={13} />}</button>
              <button className="list-preview-button" onClick={() => onShare(image)} aria-label={`查看大图 ${image.name}`} title="查看大图"><img src={image.url} alt={image.name} /></button>
              <div className="list-name"><b>{image.name}</b><span>{image.album}</span></div>
              <span>{image.type}</span><span>{formatBytes(image.size)}</span><span>{formatDate(image.createdAt)}</span>
              <div className="list-actions"><button onClick={() => void onPatch(image.id, { starred: !image.starred })}><Star size={16} fill={image.starred ? 'currentColor' : 'none'} /></button><button onClick={() => onShare(image)}><Share2 size={16} /></button></div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function VideoLibrary({ videos, categories, selectedCategory, onCategoryChange, onCategoryCreated, onSetDefaultCategory, loading, onShare, onPatch, onDelete, notify }: {
  videos: VideoItem[]
  categories: VideoCategoryItem[]
  selectedCategory: string
  onCategoryChange: (category: string) => void
  onCategoryCreated: (category: VideoCategoryItem) => void
  onSetDefaultCategory: (categoryId: string) => Promise<void>
  loading: boolean
  onShare: (video: VideoItem) => void
  onPatch: (id: string, changes: Partial<VideoItem>) => void
  onDelete: (ids: string[]) => void
  notify: (message: string) => void
}) {
  const [query, setQuery] = useState('')
  const [type, setType] = useState('全部格式')
  const [selected, setSelected] = useState<string[]>([])
  const [showNewCategory, setShowNewCategory] = useState(false)
  const [newCategory, setNewCategory] = useState('')
  const [creatingCategory, setCreatingCategory] = useState(false)
  const typeOptions = useMemo(() => ['全部格式', ...Array.from(new Set(videos.map((video) => video.type))).sort()], [videos])
  const categoryOptions = useMemo(() => ['全部分类', ...Array.from(new Set([...categories.map((category) => category.name), ...videos.map(videoCategoryName)]))], [categories, videos])
  const filtered = videos.filter((video) => {
    const matchQuery = video.name.toLowerCase().includes(query.toLowerCase())
    const matchType = type === '全部格式' || video.type === type
    const matchCategory = selectedCategory === '全部分类' || videoCategoryName(video) === selectedCategory
    return matchQuery && matchType && matchCategory
  })

  const toggleSelect = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])

  const createCategory = async () => {
    const value = newCategory.trim()
    if (!value || creatingCategory) return
    if (value.length > 100) return notify('视频分类名称不能超过 100 个字符')
    setCreatingCategory(true)
    try {
      const response = await fetch('/api/video-categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: value }) })
      const detail = await response.json().catch(() => ({ message: '创建失败' }))
      if (!response.ok) return notify(detail.message)
      onCategoryCreated(detail as VideoCategoryItem)
      setNewCategory('')
      setShowNewCategory(false)
      notify('新视频分类已创建')
    } catch {
      notify('视频分类创建失败，请重试')
    } finally {
      setCreatingCategory(false)
    }
  }

  return (
    <div className="video-library-page">
      <section className="video-category-panel section-card">
        <div className="page-action-row">
          <div><h3>{categories.length} 个视频分类</h3><p>按主题整理视频，上传后也可以随时重新归类</p></div>
          <button className="button button-secondary" onClick={() => setShowNewCategory(true)}><FolderPlus size={16} /> 新建分类</button>
        </div>
        <div className="video-category-chips">
          <button className={`video-category-chip ${selectedCategory === '全部分类' ? 'active' : ''}`} onClick={() => onCategoryChange('全部分类')} aria-pressed={selectedCategory === '全部分类'}><Video size={15} /><span>全部视频</span><em>{videos.length}</em></button>
          {categories.map((category) => (
            <div className={`video-category-chip-wrap ${selectedCategory === category.name ? 'active' : ''}`} key={category.id}>
              <button className="video-category-chip" onClick={() => onCategoryChange(category.name)} aria-pressed={selectedCategory === category.name}><FolderPlus size={15} /><span>{category.name}</span><em>{category.videoCount}</em></button>
              <button className={`video-category-default ${category.isDefault ? 'active' : ''}`} onClick={() => void onSetDefaultCategory(category.id)} disabled={category.isDefault} aria-label={category.isDefault ? `${category.name}是默认分类` : `将${category.name}设为默认分类`} title={category.isDefault ? '默认上传分类' : '设为默认上传分类'}><Star size={14} fill={category.isDefault ? 'currentColor' : 'none'} /></button>
            </div>
          ))}
        </div>
      </section>
      <section className="video-toolbar section-card">
        <label className="gallery-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="按视频名称搜索" /></label>
        <select value={selectedCategory} onChange={(event) => onCategoryChange(event.target.value)} aria-label="筛选视频分类">{categoryOptions.map((name) => <option key={name}>{name}</option>)}</select>
        <select value={type} onChange={(event) => setType(event.target.value)} aria-label="筛选视频格式">{typeOptions.map((name) => <option key={name}>{name}</option>)}</select>
      </section>

      <div className="gallery-summary">
        <div><h3>{filtered.length} 个视频</h3><p>{query || type !== '全部格式' || selectedCategory !== '全部分类' ? '当前筛选结果' : '你的全部视频资产'}</p></div>
        {selected.length > 0 && (
          <div className="bulk-actions"><span>已选择 {selected.length} 项</span><button onClick={() => { if (window.confirm(`确认永久删除选中的 ${selected.length} 个视频吗？此操作无法撤销。`)) { void onDelete(selected); setSelected([]) } }}><Trash2 size={15} /> 删除</button><button onClick={() => setSelected([])}><X size={15} /> 取消</button></div>
        )}
      </div>

      {loading ? <CardSkeletons /> : filtered.length === 0 ? (
        <div className="empty-state"><span><Video size={28} /></span><h3>{videos.length ? '没有找到视频' : '视频库还是空的'}</h3><p>{videos.length ? '试试调整关键词或格式筛选。' : '前往工作台选择视频，上传后会自动进入视频分类。'}</p></div>
      ) : (
        <div className="video-grid">
          {filtered.map((video) => (
            <article className={`video-card ${selected.includes(video.id) ? 'selected' : ''}`} key={video.id}>
              <div className="video-preview">
                <button className="video-open-button" onClick={() => onShare(video)} aria-label={`播放视频 ${video.name}`} title="播放视频">
                  <video src={video.url} preload="metadata" muted playsInline />
                  <span className="video-play-indicator"><Video size={19} fill="currentColor" /></span>
                </button>
                <span className="format-badge">{video.type}</span>
                <button className={`select-box card-select ${selected.includes(video.id) ? 'selected' : ''}`} onClick={() => toggleSelect(video.id)} aria-label={`选择${video.name}`}>{selected.includes(video.id) && <Check size={13} />}</button>
                <div className="card-hover-actions">
                  <button onClick={() => void onPatch(video.id, { starred: !video.starred })} aria-label="收藏"><Heart size={16} fill={video.starred ? 'currentColor' : 'none'} /></button>
                  <button onClick={() => onShare(video)} aria-label="分享"><Share2 size={16} /></button>
                </div>
              </div>
              <div className="image-card-meta"><b title={video.name}>{video.name}</b><span>{videoCategoryName(video)} · {formatBytes(video.size)} · {formatDate(video.createdAt)}</span></div>
            </article>
          ))}
        </div>
      )}
      {showNewCategory && (
        <div className="modal-backdrop" onMouseDown={() => setShowNewCategory(false)}>
          <div className="small-modal" onMouseDown={(event) => event.stopPropagation()}>
            <span className="modal-title-icon"><FolderPlus size={20} /></span><h3>新建视频分类</h3><p>为视频分类取一个容易识别的名字。</p>
            <label>分类名称<input autoFocus value={newCategory} maxLength={100} onChange={(event) => setNewCategory(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void createCategory()} placeholder="例如：产品演示" /></label>
            <div><button className="button button-ghost" disabled={creatingCategory} onClick={() => setShowNewCategory(false)}>取消</button><button className="button button-primary" disabled={creatingCategory || !newCategory.trim()} onClick={() => void createCategory()}>{creatingCategory ? '正在创建…' : '创建分类'}</button></div>
          </div>
        </div>
      )}
    </div>
  )
}

function FileLibraryView({ files, groups, selectedGroup, onGroupChange, onGroupCreated, onSetDefaultGroup, loading, onShare, onPatch, onDelete, notify }: {
  files: FileItem[]
  groups: FileGroupItem[]
  selectedGroup: string
  onGroupChange: (group: string) => void
  onGroupCreated: (group: FileGroupItem) => void
  onSetDefaultGroup: (groupId: string) => Promise<void>
  loading: boolean
  onShare: (file: FileItem) => void
  onPatch: (id: string, changes: Partial<FileItem>) => void
  onDelete: (ids: string[]) => void
  notify: (message: string) => void
}) {
  const [query, setQuery] = useState('')
  const [type, setType] = useState('全部格式')
  const [layout, setLayout] = useState<'grid' | 'list'>('grid')
  const [selected, setSelected] = useState<string[]>([])
  const [showNewGroup, setShowNewGroup] = useState(false)
  const [newGroup, setNewGroup] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)
  const typeOptions = useMemo(() => ['全部格式', ...Array.from(new Set(files.map((file) => file.type))).sort()], [files])
  const groupOptions = useMemo(() => ['全部分组', ...Array.from(new Set([...groups.map((group) => group.name), ...files.map(fileGroupName)]))], [groups, files])
  const filtered = files.filter((file) => {
    const matchQuery = file.name.toLowerCase().includes(query.toLowerCase())
    const matchType = type === '全部格式' || file.type === type
    const matchGroup = selectedGroup === '全部分组' || fileGroupName(file) === selectedGroup
    return matchQuery && matchType && matchGroup
  })

  useEffect(() => setSelected([]), [selectedGroup])

  const toggleSelect = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])

  const createGroup = async () => {
    const value = newGroup.trim()
    if (!value || creatingGroup) return
    if (value.length > 100) return notify('文件分组名称不能超过 100 个字符')
    setCreatingGroup(true)
    try {
      const response = await fetch('/api/file-groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: value }) })
      const detail = await response.json().catch(() => ({ message: '创建失败' }))
      if (!response.ok) return notify(detail.message)
      onGroupCreated(detail as FileGroupItem)
      setNewGroup('')
      setShowNewGroup(false)
      notify('新文件分组已创建')
    } catch {
      notify('文件分组创建失败，请重试')
    } finally {
      setCreatingGroup(false)
    }
  }

  return (
    <div className="file-library-page">
      <section className="video-category-panel file-group-panel section-card">
        <div className="page-action-row">
          <div><h3>{groups.length} 个文件分组</h3><p>按项目、合同、素材包或交付物整理文档与文件</p></div>
          <button className="button button-secondary" onClick={() => setShowNewGroup(true)}><FolderPlus size={16} /> 新建分组</button>
        </div>
        <div className="video-category-chips file-group-chips">
          <button className={`video-category-chip ${selectedGroup === '全部分组' ? 'active' : ''}`} onClick={() => onGroupChange('全部分组')} aria-pressed={selectedGroup === '全部分组'}><Files size={15} /><span>全部文件</span><em>{files.length}</em></button>
          {groups.map((group) => (
            <div className={`video-category-chip-wrap ${selectedGroup === group.name ? 'active' : ''}`} key={group.id}>
              <button className="video-category-chip" onClick={() => onGroupChange(group.name)} aria-pressed={selectedGroup === group.name}><FolderPlus size={15} /><span>{group.name}</span><em>{group.fileCount}</em></button>
              <button className={`video-category-default ${group.isDefault ? 'active' : ''}`} onClick={() => void onSetDefaultGroup(group.id)} disabled={group.isDefault} aria-label={group.isDefault ? `${group.name}是默认分组` : `将${group.name}设为默认分组`} title={group.isDefault ? '默认文件分组' : '设为默认文件分组'}><Star size={14} fill={group.isDefault ? 'currentColor' : 'none'} /></button>
            </div>
          ))}
        </div>
      </section>

      <section className="video-toolbar file-toolbar section-card">
        <label className="gallery-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="按文件名称搜索" /></label>
        <select value={selectedGroup} onChange={(event) => onGroupChange(event.target.value)} aria-label="筛选文件分组">{groupOptions.map((name) => <option key={name}>{name}</option>)}</select>
        <select value={type} onChange={(event) => setType(event.target.value)} aria-label="筛选文件格式">{typeOptions.map((name) => <option key={name}>{name}</option>)}</select>
        <div className="layout-toggle"><button className={layout === 'grid' ? 'active' : ''} onClick={() => setLayout('grid')} aria-label="文件网格视图"><Grid2X2 size={17} /></button><button className={layout === 'list' ? 'active' : ''} onClick={() => setLayout('list')} aria-label="文件列表视图"><List size={18} /></button></div>
      </section>

      <div className="gallery-summary">
        <div><h3>{filtered.length} 个文件</h3><p>{query || type !== '全部格式' || selectedGroup !== '全部分组' ? '当前筛选结果' : '你的全部文件资产'}</p></div>
        {selected.length > 0 && (
          <div className="bulk-actions"><span>已选择 {selected.length} 项</span><button onClick={() => { if (window.confirm(`确认永久删除选中的 ${selected.length} 个文件吗？此操作无法撤销。`)) { void onDelete(selected); setSelected([]) } }}><Trash2 size={15} /> 删除</button><button onClick={() => setSelected([])}><X size={15} /> 取消</button></div>
        )}
      </div>

      {loading ? <CardSkeletons /> : filtered.length === 0 ? (
        <div className="empty-state"><span><FileText size={28} /></span><h3>{files.length ? '没有找到文件' : '文件库还是空的'}</h3><p>{files.length ? '试试调整关键词、分组或格式筛选。' : '前往工作台选择文件，上传后会自动进入文件分组。'}</p></div>
      ) : layout === 'grid' ? (
        <div className="file-grid">
          {filtered.map((file) => (
            <article className={`file-card ${selected.includes(file.id) ? 'selected' : ''}`} key={file.id}>
              <div className="file-card-main">
                <button className="file-open-button" onClick={() => onShare(file)} aria-label={`查看文件 ${file.name}`} title="查看文件">
                  <span className="file-card-icon"><FileText size={28} /></span>
                  <span className="format-badge">{file.type}</span>
                </button>
                <button className={`select-box card-select ${selected.includes(file.id) ? 'selected' : ''}`} onClick={() => toggleSelect(file.id)} aria-label={`选择${file.name}`}>{selected.includes(file.id) && <Check size={13} />}</button>
                <div className="card-hover-actions">
                  <button onClick={() => void onPatch(file.id, { starred: !file.starred })} aria-label="收藏"><Heart size={16} fill={file.starred ? 'currentColor' : 'none'} /></button>
                  <button onClick={() => onShare(file)} aria-label="分享"><Share2 size={16} /></button>
                </div>
              </div>
              <div className="image-card-meta"><b title={file.name}>{file.name}</b><span>{fileGroupName(file)} · {formatBytes(file.size)} · {formatDate(file.createdAt)}</span></div>
            </article>
          ))}
        </div>
      ) : (
        <div className="image-list file-list section-card">
          {filtered.map((file) => (
            <div className={`image-list-row file-list-row ${selected.includes(file.id) ? 'selected' : ''}`} key={file.id}>
              <button className={`select-box ${selected.includes(file.id) ? 'selected' : ''}`} onClick={() => toggleSelect(file.id)}>{selected.includes(file.id) && <Check size={13} />}</button>
              <button className="file-list-open" onClick={() => onShare(file)} aria-label={`查看文件 ${file.name}`} title="查看文件"><FileText size={18} /></button>
              <div className="list-name"><b>{file.name}</b><span>{fileGroupName(file)}</span></div>
              <span>{file.type}</span><span>{formatBytes(file.size)}</span><span>{formatDate(file.createdAt)}</span>
              <div className="list-actions"><button onClick={() => void onPatch(file.id, { starred: !file.starred })}><Star size={16} fill={file.starred ? 'currentColor' : 'none'} /></button><button onClick={() => onShare(file)}><Share2 size={16} /></button></div>
            </div>
          ))}
        </div>
      )}
      {showNewGroup && (
        <div className="modal-backdrop" onMouseDown={() => setShowNewGroup(false)}>
          <div className="small-modal" onMouseDown={(event) => event.stopPropagation()}>
            <span className="modal-title-icon"><FolderPlus size={20} /></span><h3>新建文件分组</h3><p>为文件分组取一个容易识别的名字。</p>
            <label>分组名称<input autoFocus value={newGroup} maxLength={100} onChange={(event) => setNewGroup(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void createGroup()} placeholder="例如：合同文档" /></label>
            <div><button className="button button-ghost" disabled={creatingGroup} onClick={() => setShowNewGroup(false)}>取消</button><button className="button button-primary" disabled={creatingGroup || !newGroup.trim()} onClick={() => void createGroup()}>{creatingGroup ? '正在创建…' : '创建分组'}</button></div>
          </div>
        </div>
      )}
    </div>
  )
}

function VideoUploadProgress({ status }: { status: VideoUploadStatus | null }) {
  const phaseLabel = status?.phase === 'processing'
    ? '上传完成，正在处理'
    : status?.stalled
      ? '网络较慢，仍在上传'
      : status?.speed
        ? '正在上传'
        : '正在建立上传连接'
  const detailLabel = status?.phase === 'processing'
    ? '文件已传输完毕，正在等待服务器响应…'
    : status?.stalled
      ? '暂未收到新的进度，可能是网络较慢，请继续等待'
      : status?.speed
        ? `${formatTransferRate(status.speed)} · 预计剩余 ${formatEta(status.eta)}`
        : '等待网络数据…'
  const percent = status?.percent || 0
  const loaded = status?.loaded || 0
  const total = status?.total || 0

  return (
    <div className={`video-upload-progress ${status?.stalled ? 'stalled' : ''}`} aria-live="polite">
      <div className="video-upload-progress-heading">
        <span>{status?.phase === 'processing' ? <LoaderCircle size={15} className="spin" /> : <Gauge size={15} />} {phaseLabel}</span>
        <b>{percent}%</b>
      </div>
      <div className="video-upload-progress-track" role="progressbar" aria-label="视频上传进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <i style={{ width: `${percent}%` }} />
      </div>
      <div className="video-upload-progress-meta">
        <span>{formatBytes(loaded)} / {formatBytes(total)}</span>
        <span>{status?.phase === 'processing' ? <><LoaderCircle size={13} className="spin" /> 服务端处理中</> : status?.stalled ? <><Clock3 size={13} /> 等待网络响应</> : detailLabel}</span>
      </div>
    </div>
  )
}

function ImageCard({ image, onShare, onPatch, compact = false, selected = false, onSelect }: {
  image: ImageItem
  onShare: (image: ImageItem) => void
  onPatch: (id: string, changes: Partial<ImageItem>) => void
  compact?: boolean
  selected?: boolean
  onSelect?: () => void
}) {
  return (
    <article className={`image-card ${compact ? 'compact' : ''} ${selected ? 'selected' : ''}`}>
      <div className="image-preview">
        <button className="image-open-button" onClick={() => onShare(image)} aria-label={`查看大图 ${image.name}`} title="查看大图"><img src={image.url} alt={image.name} loading="lazy" /></button>
        <span className="format-badge">{image.type}</span>
        {image.guestUploaded && <span className="guest-badge"><Users size={11} /> 游客</span>}
        {!compact && <button className={`select-box card-select ${selected ? 'selected' : ''}`} onClick={onSelect}>{selected && <Check size={13} />}</button>}
        <div className="card-hover-actions">
          <button onClick={() => void onPatch(image.id, { starred: !image.starred })} aria-label="收藏"><Heart size={16} fill={image.starred ? 'currentColor' : 'none'} /></button>
          <button onClick={() => onShare(image)} aria-label="分享"><Share2 size={16} /></button>
        </div>
      </div>
      <div className="image-card-meta">
        <b title={image.name}>{image.name}</b>
        <span>{formatBytes(image.size)} · {formatDate(image.createdAt)}</span>
      </div>
    </article>
  )
}

function VideoReferenceFields({ video, notify }: { video: VideoItem; notify: (message: string) => void }) {
  const [copiedKey, setCopiedKey] = useState('')
  const clearTimer = useRef<number | null>(null)
  const references = buildVideoReferences(video)

  useEffect(() => () => {
    if (clearTimer.current !== null) window.clearTimeout(clearTimer.current)
  }, [])

  const copy = async (key: string, label: string, value: string) => {
    try {
      await copyText(value)
      setCopiedKey(key)
      notify(`${label}已复制`)
      if (clearTimer.current !== null) window.clearTimeout(clearTimer.current)
      clearTimer.current = window.setTimeout(() => setCopiedKey(''), 1800)
    } catch {
      notify('复制失败，请手动选择内容')
    }
  }

  return <>{references.map(({ key, label, value }) => (
    <label key={key}>
      <span>{label}</span>
      <div><input readOnly value={value} aria-label={label} /><button type="button" onClick={() => void copy(key, label, value)} aria-label={`复制${label}`} title={`复制${label}`}>{copiedKey === key ? <Check size={16} /> : <Copy size={16} />}</button></div>
    </label>
  ))}</>
}

function FileReferenceFields({ file, notify }: { file: FileItem; notify: (message: string) => void }) {
  const [copiedKey, setCopiedKey] = useState('')
  const clearTimer = useRef<number | null>(null)
  const references = buildFileReferences(file)

  useEffect(() => () => {
    if (clearTimer.current !== null) window.clearTimeout(clearTimer.current)
  }, [])

  const copy = async (key: string, label: string, value: string) => {
    try {
      await copyText(value)
      setCopiedKey(key)
      notify(`${label}已复制`)
      if (clearTimer.current !== null) window.clearTimeout(clearTimer.current)
      clearTimer.current = window.setTimeout(() => setCopiedKey(''), 1800)
    } catch {
      notify('复制失败，请手动选择内容')
    }
  }

  return <>{references.map(({ key, label, value }) => (
    <label key={key}>
      <span>{label}</span>
      <div><input readOnly value={value} aria-label={label} /><button type="button" onClick={() => void copy(key, label, value)} aria-label={`复制${label}`} title={`复制${label}`}>{copiedKey === key ? <Check size={16} /> : <Copy size={16} />}</button></div>
    </label>
  ))}</>
}

function RenameControl({ name, mediaLabel, onSave, notify }: {
  name: string
  mediaLabel: string
  onSave: (name: string) => Promise<boolean>
  notify: (message: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!editing) setDraft(name)
  }, [editing, name])

  const startEditing = () => {
    setDraft(name)
    setEditing(true)
  }

  const cancelEditing = () => {
    setDraft(name)
    setEditing(false)
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    const nextName = draft.trim()
    if (!nextName) return notify(`${mediaLabel}名称不能为空`)
    if (nextName.length > 255) return notify(`${mediaLabel}名称不能超过 255 个字符`)
    if (nextName === name) return setEditing(false)
    setSaving(true)
    try {
      if (await onSave(nextName)) setEditing(false)
    } catch {
      notify(`${mediaLabel}重命名失败，请重试`)
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <form className="share-name-editor" onSubmit={(event) => void save(event)}>
        <input autoFocus value={draft} maxLength={255} aria-label={`重命名${mediaLabel}`} onChange={(event) => setDraft(event.target.value)} />
        <button type="submit" className="save" disabled={saving} aria-label={`保存${mediaLabel}名称`} title={`保存${mediaLabel}名称`}><Check size={15} /></button>
        <button type="button" disabled={saving} onClick={cancelEditing} aria-label="取消重命名" title="取消重命名"><X size={15} /></button>
      </form>
    )
  }

  return (
    <div className="share-name-row">
      <h3 title={name}>{name}</h3>
      <button type="button" className="share-name-edit" onClick={startEditing} aria-label={`重命名${mediaLabel}`} title={`重命名${mediaLabel}`}><Pencil size={14} /></button>
    </div>
  )
}

function MediaHotlinkToggle({ enabled, mediaLabel, onChange }: {
  enabled: boolean
  mediaLabel: '图片' | '视频'
  onChange: () => void
}) {
  return (
    <div className="media-hotlink-setting">
      <span><b>启用{mediaLabel}防盗链</b><small>{enabled ? '已开启：外部网站引用会按系统防盗链策略校验' : '已关闭：允许外部网站直接引用此媒体'}</small></span>
      <button className={`switch ${enabled ? 'active' : ''}`} onClick={onChange} aria-label={`启用${mediaLabel}防盗链`} aria-pressed={enabled}><i /></button>
    </div>
  )
}

function VideoShareModal({ video, categories, onClose, onPatch, onDelete, notify }: {
  video: VideoItem
  categories: VideoCategoryItem[]
  onClose: () => void
  onPatch: (id: string, changes: Partial<VideoItem>) => Promise<boolean>
  onDelete: () => void
  notify: (message: string) => void
}) {
  const direct = absoluteUrl(video.url)
  const copy = async () => {
    try {
      await copyText(direct)
      notify('视频直链已复制到剪贴板')
    } catch {
      notify('复制失败，请手动选择链接')
    }
  }

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="share-modal video-share-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="关闭视频查看"><X size={18} /></button>
        <div className="share-preview">
          <a className="share-open-original" href={video.url} target="_blank" rel="noreferrer" aria-label="在新窗口打开视频" title="在新窗口打开视频"><Maximize2 size={18} /></a>
          <video controls preload="metadata" src={video.url} />
          <span>{video.type}</span>
        </div>
        <div className="share-body">
          <div className="share-heading"><span><small>{videoCategoryName(video)}</small><RenameControl name={video.name} mediaLabel="视频" onSave={(name) => onPatch(video.id, { name })} notify={notify} /><p>{video.type} · {formatBytes(video.size)} · {formatDate(video.createdAt)}</p></span><button className={video.starred ? 'starred' : ''} onClick={() => void onPatch(video.id, { starred: !video.starred })} aria-label={video.starred ? '取消收藏' : '收藏视频'}><Star size={18} fill={video.starred ? 'currentColor' : 'none'} /></button></div>
          <label className="video-detail-category"><span>所属分类</span><select value={videoCategoryName(video)} onChange={(event) => void onPatch(video.id, { category: event.target.value })}>{categories.map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}</select></label>
          <div className="video-share-note"><Video size={15} /> 支持浏览器在线播放，分享直链后可用于网页、论坛或第三方播放器。</div>
          <MediaHotlinkToggle enabled={video.hotlinkProtectionEnabled !== false} mediaLabel="视频" onChange={() => void onPatch(video.id, { hotlinkProtectionEnabled: video.hotlinkProtectionEnabled === false })} />
          <div className="link-list"><VideoReferenceFields video={video} notify={notify} /></div>
          <div className="share-footer"><button className="danger-button" onClick={onDelete}><Trash2 size={16} /> 删除视频</button><a className="button button-secondary" href={video.url} download><Download size={16} /> 下载视频</a><button className="button button-primary" onClick={() => void copy()}><Link2 size={16} /> 复制直链</button></div>
        </div>
      </div>
    </div>
  )
}

function FileShareModal({ file, groups, onClose, onPatch, onDelete, notify }: {
  file: FileItem
  groups: FileGroupItem[]
  onClose: () => void
  onPatch: (id: string, changes: Partial<FileItem>) => Promise<boolean>
  onDelete: () => void
  notify: (message: string) => void
}) {
  const direct = absoluteUrl(file.url)
  const copy = async () => {
    try {
      await copyText(direct)
      notify('文件直链已复制到剪贴板')
    } catch {
      notify('复制失败，请手动选择链接')
    }
  }

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="share-modal file-share-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="关闭文件查看"><X size={18} /></button>
        <div className="share-preview file-share-preview">
          <a className="share-open-original" href={file.url} target="_blank" rel="noreferrer" aria-label="下载文件" title="下载文件"><Download size={18} /></a>
          <span className="file-share-icon"><FileText size={62} /></span>
          <span>{file.type}</span>
        </div>
        <div className="share-body">
          <div className="share-heading"><span><small>{fileGroupName(file)}</small><RenameControl name={file.name} mediaLabel="文件" onSave={(name) => onPatch(file.id, { name })} notify={notify} /><p>{file.type} · {formatBytes(file.size)} · {formatDate(file.createdAt)}</p></span><button className={file.starred ? 'starred' : ''} onClick={() => void onPatch(file.id, { starred: !file.starred })} aria-label={file.starred ? '取消收藏' : '收藏文件'}><Star size={18} fill={file.starred ? 'currentColor' : 'none'} /></button></div>
          <label className="video-detail-category"><span>所属分组</span><select value={fileGroupName(file)} onChange={(event) => void onPatch(file.id, { group: event.target.value })}>{groups.map((group) => <option key={group.id} value={group.name}>{group.name}</option>)}</select></label>
          <div className="video-share-note"><FileText size={15} /> 文件直链默认以下载方式响应，适合分享文档、素材包和交付物。</div>
          <div className="link-list"><FileReferenceFields file={file} notify={notify} /></div>
          <div className="share-footer"><button className="danger-button" onClick={onDelete}><Trash2 size={16} /> 删除文件</button><a className="button button-secondary" href={file.url} download><Download size={16} /> 下载文件</a><button className="button button-primary" onClick={() => void copy()}><Link2 size={16} /> 复制直链</button></div>
        </div>
      </div>
    </div>
  )
}

function MediaLibraryView({ tab, onTabChange, albums, images, onOpenGallery, onAlbumCreated, onSetDefault, videoCategories, videos, onCategoryCreated, onSetDefaultCategory, selectedCategory, onCategoryChange, loading, onShare, onPatch, onDelete, notify }: {
  tab: 'albums' | 'videos'
  onTabChange: (tab: 'albums' | 'videos') => void
  albums: AlbumItem[]
  images: ImageItem[]
  onOpenGallery: (albumName: string) => void
  onAlbumCreated: (album: AlbumItem) => void
  onSetDefault: (albumId: string) => Promise<void>
  videoCategories: VideoCategoryItem[]
  videos: VideoItem[]
  onCategoryCreated: (category: VideoCategoryItem) => void
  onSetDefaultCategory: (categoryId: string) => Promise<void>
  selectedCategory: string
  onCategoryChange: (category: string) => void
  loading: boolean
  onShare: (video: VideoItem) => void
  onPatch: (id: string, changes: Partial<VideoItem>) => void
  onDelete: (ids: string[]) => void
  notify: (message: string) => void
}) {
  return (
    <div className="media-library-page">
      <div className="media-library-tabs" role="tablist" aria-label="媒体库类型">
        <button className={tab === 'albums' ? 'active' : ''} onClick={() => onTabChange('albums')} role="tab" aria-selected={tab === 'albums'}><Album size={17} /> 相册</button>
        <button className={tab === 'videos' ? 'active' : ''} onClick={() => onTabChange('videos')} role="tab" aria-selected={tab === 'videos'}><Video size={17} /> 视频</button>
      </div>
      {tab === 'albums' ? (
        <AlbumsView albums={albums} images={images} onOpenGallery={onOpenGallery} onAlbumCreated={onAlbumCreated} onSetDefault={onSetDefault} notify={notify} />
      ) : (
        <VideoLibrary videos={videos} categories={videoCategories} selectedCategory={selectedCategory} onCategoryChange={onCategoryChange} onCategoryCreated={onCategoryCreated} onSetDefaultCategory={onSetDefaultCategory} loading={loading} onShare={onShare} onPatch={onPatch} onDelete={onDelete} notify={notify} />
      )}
    </div>
  )
}

function AlbumsView({ albums, images, onOpenGallery, onAlbumCreated, onSetDefault, notify }: {
  albums: AlbumItem[]
  images: ImageItem[]
  onOpenGallery: (albumName: string) => void
  onAlbumCreated: (album: AlbumItem) => void
  onSetDefault: (albumId: string) => Promise<void>
  notify: (message: string) => void
}) {
  const [showNewAlbum, setShowNewAlbum] = useState(false)
  const [newAlbum, setNewAlbum] = useState('')
  const [creatingAlbum, setCreatingAlbum] = useState(false)
  const createAlbum = async () => {
    const value = newAlbum.trim()
    if (!value || creatingAlbum) return
    if (value.length > 100) return notify('相册名称不能超过 100 个字符')
    setCreatingAlbum(true)
    try {
      const response = await fetch('/api/albums', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: value }) })
      const detail = await response.json().catch(() => ({ message: '创建失败' }))
      if (!response.ok) return notify(detail.message)
      onAlbumCreated(detail as AlbumItem)
      setNewAlbum('')
      setShowNewAlbum(false)
      notify('新相册已创建')
    } catch {
      notify('相册创建失败，请重试')
    } finally {
      setCreatingAlbum(false)
    }
  }
  return (
    <div className="albums-page">
      <div className="page-action-row"><div><h3>{albums.length} 个相册</h3><p>用主题组织你的视觉资产</p></div><button className="button button-primary" onClick={() => setShowNewAlbum(true)}><FolderPlus size={17} /> 新建相册</button></div>
      <div className="album-grid">
        {albums.map((album, index) => {
          const albumImages = images.filter((image) => image.album === album.name)
          return (
            <article className={`album-card ${album.isDefault ? 'default' : ''}`} key={album.id}>
              <button className="album-open-button" onClick={() => onOpenGallery(album.name)} aria-label={`打开相册 ${album.name}`}>
                <div className={`album-cover album-color-${index % 4}`}>
                  {albumImages[0] || album.cover ? <img src={albumImages[0]?.url || album.cover || ''} alt="" /> : <Album size={38} />}
                  {albumImages.slice(1, 3).map((image) => <img key={image.id} src={image.url} alt="" />)}
                  <span className="album-count">{album.imageCount}</span>
                </div>
              </button>
              <div className="album-card-meta">
                <span><b>{album.name}</b><small>{album.imageCount} 张图片 · {formatBytes(album.storageUsed)}</small></span>
                <button className={`album-default-button ${album.isDefault ? 'active' : ''}`} disabled={album.isDefault} onClick={() => void onSetDefault(album.id)} title={album.isDefault ? '当前默认相册' : '设为默认相册'}>
                  {album.isDefault ? <CheckCircle2 size={15} /> : <Star size={15} />}
                  {album.isDefault ? '默认相册' : '设为默认'}
                </button>
              </div>
            </article>
          )
        })}
      </div>
      {showNewAlbum && (
        <div className="modal-backdrop" onMouseDown={() => setShowNewAlbum(false)}>
          <div className="small-modal" onMouseDown={(event) => event.stopPropagation()}>
            <span className="modal-title-icon"><FolderPlus size={20} /></span><h3>新建相册</h3><p>为新相册取一个容易识别的名字。</p>
            <label>相册名称<input autoFocus value={newAlbum} maxLength={100} onChange={(event) => setNewAlbum(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void createAlbum()} placeholder="例如：夏日旅行" /></label>
            <div><button className="button button-ghost" disabled={creatingAlbum} onClick={() => setShowNewAlbum(false)}>取消</button><button className="button button-primary" disabled={creatingAlbum || !newAlbum.trim()} onClick={() => void createAlbum()}>{creatingAlbum ? '正在创建…' : '创建相册'}</button></div>
          </div>
        </div>
      )}
    </div>
  )
}

function UsersView({ currentUser, notify, onUserUpdated }: { currentUser: User; notify: (message: string) => void; onUserUpdated: (user: UserSummary) => void }) {
  const [users, setUsers] = useState<UserSummary[]>([])
  const [storageProviders, setStorageProviders] = useState<StorageProviderItem[]>([])
  const [loadingUsers, setLoadingUsers] = useState(true)
  const [editingUser, setEditingUser] = useState<UserSummary | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [savingUser, setSavingUser] = useState(false)
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'member' as 'admin' | 'member',
    quotaGb: '5',
    storageProviderId: '',
  })

  const loadUsers = useCallback(async () => {
    try {
      const [usersResponse, storageResponse] = await Promise.all([fetch('/api/users'), fetch('/api/storage/providers')])
      if (!usersResponse.ok) throw new Error('load failed')
      setUsers(await usersResponse.json())
      if (storageResponse.ok) setStorageProviders(await storageResponse.json())
    } catch {
      notify('成员列表加载失败')
    } finally {
      setLoadingUsers(false)
    }
  }, [notify])

  useEffect(() => { void loadUsers() }, [loadUsers])

  const openCreateUser = () => {
    setEditingUser(null)
    setForm({ name: '', email: '', password: '', role: 'member', quotaGb: '5', storageProviderId: '' })
    setEditorOpen(true)
  }

  const openEditUser = (user: UserSummary) => {
    setEditingUser(user)
    setForm({
      name: user.name,
      email: user.email,
      password: '',
      role: user.role,
      quotaGb: String(Number((user.quota / 1024 ** 3).toFixed(2))),
      storageProviderId: user.storageProviderId || '',
    })
    setEditorOpen(true)
  }

  const closeEditor = () => {
    if (savingUser) return
    setEditorOpen(false)
    setEditingUser(null)
  }

  const saveUser = async (event: React.FormEvent) => {
    event.preventDefault()
    const quotaGb = Number(form.quotaGb)
    if (!Number.isFinite(quotaGb) || quotaGb <= 0) return notify('请输入有效的存储配额')
    setSavingUser(true)
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim(),
        role: form.role,
        quota: Math.round(quotaGb * 1024 ** 3),
        storageProviderId: form.storageProviderId || null,
        ...(form.password ? { password: form.password } : {}),
      }
      const response = await fetch(editingUser ? `/api/users/${editingUser.id}` : '/api/users', {
        method: editingUser ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const detail = await response.json().catch(() => ({ message: '保存失败' }))
      if (!response.ok) return notify(detail.message)
      const updated = detail as UserSummary
      setUsers((current) => editingUser
        ? current.map((user) => user.id === updated.id ? updated : user)
        : [...current, updated])
      onUserUpdated(updated)
      setEditorOpen(false)
      setEditingUser(null)
      notify(editingUser ? '成员资料已更新' : '新成员账户已创建')
    } catch {
      notify('保存成员资料失败，请重试')
    } finally {
      setSavingUser(false)
    }
  }

  const teamStorage = users.reduce((sum, user) => sum + user.storageUsed, 0)
  const storageName = (providerId: string | null) => providerId
    ? storageProviders.find((provider) => provider.id === providerId)?.name || '存储配置不可用'
    : '跟随系统默认'
  return (
    <div className="users-page">
      <section className="team-overview">
        <div><span className="eyebrow-pill light"><Users size={13} /> 团队空间</span><h2>一起创作，各自安全。</h2><p>每位成员拥有独立图库、相册、配额、存储策略和 API 密钥。</p></div>
        <div className="team-stats"><span><b>{users.length}</b><small>空间成员</small></span><span><b>{users.reduce((sum, user) => sum + user.imageCount + user.videoCount + user.fileCount, 0)}</b><small>团队资源</small></span><span><b>{formatBytes(teamStorage)}</b><small>占用空间</small></span></div>
      </section>
      <section className="section-card users-card">
        <div className="section-heading"><div><h3>空间成员</h3><p>管理账户资料、角色、存储配额与存储策略</p></div><button className="button button-primary" onClick={openCreateUser}><UserPlus size={16} /> 添加成员</button></div>
        <div className="users-table-head"><span>成员</span><span>角色</span><span>媒体</span><span>已用 / 配额</span><span>存储策略</span><span>加入时间</span><span /></div>
        {loadingUsers ? <div className="users-loading">正在载入成员…</div> : users.map((user) => (
          <div className="user-row" key={user.id}>
            <span className="member-cell"><i>{user.name.slice(0, 1).toUpperCase()}</i><span><b>{user.name}{user.id === currentUser.id && <em>你</em>}</b><small>{user.email}</small></span></span>
            <span><span className={`role-badge ${user.role}`}>{user.role === 'admin' ? '管理员' : '成员'}</span></span>
            <span>{user.imageCount} 图 · {user.videoCount} 视频 · {user.fileCount} 文件</span><span>{formatBytes(user.storageUsed)} / {formatBytes(user.quota)}</span><span className="user-storage-policy">{storageName(user.storageProviderId)}</span><span>{formatDate(user.createdAt)}</span>
            <button className="icon-button user-edit-button" onClick={() => openEditUser(user)} aria-label={`编辑${user.name}`} title="编辑成员"><Pencil size={16} /></button>
          </div>
        ))}
      </section>
      <section className="isolation-note"><ShieldCheck size={19} /><span><b>用户级数据隔离已启用</b><small>图片、相册、配额与 API 密钥均绑定到所有者账户，接口会自动校验访问身份。</small></span></section>
      {editorOpen && (
        <div className="modal-backdrop" onMouseDown={closeEditor}>
          <form className="small-modal member-modal member-editor-modal" onSubmit={saveUser} onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="modal-close" onClick={closeEditor} aria-label="关闭成员编辑"><X size={18} /></button>
            <span className="modal-title-icon">{editingUser ? <Pencil size={20} /> : <UserPlus size={20} />}</span><h3>{editingUser ? '编辑空间成员' : '添加空间成员'}</h3><p>{editingUser ? '更新成员账户与空间分配。' : '创建成员账户并分配初始空间。'}</p>
            <div className="member-form-grid">
              <label>成员称呼<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：产品设计师" required minLength={2} maxLength={80} /></label>
              <label>登录邮箱<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="member@example.com" maxLength={254} required /></label>
              <label>{editingUser ? '新密码（可选）' : '初始密码'}<input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder={editingUser ? '留空不修改' : '至少 8 个字符'} required={!editingUser} minLength={form.password ? 8 : undefined} maxLength={128} /></label>
              <label>空间角色<select value={form.role} disabled={editingUser?.id === currentUser.id} onChange={(event) => setForm({ ...form, role: event.target.value as 'admin' | 'member' })}><option value="member">普通成员</option><option value="admin">管理员</option></select></label>
              <label>存储配额（GB）<input type="number" min="0.1" max="102400" step="0.1" value={form.quotaGb} onChange={(event) => setForm({ ...form, quotaGb: event.target.value })} required /></label>
              <label>存储策略<select value={form.storageProviderId} onChange={(event) => setForm({ ...form, storageProviderId: event.target.value })}><option value="">跟随系统当前存储</option>{storageProviders.map((provider) => <option value={provider.id} key={provider.id}>{provider.name}{provider.isDefault ? ' · 当前' : ''}</option>)}</select></label>
            </div>
            <div><button type="button" className="button button-ghost" onClick={closeEditor}>取消</button><button className="button button-primary" disabled={savingUser}><Check size={16} /> {savingUser ? '正在保存…' : editingUser ? '保存修改' : '创建成员'}</button></div>
          </form>
        </div>
      )}
    </div>
  )
}

function AnalyticsView({ notify }: { notify: (message: string) => void }) {
  const [days, setDays] = useState(30)
  const [analytics, setAnalytics] = useState<TrafficAnalytics | null>(null)
  const [loadingAnalytics, setLoadingAnalytics] = useState(true)
  const [error, setError] = useState('')

  const loadAnalytics = useCallback(async () => {
    setLoadingAnalytics(true)
    setError('')
    try {
      const response = await fetch(`/api/analytics/traffic?days=${days}`)
      const detail = await response.json().catch(() => ({ message: '统计数据读取失败' }))
      if (!response.ok) throw new Error(detail.message || '统计数据读取失败')
      setAnalytics(detail as TrafficAnalytics)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '统计数据读取失败'
      setError(message)
      notify(message)
    } finally {
      setLoadingAnalytics(false)
    }
  }, [days, notify])

  useEffect(() => {
    void loadAnalytics()
  }, [loadAnalytics])

  if (loadingAnalytics && !analytics) {
    return <div className="empty-state analytics-loading"><span><BarChart3 size={28} /></span><h3>正在读取流量统计…</h3><p>正在汇总媒体直链的访问与引用数据。</p></div>
  }
  if (error && !analytics) {
    return <div className="empty-state error-state"><span><Server size={28} /></span><h3>统计数据加载失败</h3><p>{error}</p><button className="button button-primary" onClick={() => void loadAnalytics()}><RefreshCw size={16} />重新加载</button></div>
  }
  if (!analytics) return null

  const { summary, daily, topMedia, referrers } = analytics
  const maxDailyBytes = Math.max(1, ...daily.map((item) => item.bytes))
  const maxMediaBytes = Math.max(1, ...topMedia.map((item) => item.bytes))
  const averageBytes = summary.averageBytes
  const hasTrafficAlert = summary.peakBytes > 0
    && summary.peakBytes >= Math.max(averageBytes * 2, 100 * 1024 * 1024)
  const dateLabel = `${formatAnalyticsDate(analytics.startDate)} 至 ${formatAnalyticsDate(analytics.endDate)}`

  return (
    <div className="analytics-page">
      <section className="analytics-overview">
        <div>
          <span className="eyebrow-pill light"><BarChart3 size={13} /> 流量分析</span>
          <h2>看清每一次媒体引用。</h2>
          <p>按天汇总图片、视频和文件直链的实际响应流量，快速发现外链滥用和异常下载。</p>
        </div>
        <div className="analytics-overview-actions">
          <label><CalendarDays size={15} /><span>统计范围</span><select value={days} onChange={(event) => setDays(Number(event.target.value))} aria-label="统计范围">{[7, 30, 90, 180, 365].map((value) => <option key={value} value={value}>最近 {value} 天</option>)}</select></label>
          <button className="button button-light" onClick={() => void loadAnalytics()} disabled={loadingAnalytics}><RefreshCw size={16} className={loadingAnalytics ? 'spin' : ''} />刷新</button>
        </div>
      </section>

      <div className="analytics-metrics">
        <section className="section-card analytics-metric-card"><span className="metric-icon orange"><ExternalLink size={18} /></span><div><small>外部引用流量</small><b>{formatBytes(summary.externalBytes)}</b><p>{summary.externalRequests.toLocaleString()} 次外部请求</p></div></section>
        <section className="section-card analytics-metric-card"><span className="metric-icon blue"><HardDrive size={18} /></span><div><small>全部媒体流量</small><b>{formatBytes(summary.bytes)}</b><p>{summary.requests.toLocaleString()} 次媒体请求</p></div></section>
        <section className="section-card analytics-metric-card"><span className="metric-icon yellow"><Share2 size={18} /></span><div><small>外部流量占比</small><b>{summary.externalSharePercent.toFixed(1)}%</b><p>按服务器实际响应字节计算</p></div></section>
        <section className="section-card analytics-metric-card"><span className="metric-icon green"><Video size={18} /></span><div><small>Range 请求</small><b>{summary.rangeRequests.toLocaleString()}</b><p>常见于视频播放和拖动</p></div></section>
      </div>

      {hasTrafficAlert
        ? <div className="analytics-alert"><ShieldAlert size={18} /><span><b>发现需要关注的流量峰值</b><small>{formatAnalyticsDate(summary.peakDate || analytics.endDate)} 全部媒体流量达到 {formatBytes(summary.peakBytes)}，明显高于统计期间平均值；其中外部引用 {formatBytes(summary.peakExternalBytes)}。建议检查下方媒体和来源域名。</small></span></div>
        : <div className="analytics-note"><ShieldCheck size={18} /><span><b>当前没有明显的外部流量峰值</b><small>统计范围：{dateLabel} · 时区：{analytics.timezone}。新部署后从服务器首次记录开始累计。</small></span></div>}

      <section className="section-card analytics-chart-card">
        <div className="section-heading"><div><h3>每日引用流量</h3><p>{dateLabel} · 外部引用显示为橙色</p></div><div className="analytics-legend"><span><i className="total" />全部流量</span><span><i className="external" />外部引用</span></div></div>
        {daily.length ? <div className="analytics-chart" role="img" aria-label="每日媒体流量柱状图">
          {daily.map((item, index) => {
            const totalHeight = Math.max(4, (item.bytes / maxDailyBytes) * 100)
            const externalHeight = item.bytes ? Math.min(100, (item.externalBytes / item.bytes) * 100) : 0
            const labelStep = daily.length <= 31 ? 1 : Math.ceil(daily.length / 15)
            return <div className="analytics-chart-column" key={item.date} title={`${formatAnalyticsDate(item.date)} · 总流量 ${formatBytes(item.bytes)} · 外部 ${formatBytes(item.externalBytes)}`}>
              <div className="analytics-bar-wrap"><div className="analytics-bar" style={{ height: `${totalHeight}%` }}><i style={{ height: `${externalHeight}%` }} /></div></div>
              {(index % labelStep === 0 || index === daily.length - 1) && <small>{item.date.slice(5)}</small>}
            </div>
          })}
        </div> : <div className="analytics-empty">当前统计范围内还没有媒体直链访问记录。</div>}
      </section>

      <div className="analytics-lower-grid">
        <section className="section-card analytics-list-card">
          <div className="section-heading"><div><h3>高消耗媒体</h3><p>按实际总流量排序，外部引用单独标记</p></div><span className="status-pill">{topMedia.length} 项</span></div>
          {topMedia.length ? <div className="analytics-media-list">{topMedia.map((item) => <div className="analytics-media-row" key={`${item.mediaType}-${item.mediaId}`}>
            <span className={`analytics-media-icon ${item.mediaType}`}>{item.mediaType === 'video' ? <Video size={17} /> : item.mediaType === 'file' ? <FileText size={17} /> : <ImageIcon size={17} />}</span>
            <span className="analytics-media-meta"><b title={item.name}>{item.name}</b><small>{item.mediaType === 'video' ? '视频' : item.mediaType === 'file' ? '文件' : '图片'} · {item.requests.toLocaleString()} 次请求 · 外部 {formatBytes(item.externalBytes)} · Range {item.rangeRequests.toLocaleString()} 次</small><i><em style={{ width: `${Math.max(3, (item.bytes / maxMediaBytes) * 100)}%` }} /></i></span>
            <strong>{formatBytes(item.bytes)}</strong>
          </div>)}</div> : <div className="analytics-empty">还没有媒体流量数据。</div>}
        </section>

        <section className="section-card analytics-list-card">
          <div className="section-heading"><div><h3>外部来源域名</h3><p>只保存域名，不保存完整页面地址</p></div><span className="status-pill">{referrers.length} 个</span></div>
          {referrers.length ? <div className="analytics-referrer-list">{referrers.map((item) => <div className="analytics-referrer-row" key={item.host}><span><ExternalLink size={15} /><b title={item.host}>{item.host}</b></span><strong>{formatBytes(item.bytes)}</strong><small>{item.requests.toLocaleString()} 次 · {item.mediaCount} 个媒体</small></div>)}</div> : <div className="analytics-empty">暂未识别到带来源域名的外部引用。</div>}
        </section>
      </div>

      <section className="section-card analytics-breakdown-card">
        <div className="section-heading"><div><h3>访问类型</h3><p>帮助区分站内浏览、无来源直链和外部嵌入</p></div></div>
        <div className="analytics-breakdown-grid">
          <div><span><i className="external" /><b>外部引用</b><strong>{formatBytes(summary.externalBytes)}</strong></span><small>{summary.externalRequests.toLocaleString()} 次请求</small></div>
          <div><span><i className="direct" /><b>直接访问</b><strong>{formatBytes(summary.directBytes)}</strong></span><small>{summary.directRequests.toLocaleString()} 次请求</small></div>
          <div><span><i className="internal" /><b>站内访问</b><strong>{formatBytes(summary.internalBytes)}</strong></span><small>{summary.internalRequests.toLocaleString()} 次请求</small></div>
        </div>
      </section>
    </div>
  )
}

function DeveloperView({ stats, notify }: { stats: Stats; notify: (message: string) => void }) {
  const [docsOpen, setDocsOpen] = useState(false)
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([])
  const [keysLoading, setKeysLoading] = useState(true)
  const [keyLabel, setKeyLabel] = useState('')
  const [keySecrets, setKeySecrets] = useState<Record<string, string>>({})
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({})
  const [creatingKey, setCreatingKey] = useState(false)
  const [busyKeyId, setBusyKeyId] = useState('')
  useEffect(() => {
    fetch('/api/api-keys')
      .then(async (response) => {
        const detail = await response.json().catch(() => [])
        if (!response.ok) throw new Error('密钥加载失败')
        setApiKeys(Array.isArray(detail) ? detail : [])
      })
      .catch(() => notify('密钥加载失败'))
      .finally(() => setKeysLoading(false))
  }, [notify])
  const generateKey = async (event: React.FormEvent) => {
    event.preventDefault()
    const label = keyLabel.trim()
    if (label.length < 2) return notify('请输入至少 2 个字符的密钥名称')
    setCreatingKey(true)
    try {
      const response = await fetch('/api/api-keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label }) })
      const detail = await response.json().catch(() => ({ message: '密钥创建失败' })) as ApiKeyItem & { message?: string }
      if (!response.ok) return notify(detail.message || '密钥创建失败')
      setApiKeys((current) => [detail, ...current])
      if (detail.secret) {
        setKeySecrets((current) => ({ ...current, [detail.id]: detail.secret || '' }))
        setVisibleKeys((current) => ({ ...current, [detail.id]: true }))
      }
      setKeyLabel('')
      notify('新 API 密钥已创建')
    } catch {
      notify('密钥创建失败，请重试')
    } finally {
      setCreatingKey(false)
    }
  }
  const loadSecret = async (key: ApiKeyItem) => {
    if (keySecrets[key.id]) return keySecrets[key.id]
    setBusyKeyId(key.id)
    try {
      const response = await fetch(`/api/api-keys/${key.id}/secret`)
      const detail = await response.json().catch(() => ({ message: '密钥读取失败' }))
      if (!response.ok) {
        notify(detail.message || '密钥读取失败')
        return ''
      }
      const secret = String(detail.secret || '')
      setKeySecrets((current) => ({ ...current, [key.id]: secret }))
      return secret
    } catch {
      notify('密钥读取失败，请重试')
      return ''
    } finally {
      setBusyKeyId('')
    }
  }
  const toggleSecret = async (key: ApiKeyItem) => {
    if (visibleKeys[key.id]) {
      setVisibleKeys((current) => ({ ...current, [key.id]: false }))
      return
    }
    const secret = await loadSecret(key)
    if (secret) setVisibleKeys((current) => ({ ...current, [key.id]: true }))
  }
  const copyKey = async (key: ApiKeyItem) => {
    const secret = await loadSecret(key)
    if (!secret) return
    try {
      await copyText(secret)
      notify(`${key.label}已复制`)
    } catch {
      notify('复制失败，请手动选择密钥内容')
    }
  }
  const deleteKey = async (key: ApiKeyItem) => {
    if (!window.confirm(`确认删除 API 密钥“${key.label}”吗？删除后使用该密钥的程序会立即失效。`)) return
    setBusyKeyId(key.id)
    try {
      const response = await fetch(`/api/api-keys/${key.id}`, { method: 'DELETE' })
      if (!response.ok) {
        const detail = await response.json().catch(() => ({ message: '密钥删除失败' }))
        return notify(detail.message)
      }
      setApiKeys((current) => current.filter((item) => item.id !== key.id))
      setKeySecrets((current) => { const next = { ...current }; delete next[key.id]; return next })
      setVisibleKeys((current) => { const next = { ...current }; delete next[key.id]; return next })
      notify('API 密钥已删除')
    } catch {
      notify('密钥删除失败，请重试')
    } finally {
      setBusyKeyId('')
    }
  }
  const usageLimit = Math.max(1, stats.apiLimit || defaultStats.apiLimit)
  const usagePercentage = Math.min(100, (stats.apiCalls / usageLimit) * 100)
  const hasUsage = stats.apiCalls > 0
  const copy = async (text: string, message: string) => {
    try {
      await copyText(text)
      notify(message)
    } catch {
      notify('复制失败，请手动复制')
    }
  }
  const apiBaseUrl = window.location.origin
  return (
    <div className="developer-page">
      <section className="api-hero">
        <div><span className="eyebrow-pill light"><Code2 size={13} /> PicNest API</span><h2>让图片、视频和文件进入你的工作流</h2><p>通过简单、稳定的 REST API 上传、管理与分享图片、视频和通用文件。兼容 ShareX、PicGo、自动化脚本和服务端远程导入。</p><button className="button button-light" onClick={() => setDocsOpen(true)}><BookOpen size={16} /> 阅读 API 文档</button></div>
        <div className="api-terminal"><span><i className="red" /><i className="yellow" /><i className="green" /></span><pre><em>curl</em> -X POST {'\\'}{`\n`}  {apiBaseUrl}/api/files {'\\'}{`\n`}  -H <b>"Authorization: Bearer $TOKEN"</b> {'\\'}{`\n`}  -F <strong>"files=@contract.pdf"</strong> {'\\'}{`\n`}  -F <strong>"group=合同文档"</strong></pre></div>
      </section>
      <div className="developer-grid">
        <section className="section-card api-key-card">
          <div className="section-heading"><div><h3>API 密钥</h3><p>可创建多把密钥，每把密钥仅能访问当前用户的数据</p></div><span className="status-pill">{apiKeys.length} 把</span></div>
          <form className="api-key-create" onSubmit={generateKey}><input value={keyLabel} onChange={(event) => setKeyLabel(event.target.value)} placeholder="密钥名称，例如：PicGo、生产服务器" minLength={2} maxLength={50} required /><button className="button button-primary" disabled={creatingKey}><Plus size={16} /> {creatingKey ? '创建中…' : '创建密钥'}</button></form>
          {keysLoading ? <div className="users-loading">正在载入 API 密钥…</div> : apiKeys.length === 0 ? <div className="api-key-empty"><KeyRound size={20} /><span><b>尚未创建 API 密钥</b><small>为不同设备或应用分别创建，停用时互不影响。</small></span></div> : <div className="api-key-list">{apiKeys.map((key) => {
            const visible = Boolean(visibleKeys[key.id] && keySecrets[key.id])
            const busy = busyKeyId === key.id
            return <div className="api-key-row" key={key.id}>
              <span className="api-key-meta"><b>{key.label}{!key.recoverable && <em>旧密钥</em>}</b><small>创建于 {formatDateTime(key.createdAt)} · {key.lastUsedAt ? `最近使用 ${formatDateTime(key.lastUsedAt)}` : '尚未使用'}</small></span>
              <code>{visible ? keySecrets[key.id] : key.prefix}</code>
              <span className="api-key-actions">
                <button type="button" disabled={busy || !key.recoverable} onClick={() => void toggleSecret(key)} aria-label={visible ? `隐藏${key.label}` : `查看${key.label}`} title={key.recoverable ? (visible ? '隐藏完整密钥' : '查看完整密钥') : '旧密钥无法恢复完整内容'}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                <button type="button" disabled={busy || !key.recoverable} onClick={() => void copyKey(key)} aria-label={`复制${key.label}`} title={key.recoverable ? '复制完整密钥' : '旧密钥无法恢复完整内容'}><Copy size={16} /></button>
                <button type="button" className="delete" disabled={busy} onClick={() => void deleteKey(key)} aria-label={`删除${key.label}`} title="删除密钥"><Trash2 size={16} /></button>
              </span>
            </div>
          })}</div>}
          <small><Lock size={13} /> 完整密钥使用服务器密钥加密保存；删除后无法恢复。</small>
        </section>
        <section className="section-card usage-card"><div className="section-heading"><div><h3>本月用量</h3><p>API 密钥调用额度</p></div><Gauge size={20} /></div><div className="usage-number"><b>{stats.apiCalls.toLocaleString()}</b><span>/ {usageLimit.toLocaleString()}</span></div><div className="usage-progress"><i style={{ width: `${usagePercentage}%` }} /></div><div><span>成功率 <b>{hasUsage ? `${stats.apiSuccessRate.toFixed(2)}%` : '--'}</b></span><span>平均响应 <b>{hasUsage ? `${stats.apiAverageResponseMs}ms` : '--'}</b></span><span>本月流量 <b>{formatBytes(stats.traffic)}</b></span></div></section>
      </div>
      <section className="section-card endpoints-card"><div className="section-heading"><div><h3>资源 API 快速开始</h3><p>上传与查询图片、视频和文件资源</p></div></div>{[
        ['POST', '/api/images', '上传一张或多张图片', 'post'],
        ['POST', '/api/videos', '上传一个或多个视频', 'post'],
        ['POST', '/api/files', '上传一个或多个通用文件', 'post'],
        ['GET', '/api/images', '获取当前空间的图片列表', 'get'],
        ['GET', '/api/videos', '获取当前空间的视频列表', 'get'],
        ['GET', '/api/files', '获取当前空间的文件列表', 'get'],
        ['GET', '/api/file-groups', '获取文件分组列表', 'get'],
      ].map(([method, path, description, tone]) => <div className="endpoint-row" key={`${method}${path}`}><span className={`method ${tone}`}>{method}</span><code>{path}</code><p>{description}</p><button onClick={() => void copy(path, '接口路径已复制')}><Copy size={15} /></button></div>)}</section>
      {docsOpen && <ApiDocsModal onClose={() => setDocsOpen(false)} />}
    </div>
  )
}

function SettingsView({ notify, user, guestUploadEnabled, onGuestUploadChange, onAllowedExtensionsChange }: { notify: (message: string) => void; user: User; guestUploadEnabled: boolean; onGuestUploadChange: (enabled: boolean) => void; onAllowedExtensionsChange: (extensions: string[]) => void }) {
  type SettingsSection = 'storage' | 'security' | 'images' | 'notifications'
  const defaultImageProcessing: ImageProcessingSettings = {
    enabled: true,
    outputFormat: 'original',
    quality: 85,
    autoOrient: true,
    stripMetadata: false,
    allowedExtensions: defaultAllowedExtensions,
  }
  const [activeSection, setActiveSection] = useState<SettingsSection>('storage')
  const [storageProviders, setStorageProviders] = useState<StorageProviderItem[]>([])
  const [storageLoading, setStorageLoading] = useState(true)
  const [storageModalOpen, setStorageModalOpen] = useState(false)
  const [editingStorageProvider, setEditingStorageProvider] = useState<StorageProviderItem | null>(null)
  const [imageProcessing, setImageProcessing] = useState<ImageProcessingSettings>(defaultImageProcessing)
  const [imageProcessingLoading, setImageProcessingLoading] = useState(true)
  const [imageProcessingSaving, setImageProcessingSaving] = useState(false)
  const [newAllowedExtension, setNewAllowedExtension] = useState('')
  const [hotlinkProtection, setHotlinkProtection] = useState<HotlinkProtectionSettings>(defaultHotlinkProtection)
  const [hotlinkProtectionLoading, setHotlinkProtectionLoading] = useState(true)
  const [hotlinkProtectionSaving, setHotlinkProtectionSaving] = useState(false)
  const [newTrustedDomain, setNewTrustedDomain] = useState('')

  const loadStorageProviders = useCallback(async () => {
    setStorageLoading(true)
    try {
      const response = await fetch('/api/storage/providers')
      if (!response.ok) throw new Error('load failed')
      setStorageProviders(await response.json())
    } catch {
      notify('存储服务列表加载失败')
    } finally {
      setStorageLoading(false)
    }
  }, [notify])

  const loadImageProcessing = useCallback(async () => {
    setImageProcessingLoading(true)
    try {
      const response = await fetch('/api/settings/image-processing')
      const detail = await response.json().catch(() => ({ message: '图片处理设置加载失败' }))
      if (!response.ok) throw new Error(detail.message)
      setImageProcessing(detail as ImageProcessingSettings)
      onAllowedExtensionsChange((detail as ImageProcessingSettings).allowedExtensions)
    } catch (error) {
      notify(error instanceof Error ? error.message : '图片处理设置加载失败')
    } finally {
      setImageProcessingLoading(false)
    }
  }, [notify, onAllowedExtensionsChange])

  const loadHotlinkProtection = useCallback(async () => {
    setHotlinkProtectionLoading(true)
    try {
      const response = await fetch('/api/settings/hotlink-protection')
      const detail = await response.json().catch(() => ({ message: '防盗链设置加载失败' }))
      if (!response.ok) throw new Error(detail.message)
      setHotlinkProtection(detail as HotlinkProtectionSettings)
    } catch (error) {
      notify(error instanceof Error ? error.message : '防盗链设置加载失败')
    } finally {
      setHotlinkProtectionLoading(false)
    }
  }, [notify])

  useEffect(() => { void loadStorageProviders(); void loadImageProcessing(); void loadHotlinkProtection() }, [loadHotlinkProtection, loadImageProcessing, loadStorageProviders])

  const testStorageProvider = async (provider: StorageProviderItem) => {
    const response = await fetch(`/api/storage/providers/${provider.id}/test`, { method: 'POST' })
    const detail = await response.json().catch(() => ({ message: '连接检测失败' }))
    notify(response.ok ? `${provider.name}连接正常` : detail.message)
  }

  const activateStorageProvider = async (provider: StorageProviderItem) => {
    const response = await fetch(`/api/storage/providers/${provider.id}/default`, { method: 'PATCH' })
    const detail = await response.json().catch(() => ({ message: '切换失败' }))
    if (!response.ok) return notify(detail.message)
    setStorageProviders((current) => current.map((item) => ({ ...item, isDefault: item.id === provider.id })))
    notify(`新上传将保存到“${provider.name}”`)
  }

  const deleteStorageProvider = async (provider: StorageProviderItem) => {
    if (!window.confirm(`确认删除存储配置“${provider.name}”吗？`)) return
    const response = await fetch(`/api/storage/providers/${provider.id}`, { method: 'DELETE' })
    if (!response.ok) {
      const detail = await response.json().catch(() => ({ message: '删除失败' }))
      return notify(detail.message)
    }
    setStorageProviders((current) => current.filter((item) => item.id !== provider.id))
    notify('存储配置已删除')
  }

  const saveStorageProvider = async (payload: { name: string; type: StorageProviderType; config: Record<string, string | boolean> }) => {
    const response = await fetch(editingStorageProvider ? `/api/storage/providers/${editingStorageProvider.id}` : '/api/storage/providers', {
      method: editingStorageProvider ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const detail = await response.json().catch(() => ({ message: '保存失败' }))
    if (!response.ok) throw new Error(detail.message)
    setStorageProviders((current) => editingStorageProvider
      ? current.map((item) => item.id === detail.id ? detail as StorageProviderItem : item)
      : [...current, detail as StorageProviderItem])
    setStorageModalOpen(false)
    setEditingStorageProvider(null)
    notify(editingStorageProvider ? '存储配置已更新' : '存储服务已添加')
  }

  const sections = [
    { id: 'storage' as const, label: '存储与域名', icon: Server },
    { id: 'security' as const, label: '安全设置', icon: ShieldCheck },
    { id: 'images' as const, label: '图片处理', icon: ImageIcon },
    { id: 'notifications' as const, label: '通知', icon: Bell },
  ]
  const saveImageProcessing = async () => {
    if (user.role !== 'admin') return notify('仅管理员可以修改系统图片处理策略')
    setImageProcessingSaving(true)
    try {
      const response = await fetch('/api/settings/image-processing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(imageProcessing),
      })
      const detail = await response.json().catch(() => ({ message: '图片处理设置保存失败' }))
      if (!response.ok) return notify(detail.message)
      setImageProcessing(detail as ImageProcessingSettings)
      onAllowedExtensionsChange((detail as ImageProcessingSettings).allowedExtensions)
      notify('图片处理策略已保存，新上传立即生效')
    } catch {
      notify('图片处理设置保存失败，请重试')
    } finally {
      setImageProcessingSaving(false)
    }
  }
  const updateGuestUpload = async () => {
    const enabled = !guestUploadEnabled
    const response = await fetch('/api/settings/guest-upload', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) })
    const detail = await response.json().catch(() => ({ message: '设置更新失败' }))
    if (!response.ok) return notify(detail.message)
    onGuestUploadChange(enabled)
    notify(enabled ? '游客上传已开启' : '游客上传已关闭')
  }
  const saveHotlinkProtection = async () => {
    if (user.role !== 'admin') return notify('仅管理员可以修改系统防盗链策略')
    setHotlinkProtectionSaving(true)
    try {
      const response = await fetch('/api/settings/hotlink-protection', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(hotlinkProtection),
      })
      const detail = await response.json().catch(() => ({ message: '防盗链设置保存失败' }))
      if (!response.ok) return notify(detail.message)
      setHotlinkProtection(detail as HotlinkProtectionSettings)
      notify('防盗链策略已保存，新的媒体请求立即生效')
    } catch {
      notify('防盗链设置保存失败，请重试')
    } finally {
      setHotlinkProtectionSaving(false)
    }
  }
  const renderProcessingToggle = (key: 'enabled' | 'autoOrient' | 'stripMetadata', title: string, description: string) => (
    <div className="toggle-row" key={key}>
      <span><b>{title}</b><small>{description}</small></span>
      <button
        className={`switch ${imageProcessing[key] ? 'active' : ''}`}
        disabled={user.role !== 'admin' || imageProcessingLoading}
        onClick={() => setImageProcessing((current) => ({ ...current, [key]: !current[key] }))}
        aria-label={title}
        aria-pressed={imageProcessing[key]}
      ><i /></button>
    </div>
  )

  const addAllowedExtension = () => {
    const extension = newAllowedExtension.trim().toLowerCase().replace(/^\.+/, '')
    if (!/^[a-z0-9]{1,12}$/.test(extension)) return notify('扩展名只能包含 1 到 12 位字母或数字')
    if (imageProcessing.allowedExtensions.includes(extension)) return notify(`.${extension} 已经在允许列表中`)
    if (imageProcessing.allowedExtensions.length >= 32) return notify('最多可以配置 32 种上传文件类型')
    setImageProcessing((current) => ({ ...current, allowedExtensions: [...current.allowedExtensions, extension] }))
    setNewAllowedExtension('')
  }

  const removeAllowedExtension = (extension: string) => {
    if (imageProcessing.allowedExtensions.length <= 1) return notify('至少需要保留一种允许上传的文件类型')
    setImageProcessing((current) => ({ ...current, allowedExtensions: current.allowedExtensions.filter((item) => item !== extension) }))
  }
  const addTrustedDomain = () => {
    const domain = newTrustedDomain.trim().toLowerCase().replace(/^[a-z][a-z\d+.-]*:\/\//, '').split(/[/?#]/, 1)[0].replace(/\.$/, '')
    if (!domain) return notify('请输入可信引用域名')
    if (hotlinkProtection.trustedDomains.includes(domain)) return notify(`${domain} 已经在可信域名列表中`)
    if (hotlinkProtection.trustedDomains.length >= 50) return notify('最多可以配置 50 个可信引用域名')
    setHotlinkProtection((current) => ({ ...current, trustedDomains: [...current.trustedDomains, domain] }))
    setNewTrustedDomain('')
  }

  const removeTrustedDomain = (domain: string) => {
    setHotlinkProtection((current) => ({ ...current, trustedDomains: current.trustedDomains.filter((item) => item !== domain) }))
  }

  const activeStorageProvider = storageProviders.find((provider) => provider.isDefault)

  const renderStorageSection = () => <>
    <div className="settings-section-intro"><span><Server size={20} /></span><div><h2>存储与域名</h2><p>管理文件存储、服务端读取链路和游客上传入口。</p></div></div>
    {user.role === 'admin' && <section className="section-card settings-card guest-setting-card"><div className="settings-heading"><span className="metric-icon orange"><Users size={19} /></span><div><h3>游客上传</h3><p>控制未登录访客能否从首页上传图片</p></div><span className={`status-pill ${guestUploadEnabled ? '' : 'off'}`}>{guestUploadEnabled ? '已开启' : '默认关闭'}</span></div><div className="public-upload-setting"><span><b>允许游客上传</b><small>开启后，登录首页会显示游客上传入口，图片自动进入你的“游客上传”相册。</small></span><button className={`switch ${guestUploadEnabled ? 'active' : ''}`} onClick={() => void updateGuestUpload()} aria-label="允许游客上传" aria-pressed={guestUploadEnabled}><i /></button></div><div className="guest-safety-note"><ShieldCheck size={15} /> 每个来源每小时最多提交 10 次；游客不能查看图库、相册或其他用户内容。</div></section>}
    <section className="section-card settings-card storage-settings-card">
      <div className="settings-heading"><span className="metric-icon green"><HardDrive size={19} /></span><div><h3>存储服务</h3><p>{activeStorageProvider ? `当前使用 ${activeStorageProvider.name}` : '正在读取当前存储'}</p></div><span className="status-pill">{activeStorageProvider ? '已连接' : '加载中'}</span></div>
      {storageLoading ? <div className="users-loading">正在载入存储服务…</div> : <div className="storage-provider-list">
        {storageProviders.map((provider) => <div className={`storage-provider ${provider.isDefault ? 'active' : ''}`} key={provider.id}>
          <span>{provider.type === 'local' ? <Server size={22} /> : <Cloud size={22} />}</span>
          <div className="storage-provider-copy"><b>{provider.name}<em>{storageTypeLabels[provider.type]}</em></b><small>{storageProviderSummary(provider)}</small><small>{provider.imageCount} 张图片 · {provider.videoCount} 个视频 · {provider.fileCount} 个文件保存在此存储</small></div>
          {provider.isDefault && <span className="storage-current"><CheckCircle2 size={14} /> 当前使用</span>}
          {user.role === 'admin' && <div className="storage-provider-actions">
            <button className="button button-ghost" onClick={() => void testStorageProvider(provider)}><CheckCircle2 size={15} /> 检测</button>
            <button className="icon-button" onClick={() => { setEditingStorageProvider(provider); setStorageModalOpen(true) }} aria-label={`编辑${provider.name}`} title="编辑配置"><Settings size={16} /></button>
            {!provider.isDefault && <button className="button button-secondary" onClick={() => void activateStorageProvider(provider)}><Check size={15} /> 设为当前</button>}
            {provider.type !== 'local' && !provider.isDefault && <button className="icon-button storage-delete-button" onClick={() => void deleteStorageProvider(provider)} aria-label={`删除${provider.name}`} title="删除配置"><Trash2 size={16} /></button>}
          </div>}
        </div>)}
      </div>}
      {user.role === 'admin' && <button className="add-provider" onClick={() => { setEditingStorageProvider(null); setStorageModalOpen(true) }}><Plus size={17} /> 添加云存储或 WebDAV</button>}
      <div className="settings-note"><ShieldCheck size={15} /><span>目录或路径前缀只影响新上传；历史图片、视频和文件不会自动移动，删除时会继续使用文件原来的存储位置。</span></div>
    </section>
    <section className="section-card settings-card"><div className="settings-heading"><span className="metric-icon orange"><Link2 size={19} /></span><div><h3>访问域名</h3><p>图片直链由服务器生产配置统一生成</p></div><span className="status-pill">服务器配置</span></div><div className="settings-note"><Link2 size={15} /><span>当前浏览器地址：<code>{window.location.origin}</code>。生产环境请通过 <code>PICNEST_PUBLIC_URL</code> 设置唯一 HTTPS 公网域名，避免不同用户生成不一致的链接。</span></div></section>
  </>

  const renderSecurityToggle = (key: 'imageEnabled' | 'videoEnabled', title: string, description: string) => (
    <div className="toggle-row" key={key}>
      <span><b>{title}</b><small>{description}</small></span>
      <button
        className={`switch ${hotlinkProtection[key] ? 'active' : ''}`}
        disabled={user.role !== 'admin' || hotlinkProtectionLoading}
        onClick={() => setHotlinkProtection((current) => ({ ...current, [key]: !current[key] }))}
        aria-label={title}
        aria-pressed={hotlinkProtection[key]}
      ><i /></button>
    </div>
  )

  const renderSecuritySection = () => <>
    <div className="settings-section-intro"><span><ShieldCheck size={20} /></span><div><h2>安全设置</h2><p>查看账户身份、登录会话和安全提醒状态。</p></div></div>
    <section className="section-card settings-card"><div className="settings-heading"><span className="metric-icon green"><Lock size={19} /></span><div><h3>账户保护</h3><p>当前登录账户的身份与权限</p></div><span className="status-pill">受保护</span></div><div className="security-account"><span><Mail size={17} /></span><div><small>登录邮箱</small><b>{user.email}</b></div><em>{user.role === 'admin' ? '管理员' : '空间成员'}</em></div><div className="security-facts"><span><ShieldCheck size={15} /><b>HttpOnly Cookie</b><small>脚本无法读取会话令牌</small></span><span><Lock size={15} /><b>SameSite Lax</b><small>限制跨站请求携带登录态</small></span><span><KeyRound size={15} /><b>7 天会话</b><small>到期后需要重新登录</small></span></div></section>
    <section className="section-card settings-card hotlink-protection-card">
      <div className="settings-heading"><span className="metric-icon orange"><ShieldAlert size={19} /></span><div><h3>媒体防盗链</h3><p>按媒体类型控制外部网站嵌入和引用</p></div><span className={`status-pill ${hotlinkProtectionLoading ? 'off' : ''}`}>{hotlinkProtectionLoading ? '读取中' : '已配置'}</span></div>
      {hotlinkProtectionLoading ? <div className="users-loading">正在读取防盗链策略…</div> : <>
        {renderSecurityToggle('imageEnabled', '启用图片防盗链', '开启后，外部网站带来源嵌入图片会被拦截；无来源的直接访问仍然允许')}
        {renderSecurityToggle('videoEnabled', '启用视频防盗链', '开启后，外部网站带来源嵌入视频会被拦截；视频 Range 播放仍按同一规则校验')}
        <div className="trusted-domain-setting">
          <div className="allowed-extension-heading"><span><b>可信引用域名</b><small>这些域名及其子域名可以引用已开启防盗链的图片和视频；PicNest 当前域名始终自动允许。</small></span><em>{hotlinkProtection.trustedDomains.length} 个</em></div>
          <div className="extension-chip-list">
            {hotlinkProtection.trustedDomains.map((domain) => <span className="extension-chip" key={domain}><code>{domain}</code>{user.role === 'admin' && <button type="button" onClick={() => removeTrustedDomain(domain)} aria-label={`移除可信域名 ${domain}`} title={`移除可信域名 ${domain}`}><X size={13} /></button>}</span>)}
          </div>
          {user.role === 'admin' && <div className="extension-adder trusted-domain-adder"><span>https://</span><input value={newTrustedDomain} maxLength={253} placeholder="例如 example.com" onChange={(event) => setNewTrustedDomain(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTrustedDomain() } }} /><button type="button" className="button button-secondary" onClick={addTrustedDomain}><Plus size={15} /> 添加域名</button></div>}
        </div>
        <div className="settings-note"><ShieldCheck size={15} /><span>默认图片和视频均开启防盗链，单个媒体还可以在详情弹窗中单独关闭。防盗链主要防止网页盗嵌，不能替代登录授权或签名 URL。</span></div>
        {user.role !== 'admin' && <div className="settings-note"><Lock size={15} /><span>当前策略由管理员统一维护。</span></div>}
      </>}
    </section>
    <section className="section-card settings-card"><div className="settings-heading"><span className="metric-icon orange"><ShieldCheck size={19} /></span><div><h3>接口防护</h3><p>服务端强制执行的生产安全策略</p></div></div><div className="security-facts"><span><ShieldCheck size={15} /><b>同源写操作</b><small>网页登录写请求会校验请求来源</small></span><span><Lock size={15} /><b>登录限流</b><small>同一来源 15 分钟最多尝试 10 次</small></span><span><KeyRound size={15} /><b>密钥隔离</b><small>Bearer 密钥不能管理其他密钥</small></span></div></section>
  </>

  const renderImageSection = () => {
    const editable = user.role === 'admin' && !imageProcessingLoading
    return <>
      <div className="settings-section-intro"><span><ImageIcon size={20} /></span><div><h2>图片处理</h2><p>设置新上传图片的默认保存与处理偏好。</p></div></div>
      {imageProcessingLoading ? <section className="section-card settings-card"><div className="users-loading">正在读取图片处理策略…</div></section> : <>
        <section className="section-card settings-card image-processing-card">
          <div className="settings-heading"><span className="metric-icon blue"><Sparkles size={19} /></span><div><h3>服务端处理策略</h3><p>应用于选择、拖拽、粘贴、API 和游客上传</p></div><span className={`status-pill ${imageProcessing.enabled ? '' : 'off'}`}>{imageProcessing.enabled ? '默认启用' : '已关闭'}</span></div>
          <div className="allowed-extension-setting">
            <div className="allowed-extension-heading"><span><b>允许上传的文件类型</b><small>按文件扩展名控制上传范围，服务端还会核对图片真实格式。</small></span><em>{imageProcessing.allowedExtensions.length} 种</em></div>
            <div className="extension-chip-list">
              {imageProcessing.allowedExtensions.map((extension) => <span className="extension-chip" key={extension}><code>.{extension}</code>{editable && <button type="button" onClick={() => removeAllowedExtension(extension)} aria-label={`移除 .${extension}`} title={`移除 .${extension}`}><X size={13} /></button>}</span>)}
            </div>
            {editable && <div className="extension-adder"><span>.</span><input value={newAllowedExtension} maxLength={13} placeholder="例如 avif" onChange={(event) => setNewAllowedExtension(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addAllowedExtension() } }} /><button type="button" className="button button-secondary" onClick={addAllowedExtension}><Plus size={15} /> 添加类型</button></div>}
          </div>
          {renderProcessingToggle('enabled', '启用图片处理', '关闭后保存原始图片字节；文件类型白名单与真实格式校验仍然生效')}
          <div className={`image-processing-form ${imageProcessing.enabled ? '' : 'disabled'}`}>
            <label><span>默认输出格式</span><select value={imageProcessing.outputFormat} disabled={!editable || !imageProcessing.enabled} onChange={(event) => setImageProcessing((current) => ({ ...current, outputFormat: event.target.value as ImageProcessingSettings['outputFormat'] }))}><option value="original">保持原格式</option><option value="jpg">JPEG · .jpg</option><option value="png">PNG · .png</option><option value="webp">WebP · .webp</option><option value="avif">AVIF · .avif</option></select><small>选择其他格式会真实转换图片编码，不只是修改文件名。</small></label>
            <label className="quality-control"><span>转换质量 <b>{imageProcessing.quality}</b></span><input type="range" min="1" max="100" step="1" value={imageProcessing.quality} disabled={!editable || !imageProcessing.enabled} onInput={(event) => { const quality = Number(event.currentTarget.value); setImageProcessing((current) => ({ ...current, quality })) }} /><small>用于 JPEG、WebP、AVIF，以及需要重新编码的原格式图片。</small></label>
          </div>
          {renderProcessingToggle('autoOrient', '按 EXIF 自动旋转', '检测到方向标记时校正像素方向，并把 Orientation 归一化')}
          {renderProcessingToggle('stripMetadata', '移除 EXIF 与附加元数据', '清除位置、设备、拍摄参数和版权等元数据；SVG 保持原文件内容')}
          {user.role !== 'admin' && <div className="settings-note"><Lock size={15} /><span>当前策略由管理员统一维护，你可以在上传 API 中读取设置，但不能修改系统默认值。</span></div>}
        </section>
        <section className="section-card settings-card"><div className="settings-heading"><span className="metric-icon green"><Upload size={19} /></span><div><h3>当前上传能力</h3><p>服务端已启用 Sharp 图片处理引擎</p></div></div><div className="capability-grid"><span><b>20 MB</b><small>单张文件上限</small></span><span><b>20 张</b><small>单次批量上限</small></span><span><b>{imageProcessing.allowedExtensions.length} 种输入</b><small>{extensionSummary(imageProcessing.allowedExtensions)}</small></span></div><div className="settings-note"><Code2 size={15} /><span>上传 API、工作台和游客入口使用同一份文件类型白名单；API 仍可通过 format、quality、stripMetadata、autoOrient 覆盖单次图片处理参数。</span></div></section>
      </>}
    </>
  }

  const renderNotificationSection = () => <>
    <div className="settings-section-intro"><span><Bell size={20} /></span><div><h2>通知</h2><p>当前版本提供即时的应用内操作反馈。</p></div></div>
    <section className="section-card settings-card"><div className="settings-heading"><span className="metric-icon orange"><Bell size={19} /></span><div><h3>应用内通知</h3><p>上传、设置、密钥和异常状态会立即反馈</p></div><span className="status-pill">已启用</span></div><div className="settings-note"><Bell size={15} /><span>通知会在页面底部短暂显示，上传结果和引用地址会持续保留在工作台，直到你主动清空。</span></div></section>
    <section className="section-card settings-card"><div className="settings-heading"><span className="metric-icon blue"><Mail size={19} /></span><div><h3>邮件通知</h3><p>当前版本不发送邮件，也不会收集 SMTP 凭据</p></div><span className="status-pill off">未提供</span></div></section>
  </>

  return (
    <>
      <div className="settings-page">
        <aside className="settings-index" aria-label="设置分类">{sections.map(({ id, label, icon: Icon }) => <button className={activeSection === id ? 'active' : ''} onClick={() => setActiveSection(id)} aria-pressed={activeSection === id} key={id}><Icon size={17} /> {label}</button>)}</aside>
        <div className="settings-content">
          {activeSection === 'storage' && renderStorageSection()}
          {activeSection === 'security' && renderSecuritySection()}
          {activeSection === 'images' && renderImageSection()}
          {activeSection === 'notifications' && renderNotificationSection()}
          {activeSection === 'images' && <div className="save-settings"><button className="button button-primary" disabled={imageProcessingLoading || imageProcessingSaving || user.role !== 'admin'} onClick={() => void saveImageProcessing()}><Check size={16} /> {imageProcessingSaving ? '正在保存…' : '保存图片处理策略'}</button></div>}
          {activeSection === 'security' && <div className="save-settings"><button className="button button-primary" disabled={hotlinkProtectionLoading || hotlinkProtectionSaving || user.role !== 'admin'} onClick={() => void saveHotlinkProtection()}><Check size={16} /> {hotlinkProtectionSaving ? '正在保存…' : '保存防盗链策略'}</button></div>}
        </div>
      </div>
      {storageModalOpen && <StorageProviderModal provider={editingStorageProvider} onClose={() => { setStorageModalOpen(false); setEditingStorageProvider(null) }} onSave={saveStorageProvider} />}
    </>
  )
}

function StorageProviderModal({ provider, onClose, onSave }: {
  provider: StorageProviderItem | null
  onClose: () => void
  onSave: (payload: { name: string; type: StorageProviderType; config: Record<string, string | boolean> }) => Promise<void>
}) {
  const [type, setType] = useState<StorageProviderType>(provider?.type || 'tencent-cos')
  const [name, setName] = useState(provider?.name || storageTypeLabels['tencent-cos'])
  const [config, setConfig] = useState<Record<string, string | boolean>>({
    region: provider?.config.region || '',
    endpoint: provider?.config.endpoint || '',
    bucket: provider?.config.bucket || '',
    accessKeyId: '',
    secretAccessKey: '',
    imagePathPrefix: provider?.config.imagePathPrefix ?? provider?.config.pathPrefix ?? '',
    videoPathPrefix: provider?.config.videoPathPrefix ?? provider?.config.pathPrefix ?? '',
    filePathPrefix: provider?.config.filePathPrefix ?? provider?.config.pathPrefix ?? '',
    forcePathStyle: Boolean(provider?.config.forcePathStyle),
    useInternalEndpoint: Boolean(provider?.config.useInternalEndpoint),
    baseUrl: provider?.config.baseUrl || '',
    username: provider?.config.username || '',
    password: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const editing = Boolean(provider)
  const isLocal = type === 'local'
  const isWebdav = type === 'webdav'
  const isGenericS3 = type === 's3-compatible'
  const supportsAutomaticInternalEndpoint = type === 'tencent-cos' || type === 'aliyun-oss'
  const examples = {
    'tencent-cos': { region: 'ap-guangzhou', bucket: 'picnest-1250000000' },
    'aliyun-oss': { region: 'cn-hangzhou', bucket: 'picnest-images' },
    'huawei-obs': { region: 'cn-north-4', bucket: 'picnest-images' },
    's3-compatible': { region: 'auto 或实际区域', bucket: 'picnest-images' },
  }[type as Exclude<StorageProviderType, 'local' | 'webdav'>]
  const setField = (key: string, value: string | boolean) => setConfig((current) => ({ ...current, [key]: value }))
  const credentialPlaceholder = (saved: boolean, fallback: string) => saved ? '已加密保存，留空不修改' : fallback

  const changeType = (nextType: StorageProviderType) => {
    setType(nextType)
    if (!editing) setName(storageTypeLabels[nextType])
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await onSave({ name: name.trim(), type, config })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="storage-modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="关闭存储配置"><X size={18} /></button>
        <span className="modal-title-icon"><Cloud size={20} /></span>
        <h3>{editing ? '编辑存储服务' : '添加存储服务'}</h3>
        <p>连接信息会加密保存在本机 SQLite 中。</p>
        <div className="storage-form-grid">
          <label><span>显示名称</span><input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={100} /></label>
          <label><span>存储类型</span><select value={type} disabled={editing} onChange={(event) => changeType(event.target.value as StorageProviderType)}>{editing && <option value="local">本地文件系统</option>}<option value="tencent-cos">腾讯云 COS</option><option value="aliyun-oss">阿里云 OSS</option><option value="huawei-obs">华为云 OBS</option><option value="webdav">WebDAV</option><option value="s3-compatible">S3 兼容存储</option></select></label>
          {isLocal ? <>
            <label><span>图片存储目录</span><input value={String(config.imagePathPrefix)} onChange={(event) => setField('imagePathPrefix', event.target.value)} placeholder="留空使用 server/uploads" /></label>
            <label><span>视频存储目录</span><input value={String(config.videoPathPrefix)} onChange={(event) => setField('videoPathPrefix', event.target.value)} placeholder="留空使用 server/uploads" /></label>
            <label><span>文件存储目录</span><input value={String(config.filePathPrefix)} onChange={(event) => setField('filePathPrefix', event.target.value)} placeholder="留空使用 server/uploads" /></label>
            <div className="storage-field-hint field-wide">支持相对目录（相对于 server/uploads）或服务器绝对路径，例如 <code>/data/picnest/files</code>、<code>D:\PicNest\images</code>。</div>
          </> : isWebdav ? <>
            <label className="field-wide"><span>WebDAV 服务地址</span><input type="url" value={String(config.baseUrl)} onChange={(event) => setField('baseUrl', event.target.value)} placeholder="https://dav.example.com/remote.php/dav/files/user/picnest" required /></label>
            <label><span>用户名</span><input value={String(config.username)} onChange={(event) => setField('username', event.target.value)} autoComplete="username" /></label>
            <label><span>密码</span><input type="password" value={String(config.password)} onChange={(event) => setField('password', event.target.value)} autoComplete="new-password" placeholder={credentialPlaceholder(Boolean(provider?.credentials.password), 'WebDAV 密码')} /></label>
          </> : <>
            <label><span>Region</span><input value={String(config.region)} onChange={(event) => setField('region', event.target.value)} placeholder={examples.region} required={!isGenericS3} /></label>
            <label><span>Bucket</span><input value={String(config.bucket)} onChange={(event) => setField('bucket', event.target.value)} placeholder={examples.bucket} required /></label>
            <label className="field-wide"><span>服务端 Endpoint {isGenericS3 ? '' : '（可选）'}</span><input type="url" value={String(config.endpoint)} onChange={(event) => setField('endpoint', event.target.value)} placeholder={isGenericS3 ? 'https://s3.example.com 或云厂商内网地址' : '留空时根据厂商与 Region 自动生成'} required={isGenericS3} /></label>
            {supportsAutomaticInternalEndpoint && <label className="storage-checkbox field-wide"><input type="checkbox" checked={Boolean(config.useInternalEndpoint)} onChange={(event) => setField('useInternalEndpoint', event.target.checked)} /><span className="storage-checkbox-copy"><b>上传、读取、检测和删除使用同地域内网 Endpoint</b><small>仅在 PicNest 与 Bucket 同地域且内网可达时开启；手动填写的 Endpoint 优先。</small></span></label>}
            <label><span>AccessKey ID</span><input type="password" value={String(config.accessKeyId)} onChange={(event) => setField('accessKeyId', event.target.value)} autoComplete="off" placeholder={credentialPlaceholder(Boolean(provider?.credentials.accessKeyId), 'AccessKey ID')} required={!provider?.credentials.accessKeyId} /></label>
            <label><span>SecretKey</span><input type="password" value={String(config.secretAccessKey)} onChange={(event) => setField('secretAccessKey', event.target.value)} autoComplete="new-password" placeholder={credentialPlaceholder(Boolean(provider?.credentials.secretAccessKey), 'SecretKey')} required={!provider?.credentials.secretAccessKey} /></label>
            {isGenericS3 && <label className="storage-checkbox field-wide"><input type="checkbox" checked={Boolean(config.forcePathStyle)} onChange={(event) => setField('forcePathStyle', event.target.checked)} /><span>使用 Path-style Bucket 地址</span></label>}
          </>}
          {!isLocal && <><label><span>图片对象路径前缀（可选）</span><input value={String(config.imagePathPrefix)} onChange={(event) => setField('imagePathPrefix', event.target.value)} placeholder="picnest/images" /></label><label><span>视频对象路径前缀（可选）</span><input value={String(config.videoPathPrefix)} onChange={(event) => setField('videoPathPrefix', event.target.value)} placeholder="picnest/videos" /></label><label><span>文件对象路径前缀（可选）</span><input value={String(config.filePathPrefix)} onChange={(event) => setField('filePathPrefix', event.target.value)} placeholder="picnest/files" /></label><div className="storage-field-hint field-wide">图片、视频和文件可以使用不同的目录；留空时直接写入当前服务的根目录。</div></>}
        </div>
        {error && <p className="auth-error">{error}</p>}
        <div className="storage-modal-actions"><button type="button" className="button button-ghost" onClick={onClose}>取消</button><button className="button button-primary" disabled={submitting}><Check size={16} /> {submitting ? '正在保存…' : '保存配置'}</button></div>
      </form>
    </div>
  )
}

function ReferenceFields({ image, notify }: { image: ImageItem; notify?: (message: string) => void }) {
  const [copiedKey, setCopiedKey] = useState('')
  const clearTimer = useRef<number | null>(null)
  const references = buildImageReferences(image)

  useEffect(() => () => {
    if (clearTimer.current !== null) window.clearTimeout(clearTimer.current)
  }, [])

  const copy = async (key: string, label: string, value: string) => {
    try {
      await copyText(value)
      setCopiedKey(key)
      notify?.(`${label}已复制`)
      if (clearTimer.current !== null) window.clearTimeout(clearTimer.current)
      clearTimer.current = window.setTimeout(() => setCopiedKey(''), 1800)
    } catch {
      notify?.('复制失败，请手动选择内容')
    }
  }

  return <>{references.map(({ key, label, value }) => (
    <label key={key}>
      <span>{label}</span>
      <div>
        <input readOnly value={value} aria-label={label} />
        <button type="button" onClick={() => void copy(key, label, value)} aria-label={`复制${label}`} title={`复制${label}`}>
          {copiedKey === key ? <Check size={16} /> : <Copy size={16} />}
        </button>
      </div>
    </label>
  ))}</>
}

function ShareModal({ image, onClose, onPatch, onDelete, notify }: {
  image: ImageItem
  onClose: () => void
  onPatch: (id: string, changes: Partial<ImageItem>) => Promise<boolean>
  onDelete: () => void
  notify: (message: string) => void
}) {
  const [activeTab, setActiveTab] = useState<'links' | 'info'>('links')
  const [metadataResult, setMetadataResult] = useState<{ imageId: string; data: ImageMetadata } | null>(null)
  const [metadataLoading, setMetadataLoading] = useState(false)
  const [metadataError, setMetadataError] = useState('')
  const direct = absoluteUrl(image.url)
  const copy = async (value: string) => {
    try {
      await copyText(value)
      notify('链接已复制到剪贴板')
    } catch {
      notify('复制失败，请手动选择链接')
    }
  }
  const metadata = metadataResult?.imageId === image.id ? metadataResult.data : null
  const metadataSections = metadata ? buildMetadataSections(metadata.exif) : []
  const metadataFieldCount = metadataSections.reduce((sum, section) => sum + section.entries.length, 0)

  useEffect(() => {
    if (activeTab !== 'info' || metadataResult?.imageId === image.id) return
    const controller = new AbortController()
    setMetadataLoading(true)
    setMetadataError('')
    fetch(`/api/images/${image.id}/metadata`, { signal: controller.signal })
      .then(async (response) => {
        const detail = await response.json().catch(() => ({ message: '图片元数据读取失败' }))
        if (!response.ok) throw new Error(detail.message || '图片元数据读取失败')
        setMetadataResult({ imageId: image.id, data: detail as ImageMetadata })
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setMetadataError(error instanceof Error ? error.message : '图片元数据读取失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setMetadataLoading(false)
      })
    return () => controller.abort()
  }, [activeTab, image.id, metadataResult?.imageId])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="share-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="关闭大图查看"><X size={18} /></button>
        <div className="share-preview">
          <a className="share-open-original" href={image.url} target="_blank" rel="noreferrer" aria-label="在新窗口打开原图" title="在新窗口打开原图"><Maximize2 size={18} /></a>
          <img src={image.url} alt={image.name} />
          <span>{image.type}</span>
        </div>
        <div className="share-body">
          <div className="share-heading"><span><small>{image.album}</small><RenameControl name={image.name} mediaLabel="图片" onSave={(name) => onPatch(image.id, { name })} notify={notify} /><p>{image.width && image.height ? `${image.width} × ${image.height} · ` : ''}{formatBytes(image.size)} · {formatDate(image.createdAt)}</p></span><button className={image.starred ? 'starred' : ''} onClick={() => void onPatch(image.id, { starred: !image.starred })}><Star size={18} fill={image.starred ? 'currentColor' : 'none'} /></button></div>
          <MediaHotlinkToggle enabled={image.hotlinkProtectionEnabled !== false} mediaLabel="图片" onChange={() => void onPatch(image.id, { hotlinkProtectionEnabled: image.hotlinkProtectionEnabled === false })} />
          <div className="share-tabs"><button className={activeTab === 'links' ? 'active' : ''} onClick={() => setActiveTab('links')}>分享链接</button><button className={activeTab === 'info' ? 'active' : ''} onClick={() => setActiveTab('info')}>图片信息</button></div>
          {activeTab === 'links' ? <div className="link-list"><ReferenceFields image={image} notify={notify} /></div> : <div className="image-info-content">
            <div className="image-info-grid">
              <span><small>文件名称</small><b>{image.name}</b></span>
              <span><small>文件格式</small><b>{image.type} · {image.mimeType}</b></span>
              <span><small>文件大小</small><b>{formatBytes(image.size)}</b></span>
              <span><small>所属相册</small><b>{image.album}</b></span>
              <span><small>图片尺寸</small><b>{(metadata?.width || image.width) && (metadata?.height || image.height) ? `${metadata?.width || image.width} × ${metadata?.height || image.height}` : '未读取'}</b></span>
              <span><small>上传时间</small><b>{formatDateTime(image.createdAt)}</b></span>
            </div>
            <div className="exif-heading"><span><b>EXIF 与原始元数据</b><small>相机、拍摄参数、位置和版权等原文件信息</small></span>{metadata && <em>{metadataFieldCount} 项</em>}</div>
            {metadataLoading && <div className="metadata-state">正在读取原文件元数据…</div>}
            {!metadataLoading && metadataError && <div className="metadata-state error">{metadataError}</div>}
            {!metadataLoading && metadata && metadataSections.length === 0 && <div className="metadata-state">该图片不包含可读取的 EXIF 元数据</div>}
            {!metadataLoading && metadataSections.map((section) => <section className="exif-section" key={section.key}>
              <h4>{section.title}<small>{section.entries.length} 项</small></h4>
              <div>{section.entries.map((entry) => <span className="exif-row" key={`${section.key}-${entry.key}`}><small>{entry.key}</small><b>{entry.value}</b></span>)}</div>
            </section>)}
          </div>}
          <div className="share-footer"><button className="danger-button" onClick={onDelete}><Trash2 size={16} /> 删除图片</button><a className="button button-secondary" href={image.url} download><Download size={16} /> 下载原图</a><button className="button button-primary" onClick={() => void copy(direct)}><Link2 size={16} /> 复制直链</button></div>
        </div>
      </div>
    </div>
  )
}

function CardSkeletons() {
  return <div className="recent-grid">{Array.from({ length: 5 }, (_, index) => <div className="card-skeleton" key={index}><i /><span /><small /></div>)}</div>
}

export default App

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Album,
  ArrowRight,
  Bell,
  BookOpen,
  Check,
  CheckCircle2,
  CircleHelp,
  Clipboard,
  Cloud,
  Code2,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileCode2,
  FolderPlus,
  Gauge,
  Grid2X2,
  HardDrive,
  Heart,
  Image as ImageIcon,
  Images,
  KeyRound,
  LayoutDashboard,
  Link2,
  List,
  Lock,
  LogOut,
  Mail,
  Maximize2,
  Pencil,
  Plus,
  Search,
  Server,
  Settings,
  Share2,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import type { AlbumItem, ApiKeyItem, ImageItem, ImageMetadata, ImageProcessingSettings, Stats, StorageProviderItem, StorageProviderType, User, UserSummary, ViewName } from './types'
import ApiDocsModal from './ApiDocsModal'

const defaultStats: Stats = {
  images: 0,
  used: 0,
  limit: 10 * 1024 ** 3,
  traffic: 0,
  apiCalls: 0,
  apiLimit: 50000,
  apiSuccessRate: 0,
  apiAverageResponseMs: 0,
}

const defaultAllowedExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg']
const extensionAccept = (extensions: string[]) => extensions.map((extension) => `.${extension}`).join(',')
const extensionSummary = (extensions: string[]) => extensions.map((extension) => extension.toUpperCase()).join('、')
const uploadFileMatches = (file: File, extensions: string[]) => {
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension && extensions.includes(extension)) return true
  return !file.name.includes('.') && file.type.startsWith('image/')
}

const viewMeta: Record<ViewName, { title: string; eyebrow: string }> = {
  dashboard: { title: '工作台', eyebrow: '今天也要好好整理灵感' },
  gallery: { title: '图片库', eyebrow: '查找、整理与分享全部素材' },
  albums: { title: '相册', eyebrow: '让每一组内容都有自己的归属' },
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
  if (provider.type === 'local') return 'server/uploads · SQLite 元数据'
  if (provider.type === 'webdav') return provider.config.baseUrl || '尚未配置服务地址'
  return [
    provider.config.bucket,
    provider.config.region || provider.config.endpoint,
    provider.config.useInternalEndpoint ? '内网读写' : '',
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

const formatDateTime = (value: string) => new Date(value).toLocaleString('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

const absoluteUrl = (url: string) => {
  let baseUrl = window.location.origin
  try {
    baseUrl = window.localStorage.getItem('picnest-public-base-url')?.trim() || baseUrl
  } catch {
    // Browser storage can be unavailable in strict privacy modes.
  }
  return new URL(url, `${baseUrl.replace(/\/+$/, '')}/`).href
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
  const [setupRequired, setSetupRequired] = useState(false)
  const [guestUploadEnabled, setGuestUploadEnabled] = useState(false)
  const [allowedExtensions, setAllowedExtensions] = useState<string[]>(defaultAllowedExtensions)
  const [images, setImages] = useState<ImageItem[]>([])
  const [albums, setAlbums] = useState<AlbumItem[]>([])
  const [selectedUploadAlbum, setSelectedUploadAlbum] = useState('')
  const [galleryAlbum, setGalleryAlbum] = useState('全部相册')
  const [stats, setStats] = useState<Stats>(defaultStats)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadResults, setUploadResults] = useState<ImageItem[]>([])
  const [shareImage, setShareImage] = useState<ImageItem | null>(null)
  const [toast, setToast] = useState('')

  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2600)
  }

  const loadData = async () => {
    setLoading(true)
    try {
      const [imageResponse, statsResponse, albumResponse] = await Promise.all([fetch('/api/images'), fetch('/api/stats'), fetch('/api/albums')])
      if (!imageResponse.ok || !statsResponse.ok || !albumResponse.ok) throw new Error('加载失败')
      const [imageData, statsData, albumData]: [ImageItem[], Stats, AlbumItem[]] = await Promise.all([imageResponse.json(), statsResponse.json(), albumResponse.json()])
      setImages(imageData)
      setStats({ ...defaultStats, ...statsData })
      setAlbums(albumData)
      setSelectedUploadAlbum((current) => current && albumData.some((album) => album.name === current) ? current : '')
    } catch {
      notify('无法连接本地存储服务')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const checkSession = async () => {
      try {
        const [response, publicConfigResponse] = await Promise.all([fetch('/api/auth/me'), fetch('/api/public/config')])
        if (publicConfigResponse.ok) {
          const publicConfig = await publicConfigResponse.json()
          setGuestUploadEnabled(Boolean(publicConfig.guestUploadEnabled))
          if (Array.isArray(publicConfig.allowedExtensions) && publicConfig.allowedExtensions.length) {
            setAllowedExtensions(publicConfig.allowedExtensions)
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
      } finally {
        setAuthLoading(false)
      }
    }
    void checkSession()
  }, [])

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
    setAlbums([])
    setSelectedUploadAlbum('')
    setGalleryAlbum('全部相册')
    setUploadResults([])
    setStats(defaultStats)
    setActiveView('dashboard')
  }

  const uploadFiles = async (files: File[], albumName = selectedUploadAlbum) => {
    if (!files.length || uploading) return
    setUploading(true)
    setUploadProgress(10)
    const ticker = window.setInterval(() => {
      setUploadProgress((value) => (value < 86 ? value + Math.max(2, Math.round((86 - value) / 6)) : value))
    }, 180)
    try {
      const form = new FormData()
      files.forEach((file) => form.append('files', file))
      if (albumName) form.append('album', albumName)
      const response = await fetch('/api/images', { method: 'POST', body: form })
      if (!response.ok) {
        const detail = await response.json().catch(() => ({ message: '上传失败' }))
        throw new Error(detail.message)
      }
      const created: ImageItem[] = await response.json()
      setUploadProgress(100)
      setImages((current) => [...created, ...current])
      setStats((current) => ({
        ...current,
        images: current.images + created.length,
        used: current.used + created.reduce((sum, item) => sum + item.size, 0),
      }))
      setShareImage(null)
      setUploadResults(created)
      notify(`${created.length} 张图片已安全入库`)
    } catch (error) {
      notify(error instanceof Error ? error.message : '上传失败，请重试')
    } finally {
      window.clearInterval(ticker)
      window.setTimeout(() => {
        setUploading(false)
        setUploadProgress(0)
      }, 500)
    }
  }

  const patchImage = async (id: string, changes: Partial<ImageItem>) => {
    const response = await fetch(`/api/images/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    })
    if (!response.ok) return notify('更新失败，请重试')
    const updated: ImageItem = await response.json()
    setImages((current) => current.map((item) => (item.id === id ? updated : item)))
    if (shareImage?.id === id) setShareImage(updated)
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
    notify(`${removed.length} 张图片已移至回收站`)
  }

  const jumpToUpload = () => {
    setActiveView('dashboard')
    window.setTimeout(() => document.getElementById('file-picker')?.click(), 0)
  }

  const navigateToView = (view: ViewName) => {
    if (view === 'gallery') setGalleryAlbum('全部相册')
    setActiveView(view)
  }

  const openAlbum = (albumName: string) => {
    setGalleryAlbum(albumName)
    setActiveView('gallery')
  }

  const addAlbum = (album: AlbumItem) => setAlbums((current) => [...current, album])

  const setDefaultAlbum = async (albumId: string) => {
    const response = await fetch(`/api/albums/${albumId}/default`, { method: 'PATCH' })
    const detail = await response.json().catch(() => ({ message: '设置失败' }))
    if (!response.ok) return notify(detail.message)
    setAlbums((current) => current.map((album) => ({ ...album, isDefault: album.id === albumId })))
    setSelectedUploadAlbum((current) => current === detail.name ? '' : current)
    notify(`“${detail.name}”已设为默认相册`)
  }

  const handleManagedUserUpdate = (updated: UserSummary) => {
    if (updated.id !== user?.id) return
    setUser((current) => current ? { ...current, ...updated } : current)
    setStats((current) => ({ ...current, limit: updated.quota }))
  }

  const renderView = () => {
    switch (activeView) {
      case 'gallery':
        return <GalleryView images={images} albums={albums} selectedAlbum={galleryAlbum} onAlbumChange={setGalleryAlbum} loading={loading} onShare={setShareImage} onPatch={patchImage} onDelete={deleteImages} />
      case 'albums':
        return <AlbumsView albums={albums} images={images} onOpenGallery={openAlbum} onAlbumCreated={addAlbum} onSetDefault={setDefaultAlbum} notify={notify} />
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
            uploadResults={uploadResults}
            albums={albums}
            allowedExtensions={allowedExtensions}
            selectedAlbum={selectedUploadAlbum}
            onAlbumChange={setSelectedUploadAlbum}
            onUpload={uploadFiles}
            onClearResults={() => setUploadResults([])}
            notify={notify}
          />
        )
    }
  }

  if (authLoading) return <AppLoading />
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
          onDelete={() => void deleteImages([shareImage.id])}
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
        {guestMode ? <GuestUploadPanel allowedExtensions={allowedExtensions} onBack={() => setGuestMode(false)} /> : <form className="auth-form" onSubmit={submit}>
          {setupRequired && <span className="setup-badge"><KeyRound size={14} /> 首位注册用户将成为系统管理员</span>}
          <div className="auth-heading"><h2>{mode === 'login' ? '欢迎回来' : '创建你的空间'}</h2><p>{mode === 'login' ? '登录后继续管理你的图片资产。' : '只需要一分钟，就能拥有自己的图床。'}</p></div>
          <div className="auth-mode-note">{setupRequired ? <><UserPlus size={15} /><span><b>初始化管理员</b><small>完成后可在成员管理中创建其他账户</small></span></> : <><Lock size={15} /><span><b>账户登录</b><small>新成员账户由空间管理员创建</small></span></>}</div>
          {mode === 'register' && <label><span>你的称呼</span><div><Users size={17} /><input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="例如：设计师小苏" required /></div></label>}
          <label><span>邮箱地址</span><div><Mail size={17} /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="name@example.com" required /></div></label>
          <label><span>密码</span><div><Lock size={17} /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="至少 8 个字符" minLength={8} required /></div></label>
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

  const uploadGuestFiles = async (files: File[]) => {
    const images = files.slice(0, 5)
    if (!images.length || uploading) return
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
  }

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
  }, [uploading, allowedExtensions])

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
    { id: 'albums' as const, label: '相册', icon: Album },
  ]
  const secondary: NavItem[] = [
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
        <button className="help-link"><CircleHelp size={18} /> 帮助与反馈</button>
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
        <label className="global-search">
          <Search size={17} />
          <input placeholder="搜索图片、相册..." />
          <kbd>⌘ K</kbd>
        </label>
        <button className="icon-button" aria-label="通知"><Bell size={19} /><i /></button>
        <button className="button button-primary" onClick={onUpload}><Upload size={17} /> 上传图片</button>
      </div>
    </header>
  )
}

function DashboardView({
  uploading,
  uploadProgress,
  uploadResults,
  albums,
  allowedExtensions,
  selectedAlbum,
  onAlbumChange,
  onUpload,
  onClearResults,
  notify,
}: {
  uploading: boolean
  uploadProgress: number
  uploadResults: ImageItem[]
  albums: AlbumItem[]
  allowedExtensions: string[]
  selectedAlbum: string
  onAlbumChange: (album: string) => void
  onUpload: (files: File[], albumName?: string) => void
  onClearResults: () => void
  notify: (message: string) => void
}) {
  return (
    <div className="dashboard-upload-focus">
      <div className="dashboard-upload-panel">
        <UploadZone selectedAlbum={selectedAlbum} allowedExtensions={allowedExtensions} uploading={uploading} progress={uploadProgress} onUpload={onUpload} />
        <UploadDestination albums={albums} selectedAlbum={selectedAlbum} uploading={uploading} onAlbumChange={onAlbumChange} />
      </div>
      {uploadResults.length > 0 && (
        <InlineUploadResults images={uploadResults} onClear={onClearResults} notify={notify} />
      )}
    </div>
  )
}

function InlineUploadResults({ images, onClear, notify }: { images: ImageItem[]; onClear: () => void; notify: (message: string) => void }) {
  const copyAllDirectLinks = async () => {
    await navigator.clipboard.writeText(images.map((image) => absoluteUrl(image.url)).join('\n'))
    notify(`${images.length} 条图片直链已复制`)
  }

  return (
    <section className="upload-results-inline" aria-live="polite">
      <div className="upload-results-heading">
        <div><span><CheckCircle2 size={19} /></span><div><h2>本次上传结果</h2><p>{images.length} 张图片已保存，引用地址显示在各图片下方。</p></div></div>
        <div className="upload-results-actions">
          {images.length > 1 && <button className="button button-secondary" onClick={() => void copyAllDirectLinks()}><Copy size={15} /> 复制全部直链</button>}
          <button className="button button-ghost" onClick={onClear}><X size={15} /> 清空结果</button>
        </div>
      </div>
      <div className={`upload-results-grid ${images.length === 1 ? 'single' : ''}`}>
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
      </div>
    </section>
  )
}

function UploadZone({ selectedAlbum, allowedExtensions, uploading, progress, onUpload }: {
  selectedAlbum: string
  allowedExtensions: string[]
  uploading: boolean
  progress: number
  onUpload: (files: File[], albumName?: string) => void
}) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const receive = (fileList: FileList | null) => {
    if (fileList) onUpload(Array.from(fileList), selectedAlbum)
  }

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const pastedImages = Array.from(event.clipboardData?.items || [])
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file))
        .filter((file) => uploadFileMatches(file, allowedExtensions))
      if (pastedImages.length) {
        event.preventDefault()
        onUpload(pastedImages, selectedAlbum)
      }
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [onUpload, selectedAlbum, allowedExtensions])

  return (
    <section
      className={`upload-zone ${dragging ? 'dragging' : ''}`}
      onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => { event.preventDefault(); setDragging(false); receive(event.dataTransfer.files) }}
    >
      <input id="file-picker" ref={inputRef} type="file" accept={extensionAccept(allowedExtensions)} multiple hidden onChange={(event) => { receive(event.target.files); event.currentTarget.value = '' }} />
      <span className="upload-icon"><Upload size={27} /></span>
      <div className="upload-copy">
        <h3>{uploading ? '正在安放你的图片…' : '把图片拖到这里'}</h3>
        <p>{uploading ? '上传期间请不要关闭页面' : `允许 ${extensionSummary(allowedExtensions)}，单张最大 20MB`}</p>
      </div>
      {uploading ? (
        <div className="upload-progress-wrap">
          <div className="upload-progress"><i style={{ width: `${progress}%` }} /></div>
          <b>{progress}%</b>
        </div>
      ) : (
        <>
          <button className="button button-secondary" onClick={() => inputRef.current?.click()}>选择图片</button>
          <div className="upload-hints"><span><Check size={13} /> 支持批量上传</span><span><Clipboard size={13} /> 可直接粘贴</span><span><ShieldCheck size={13} /> 原图安全保存</span></div>
        </>
      )}
    </section>
  )
}

function UploadDestination({ albums, selectedAlbum, uploading, onAlbumChange }: {
  albums: AlbumItem[]
  selectedAlbum: string
  uploading: boolean
  onAlbumChange: (album: string) => void
}) {
  const defaultAlbum = albums.find((album) => album.isDefault)
  return (
    <div className="upload-destination-row">
      <label className="upload-album-select">
        <Album size={16} />
        <span>保存到</span>
        <select value={selectedAlbum} disabled={uploading} onChange={(event) => onAlbumChange(event.target.value)} aria-label="上传到相册">
          <option value="">默认相册 · {defaultAlbum?.name || '未分类'}</option>
          {albums.filter((album) => !album.isDefault).map((album) => <option key={album.id} value={album.name}>{album.name}</option>)}
        </select>
      </label>
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
        <select value={type} onChange={(event) => setType(event.target.value)} aria-label="筛选格式">{['全部格式', 'JPG', 'JPEG', 'PNG', 'WEBP', 'GIF', 'SVG'].map((name) => <option key={name}>{name}</option>)}</select>
        <div className="layout-toggle"><button className={layout === 'grid' ? 'active' : ''} onClick={() => setLayout('grid')} aria-label="网格视图"><Grid2X2 size={17} /></button><button className={layout === 'list' ? 'active' : ''} onClick={() => setLayout('list')} aria-label="列表视图"><List size={18} /></button></div>
      </section>

      <div className="gallery-summary">
        <div><h3>{filtered.length} 张图片</h3><p>{selectedAlbum === '全部相册' ? '你的全部图片资产' : `相册 · ${selectedAlbum}`}</p></div>
        {selected.length > 0 && (
          <div className="bulk-actions"><span>已选择 {selected.length} 项</span><button onClick={() => { void onDelete(selected); setSelected([]) }}><Trash2 size={15} /> 删除</button><button onClick={() => setSelected([])}><X size={15} /> 取消</button></div>
        )}
      </div>

      {loading ? <CardSkeletons /> : filtered.length === 0 ? (
        <div className="empty-state"><span><ImageIcon size={28} /></span><h3>没有找到图片</h3><p>试试调整关键词或筛选条件。</p></div>
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

function ImageCard({ image, onShare, onPatch, compact = false, selected = false, onSelect }: {
  image: ImageItem
  onShare: (image: ImageItem) => void
  onPatch: (id: string, changes: Partial<ImageItem>) => void
  compact?: boolean
  selected?: boolean
  onSelect?: () => void
}) {
  const copyLink = async () => {
    await navigator.clipboard.writeText(absoluteUrl(image.url))
  }
  return (
    <article className={`image-card ${compact ? 'compact' : ''} ${selected ? 'selected' : ''}`}>
      <div className="image-preview">
        <button className="image-open-button" onClick={() => onShare(image)} aria-label={`查看大图 ${image.name}`} title="查看大图"><img src={image.url} alt={image.name} loading="lazy" /></button>
        <span className="format-badge">{image.type}</span>
        {image.guestUploaded && <span className="guest-badge"><Users size={11} /> 游客</span>}
        {!compact && <button className={`select-box card-select ${selected ? 'selected' : ''}`} onClick={onSelect}>{selected && <Check size={13} />}</button>}
        <div className="card-hover-actions">
          <button onClick={() => void onPatch(image.id, { starred: !image.starred })} aria-label="收藏"><Heart size={16} fill={image.starred ? 'currentColor' : 'none'} /></button>
          <button onClick={() => void copyLink()} aria-label="复制链接"><Link2 size={16} /></button>
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
  const createAlbum = async () => {
    const value = newAlbum.trim()
    if (!value) return
    const response = await fetch('/api/albums', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: value }) })
    const detail = await response.json().catch(() => ({ message: '创建失败' }))
    if (!response.ok) return notify(detail.message)
    onAlbumCreated(detail as AlbumItem)
    setNewAlbum('')
    setShowNewAlbum(false)
    notify('新相册已创建')
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
            <label>相册名称<input autoFocus value={newAlbum} onChange={(event) => setNewAlbum(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void createAlbum()} placeholder="例如：夏日旅行" /></label>
            <div><button className="button button-ghost" onClick={() => setShowNewAlbum(false)}>取消</button><button className="button button-primary" onClick={() => void createAlbum()}>创建相册</button></div>
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

  const loadUsers = async () => {
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
  }

  useEffect(() => { void loadUsers() }, [])

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
        <div className="team-stats"><span><b>{users.length}</b><small>空间成员</small></span><span><b>{users.reduce((sum, user) => sum + user.imageCount, 0)}</b><small>团队图片</small></span><span><b>{formatBytes(teamStorage)}</b><small>占用空间</small></span></div>
      </section>
      <section className="section-card users-card">
        <div className="section-heading"><div><h3>空间成员</h3><p>管理账户资料、角色、存储配额与存储策略</p></div><button className="button button-primary" onClick={openCreateUser}><UserPlus size={16} /> 添加成员</button></div>
        <div className="users-table-head"><span>成员</span><span>角色</span><span>图片</span><span>已用 / 配额</span><span>存储策略</span><span>加入时间</span><span /></div>
        {loadingUsers ? <div className="users-loading">正在载入成员…</div> : users.map((user) => (
          <div className="user-row" key={user.id}>
            <span className="member-cell"><i>{user.name.slice(0, 1).toUpperCase()}</i><span><b>{user.name}{user.id === currentUser.id && <em>你</em>}</b><small>{user.email}</small></span></span>
            <span><span className={`role-badge ${user.role}`}>{user.role === 'admin' ? '管理员' : '成员'}</span></span>
            <span>{user.imageCount} 张</span><span>{formatBytes(user.storageUsed)} / {formatBytes(user.quota)}</span><span className="user-storage-policy">{storageName(user.storageProviderId)}</span><span>{formatDate(user.createdAt)}</span>
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
              <label>成员称呼<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：产品设计师" required minLength={2} /></label>
              <label>登录邮箱<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="member@example.com" required /></label>
              <label>{editingUser ? '新密码（可选）' : '初始密码'}<input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder={editingUser ? '留空不修改' : '至少 8 个字符'} required={!editingUser} minLength={form.password ? 8 : undefined} /></label>
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

function DeveloperView({ stats, notify }: { stats: Stats; notify: (message: string) => void }) {
  const [docsOpen, setDocsOpen] = useState(false)
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([])
  const [keyLabel, setKeyLabel] = useState('')
  const [keySecrets, setKeySecrets] = useState<Record<string, string>>({})
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({})
  const [creatingKey, setCreatingKey] = useState(false)
  const [busyKeyId, setBusyKeyId] = useState('')
  const [usage, setUsage] = useState(stats)
  useEffect(() => {
    fetch('/api/api-keys')
      .then(async (response) => {
        const detail = await response.json().catch(() => [])
        if (!response.ok) throw new Error('密钥加载失败')
        setApiKeys(Array.isArray(detail) ? detail : [])
      })
      .catch(() => notify('密钥加载失败'))
  }, [])
  useEffect(() => { setUsage(stats) }, [stats])
  useEffect(() => {
    fetch('/api/stats').then((response) => response.ok ? response.json() : Promise.reject()).then((data) => setUsage({ ...defaultStats, ...data })).catch(() => notify('API 用量加载失败'))
  }, [])
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
    await navigator.clipboard.writeText(secret)
    notify(`${key.label}已复制`)
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
  const usageLimit = Math.max(1, usage.apiLimit || defaultStats.apiLimit)
  const usagePercentage = Math.min(100, (usage.apiCalls / usageLimit) * 100)
  const hasUsage = usage.apiCalls > 0
  const copy = async (text: string, message: string) => { await navigator.clipboard.writeText(text); notify(message) }
  return (
    <div className="developer-page">
      <section className="api-hero">
        <div><span className="eyebrow-pill light"><Code2 size={13} /> PicNest API</span><h2>让图片进入你的工作流</h2><p>通过简单、稳定的 REST API 上传与管理图片。兼容 ShareX、PicGo 和自定义脚本。</p><button className="button button-light" onClick={() => setDocsOpen(true)}><BookOpen size={16} /> 阅读 API 文档</button></div>
        <div className="api-terminal"><span><i className="red" /><i className="yellow" /><i className="green" /></span><pre><em>curl</em> -X POST {'\\'}{`\n`}  https://picnest.local/api/images {'\\'}{`\n`}  -H <b>"Authorization: Bearer $TOKEN"</b> {'\\'}{`\n`}  -F <strong>"files=@cover.png"</strong></pre></div>
      </section>
      <div className="developer-grid">
        <section className="section-card api-key-card">
          <div className="section-heading"><div><h3>API 密钥</h3><p>可创建多把密钥，每把密钥仅能访问当前用户的数据</p></div><span className="status-pill">{apiKeys.length} 把</span></div>
          <form className="api-key-create" onSubmit={generateKey}><input value={keyLabel} onChange={(event) => setKeyLabel(event.target.value)} placeholder="密钥名称，例如：PicGo、生产服务器" maxLength={50} /><button className="button button-primary" disabled={creatingKey}><Plus size={16} /> {creatingKey ? '创建中…' : '创建密钥'}</button></form>
          {apiKeys.length === 0 ? <div className="api-key-empty"><KeyRound size={20} /><span><b>尚未创建 API 密钥</b><small>为不同设备或应用分别创建，停用时互不影响。</small></span></div> : <div className="api-key-list">{apiKeys.map((key) => {
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
        <section className="section-card usage-card"><div className="section-heading"><div><h3>本月用量</h3><p>API 密钥调用额度</p></div><Gauge size={20} /></div><div className="usage-number"><b>{usage.apiCalls.toLocaleString()}</b><span>/ {usageLimit.toLocaleString()}</span></div><div className="usage-progress"><i style={{ width: `${usagePercentage}%` }} /></div><div><span>成功率 <b>{hasUsage ? `${usage.apiSuccessRate.toFixed(2)}%` : '--'}</b></span><span>平均响应 <b>{hasUsage ? `${usage.apiAverageResponseMs}ms` : '--'}</b></span><span>本月流量 <b>{formatBytes(usage.traffic)}</b></span></div></section>
      </div>
      <section className="section-card endpoints-card"><div className="section-heading"><div><h3>快速开始</h3><p>三个最常用的接口</p></div></div>{[
        ['POST', '/api/images', '上传一张或多张图片', 'post'],
        ['GET', '/api/images', '获取当前空间的图片列表', 'get'],
        ['DELETE', '/api/images/:id', '删除指定图片与文件', 'delete'],
      ].map(([method, path, description, tone]) => <div className="endpoint-row" key={`${method}${path}`}><span className={`method ${tone}`}>{method}</span><code>{path}</code><p>{description}</p><button onClick={() => void copy(path, '接口路径已复制')}><Copy size={15} /></button></div>)}</section>
      {docsOpen && <ApiDocsModal onClose={() => setDocsOpen(false)} />}
    </div>
  )
}

function SettingsView({ notify, user, guestUploadEnabled, onGuestUploadChange, onAllowedExtensionsChange }: { notify: (message: string) => void; user: User; guestUploadEnabled: boolean; onGuestUploadChange: (enabled: boolean) => void; onAllowedExtensionsChange: (extensions: string[]) => void }) {
  type SettingsSection = 'storage' | 'security' | 'images' | 'notifications'
  type PreferenceKey = 'loginAlerts' | 'apiAlerts' | 'uploadNotice' | 'quotaNotice' | 'securityNotice'
  type SettingsPreferences = Record<PreferenceKey, boolean> & { domain: string }
  const preferenceStorageKey = `picnest-preferences:${user.id}`
  const defaults: SettingsPreferences = {
    loginAlerts: true,
    apiAlerts: true,
    uploadNotice: true,
    quotaNotice: true,
    securityNotice: true,
    domain: window.location.origin,
  }
  const defaultImageProcessing: ImageProcessingSettings = {
    enabled: true,
    outputFormat: 'original',
    quality: 85,
    autoOrient: true,
    stripMetadata: false,
    allowedExtensions: defaultAllowedExtensions,
  }
  const [activeSection, setActiveSection] = useState<SettingsSection>('storage')
  const [settings, setSettings] = useState<SettingsPreferences>(() => {
    try {
      const stored = window.localStorage.getItem(preferenceStorageKey)
      return stored ? { ...defaults, ...(JSON.parse(stored) as Partial<SettingsPreferences>) } : defaults
    } catch {
      return defaults
    }
  })
  const [storageProviders, setStorageProviders] = useState<StorageProviderItem[]>([])
  const [storageLoading, setStorageLoading] = useState(true)
  const [storageModalOpen, setStorageModalOpen] = useState(false)
  const [editingStorageProvider, setEditingStorageProvider] = useState<StorageProviderItem | null>(null)
  const [imageProcessing, setImageProcessing] = useState<ImageProcessingSettings>(defaultImageProcessing)
  const [imageProcessingLoading, setImageProcessingLoading] = useState(true)
  const [imageProcessingSaving, setImageProcessingSaving] = useState(false)
  const [newAllowedExtension, setNewAllowedExtension] = useState('')

  const loadStorageProviders = async () => {
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
  }

  const loadImageProcessing = async () => {
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
  }

  useEffect(() => { void loadStorageProviders(); void loadImageProcessing() }, [])

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

  const toggle = (key: PreferenceKey) => setSettings((current) => ({ ...current, [key]: !current[key] }))
  const sections = [
    { id: 'storage' as const, label: '存储与域名', icon: Server },
    { id: 'security' as const, label: '安全设置', icon: ShieldCheck },
    { id: 'images' as const, label: '图片处理', icon: ImageIcon },
    { id: 'notifications' as const, label: '通知', icon: Bell },
  ]
  const saveSettings = async () => {
    if (activeSection === 'images') {
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
      return
    }
    try {
      const parsedDomain = new URL(settings.domain)
      if (!['http:', 'https:'].includes(parsedDomain.protocol)) throw new Error('invalid protocol')
      const normalized = parsedDomain.href.replace(/\/$/, '')
      const nextSettings = { ...settings, domain: normalized }
      setSettings(nextSettings)
      window.localStorage.setItem(preferenceStorageKey, JSON.stringify(nextSettings))
      window.localStorage.setItem('picnest-public-base-url', normalized)
      notify('当前设置已保存')
    } catch {
      notify('请输入以 http:// 或 https:// 开头的有效域名')
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
  const renderToggle = (key: PreferenceKey, title: string, description: string) => (
    <div className="toggle-row" key={key}>
      <span><b>{title}</b><small>{description}</small></span>
      <button className={`switch ${settings[key] ? 'active' : ''}`} onClick={() => toggle(key)} aria-label={title} aria-pressed={settings[key]}><i /></button>
    </div>
  )
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

  const activeStorageProvider = storageProviders.find((provider) => provider.isDefault)

  const renderStorageSection = () => <>
    <div className="settings-section-intro"><span><Server size={20} /></span><div><h2>存储与域名</h2><p>管理文件存储、服务端读取链路和游客上传入口。</p></div></div>
    {user.role === 'admin' && <section className="section-card settings-card guest-setting-card"><div className="settings-heading"><span className="metric-icon orange"><Users size={19} /></span><div><h3>游客上传</h3><p>控制未登录访客能否从首页上传图片</p></div><span className={`status-pill ${guestUploadEnabled ? '' : 'off'}`}>{guestUploadEnabled ? '已开启' : '默认关闭'}</span></div><div className="public-upload-setting"><span><b>允许游客上传</b><small>开启后，登录首页会显示游客上传入口，图片自动进入你的“游客上传”相册。</small></span><button className={`switch ${guestUploadEnabled ? 'active' : ''}`} onClick={() => void updateGuestUpload()} aria-label="允许游客上传" aria-pressed={guestUploadEnabled}><i /></button></div><div className="guest-safety-note"><ShieldCheck size={15} /> 每个来源每小时最多提交 10 次；游客不能查看图库、相册或其他用户内容。</div></section>}
    <section className="section-card settings-card storage-settings-card">
      <div className="settings-heading"><span className="metric-icon green"><HardDrive size={19} /></span><div><h3>存储服务</h3><p>{activeStorageProvider ? `当前使用 ${activeStorageProvider.name}` : '正在读取当前存储'}</p></div><span className="status-pill">{activeStorageProvider ? '已连接' : '加载中'}</span></div>
      {storageLoading ? <div className="users-loading">正在载入存储服务…</div> : <div className="storage-provider-list">
        {storageProviders.map((provider) => <div className={`storage-provider ${provider.isDefault ? 'active' : ''}`} key={provider.id}>
          <span>{provider.type === 'local' ? <Server size={22} /> : <Cloud size={22} />}</span>
          <div className="storage-provider-copy"><b>{provider.name}<em>{storageTypeLabels[provider.type]}</em></b><small>{storageProviderSummary(provider)}</small><small>{provider.imageCount} 张图片保存在此存储</small></div>
          {provider.isDefault && <span className="storage-current"><CheckCircle2 size={14} /> 当前使用</span>}
          {user.role === 'admin' && <div className="storage-provider-actions">
            <button className="button button-ghost" onClick={() => void testStorageProvider(provider)}><CheckCircle2 size={15} /> 检测</button>
            {provider.type !== 'local' && <button className="icon-button" onClick={() => { setEditingStorageProvider(provider); setStorageModalOpen(true) }} aria-label={`编辑${provider.name}`} title="编辑配置"><Settings size={16} /></button>}
            {!provider.isDefault && <button className="button button-secondary" onClick={() => void activateStorageProvider(provider)}><Check size={15} /> 设为当前</button>}
            {provider.type !== 'local' && !provider.isDefault && <button className="icon-button storage-delete-button" onClick={() => void deleteStorageProvider(provider)} aria-label={`删除${provider.name}`} title="删除配置"><Trash2 size={16} /></button>}
          </div>}
        </div>)}
      </div>}
      {user.role === 'admin' && <button className="add-provider" onClick={() => { setEditingStorageProvider(null); setStorageModalOpen(true) }}><Plus size={17} /> 添加云存储或 WebDAV</button>}
      <div className="settings-note"><ShieldCheck size={15} /><span>切换只影响新上传；历史图片仍保留在原存储中，删除时会自动使用对应的存储配置。</span></div>
    </section>
    <section className="section-card settings-card"><div className="settings-heading"><span className="metric-icon orange"><Link2 size={19} /></span><div><h3>访问域名</h3><p>生成图片直链和引用代码时使用</p></div></div><label className="setting-label">默认域名<div className="domain-input"><span>URL</span><input value={settings.domain} onChange={(event) => setSettings({ ...settings, domain: event.target.value })} placeholder="https://img.example.com" /></div></label></section>
  </>

  const renderSecuritySection = () => <>
    <div className="settings-section-intro"><span><ShieldCheck size={20} /></span><div><h2>安全设置</h2><p>查看账户身份、登录会话和安全提醒状态。</p></div></div>
    <section className="section-card settings-card"><div className="settings-heading"><span className="metric-icon green"><Lock size={19} /></span><div><h3>账户保护</h3><p>当前登录账户的身份与权限</p></div><span className="status-pill">受保护</span></div><div className="security-account"><span><Mail size={17} /></span><div><small>登录邮箱</small><b>{user.email}</b></div><em>{user.role === 'admin' ? '管理员' : '空间成员'}</em></div><div className="security-facts"><span><ShieldCheck size={15} /><b>HttpOnly Cookie</b><small>脚本无法读取会话令牌</small></span><span><Lock size={15} /><b>SameSite Lax</b><small>限制跨站请求携带登录态</small></span><span><KeyRound size={15} /><b>7 天会话</b><small>到期后需要重新登录</small></span></div></section>
    <section className="section-card settings-card"><div className="settings-heading"><span className="metric-icon orange"><Bell size={19} /></span><div><h3>安全提醒</h3><p>控制需要在应用内提醒的账户事件</p></div></div>{renderToggle('loginAlerts', '异常登录提醒', '登录状态异常或会话失效时提醒')}{renderToggle('apiAlerts', 'API 密钥提醒', '创建或撤销 API 密钥时提醒')}</section>
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
    <div className="settings-section-intro"><span><Bell size={20} /></span><div><h2>通知</h2><p>选择需要在 PicNest 内显示的操作提醒。</p></div></div>
    <section className="section-card settings-card"><div className="settings-heading"><span className="metric-icon orange"><Bell size={19} /></span><div><h3>应用内通知</h3><p>这些提醒只显示在当前浏览器中</p></div></div>{renderToggle('uploadNotice', '上传结果', '上传完成或失败时显示结果通知')}{renderToggle('quotaNotice', '空间用量', '存储空间接近配额时提醒')}{renderToggle('securityNotice', '账户安全', '登录与权限变更时显示提醒')}</section>
    <section className="section-card settings-card"><div className="settings-heading"><span className="metric-icon blue"><Mail size={19} /></span><div><h3>邮件通知</h3><p>尚未配置邮件发送服务</p></div><span className="status-pill off">未接入</span></div><div className="settings-note"><Mail size={15} /><span>配置 SMTP 服务后，邮件通知选项将在这里启用。</span></div></section>
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
          <div className="save-settings"><button className="button button-primary" disabled={activeSection === 'images' && (imageProcessingLoading || imageProcessingSaving || user.role !== 'admin')} onClick={() => void saveSettings()}><Check size={16} /> {imageProcessingSaving ? '正在保存…' : activeSection === 'images' ? '保存图片处理策略' : '保存当前设置'}</button></div>
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
    pathPrefix: provider?.config.pathPrefix || '',
    forcePathStyle: Boolean(provider?.config.forcePathStyle),
    useInternalEndpoint: Boolean(provider?.config.useInternalEndpoint),
    baseUrl: provider?.config.baseUrl || '',
    username: provider?.config.username || '',
    password: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const editing = Boolean(provider)
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
          <label><span>显示名称</span><input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} /></label>
          <label><span>存储类型</span><select value={type} disabled={editing} onChange={(event) => changeType(event.target.value as StorageProviderType)}><option value="tencent-cos">腾讯云 COS</option><option value="aliyun-oss">阿里云 OSS</option><option value="huawei-obs">华为云 OBS</option><option value="webdav">WebDAV</option><option value="s3-compatible">S3 兼容存储</option></select></label>
          {isWebdav ? <>
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
          <label className="field-wide"><span>对象路径前缀（可选）</span><input value={String(config.pathPrefix)} onChange={(event) => setField('pathPrefix', event.target.value)} placeholder="picnest/images" /></label>
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
    await navigator.clipboard.writeText(value)
    setCopiedKey(key)
    notify?.(`${label}已复制`)
    if (clearTimer.current !== null) window.clearTimeout(clearTimer.current)
    clearTimer.current = window.setTimeout(() => setCopiedKey(''), 1800)
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
  onPatch: (id: string, changes: Partial<ImageItem>) => void
  onDelete: () => void
  notify: (message: string) => void
}) {
  const [activeTab, setActiveTab] = useState<'links' | 'info'>('links')
  const [metadataResult, setMetadataResult] = useState<{ imageId: string; data: ImageMetadata } | null>(null)
  const [metadataLoading, setMetadataLoading] = useState(false)
  const [metadataError, setMetadataError] = useState('')
  const direct = absoluteUrl(image.url)
  const copy = async (value: string) => { await navigator.clipboard.writeText(value); notify('链接已复制到剪贴板') }
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
          <div className="share-heading"><span><small>{image.album}</small><h3>{image.name}</h3><p>{image.width && image.height ? `${image.width} × ${image.height} · ` : ''}{formatBytes(image.size)} · {formatDate(image.createdAt)}</p></span><button className={image.starred ? 'starred' : ''} onClick={() => void onPatch(image.id, { starred: !image.starred })}><Star size={18} fill={image.starred ? 'currentColor' : 'none'} /></button></div>
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

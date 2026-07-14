import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  Album,
  ArrowRight,
  Bell,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clipboard,
  Cloud,
  Code2,
  Copy,
  Download,
  Eye,
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
  MoreHorizontal,
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
  Zap,
} from 'lucide-react'
import type { AlbumItem, ApiKeyItem, ImageItem, Stats, User, UserSummary, ViewName } from './types'

const defaultStats: Stats = {
  images: 0,
  used: 0,
  limit: 10 * 1024 ** 3,
  traffic: 2.84 * 1024 ** 3,
  apiCalls: 12840,
}

const viewMeta: Record<ViewName, { title: string; eyebrow: string }> = {
  dashboard: { title: '工作台', eyebrow: '今天也要好好整理灵感' },
  gallery: { title: '图片库', eyebrow: '查找、整理与分享全部素材' },
  albums: { title: '相册', eyebrow: '让每一组内容都有自己的归属' },
  users: { title: '成员管理', eyebrow: '管理团队成员与空间权限' },
  developer: { title: '开发者', eyebrow: 'API、密钥与自动化工作流' },
  settings: { title: '系统设置', eyebrow: '存储、安全与个性化偏好' },
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

const absoluteUrl = (url: string) => new URL(url, window.location.origin).href

function App() {
  const [activeView, setActiveView] = useState<ViewName>('dashboard')
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [setupRequired, setSetupRequired] = useState(false)
  const [guestUploadEnabled, setGuestUploadEnabled] = useState(false)
  const [images, setImages] = useState<ImageItem[]>([])
  const [stats, setStats] = useState<Stats>(defaultStats)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [shareImage, setShareImage] = useState<ImageItem | null>(null)
  const [toast, setToast] = useState('')

  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2600)
  }

  const loadData = async () => {
    setLoading(true)
    try {
      const [imageResponse, statsResponse] = await Promise.all([fetch('/api/images'), fetch('/api/stats')])
      if (!imageResponse.ok || !statsResponse.ok) throw new Error('加载失败')
      setImages(await imageResponse.json())
      setStats(await statsResponse.json())
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
    setActiveView('dashboard')
    await loadData()
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setUser(null)
    setImages([])
    setStats(defaultStats)
    setActiveView('dashboard')
  }

  const uploadFiles = async (files: File[]) => {
    if (!files.length || uploading) return
    setUploading(true)
    setUploadProgress(10)
    const ticker = window.setInterval(() => {
      setUploadProgress((value) => (value < 86 ? value + Math.max(2, Math.round((86 - value) / 6)) : value))
    }, 180)
    try {
      const form = new FormData()
      files.forEach((file) => form.append('files', file))
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

  const renderView = () => {
    switch (activeView) {
      case 'gallery':
        return <GalleryView images={images} loading={loading} onShare={setShareImage} onPatch={patchImage} onDelete={deleteImages} />
      case 'albums':
        return <AlbumsView images={images} onOpenGallery={() => setActiveView('gallery')} notify={notify} />
      case 'users':
        return user?.role === 'admin' ? <UsersView currentUser={user} notify={notify} /> : null
      case 'developer':
        return <DeveloperView stats={stats} notify={notify} />
      case 'settings':
        return <SettingsView notify={notify} user={user!} guestUploadEnabled={guestUploadEnabled} onGuestUploadChange={setGuestUploadEnabled} />
      default:
        return (
          <DashboardView
            images={images}
            stats={stats}
            userName={user?.name || '你'}
            loading={loading}
            uploading={uploading}
            uploadProgress={uploadProgress}
            onUpload={uploadFiles}
            onShare={setShareImage}
            onPatch={patchImage}
            onViewGallery={() => setActiveView('gallery')}
          />
        )
    }
  }

  if (authLoading) return <AppLoading />
  if (!user) return <AuthScreen setupRequired={setupRequired} guestUploadEnabled={guestUploadEnabled} onAuthenticated={handleAuthenticated} />

  return (
    <div className="app-shell">
      <Sidebar activeView={activeView} onChange={setActiveView} stats={stats} user={user} onLogout={logout} />
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

function AuthScreen({ setupRequired, guestUploadEnabled, onAuthenticated }: { setupRequired: boolean; guestUploadEnabled: boolean; onAuthenticated: (user: User) => Promise<void> }) {
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
        {guestMode ? <GuestUploadPanel onBack={() => setGuestMode(false)} /> : <form className="auth-form" onSubmit={submit}>
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

function GuestUploadPanel({ onBack }: { onBack: () => void }) {
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState<ImageItem[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const uploadGuestFiles = async (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith('image/')).slice(0, 5)
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
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file))
      if (files.length) {
        event.preventDefault()
        void uploadGuestFiles(files)
      }
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [uploading])

  const copy = async (value: string) => navigator.clipboard.writeText(value)

  return (
    <div className="auth-form guest-form">
      <button className="back-to-login" onClick={onBack}><ArrowRight size={15} /> 返回账户登录</button>
      <div className="auth-heading"><h2>{results.length ? '上传完成' : '游客快速上传'}</h2><p>{results.length ? '链接已经生成，请在离开前保存。' : '无需注册，上传后立即获得可分享的图片链接。'}</p></div>
      {results.length ? (
        <div className="guest-results">
          {results.map((image) => {
            const direct = absoluteUrl(image.url)
            return <div className="guest-result" key={image.id}><img src={image.url} alt={image.name} /><span><b>{image.name}</b><small>{formatBytes(image.size)}</small></span><label>图片直链<div><input readOnly value={direct} /><button onClick={() => void copy(direct)}><Copy size={15} /></button></div></label><label>Markdown<div><input readOnly value={`![${image.name}](${direct})`} /><button onClick={() => void copy(`![${image.name}](${direct})`)}><Copy size={15} /></button></div></label></div>
          })}
          <button className="auth-submit" onClick={() => setResults([])}><Upload size={16} /> 继续上传</button>
        </div>
      ) : (
        <>
          <div className={`guest-dropzone ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void uploadGuestFiles(Array.from(event.dataTransfer.files)) }}>
            <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple hidden onChange={(event) => void uploadGuestFiles(Array.from(event.target.files || []))} />
            <span><Upload size={24} /></span><h3>{uploading ? '图片正在上传…' : '拖曳图片到这里'}</h3><p>也可以直接粘贴，或从设备中选择</p><button className="button button-secondary" onClick={() => inputRef.current?.click()} disabled={uploading}>{uploading ? '请稍候' : '选择图片'}</button>
            <div><kbd>Ctrl V</kbd> 粘贴上传</div>
          </div>
          {error && <p className="auth-error">{error}</p>}
          <div className="guest-rules"><ShieldCheck size={16} /><span><b>受控公共上传</b><small>最多 5 张，单张 10MB；支持 JPG、PNG、GIF、WebP。游客无法浏览图库。</small></span></div>
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
      <div className="workspace-switcher">
        <span className="workspace-avatar">{user.name.slice(0, 1).toUpperCase()}</span>
        <span><small>当前空间</small><b>{user.name}的创作空间</b></span>
        <ChevronDown size={15} />
      </div>
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
  images,
  stats,
  userName,
  loading,
  uploading,
  uploadProgress,
  onUpload,
  onShare,
  onPatch,
  onViewGallery,
}: {
  images: ImageItem[]
  stats: Stats
  userName: string
  loading: boolean
  uploading: boolean
  uploadProgress: number
  onUpload: (files: File[]) => void
  onShare: (image: ImageItem) => void
  onPatch: (id: string, changes: Partial<ImageItem>) => void
  onViewGallery: () => void
}) {
  return (
    <div className="dashboard-stack">
      <section className="welcome-strip">
        <div>
          <span className="eyebrow-pill"><Sparkles size={13} /> 灵感已就绪</span>
          <h2>下午好，{userName}。<br />把新的画面带进来吧。</h2>
          <p>拖拽、粘贴或选择图片，PicNest 会替你保管好每一个灵感瞬间。</p>
        </div>
        <div className="welcome-art" aria-hidden="true">
          <span className="art-card art-card-one"><img src="/demo/coast.svg" alt="" /></span>
          <span className="art-card art-card-two"><img src="/demo/garden.svg" alt="" /></span>
          <span className="art-spark">✦</span>
        </div>
      </section>

      <div className="dashboard-main-grid">
        <UploadZone uploading={uploading} progress={uploadProgress} onUpload={onUpload} />
        <StoragePanel stats={stats} />
      </div>

      <section className="metric-grid">
        <MetricCard icon={Images} tone="green" label="图片总数" value={String(stats.images)} change="本周 +6" />
        <MetricCard icon={HardDrive} tone="orange" label="已用空间" value={formatBytes(stats.used)} change="空间充足" />
        <MetricCard icon={Activity} tone="blue" label="本月流量" value={formatBytes(stats.traffic)} change="较上月 +12%" />
        <MetricCard icon={Zap} tone="yellow" label="API 调用" value={stats.apiCalls.toLocaleString()} change="成功率 99.98%" />
      </section>

      <section className="section-card recent-section">
        <div className="section-heading">
          <div><h3>最近上传</h3><p>你最近添加到空间的图片</p></div>
          <button className="text-button" onClick={onViewGallery}>查看全部 <ArrowRight size={15} /></button>
        </div>
        {loading ? <CardSkeletons /> : (
          <div className="recent-grid">
            {images.slice(0, 5).map((image) => (
              <ImageCard key={image.id} image={image} onShare={onShare} onPatch={onPatch} compact />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function UploadZone({ uploading, progress, onUpload }: { uploading: boolean; progress: number; onUpload: (files: File[]) => void }) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const receive = (fileList: FileList | null) => {
    if (fileList) onUpload(Array.from(fileList).filter((file) => file.type.startsWith('image/')))
  }

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const pastedImages = Array.from(event.clipboardData?.items || [])
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file))
      if (pastedImages.length) {
        event.preventDefault()
        onUpload(pastedImages)
      }
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [onUpload])

  return (
    <section
      className={`upload-zone ${dragging ? 'dragging' : ''}`}
      onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => { event.preventDefault(); setDragging(false); receive(event.dataTransfer.files) }}
    >
      <input id="file-picker" ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(event) => receive(event.target.files)} />
      <span className="upload-icon"><Upload size={27} /></span>
      <div className="upload-copy">
        <h3>{uploading ? '正在安放你的图片…' : '把图片拖到这里'}</h3>
        <p>{uploading ? '上传期间请不要关闭页面' : '支持 JPG、PNG、GIF、WebP、SVG，单张最大 20MB'}</p>
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

function StoragePanel({ stats }: { stats: Stats }) {
  const percentage = Math.min(100, (stats.used / stats.limit) * 100)
  return (
    <section className="storage-panel section-card">
      <div className="storage-title"><span className="metric-icon green"><Cloud size={19} /></span><span><h3>本地存储</h3><p>运行状态良好</p></span><i className="online-dot" /></div>
      <div className="storage-donut" style={{ '--percentage': `${Math.max(percentage, 7) * 3.6}deg` } as React.CSSProperties}>
        <div><b>{percentage.toFixed(1)}%</b><span>已使用</span></div>
      </div>
      <div className="storage-numbers"><span><small>已使用</small><b>{formatBytes(stats.used)}</b></span><span><small>总容量</small><b>{formatBytes(stats.limit)}</b></span></div>
      <button className="storage-manage">管理存储策略 <ArrowRight size={14} /></button>
    </section>
  )
}

function MetricCard({ icon: Icon, tone, label, value, change }: { icon: typeof Images; tone: string; label: string; value: string; change: string }) {
  return (
    <article className="metric-card section-card">
      <span className={`metric-icon ${tone}`}><Icon size={19} /></span>
      <span><p>{label}</p><h3>{value}</h3></span>
      <em>{change}</em>
    </article>
  )
}

function GalleryView({ images, loading, onShare, onPatch, onDelete }: {
  images: ImageItem[]
  loading: boolean
  onShare: (image: ImageItem) => void
  onPatch: (id: string, changes: Partial<ImageItem>) => void
  onDelete: (ids: string[]) => void
}) {
  const [query, setQuery] = useState('')
  const [album, setAlbum] = useState('全部相册')
  const [type, setType] = useState('全部格式')
  const [layout, setLayout] = useState<'grid' | 'list'>('grid')
  const [selected, setSelected] = useState<string[]>([])
  const albums = useMemo(() => ['全部相册', ...Array.from(new Set(images.map((image) => image.album)))], [images])
  const filtered = images.filter((image) => {
    const matchQuery = image.name.toLowerCase().includes(query.toLowerCase())
    const matchAlbum = album === '全部相册' || image.album === album
    const matchType = type === '全部格式' || image.type === type
    return matchQuery && matchAlbum && matchType
  })

  const toggleSelect = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])

  return (
    <div className="gallery-page">
      <section className="gallery-toolbar section-card">
        <label className="gallery-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="按文件名搜索" /></label>
        <select value={album} onChange={(event) => setAlbum(event.target.value)} aria-label="筛选相册">{albums.map((name) => <option key={name}>{name}</option>)}</select>
        <select value={type} onChange={(event) => setType(event.target.value)} aria-label="筛选格式">{['全部格式', 'JPG', 'JPEG', 'PNG', 'WEBP', 'GIF', 'SVG'].map((name) => <option key={name}>{name}</option>)}</select>
        <div className="layout-toggle"><button className={layout === 'grid' ? 'active' : ''} onClick={() => setLayout('grid')} aria-label="网格视图"><Grid2X2 size={17} /></button><button className={layout === 'list' ? 'active' : ''} onClick={() => setLayout('list')} aria-label="列表视图"><List size={18} /></button></div>
      </section>

      <div className="gallery-summary">
        <div><h3>{filtered.length} 张图片</h3><p>{album === '全部相册' ? '你的全部图片资产' : `相册 · ${album}`}</p></div>
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
              <img src={image.url} alt={image.name} />
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
        <img src={image.url} alt={image.name} loading="lazy" />
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

function AlbumsView({ images, onOpenGallery, notify }: { images: ImageItem[]; onOpenGallery: () => void; notify: (message: string) => void }) {
  const [albums, setAlbums] = useState<AlbumItem[]>([])
  const [showNewAlbum, setShowNewAlbum] = useState(false)
  const [newAlbum, setNewAlbum] = useState('')
  useEffect(() => {
    fetch('/api/albums').then((response) => response.json()).then(setAlbums).catch(() => notify('相册加载失败'))
  }, [])
  const createAlbum = async () => {
    const value = newAlbum.trim()
    if (!value) return
    const response = await fetch('/api/albums', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: value }) })
    const detail = await response.json().catch(() => ({ message: '创建失败' }))
    if (!response.ok) return notify(detail.message)
    setAlbums((current) => [...current, detail as AlbumItem])
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
            <button className="album-card" key={album.id} onClick={onOpenGallery}>
              <div className={`album-cover album-color-${index % 4}`}>
                {albumImages[0] || album.cover ? <img src={albumImages[0]?.url || album.cover || ''} alt="" /> : <Album size={38} />}
                {albumImages.slice(1, 3).map((image) => <img key={image.id} src={image.url} alt="" />)}
                <span>{album.imageCount}</span>
              </div>
              <div><span><b>{album.name}</b><small>{album.imageCount} 张图片 · {formatBytes(album.storageUsed)}</small></span><MoreHorizontal size={18} /></div>
            </button>
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

function UsersView({ currentUser, notify }: { currentUser: User; notify: (message: string) => void }) {
  const [users, setUsers] = useState<UserSummary[]>([])
  const [loadingUsers, setLoadingUsers] = useState(true)
  const [showNewUser, setShowNewUser] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'member' as 'admin' | 'member' })

  const loadUsers = async () => {
    const response = await fetch('/api/users')
    if (!response.ok) return notify('成员列表加载失败')
    setUsers(await response.json())
    setLoadingUsers(false)
  }

  useEffect(() => { void loadUsers() }, [])

  const createMember = async () => {
    const response = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    const detail = await response.json().catch(() => ({ message: '创建失败' }))
    if (!response.ok) return notify(detail.message)
    setUsers((current) => [...current, detail as UserSummary])
    setForm({ name: '', email: '', password: '', role: 'member' })
    setShowNewUser(false)
    notify('新成员账户已创建')
  }

  const changeRole = async (id: string, role: 'admin' | 'member') => {
    const response = await fetch(`/api/users/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) })
    const detail = await response.json().catch(() => ({ message: '更新失败' }))
    if (!response.ok) return notify(detail.message)
    setUsers((current) => current.map((user) => user.id === id ? { ...user, role } : user))
    notify('成员权限已更新')
  }

  const teamStorage = users.reduce((sum, user) => sum + user.storageUsed, 0)
  return (
    <div className="users-page">
      <section className="team-overview">
        <div><span className="eyebrow-pill light"><Users size={13} /> 团队空间</span><h2>一起创作，各自安全。</h2><p>每位成员拥有独立图库、相册、配额和 API 密钥，管理员只管理账户与权限。</p></div>
        <div className="team-stats"><span><b>{users.length}</b><small>空间成员</small></span><span><b>{users.reduce((sum, user) => sum + user.imageCount, 0)}</b><small>团队图片</small></span><span><b>{formatBytes(teamStorage)}</b><small>占用空间</small></span></div>
      </section>
      <section className="section-card users-card">
        <div className="section-heading"><div><h3>空间成员</h3><p>账户数据相互隔离，管理员可调整成员角色</p></div><button className="button button-primary" onClick={() => setShowNewUser(true)}><UserPlus size={16} /> 添加成员</button></div>
        <div className="users-table-head"><span>成员</span><span>角色</span><span>图片</span><span>已用空间</span><span>加入时间</span></div>
        {loadingUsers ? <div className="users-loading">正在载入成员…</div> : users.map((user) => (
          <div className="user-row" key={user.id}>
            <span className="member-cell"><i>{user.name.slice(0, 1).toUpperCase()}</i><span><b>{user.name}{user.id === currentUser.id && <em>你</em>}</b><small>{user.email}</small></span></span>
            <span>{user.id === currentUser.id ? <span className="role-badge admin">管理员</span> : <select value={user.role} onChange={(event) => void changeRole(user.id, event.target.value as 'admin' | 'member')} aria-label={`${user.name}的角色`}><option value="member">成员</option><option value="admin">管理员</option></select>}</span>
            <span>{user.imageCount} 张</span><span>{formatBytes(user.storageUsed)} / {formatBytes(user.quota)}</span><span>{formatDate(user.createdAt)}</span>
          </div>
        ))}
      </section>
      <section className="isolation-note"><ShieldCheck size={19} /><span><b>用户级数据隔离已启用</b><small>图片、相册、配额与 API 密钥均绑定到所有者账户，接口会自动校验访问身份。</small></span></section>
      {showNewUser && (
        <div className="modal-backdrop" onMouseDown={() => setShowNewUser(false)}>
          <div className="small-modal member-modal" onMouseDown={(event) => event.stopPropagation()}>
            <span className="modal-title-icon"><UserPlus size={20} /></span><h3>添加空间成员</h3><p>创建后，将登录信息安全地交给成员本人。</p>
            <label>成员称呼<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：产品设计师" /></label>
            <label>登录邮箱<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="member@example.com" /></label>
            <label>初始密码<input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="至少 8 个字符" /></label>
            <label>空间角色<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as 'admin' | 'member' })}><option value="member">普通成员 · 独立管理自己的图片</option><option value="admin">管理员 · 可管理成员账户</option></select></label>
            <div><button className="button button-ghost" onClick={() => setShowNewUser(false)}>取消</button><button className="button button-primary" onClick={() => void createMember()}>创建成员</button></div>
          </div>
        </div>
      )}
    </div>
  )
}

function DeveloperView({ stats, notify }: { stats: Stats; notify: (message: string) => void }) {
  const [revealed, setRevealed] = useState(false)
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([])
  const [newSecret, setNewSecret] = useState('')
  useEffect(() => { fetch('/api/api-keys').then((response) => response.json()).then(setApiKeys).catch(() => notify('密钥加载失败')) }, [])
  const generateKey = async () => {
    const response = await fetch('/api/api-keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: '生产环境密钥' }) })
    const detail: ApiKeyItem = await response.json()
    if (!response.ok) return notify('密钥创建失败')
    setApiKeys((current) => [detail, ...current])
    setNewSecret(detail.secret || '')
    setRevealed(true)
    notify('新密钥已创建，请妥善保存')
  }
  const activeKey = apiKeys[0]
  const displayKey = newSecret ? (revealed ? newSecret : `${newSecret.slice(0, 15)}••••••••`) : activeKey?.prefix || '尚未创建 API 密钥'
  const copy = async (text: string, message: string) => { await navigator.clipboard.writeText(text); notify(message) }
  return (
    <div className="developer-page">
      <section className="api-hero">
        <div><span className="eyebrow-pill light"><Code2 size={13} /> PicNest API</span><h2>让图片进入你的工作流</h2><p>通过简单、稳定的 REST API 上传与管理图片。兼容 ShareX、PicGo 和自定义脚本。</p><button className="button button-light"><BookOpen size={16} /> 阅读 API 文档</button></div>
        <div className="api-terminal"><span><i className="red" /><i className="yellow" /><i className="green" /></span><pre><em>curl</em> -X POST {'\\'}{`\n`}  https://picnest.local/api/images {'\\'}{`\n`}  -H <b>"Authorization: Bearer $TOKEN"</b> {'\\'}{`\n`}  -F <strong>"files=@cover.png"</strong></pre></div>
      </section>
      <div className="developer-grid">
        <section className="section-card api-key-card"><div className="section-heading"><div><h3>API 密钥</h3><p>密钥仅能访问当前登录用户的数据</p></div>{activeKey ? <span className="status-pill">使用中</span> : <button className="button button-primary" onClick={() => void generateKey()}><KeyRound size={15} /> 创建密钥</button>}</div><label>生产环境密钥<div><code>{displayKey}</code>{newSecret && <button onClick={() => setRevealed(!revealed)}><Eye size={16} /></button>}<button disabled={!newSecret} onClick={() => newSecret && void copy(newSecret, 'API 密钥已复制')}><Copy size={16} /></button></div></label><small><Lock size={13} /> 完整密钥只显示一次；遗失后请创建新密钥。</small></section>
        <section className="section-card usage-card"><div className="section-heading"><div><h3>本月用量</h3><p>API 调用额度</p></div><Gauge size={20} /></div><div className="usage-number"><b>{stats.apiCalls.toLocaleString()}</b><span>/ 50,000</span></div><div className="usage-progress"><i style={{ width: `${(stats.apiCalls / 50000) * 100}%` }} /></div><div><span>成功率 <b>99.98%</b></span><span>平均响应 <b>124ms</b></span></div></section>
      </div>
      <section className="section-card endpoints-card"><div className="section-heading"><div><h3>快速开始</h3><p>三个最常用的接口</p></div></div>{[
        ['POST', '/api/images', '上传一张或多张图片', 'post'],
        ['GET', '/api/images', '获取当前空间的图片列表', 'get'],
        ['DELETE', '/api/images/:id', '删除指定图片与文件', 'delete'],
      ].map(([method, path, description, tone]) => <div className="endpoint-row" key={`${method}${path}`}><span className={`method ${tone}`}>{method}</span><code>{path}</code><p>{description}</p><button onClick={() => void copy(path, '接口路径已复制')}><Copy size={15} /></button></div>)}</section>
    </div>
  )
}

function SettingsView({ notify, user, guestUploadEnabled, onGuestUploadChange }: { notify: (message: string) => void; user: User; guestUploadEnabled: boolean; onGuestUploadChange: (enabled: boolean) => void }) {
  const [settings, setSettings] = useState({ original: true, webp: true, strip: false, private: true, domain: 'http://127.0.0.1:18765' })
  const toggle = (key: keyof typeof settings) => setSettings((current) => ({ ...current, [key]: !current[key] }))
  const updateGuestUpload = async () => {
    const enabled = !guestUploadEnabled
    const response = await fetch('/api/settings/guest-upload', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) })
    const detail = await response.json().catch(() => ({ message: '设置更新失败' }))
    if (!response.ok) return notify(detail.message)
    onGuestUploadChange(enabled)
    notify(enabled ? '游客上传已开启' : '游客上传已关闭')
  }
  return (
    <div className="settings-page">
      <aside className="settings-index"><button className="active"><Server size={17} /> 存储与域名</button><button><ShieldCheck size={17} /> 安全设置</button><button><ImageIcon size={17} /> 图片处理</button><button><Bell size={17} /> 通知</button></aside>
      <div className="settings-content">
        {user.role === 'admin' && <section className="section-card settings-card guest-setting-card"><div className="settings-heading"><span className="metric-icon orange"><Users size={19} /></span><div><h3>游客上传</h3><p>控制未登录访客能否从首页上传图片</p></div><span className={`status-pill ${guestUploadEnabled ? '' : 'off'}`}>{guestUploadEnabled ? '已开启' : '默认关闭'}</span></div><div className="public-upload-setting"><span><b>允许游客上传</b><small>开启后，登录首页会显示游客上传入口，图片自动进入你的“游客上传”相册。</small></span><button className={`switch ${guestUploadEnabled ? 'active' : ''}`} onClick={() => void updateGuestUpload()} aria-label="允许游客上传"><i /></button></div><div className="guest-safety-note"><ShieldCheck size={15} /> 每个来源每小时最多提交 10 次；游客不能查看图库、相册或其他用户内容。</div></section>}
        <section className="section-card settings-card"><div className="settings-heading"><span className="metric-icon green"><HardDrive size={19} /></span><div><h3>存储服务</h3><p>当前文件保存在本机磁盘</p></div><span className="status-pill">已连接</span></div><div className="storage-provider"><span><Server size={22} /></span><div><b>本地文件系统</b><small>server/uploads · 读写正常</small></div><button className="button button-ghost">检测连接</button></div><button className="add-provider"><Plus size={17} /> 添加 S3 / R2 存储源</button></section>
        <section className="section-card settings-card"><div className="settings-heading"><span className="metric-icon orange"><Link2 size={19} /></span><div><h3>访问域名</h3><p>生成图片直链时使用的基础地址</p></div></div><label className="setting-label">默认域名<div className="domain-input"><span>URL</span><input value={settings.domain} onChange={(event) => setSettings({ ...settings, domain: event.target.value })} /></div></label></section>
        <section className="section-card settings-card"><div className="settings-heading"><span className="metric-icon blue"><Sparkles size={19} /></span><div><h3>上传偏好</h3><p>统一处理新上传的图片</p></div></div>{[
          ['original', '保留原始文件', '不压缩、不改变源图片质量'],
          ['webp', '自动生成 WebP', '为网页访问提供更小的文件'],
          ['strip', '移除 EXIF 信息', '清除位置与拍摄设备等隐私信息'],
          ['private', '默认私有上传', '新图片仅通过链接访问'],
        ].map(([key, title, description]) => <div className="toggle-row" key={key}><span><b>{title}</b><small>{description}</small></span><button className={`switch ${settings[key as keyof typeof settings] ? 'active' : ''}`} onClick={() => toggle(key as keyof typeof settings)}><i /></button></div>)}</section>
        <div className="save-settings"><button className="button button-primary" onClick={() => notify('设置已保存')}>保存更改</button></div>
      </div>
    </div>
  )
}

function ShareModal({ image, onClose, onPatch, onDelete, notify }: {
  image: ImageItem
  onClose: () => void
  onPatch: (id: string, changes: Partial<ImageItem>) => void
  onDelete: () => void
  notify: (message: string) => void
}) {
  const direct = absoluteUrl(image.url)
  const links = [
    ['图片直链', direct],
    ['Markdown', `![${image.name}](${direct})`],
    ['HTML', `<img src="${direct}" alt="${image.name}" />`],
    ['BBCode', `[img]${direct}[/img]`],
  ]
  const copy = async (value: string) => { await navigator.clipboard.writeText(value); notify('链接已复制到剪贴板') }
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="share-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        <div className="share-preview"><img src={image.url} alt={image.name} /><span>{image.type}</span></div>
        <div className="share-body">
          <div className="share-heading"><span><small>{image.album}</small><h3>{image.name}</h3><p>{image.width && image.height ? `${image.width} × ${image.height} · ` : ''}{formatBytes(image.size)} · {formatDate(image.createdAt)}</p></span><button className={image.starred ? 'starred' : ''} onClick={() => void onPatch(image.id, { starred: !image.starred })}><Star size={18} fill={image.starred ? 'currentColor' : 'none'} /></button></div>
          <div className="share-tabs"><button className="active">分享链接</button><button>图片信息</button></div>
          <div className="link-list">{links.map(([label, value]) => <label key={label}><span>{label}</span><div><input readOnly value={value} /><button onClick={() => void copy(value)}><Copy size={16} /></button></div></label>)}</div>
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

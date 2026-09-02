export type ViewName = 'dashboard' | 'gallery' | 'media' | 'analytics' | 'users' | 'developer' | 'settings'

export interface User {
  id: string
  name: string
  email: string
  role: 'admin' | 'member'
  quota: number
  storageProviderId: string | null
  createdAt: string
}

export interface UserSummary extends User {
  imageCount: number
  videoCount: number
  storageUsed: number
}

export interface AlbumItem {
  id: string
  name: string
  isDefault: boolean
  createdAt: string
  imageCount: number
  storageUsed: number
  cover: string | null
}

export interface VideoCategoryItem {
  id: string
  name: string
  isDefault: boolean
  createdAt: string
  videoCount: number
  storageUsed: number
  cover: string | null
}

export interface ApiKeyItem {
  id: string
  label: string
  prefix: string
  createdAt: string
  lastUsedAt?: string | null
  recoverable?: boolean
  secret?: string
}

export type StorageProviderType = 'local' | 'tencent-cos' | 'aliyun-oss' | 'huawei-obs' | 'webdav' | 's3-compatible'

export interface StorageProviderConfig {
  region?: string
  endpoint?: string
  bucket?: string
  imagePathPrefix?: string
  videoPathPrefix?: string
  pathPrefix?: string
  forcePathStyle?: boolean
  useInternalEndpoint?: boolean
  baseUrl?: string
  username?: string
}

export interface StorageProviderItem {
  id: string
  name: string
  type: StorageProviderType
  isDefault: boolean
  config: StorageProviderConfig
  credentials: {
    accessKeyId: boolean
    secretAccessKey: boolean
    password: boolean
  }
  imageCount: number
  videoCount: number
  createdAt: string
  updatedAt: string
}

export interface ImageItem {
  id: string
  name: string
  filename?: string
  url: string
  path?: string
  type: string
  format?: string
  extension?: string
  mimeType: string
  size: number
  width: number | null
  height: number | null
  album: string
  starred: boolean
  hotlinkProtectionEnabled: boolean
  guestUploaded?: boolean
  views: number
  processing?: {
    applied: boolean
    converted: boolean
    sourceFormat: string
    outputFormat: string
    quality: number
    autoOriented: boolean
    metadataStripped: boolean
  } | null
  links?: {
    direct: string
    markdown: string
    bbcode: string
    html: string
  }
  createdAt: string
}

export interface VideoItem {
  id: string
  name: string
  filename?: string
  url: string
  path?: string
  type: string
  format?: string
  extension?: string
  mimeType: string
  size: number
  album: string
  category?: string
  starred: boolean
  hotlinkProtectionEnabled: boolean
  views: number
  links?: {
    direct: string
    markdown: string
    bbcode: string
    html: string
  }
  createdAt: string
}

export type RemoteImportStatus = 'queued' | 'downloading' | 'processing' | 'completed' | 'failed'
export type RemoteImportPhase = 'queued' | 'downloading' | 'detecting' | 'storing' | 'completed' | 'failed'

export interface RemoteImportTask {
  id: string
  status: RemoteImportStatus
  phase: RemoteImportPhase
  sourceLabel: string
  filename: string
  mediaType: 'image' | 'video' | ''
  progress: number
  downloadedBytes: number
  totalBytes: number | null
  speed: number
  eta: number | null
  downloader: 'aria2c' | 'curl' | 'node' | null
  connections: number
  result: ImageItem | VideoItem | null
  error: string
  createdAt: string
  updatedAt: string
}

export interface ImageProcessingSettings {
  enabled: boolean
  outputFormat: 'original' | 'jpg' | 'png' | 'webp' | 'avif'
  quality: number
  autoOrient: boolean
  stripMetadata: boolean
  allowedExtensions: string[]
}

export interface HotlinkProtectionSettings {
  imageEnabled: boolean
  videoEnabled: boolean
  trustedDomains: string[]
}

export interface ImageMetadata {
  width: number | null
  height: number | null
  exif: Record<string, unknown>
}

export interface Stats {
  images: number
  videos: number
  used: number
  limit: number
  traffic: number
  apiCalls: number
  apiLimit: number
  apiSuccessRate: number
  apiAverageResponseMs: number
}

export interface TrafficAnalyticsDaily {
  date: string
  requests: number
  bytes: number
  externalRequests: number
  externalBytes: number
  directRequests: number
  directBytes: number
  internalRequests: number
  internalBytes: number
  rangeRequests: number
}

export interface TrafficAnalyticsMedia {
  mediaType: 'image' | 'video'
  mediaId: string
  name: string
  filename: string
  requests: number
  bytes: number
  externalRequests: number
  externalBytes: number
  rangeRequests: number
}

export interface TrafficAnalyticsReferrer {
  host: string
  requests: number
  bytes: number
  mediaCount: number
}

export interface TrafficAnalytics {
  timezone: string
  days: number
  startDate: string
  endDate: string
  summary: {
    requests: number
    bytes: number
    externalRequests: number
    externalBytes: number
    directRequests: number
    directBytes: number
    internalRequests: number
    internalBytes: number
    rangeRequests: number
    activeDays: number
    externalSharePercent: number
    averageBytes: number
    averageExternalBytes: number
    peakDate: string | null
    peakBytes: number
    peakExternalDate: string | null
    peakExternalBytes: number
  }
  daily: TrafficAnalyticsDaily[]
  topMedia: TrafficAnalyticsMedia[]
  referrers: TrafficAnalyticsReferrer[]
}

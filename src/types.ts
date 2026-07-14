export type ViewName = 'dashboard' | 'gallery' | 'albums' | 'users' | 'developer' | 'settings'

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

export interface ImageProcessingSettings {
  enabled: boolean
  outputFormat: 'original' | 'jpg' | 'png' | 'webp' | 'avif'
  quality: number
  autoOrient: boolean
  stripMetadata: boolean
  allowedExtensions: string[]
}

export interface ImageMetadata {
  width: number | null
  height: number | null
  exif: Record<string, unknown>
}

export interface Stats {
  images: number
  used: number
  limit: number
  traffic: number
  apiCalls: number
  apiLimit: number
  apiSuccessRate: number
  apiAverageResponseMs: number
}

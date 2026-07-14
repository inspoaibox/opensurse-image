export type ViewName = 'dashboard' | 'gallery' | 'albums' | 'users' | 'developer' | 'settings'

export interface User {
  id: string
  name: string
  email: string
  role: 'admin' | 'member'
  quota: number
  createdAt: string
}

export interface UserSummary extends User {
  imageCount: number
  storageUsed: number
}

export interface AlbumItem {
  id: string
  name: string
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
  secret?: string
}

export interface ImageItem {
  id: string
  name: string
  filename?: string
  url: string
  type: string
  mimeType: string
  size: number
  width: number | null
  height: number | null
  album: string
  starred: boolean
  guestUploaded?: boolean
  views: number
  createdAt: string
}

export interface Stats {
  images: number
  used: number
  limit: number
  traffic: number
  apiCalls: number
}

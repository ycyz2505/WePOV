import type { IconName } from './Icon'

export interface NavEntry {
  key: string
  path: string
  label: string
  icon: IconName
  adminOnly?: boolean
}

export const PRIMARY_NAV: NavEntry[] = [
  { key: 'classroom', path: '/classroom', label: '教室', icon: 'classroom' },
  { key: 'plaza', path: '/plaza', label: '广场', icon: 'plaza' },
  { key: 'tree', path: '/tree', label: '树洞', icon: 'tree' },
  { key: 'partner', path: '/partners', label: '搭子', icon: 'partner' },
  { key: 'album', path: '/albums', label: '相册', icon: 'album' },
  { key: 'capsule', path: '/capsules', label: '胶囊', icon: 'capsule' },
  { key: 'notifications', path: '/notifications', label: '通知', icon: 'bell' },
  { key: 'me', path: '/me', label: '我的', icon: 'me' },
  { key: 'admin', path: '/admin', label: '管理', icon: 'admin', adminOnly: true },
]

export const MOBILE_PRIMARY: NavEntry[] = [
  { key: 'classroom', path: '/classroom', label: '教室', icon: 'classroom' },
  { key: 'plaza', path: '/plaza', label: '广场', icon: 'plaza' },
  { key: 'tree', path: '/tree', label: '树洞', icon: 'tree' },
  { key: 'partner', path: '/partners', label: '搭子', icon: 'partner' },
]

export const MOBILE_MORE: NavEntry[] = [
  { key: 'album', path: '/albums', label: '相册', icon: 'album' },
  { key: 'capsule', path: '/capsules', label: '胶囊', icon: 'capsule' },
  { key: 'notifications', path: '/notifications', label: '通知', icon: 'bell' },
  { key: 'me', path: '/me', label: '我的', icon: 'me' },
  { key: 'admin', path: '/admin', label: '管理', icon: 'admin', adminOnly: true },
]

export const PAGE_TITLES: Record<string, string> = {
  classroom: '教室',
  plaza: '广场',
  tree: '树洞',
  partners: '搭子',
  albums: '相册',
  capsules: '胶囊',
  notifications: '通知',
  me: '我的',
  admin: '管理',
}

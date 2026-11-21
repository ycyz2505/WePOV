import { segmentsOf } from './router'

export interface RouteMatch {
  name: string
  params: Record<string, string>
}

export function matchRoute(pathname: string): RouteMatch {
  const segments = segmentsOf(pathname)
  const [first, second] = segments

  if (!first) return { name: 'classroom', params: {} }

  switch (first) {
    case 'classroom':
      return { name: 'classroom', params: {} }
    case 'plaza':
      if (second === 'me') return { name: 'profile', params: { userId: 'me' } }
      if (second) return { name: 'profile', params: { userId: second } }
      return { name: 'plaza', params: {} }
    case 'tree':
      if (second === 'new') return { name: 'tree-new', params: {} }
      if (second === 'wall') return { name: 'tree-wall', params: {} }
      if (second === 'mine') return { name: 'tree-mine', params: {} }
      if (second) return { name: 'tree-detail', params: { id: second } }
      return { name: 'tree', params: {} }
    case 'partners':
      if (second === 'new') return { name: 'partner-new', params: {} }
      if (second) return { name: 'partner-detail', params: { id: second } }
      return { name: 'partners', params: {} }
    case 'albums':
      if (second) return { name: 'album-folder', params: { folderId: second } }
      return { name: 'albums', params: {} }
    case 'capsules':
      if (second === 'new') return { name: 'capsule-new', params: {} }
      if (second) return { name: 'capsule-detail', params: { id: second } }
      return { name: 'capsules', params: {} }
    case 'notifications':
      return { name: 'notifications', params: {} }
    case 'me':
      return { name: 'me', params: {} }
    case 'admin':
      if (second === 'roster') return { name: 'admin-roster', params: {} }
      if (second === 'moderation') return { name: 'admin-moderation', params: {} }
      if (second === 'recycle') return { name: 'admin-recycle', params: {} }
      if (second === 'logs') return { name: 'admin-logs', params: {} }
      if (second === 'security') return { name: 'admin-security', params: {} }
      return { name: 'admin', params: {} }
    default:
      return { name: 'not-found', params: { path: pathname } }
  }
}

export function activeKeyForRoute(name: string): string {
  if (name.startsWith('tree')) return 'tree'
  if (name.startsWith('partner')) return 'partners'
  if (name.startsWith('album')) return 'albums'
  if (name.startsWith('capsule')) return 'capsules'
  if (name.startsWith('admin')) return 'admin'
  if (name === 'profile' || name === 'plaza') return 'plaza'
  if (name === 'me') return 'me'
  if (name === 'notifications') return 'notifications'
  if (name === 'classroom') return 'classroom'
  return 'plaza'
}

export function titleForRoute(name: string): string {
  const map: Record<string, string> = {
    classroom: '教室',
    plaza: '广场',
    profile: '个人空间',
    tree: '树洞',
    'tree-new': '发布树洞',
    'tree-wall': '弹幕墙',
    'tree-mine': '我的树洞',
    'tree-detail': '树洞',
    partners: '搭子',
    'partner-new': '发起搭子',
    'partner-detail': '搭子详情',
    albums: '相册',
    'album-folder': '相册',
    capsules: '胶囊',
    'capsule-new': '写胶囊',
    'capsule-detail': '胶囊',
    notifications: '通知',
    me: '我的',
    admin: '管理',
    'admin-roster': '名单管理',
    'admin-moderation': '审核队列',
    'admin-recycle': '回收站',
    'admin-logs': '日志与统计',
    'admin-security': '安全设置',
    'not-found': '页面不存在',
  }
  return map[name] ?? 'WePOV'
}

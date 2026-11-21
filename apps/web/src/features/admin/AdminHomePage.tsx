import { AppShell } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { navigate } from '../../lib/router'
import { isSuperAdmin } from '../../lib/session'
import styles from './admin.module.css'

interface AdminLink {
  path: string
  title: string
  description: string
  icon: 'shield' | 'list' | 'recycle' | 'chart' | 'settings' | 'users'
  superOnly?: boolean
}

const LINKS: AdminLink[] = [
  { path: '/admin/moderation', title: '审核队列', description: '处理举报、待审核的图片与文件夹申请。', icon: 'list' },
  { path: '/admin/roster', title: '名单与账号', description: '导入名单、任命角色、重置密码。', icon: 'users', superOnly: true },
  { path: '/admin/recycle', title: '回收站', description: '恢复或彻底清除被删除的内容。', icon: 'recycle', superOnly: true },
  { path: '/admin/logs', title: '日志与统计', description: '流量统计、HTTP 日志与语义事件。', icon: 'chart', superOnly: true },
  { path: '/admin/security', title: '安全设置', description: '会话、告警与数据导出。', icon: 'settings', superOnly: true },
]

export function AdminHomePage(): preact.JSX.Element {
  const superAdmin = isSuperAdmin.value
  const links = LINKS.filter((link) => !link.superOnly || superAdmin)

  return (
    <AppShell activeKey="admin" title="管理">
      <div class={styles.page}>
        <div class={styles.headRow}>
          <div>
            <h1 class={styles.headTitle}>管理后台</h1>
            <p class={styles.rowText}>{superAdmin ? '你是超级管理员，拥有全部管理权限。' : '你是一般管理员，负责内容审核。'}</p>
          </div>
        </div>

        <div class={styles.cardGrid}>
          {links.map((link) => (
            <button key={link.path} type="button" class={styles.navCard} onClick={() => navigate(link.path)}>
              <span class={styles.navCardIcon}>
                <Icon name={link.icon} size={24} />
              </span>
              <span class={styles.navCardTitle}>{link.title}</span>
              <span class={styles.navCardDesc}>{link.description}</span>
            </button>
          ))}
        </div>
      </div>
    </AppShell>
  )
}

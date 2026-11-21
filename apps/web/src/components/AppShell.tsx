import { useEffect, useState } from 'preact/hooks'
import type { ComponentChildren, JSX } from 'preact'
import { Icon } from './Icon'
import { Avatar } from './ui'
import { cn } from '../lib/cn'
import { MOBILE_MORE, MOBILE_PRIMARY, PRIMARY_NAV, type NavEntry } from './nav'
import { isAdmin, unreadCount, currentUser } from '../lib/session'
import { online } from '../lib/network'
import { navigate } from '../lib/router'
import styles from './shell.module.css'
import ui from './ui.module.css'

interface AppShellProps {
  activeKey: string
  title: string
  children: ComponentChildren
  context?: ComponentChildren
  wide?: boolean
}

export function AppShell({ activeKey, title, children, context, wide }: AppShellProps): JSX.Element {
  const [moreOpen, setMoreOpen] = useState(false)
  const user = currentUser.value
  const visibleRail = PRIMARY_NAV.filter((entry) => !entry.adminOnly || isAdmin.value)

  const go = (path: string) => (event: MouseEvent): void => {
    event.preventDefault()
    navigate(path)
  }

  useEffect(() => {
    document.title = `${title} · WePOV`
  }, [title])

  return (
    <div class={styles.shell}>
      <nav class={styles.rail} aria-label="主导航">
        <a href="/classroom" class={styles.brand} onClick={go('/classroom')} aria-label="WePOV 首页">
          <span class={styles.brandMark}>WePOV</span>
        </a>
        {visibleRail.map((entry) => (
          <a
            key={entry.key}
            href={entry.path}
            class={cn(styles.railLink, activeKey === entry.key && styles.railLinkActive)}
            onClick={go(entry.path)}
            aria-current={activeKey === entry.key ? 'page' : undefined}
          >
            <Icon name={entry.icon} size={22} />
            <span>{entry.label}</span>
            {entry.key === 'notifications' && unreadCount.value > 0 ? (
              <span class={styles.badgeDot}>{unreadCount.value > 99 ? '99+' : unreadCount.value}</span>
            ) : null}
          </a>
        ))}
        <div class={styles.railBottom}>
          <a
            href="/me"
            class={styles.railLink}
            onClick={go('/me')}
            aria-label="我的"
          >
            {user ? <Avatar name={user.nickname} src={user.avatarUrl} seed={user.id} size={30} /> : <Icon name="me" size={22} />}
          </a>
        </div>
      </nav>

      <div class={styles.main}>
        {!online.value ? (
          <div class={styles.offlineBanner} role="status">
            <Icon name="wifi-off" size={16} />
            当前处于离线状态，部分内容可能无法加载或保存。
          </div>
        ) : null}

        <header class={styles.topbar}>
          <h1 class={styles.pageTitle}>{title}</h1>
          <div class={styles.topbarSpacer} />
          <div class={styles.topbarActions}>
            <a href="/notifications" class={styles.iconBtn} onClick={go('/notifications')} aria-label="通知">
              <Icon name="bell" size={20} />
              {unreadCount.value > 0 ? (
                <span class={styles.badgeDot}>{unreadCount.value > 99 ? '99+' : unreadCount.value}</span>
              ) : null}
            </a>
            <a href="/me" class={styles.iconBtn} onClick={go('/me')} aria-label="我的">
              <Icon name="me" size={20} />
            </a>
          </div>
        </header>

        <main class={cn(styles.content, wide && styles.contentWide)} id="main-content" tabIndex={-1}>
          {context ? (
            <div class={styles.withContext}>
              <div class={ui.pageEnter}>{children}</div>
              <aside class={styles.contextCol} aria-label="上下文">
                {context}
              </aside>
            </div>
          ) : (
            <div class={ui.pageEnter}>{children}</div>
          )}
        </main>
      </div>

      <nav class={styles.bottomNav} aria-label="底部导航">
        {MOBILE_PRIMARY.map((entry) => (
          <a
            key={entry.key}
            href={entry.path}
            class={cn(styles.navItem, activeKey === entry.key && styles.navItemActive)}
            onClick={go(entry.path)}
            aria-current={activeKey === entry.key ? 'page' : undefined}
          >
            <Icon name={entry.icon} size={22} />
            <span>{entry.label}</span>
          </a>
        ))}
        <button
          type="button"
          class={cn(styles.navItem, (activeKey === 'album' || activeKey === 'capsule' || activeKey === 'notifications' || activeKey === 'me' || activeKey === 'admin') && styles.navItemActive)}
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
        >
          <Icon name="more" size={22} />
          <span>更多</span>
          {unreadCount.value > 0 ? <span class={styles.navBadge}>{unreadCount.value > 99 ? '99+' : unreadCount.value}</span> : null}
        </button>
      </nav>

      {moreOpen ? (
        <div class={styles.sheetOverlay} onClick={() => setMoreOpen(false)} role="presentation">
          <div
            class={styles.sheet}
            role="dialog"
            aria-modal="true"
            aria-label="更多入口"
            onClick={(event) => event.stopPropagation()}
          >
            <div class={styles.sheetHandle} />
            <div class={styles.sheetGrid}>
              {MOBILE_MORE.filter((entry: NavEntry) => !entry.adminOnly || isAdmin.value).map((entry) => (
                <a
                  key={entry.key}
                  href={entry.path}
                  class={styles.sheetItem}
                  onClick={(event) => {
                    event.preventDefault()
                    setMoreOpen(false)
                    navigate(entry.path)
                  }}
                >
                  <Icon name={entry.icon} size={22} />
                  <span>{entry.label}</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

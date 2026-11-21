import { useState } from 'preact/hooks'
import { notificationApi } from '../../lib/api'
import type { Notification } from '../../lib/types'
import { AppShell } from '../../components/AppShell'
import { Button, StateBlock } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { useAsync, describeError } from '../../lib/useAsync'
import { formatRelative } from '../../lib/format'
import { navigate } from '../../lib/router'
import { showToast } from '../../lib/toast'
import { liveNotifications, unreadCount } from '../../lib/session'
import styles from './notifications.module.css'

export function NotificationsPage(): preact.JSX.Element {
  const list = useAsync(() => notificationApi.list(), [])
  const [readIds, setReadIds] = useState<Set<string>>(new Set())
  const [markingAll, setMarkingAll] = useState(false)

  const serverItems = list.state.status === 'success' ? list.state.data.items : []
  const seen = new Set<string>()
  const merged: Notification[] = []
  for (const item of [...liveNotifications.value, ...serverItems]) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    merged.push(readIds.has(item.id) && !item.readAt ? { ...item, readAt: new Date().toISOString() } : item)
  }
  const unreadTotal = merged.filter((item) => !item.readAt).length

  const markOne = async (notification: Notification): Promise<void> => {
    if (!notification.readAt && !readIds.has(notification.id)) {
      setReadIds((current) => new Set(current).add(notification.id))
      unreadCount.value = Math.max(0, unreadCount.value - 1)
      try {
        await notificationApi.markRead(notification.id)
      } catch {
        // non-blocking
      }
    }
    if (notification.href) navigate(notification.href)
  }

  const markAll = async (): Promise<void> => {
    setMarkingAll(true)
    try {
      await notificationApi.markAllRead()
      unreadCount.value = 0
      setReadIds(new Set(merged.map((item) => item.id)))
      showToast('已全部标记为已读。')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '操作失败', 'error')
    } finally {
      setMarkingAll(false)
    }
  }

  return (
    <AppShell activeKey="notifications" title="通知">
      <div class={styles.page}>
        <div class={styles.headRow}>
          <h1 class={styles.headTitle}>通知{unreadTotal > 0 ? `（${unreadTotal} 条未读）` : ''}</h1>
          {unreadTotal > 0 ? (
            <Button variant="quiet" onClick={() => void markAll()} loading={markingAll}>
              <Icon name="check" size={16} /> 全部已读
            </Button>
          ) : null}
        </div>

        {list.state.status === 'loading' && merged.length === 0 ? <p class={styles.itemText}>加载中…</p> : null}
        {list.state.status === 'error' ? (
          <StateBlock icon="alert" title={describeError(list.state.error).title} body={describeError(list.state.error).detail} tone="danger">
            <Button variant="quiet" onClick={list.reload}>
              重试
            </Button>
          </StateBlock>
        ) : null}
        {list.state.status === 'success' && merged.length === 0 ? (
          <StateBlock icon="bell" title="还没有通知" body="有新的关注、评论或审核结果时，会在这里提醒你。" />
        ) : null}

        {merged.length > 0 ? (
          <div class={styles.list}>
            {merged.map((notification) => (
              <button
                key={notification.id}
                type="button"
                class={`${styles.item} ${notification.readAt ? '' : styles.itemUnread}`}
                onClick={() => void markOne(notification)}
              >
                <span class={notification.readAt ? styles.dotSpacer : styles.dot} aria-hidden="true" />
                <span class={styles.itemBody}>
                  <span class={styles.itemTitle}>{notification.title}</span>
                  <span class={styles.itemText}>{notification.body}</span>
                  {notification.href ? <span class={styles.liveTag}>点击查看</span> : null}
                </span>
                <span class={styles.itemTime}>{formatRelative(notification.createdAt)}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </AppShell>
  )
}

import { adminApi } from '../../lib/api'
import { AppShell } from '../../components/AppShell'
import { Badge, Button, StateBlock } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { useAsync, describeError } from '../../lib/useAsync'
import { formatRelative } from '../../lib/format'
import { showToast } from '../../lib/toast'
import { navigate } from '../../lib/router'
import styles from './admin.module.css'

export function AdminRecyclePage(): preact.JSX.Element {
  const recycle = useAsync(() => adminApi.recycle(), [])

  const restore = async (id: string): Promise<void> => {
    try {
      await adminApi.restoreRecycle(id)
      showToast('已恢复。')
      recycle.reload()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '恢复失败', 'error')
    }
  }

  const purge = async (id: string, label: string): Promise<void> => {
    if (!window.confirm(`彻底删除「${label}」？此操作不可撤销。`)) return
    try {
      await adminApi.purgeRecycle(id)
      showToast('已彻底删除。')
      recycle.reload()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '删除失败', 'error')
    }
  }

  return (
    <AppShell activeKey="admin" title="回收站">
      <div class={styles.page}>
        <div class={styles.headRow}>
          <h1 class={styles.headTitle}>回收站</h1>
          <Button variant="quiet" onClick={() => navigate('/admin')}>
            <Icon name="arrow-left" size={16} /> 返回管理首页
          </Button>
        </div>

        {recycle.state.status === 'loading' ? <p class={styles.rowText}>加载中…</p> : null}
        {recycle.state.status === 'error' ? (
          <StateBlock icon="alert" title={describeError(recycle.state.error).title} body={describeError(recycle.state.error).detail} tone="danger">
            <Button variant="quiet" onClick={recycle.reload}>
              重试
            </Button>
          </StateBlock>
        ) : null}
        {recycle.state.status === 'success' && recycle.state.data.items.length === 0 ? (
          <StateBlock icon="recycle" title="回收站是空的" body="删除的内容会先进入回收站，可以在这里恢复或彻底清除。" />
        ) : null}
        {recycle.state.status === 'success' && recycle.state.data.items.length > 0 ? (
          <div class={styles.section}>
            {recycle.state.data.items.map((entry) => (
              <div key={entry.id} class={styles.row}>
                <div class={styles.rowBody}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span class={styles.rowTitle}>{entry.label}</span>
                    <Badge>{entry.kind}</Badge>
                  </div>
                  <span class={styles.rowMeta}>
                    {entry.deletedByNickname} 删除于 {formatRelative(entry.deletedAt)}
                  </span>
                </div>
                <div class={styles.rowActions}>
                  {entry.restorable ? (
                    <Button size="sm" variant="quiet" onClick={() => void restore(entry.id)}>
                      恢复
                    </Button>
                  ) : null}
                  <Button size="sm" variant="danger" onClick={() => void purge(entry.id, entry.label)}>
                    彻底删除
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </AppShell>
  )
}

import { useState } from 'preact/hooks'
import { treeApi } from '../../lib/api'
import type { TreePost } from '../../lib/types'
import { AppShell } from '../../components/AppShell'
import { Button, StateBlock } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { useAsync, describeError } from '../../lib/useAsync'
import { navigate } from '../../lib/router'
import { cn } from '../../lib/cn'
import { PostCard } from './PostCard'
import styles from './tree.module.css'

type Sort = 'latest' | 'active' | 'saved'

const SORTS: Array<{ key: Sort; label: string }> = [
  { key: 'latest', label: '最新' },
  { key: 'active', label: '最热' },
  { key: 'saved', label: '收藏' },
]

export function TreePage(): preact.JSX.Element {
  const [sort, setSort] = useState<Sort>('latest')
  const list = useAsync(() => treeApi.list({ sort, limit: 20 }), [sort])
  const [extra, setExtra] = useState<TreePost[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const items = list.state.status === 'success' ? [...list.state.data.items, ...extra] : []
  const nextCursor = list.state.status === 'success' ? cursor ?? list.state.data.nextCursor : null

  const loadMore = async (): Promise<void> => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await treeApi.list({ sort, cursor: nextCursor, limit: 20 })
      setExtra((current) => [...current, ...page.items])
      setCursor(page.nextCursor)
    } catch {
      // handled by toast-free silent failure; user can retry
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <AppShell activeKey="tree" title="树洞">
      <div class={styles.page}>
        <div class={styles.headRow}>
          <div class={styles.tabs} role="tablist" aria-label="树洞排序">
            {SORTS.map((option) => (
              <button
                key={option.key}
                type="button"
                role="tab"
                aria-selected={sort === option.key}
                class={cn(styles.tab, sort === option.key && styles.tabActive)}
                onClick={() => {
                  setSort(option.key)
                  setExtra([])
                  setCursor(null)
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="quiet" onClick={() => navigate('/tree/wall')}>
              <Icon name="message" size={16} /> 弹幕墙
            </Button>
            <Button variant="primary" onClick={() => navigate('/tree/new')}>
              <Icon name="edit" size={16} /> 发帖
            </Button>
          </div>
        </div>

        {list.state.status === 'loading' ? <PostSkeletonList /> : null}
        {list.state.status === 'error' ? (
          <StateBlock
            icon="alert"
            title={describeError(list.state.error).title}
            body={describeError(list.state.error).detail}
            tone="danger"
          >
            <Button variant="quiet" onClick={list.reload}>
              重试
            </Button>
          </StateBlock>
        ) : null}
        {list.state.status === 'success' && items.length === 0 ? (
          <StateBlock
            icon="message"
            title="树洞里还没有帖子"
            body="说点什么吧。发帖默认匿名，别人看不到你的真实身份。"
          >
            <Button variant="primary" onClick={() => navigate('/tree/new')}>
              发第一条
            </Button>
          </StateBlock>
        ) : null}

        {items.length > 0 ? (
          <div class={styles.postList}>
            {items.map((post) => (
              <PostCard key={post.id} post={post} onChanged={list.reload} />
            ))}
            {nextCursor ? (
              <div style={{ textAlign: 'center' }}>
                <Button variant="quiet" onClick={() => void loadMore()} loading={loadingMore}>
                  加载更多
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </AppShell>
  )
}

function PostSkeletonList(): preact.JSX.Element {
  return (
    <div class={styles.postList} aria-hidden="true">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} class={styles.postCard}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--desk)' }} />
            <span style={{ width: 80, height: 12, borderRadius: 4, background: 'var(--desk)' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ width: '90%', height: 14, borderRadius: 4, background: 'var(--desk)' }} />
            <span style={{ width: '70%', height: 14, borderRadius: 4, background: 'var(--desk)' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

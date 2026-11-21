import { treeApi } from '../../lib/api'
import { AppShell } from '../../components/AppShell'
import { Button, StateBlock } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { useAsync, describeError } from '../../lib/useAsync'
import { navigate } from '../../lib/router'
import { PostCard } from './PostCard'
import styles from './tree.module.css'

export function TreeMinePage(): preact.JSX.Element {
  const mine = useAsync(() => treeApi.mine(), [])

  return (
    <AppShell activeKey="tree" title="我的树洞">
      <div class={styles.page}>
        <button type="button" class={styles.footAction} onClick={() => navigate('/tree')}>
          <Icon name="arrow-left" size={16} /> 返回树洞
        </button>

        <p class={styles.moderated} style={{ fontStyle: 'normal' }}>
          这里只有你自己能看到，展示的是你发过的匿名帖。其他同学看到的仍是马甲。
        </p>

        {mine.state.status === 'loading' ? <p class={styles.postTime}>加载中…</p> : null}
        {mine.state.status === 'error' ? (
          <StateBlock icon="alert" title={describeError(mine.state.error).title} body={describeError(mine.state.error).detail} tone="danger">
            <Button variant="quiet" onClick={mine.reload}>
              重试
            </Button>
          </StateBlock>
        ) : null}
        {mine.state.status === 'success' && mine.state.data.items.length === 0 ? (
          <StateBlock icon="message" title="你还没有发过树洞" body="匿名说说最近的心情，或求助一件小事。">
            <Button variant="primary" onClick={() => navigate('/tree/new')}>
              去发帖
            </Button>
          </StateBlock>
        ) : null}
        {mine.state.status === 'success' && mine.state.data.items.length > 0 ? (
          <div class={styles.postList}>
            {mine.state.data.items.map((post) => (
              <PostCard key={post.id} post={post} onChanged={mine.reload} />
            ))}
          </div>
        ) : null}
      </div>
    </AppShell>
  )
}

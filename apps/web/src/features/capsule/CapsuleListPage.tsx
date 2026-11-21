import { useEffect, useState } from 'preact/hooks'
import { capsuleApi } from '../../lib/api'
import type { CapsuleSummary, CapsuleVisibility } from '../../lib/types'
import { AppShell } from '../../components/AppShell'
import { Button, Chip, StateBlock } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { useAsync, describeError } from '../../lib/useAsync'
import { formatCountdown } from '../../lib/format'
import { navigate } from '../../lib/router'
import styles from './capsule.module.css'

const VISIBILITY_LABELS: Record<CapsuleVisibility, string> = {
  class: '全班可见',
  recipient: '指定接收',
  self: '只给自己',
  collaborative: '共同创作',
}

export function CapsuleListPage(): preact.JSX.Element {
  const list = useAsync(() => capsuleApi.list({}), [])

  return (
    <AppShell activeKey="capsule" title="时光胶囊">
      <div class={styles.page}>
        <div class={styles.headRow}>
          <div>
            <h1 class={styles.headTitle}>时光胶囊</h1>
            <p class={styles.countdownLabel}>封存一段话或一张照片，等约定的日子再打开。</p>
          </div>
          <Button variant="primary" onClick={() => navigate('/capsules/new')}>
            <Icon name="plus" size={16} /> 新建胶囊
          </Button>
        </div>

        {list.state.status === 'loading' ? <p class={styles.countdownLabel}>加载中…</p> : null}
        {list.state.status === 'error' ? (
          <StateBlock icon="alert" title={describeError(list.state.error).title} body={describeError(list.state.error).detail} tone="danger">
            <Button variant="quiet" onClick={list.reload}>
              重试
            </Button>
          </StateBlock>
        ) : null}
        {list.state.status === 'success' && list.state.data.items.length === 0 ? (
          <StateBlock
            icon="capsule"
            title="还没有时光胶囊"
            body="写一封给未来的信，设定解锁时间，到期后一起打开。"
          >
            <Button variant="primary" onClick={() => navigate('/capsules/new')}>
              新建胶囊
            </Button>
          </StateBlock>
        ) : null}

        {list.state.status === 'success' && list.state.data.items.length > 0 ? (
          <div class={styles.list}>
            {list.state.data.items.map((capsule) => (
              <CapsuleCard key={capsule.id} capsule={capsule} />
            ))}
          </div>
        ) : null}
      </div>
    </AppShell>
  )
}

function CapsuleCard({ capsule }: { capsule: CapsuleSummary }): preact.JSX.Element {
  const [remaining, setRemaining] = useState(() => new Date(capsule.unlockAt).getTime() - Date.now())

  useEffect(() => {
    if (!capsule.locked) return undefined
    const timer = window.setInterval(() => {
      setRemaining(new Date(capsule.unlockAt).getTime() - Date.now())
    }, 1000)
    return () => window.clearInterval(timer)
  }, [capsule.locked, capsule.unlockAt])

  return (
    <button type="button" class={styles.card} onClick={() => navigate(`/capsules/${capsule.id}`)}>
      <div class={styles.cardTop}>
        <span class={styles.cardTitle}>{capsule.title}</span>
        <span class={styles.visibilityTag}>{VISIBILITY_LABELS[capsule.visibility]}</span>
      </div>
      {capsule.locked ? (
        <div>
          <span class={styles.lockedMark}>
            <Icon name="lock" size={16} /> 距离解锁
          </span>
          <div class={styles.countdown}>{formatCountdown(remaining)}</div>
        </div>
      ) : (
        <span class={styles.lockedMark}>
          <Icon name="unlock" size={16} /> 已解锁，可以查看
        </span>
      )}
      <div class={styles.cardMeta}>
        <span>{capsule.contributorCount} 位贡献者</span>
        <span>{capsule.recipientCount} 位接收人</span>
        {capsule.canContribute ? <Chip>可继续投稿</Chip> : null}
      </div>
    </button>
  )
}

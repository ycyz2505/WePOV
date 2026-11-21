import { useState } from 'preact/hooks'
import { partnerApi } from '../../lib/api'
import type { PartnerPost, PartnerKind } from '../../lib/types'
import { AppShell } from '../../components/AppShell'
import { Badge, Button, Chip, StateBlock } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { useAsync, describeError } from '../../lib/useAsync'
import { navigate } from '../../lib/router'
import { formatDateTime, formatRelative } from '../../lib/format'
import styles from './partner.module.css'

const KIND_LABELS: Record<PartnerKind, string> = {
  meal: '吃饭',
  study: '学习',
  sport: '运动',
  entertainment: '娱乐',
  travel: '出行',
  activity: '活动',
  other: '其他',
}

const KIND_FILTERS: Array<{ key: string; label: string }> = [
  { key: '', label: '全部' },
  { key: 'meal', label: '吃饭' },
  { key: 'study', label: '学习' },
  { key: 'sport', label: '运动' },
  { key: 'entertainment', label: '娱乐' },
  { key: 'travel', label: '出行' },
  { key: 'activity', label: '活动' },
  { key: 'other', label: '其他' },
]

export function PartnerPage(): preact.JSX.Element {
  const [kind, setKind] = useState('')
  const [status, setStatus] = useState('open')
  const list = useAsync(() => partnerApi.list({ status, cursor: undefined }), [status])

  const allItems = list.state.status === 'success' ? list.state.data.items : []
  const items = kind ? allItems.filter((post) => post.kind === kind) : allItems

  return (
    <AppShell activeKey="partner" title="搭子">
      <div class={styles.page}>
        <div class={styles.headRow}>
          <div class={styles.chipRow}>
            {KIND_FILTERS.map((option) => (
              <Chip key={option.key} active={kind === option.key} onClick={() => setKind(option.key)}>
                {option.label}
              </Chip>
            ))}
          </div>
          <Button variant="primary" onClick={() => navigate('/partners/new')}>
            <Icon name="plus" size={16} /> 发起搭子
          </Button>
        </div>

        <div class={styles.toolbar}>
          <Chip active={status === 'open'} onClick={() => setStatus('open')}>
            进行中
          </Chip>
          <Chip active={status === 'formed'} onClick={() => setStatus('formed')}>
            已成团
          </Chip>
          <Chip active={status === 'expired'} onClick={() => setStatus('expired')}>
            已过期
          </Chip>
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="quiet" onClick={list.reload}>
            <Icon name="refresh" size={14} /> 刷新
          </Button>
        </div>

        {list.state.status === 'loading' ? <PartnerSkeleton /> : null}
        {list.state.status === 'error' ? (
          <StateBlock icon="alert" title={describeError(list.state.error).title} body={describeError(list.state.error).detail} tone="danger">
            <Button variant="quiet" onClick={list.reload}>
              重试
            </Button>
          </StateBlock>
        ) : null}
        {list.state.status === 'success' && items.length === 0 ? (
          <StateBlock
            icon="partner"
            title="这里还没有搭子"
            body="发起一个搭子：约饭、自习、运动或一起去看点什么。"
          >
            <Button variant="primary" onClick={() => navigate('/partners/new')}>
              发起搭子
            </Button>
          </StateBlock>
        ) : null}

        {items.length > 0 ? (
          <div class={styles.list}>
            {items.map((post) => (
              <PartnerCard key={post.id} post={post} />
            ))}
          </div>
        ) : null}
      </div>
    </AppShell>
  )
}

function PartnerCard({ post }: { post: PartnerPost }): preact.JSX.Element {
  const fillRatio = post.capacity > 0 ? Math.min(100, Math.round((post.confirmedCount / post.capacity) * 100)) : 0
  const expired = new Date(post.expiresAt).getTime() < Date.now()

  return (
    <article class={styles.card}>
      <div class={styles.cardHead}>
        <Badge tone="accent">{KIND_LABELS[post.kind]}</Badge>
        <span class={styles.title}>{post.title}</span>
      </div>
      <div class={styles.metaRow}>
        <span class={styles.metaItem}>
          <Icon name="calendar" size={14} /> {formatDateTime(post.startsAt)}
        </span>
        <span class={styles.metaItem}>
          <Icon name="map-pin" size={14} /> {post.location}
        </span>
      </div>
      <p class={styles.desc}>{post.description || '发起人没有写补充说明。'}</p>
      <div>
        <div class={styles.capacity}>
          已确认 {post.confirmedCount}/{post.capacity}
          {post.waitlistCount > 0 ? ` · 候补 ${post.waitlistCount}` : ''}
        </div>
        <div class={styles.capacityBar}>
          <div class={styles.capacityFill} style={{ width: `${fillRatio}%` }} />
        </div>
      </div>
      <div class={styles.cardFoot}>
        <span class={styles.statusText}>
          {post.status === 'formed' ? '已成团' : expired ? '已过期' : `截止 ${formatRelative(post.expiresAt)}`}
        </span>
        <Button size="sm" variant="quiet" onClick={() => navigate(`/partners/${post.id}`)}>
          查看详情
        </Button>
      </div>
    </article>
  )
}

function PartnerSkeleton(): preact.JSX.Element {
  return (
    <div class={styles.list} aria-hidden="true">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} class={styles.card}>
          <span style={{ width: '40%', height: 18, borderRadius: 4, background: 'var(--desk)' }} />
          <span style={{ width: '80%', height: 14, borderRadius: 4, background: 'var(--desk)' }} />
          <span style={{ width: '100%', height: 40, borderRadius: 4, background: 'var(--desk)' }} />
        </div>
      ))}
    </div>
  )
}

export { KIND_LABELS }

import { useState } from 'preact/hooks'
import { partnerApi } from '../../lib/api'
import type { PartnerPost, PartnerResponse } from '../../lib/types'
import { AppShell } from '../../components/AppShell'
import { Avatar, Badge, Button, Notice, StateBlock, TextArea } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { useAsync, describeError } from '../../lib/useAsync'
import { showToast } from '../../lib/toast'
import { formatDateTime, formatRelative } from '../../lib/format'
import { navigate } from '../../lib/router'
import { currentUser } from '../../lib/session'
import { cn } from '../../lib/cn'
import styles from './partner.module.css'

const KIND_LABELS: Record<string, string> = {
  meal: '吃饭',
  study: '学习',
  sport: '运动',
  entertainment: '娱乐',
  travel: '出行',
  activity: '活动',
  other: '其他',
}

const STATE_LABELS: Record<string, string> = {
  pending: '待确认',
  confirmed: '已确认',
  waitlist: '候补',
  declined: '已婉拒',
}

export function PartnerDetailPage({ partnerId }: { partnerId: string }): preact.JSX.Element {
  const post = useAsync(() => partnerApi.get(partnerId), [partnerId])
  const responses = useAsync(() => partnerApi.responses(partnerId), [partnerId])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const data: PartnerPost | null = post.state.status === 'success' ? post.state.data : null
  const me = currentUser.value
  const isOwner = data ? data.ownerId === me?.id : false
  const isFull = data ? data.confirmedCount >= data.capacity : false
  const myState = data?.myResponse ?? null

  const respond = async (): Promise<void> => {
    setBusy(true)
    try {
      await partnerApi.respond(partnerId, note.trim())
      showToast(isFull ? '已加入候补。' : '已报名。')
      setNote('')
      post.reload()
      responses.reload()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '报名失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const confirmUser = async (userId: string): Promise<void> => {
    try {
      await partnerApi.confirm(partnerId, userId)
      post.reload()
      responses.reload()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '操作失败', 'error')
    }
  }

  const closePost = async (): Promise<void> => {
    try {
      await partnerApi.close(partnerId)
      showToast('已结束招募。')
      post.reload()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '操作失败', 'error')
    }
  }

  const cancelPost = async (): Promise<void> => {
    try {
      await partnerApi.cancel(partnerId)
      showToast('搭子已取消。')
      navigate('/partners', { replace: true })
    } catch (error) {
      showToast(error instanceof Error ? error.message : '取消失败', 'error')
    }
  }

  const fillRatio = data && data.capacity > 0 ? Math.min(100, Math.round((data.confirmedCount / data.capacity) * 100)) : 0

  return (
    <AppShell activeKey="partner" title="搭子详情">
      <div class={styles.page}>
        <button type="button" class={styles.back} onClick={() => navigate('/partners')}>
          <Icon name="arrow-left" size={16} /> 返回搭子
        </button>

        {post.state.status === 'loading' ? <p style={{ color: 'var(--ink-muted)' }}>加载中…</p> : null}
        {post.state.status === 'error' ? (
          <StateBlock icon="alert" title={describeError(post.state.error).title} body={describeError(post.state.error).detail} tone="danger">
            <Button variant="quiet" onClick={post.reload}>
              重试
            </Button>
          </StateBlock>
        ) : null}

        {data ? (
          <>
            <div class={styles.card}>
              <div class={styles.cardHead}>
                <Badge tone="accent">{KIND_LABELS[data.kind] ?? data.kind}</Badge>
                <span class={styles.title}>{data.title}</span>
                {data.status === 'formed' ? <Badge tone="success">已成团</Badge> : null}
                {data.status === 'expired' ? <Badge tone="default">已过期</Badge> : null}
              </div>
              <div class={styles.metaRow}>
                <span class={styles.metaItem}>
                  <Icon name="calendar" size={14} /> {formatDateTime(data.startsAt)}
                </span>
                <span class={styles.metaItem}>
                  <Icon name="map-pin" size={14} /> {data.location}
                </span>
                <span class={styles.metaItem}>
                  <Icon name="users" size={14} /> 发起人 {data.ownerNickname}
                </span>
              </div>
              <p class={styles.desc}>{data.description || '发起人没有写补充说明。'}</p>
              <div>
                <div class={styles.capacity}>
                  已确认 {data.confirmedCount}/{data.capacity}
                  {data.waitlistCount > 0 ? ` · 候补 ${data.waitlistCount}` : ''}
                </div>
                <div class={styles.capacityBar}>
                  <div class={styles.capacityFill} style={{ width: `${fillRatio}%` }} />
                </div>
              </div>
              <div class={styles.cardFoot}>
                <span class={styles.statusText}>报名截止 {formatRelative(data.expiresAt)}</span>
                {isOwner && (data.status === 'open' || data.status === 'formed') ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button size="sm" variant="quiet" onClick={() => void closePost()}>
                      结束招募
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => void cancelPost()}>
                      取消搭子
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>

            {!isOwner && data.status === 'open' ? (
              myState ? (
                <Notice tone={myState === 'confirmed' ? 'success' : myState === 'waitlist' ? 'warn' : 'info'} icon="check">
                  你的状态：{STATE_LABELS[myState] ?? myState}
                </Notice>
              ) : (
                <div class={styles.form}>
                  <TextArea
                    label="报名留言"
                    value={note}
                    maxLength={120}
                    counterMax={120}
                    rows={2}
                    placeholder={isFull ? '人数已满，留言后会进入候补。' : '简单介绍一下，方便发起人确认。'}
                    onInput={(event) => setNote((event.currentTarget as HTMLTextAreaElement).value)}
                  />
                  <div>
                    <Button variant="primary" onClick={() => void respond()} loading={busy}>
                      {isFull ? (data.allowWaitlist ? '加入候补' : '人数已满') : '报名'}
                    </Button>
                  </div>
                </div>
              )
            ) : null}

            <h2 class={styles.headTitle}>报名与候补</h2>
            {responses.state.status === 'loading' ? <p style={{ color: 'var(--ink-muted)' }}>加载中…</p> : null}
            {responses.state.status === 'error' ? (
              <p class={styles.statusText}>报名列表加载失败。</p>
            ) : null}
            {responses.state.status === 'success' ? (
              responses.state.data.items.length === 0 ? (
                <p class={styles.statusText}>还没有人报名。</p>
              ) : (
                <div class={styles.responses}>
                  {responses.state.data.items.map((response) => (
                    <ResponseRow
                      key={response.id}
                      response={response}
                      canConfirm={isOwner && response.state === 'pending'}
                      onConfirm={() => void confirmUser(response.userId)}
                    />
                  ))}
                </div>
              )
            ) : null}
          </>
        ) : null}
      </div>
    </AppShell>
  )
}

function ResponseRow({
  response,
  canConfirm,
  onConfirm,
}: {
  response: PartnerResponse
  canConfirm: boolean
  onConfirm: () => void
}): preact.JSX.Element {
  return (
    <div class={styles.responseRow}>
      <Avatar name={response.nickname} size={34} seed={response.userId} />
      <div class={styles.responseMeta}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 600 }}>{response.nickname}</span>
          <span
            class={cn(
              styles.stateTag,
              response.state === 'confirmed' && styles.stateConfirmed,
              response.state === 'waitlist' && styles.stateWaitlist,
            )}
          >
            {STATE_LABELS[response.state] ?? response.state}
          </span>
        </div>
        {response.note ? <p class={styles.responseNote}>{response.note}</p> : null}
      </div>
      {canConfirm ? (
        <Button size="sm" variant="primary" onClick={onConfirm}>
          确认
        </Button>
      ) : null}
    </div>
  )
}

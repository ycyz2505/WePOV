import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { classroomApi } from '../../lib/api'
import type { ClassroomLayout, ClassroomSeat, FocusSession } from '../../lib/types'
import { AppShell } from '../../components/AppShell'
import { Avatar, Button, Notice, Skeleton, StateBlock } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { useAsync, describeError } from '../../lib/useAsync'
import { showToast } from '../../lib/toast'
import { formatTimer, genderLabel } from '../../lib/format'
import { cn } from '../../lib/cn'
import styles from './classroom.module.css'

const FOCUS_DURATIONS = [25, 45, 60, 90]

export function ClassroomPage(): preact.JSX.Element {
  const layout = useAsync<ClassroomLayout>(() => classroomApi.layout(), [])
  const [selected, setSelected] = useState<ClassroomSeat | null>(null)

  return (
    <AppShell activeKey="classroom" title="教室">
      <div class={styles.page}>
        <header class={styles.headRow}>
          <div>
            <h2 class={styles.headTitle}>我们班现在</h2>
            <p class={styles.headSub}>点一个座位，送一句鼓励或看看谁在专注。</p>
          </div>
        </header>

        {layout.state.status === 'loading' ? <ClassroomSkeleton /> : null}

        {layout.state.status === 'error' ? (
          <ErrorPanel error={layout.state.error} onRetry={layout.reload} />
        ) : null}

        {layout.state.status === 'success' ? (
          <ClassroomBody
            layout={layout.state.data}
            onRefresh={layout.reload}
            onSelect={setSelected}
          />
        ) : null}
      </div>

      {selected ? (
        <SeatModal
          seat={selected}
          onClose={() => setSelected(null)}
          onDone={() => {
            setSelected(null)
            layout.reload()
          }}
        />
      ) : null}
    </AppShell>
  )
}

function ClassroomSkeleton(): preact.JSX.Element {
  return (
    <div class={styles.stageWrap}>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(6, 62px)', justifyContent: 'center' }}>
        {Array.from({ length: 24 }, (_, index) => (
          <Skeleton key={index} height={66} radius={6} />
        ))}
      </div>
    </div>
  )
}

function ErrorPanel({ error, onRetry }: { error: Error; onRetry: () => void }): preact.JSX.Element {
  const info = describeError(error)
  return (
    <StateBlock icon="alert" title={info.title} body={info.detail} tone="danger">
      {info.retryable ? (
        <Button variant="quiet" onClick={onRetry}>
          <Icon name="refresh" size={16} /> 重试
        </Button>
      ) : null}
    </StateBlock>
  )
}

function ClassroomBody({
  layout,
  onRefresh,
  onSelect,
}: {
  layout: ClassroomLayout
  onRefresh: () => void
  onSelect: (seat: ClassroomSeat) => void
}): preact.JSX.Element {
  const columns = Math.max(1, layout.columns)
  return (
    <>
      <div class={styles.stageWrap}>
        <div class={styles.blackboard}>今天也在一起</div>
        <div
          class={styles.seatGrid}
          style={{ gridTemplateColumns: `repeat(${columns}, 62px)` }}
          role="grid"
          aria-label="教室座位"
        >
          {layout.seats.map((seat) => (
            <SeatCell key={seat.seatId} seat={seat} isMe={seat.seatId === layout.me?.seatId} onSelect={onSelect} />
          ))}
        </div>
        <div class={styles.legend}>
          <span class={styles.legendItem}>
            <span class={cn(styles.legendSwatch, styles.presenceFocus)} /> 专注
          </span>
          <span class={styles.legendItem}>
            <span class={cn(styles.legendSwatch, styles.presenceRest)} /> 休息
          </span>
          <span class={styles.legendItem}>
            <span class={styles.legendSwatch} /> 未设置状态
          </span>
        </div>
      </div>

      <div class={styles.panels}>
        <FocusPanel onDone={onRefresh} />
        <BossPanel boss={layout.boss} />
      </div>
    </>
  )
}

function SeatCell({
  seat,
  isMe,
  onSelect,
}: {
  seat: ClassroomSeat
  isMe: boolean
  onSelect: (seat: ClassroomSeat) => void
}): preact.JSX.Element {
  if (!seat.userId) {
    return <div class={cn(styles.seat, styles.seatEmpty)} aria-label="空座位" />
  }
  const statusLabel = seat.presence === 'focus' ? '专注中' : seat.presence === 'rest' ? '休息' : '未设置'
  return (
    <button
      type="button"
      class={cn(
        styles.seat,
        isMe && styles.seatMe,
        seat.presence === 'offline' && styles.seatOffline,
        seat.presence === 'focus' && styles.seatFocus,
      )}
      onClick={() => onSelect(seat)}
      aria-label={`${seat.nickname ?? '同学'}，${statusLabel}`}
    >
      <span
        class={cn(
          styles.presenceDot,
          seat.presence === 'focus' && styles.presenceFocus,
          seat.presence === 'rest' && styles.presenceRest,
        )}
      />
      <span class={styles.pixel} aria-hidden="true">
        <span class={styles.pixelHead} />
        <span class={styles.pixelBody} />
      </span>
      <span class={styles.seatName}>{seat.nickname}</span>
    </button>
  )
}

function FocusPanel({ onDone }: { onDone: () => void }): preact.JSX.Element {
  const [duration, setDuration] = useState(25)
  const [session, setSession] = useState<FocusSession | null>(null)
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  const intervalRef = useRef<number | null>(null)

  useEffect(() => {
    intervalRef.current = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      if (intervalRef.current !== null) window.clearInterval(intervalRef.current)
    }
  }, [])

  const remaining = session ? new Date(session.endsAt).getTime() - now : 0

  const start = async (): Promise<void> => {
    setBusy(true)
    try {
      const created = await classroomApi.startFocus(duration, '')
      setSession(created)
      showToast('专注开始，加油。')
      onDone()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '开始专注失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const end = async (): Promise<void> => {
    setBusy(true)
    try {
      await classroomApi.endFocus()
      setSession(null)
      showToast('已结束专注。')
      onDone()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '结束失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section class={styles.panelCard}>
      <h3 class={styles.panelTitle}>
        <Icon name="clock" size={18} /> 专注打卡
      </h3>
      {session && remaining > 0 ? (
        <>
          <div class={styles.timerDisplay} aria-live="polite">
            {formatTimer(remaining)}
          </div>
          <p class={styles.panelBody}>保持专注，结束后会计入全班 Boss 贡献。</p>
          <Button variant="quiet" onClick={() => void end()} loading={busy}>
            结束专注
          </Button>
        </>
      ) : (
        <>
          <p class={styles.panelBody}>选一个时长开始，完成后自动记录。</p>
          <div class={styles.durationRow}>
            {FOCUS_DURATIONS.map((minutes) => (
              <button
                key={minutes}
                type="button"
                class={cn(styles.actionBtn, duration === minutes && styles.seatMe)}
                onClick={() => setDuration(minutes)}
                style={{ flexDirection: 'row', gap: 4 }}
              >
                <span class="numeral">{minutes}</span> 分钟
              </button>
            ))}
          </div>
          <Button variant="primary" onClick={() => void start()} loading={busy}>
            开始专注
          </Button>
        </>
      )}
    </section>
  )
}

function BossPanel({ boss }: { boss: ClassroomLayout['boss'] }): preact.JSX.Element {
  if (!boss) {
    return (
      <section class={styles.panelCard}>
        <h3 class={styles.panelTitle}>
          <Icon name="trophy" size={18} /> 期末 Boss
        </h3>
        <p class={styles.panelBody}>当前没有进行中的赛季。等管理员开启后，这里会出现全班共同的目标。</p>
      </section>
    )
  }
  const ratio = boss.targetPoints > 0 ? Math.min(1, boss.currentPoints / boss.targetPoints) : 0
  const remaining = Math.max(0, boss.targetPoints - boss.currentPoints)
  return (
    <section class={styles.bossCard}>
      <div class={styles.bossHead}>
        <Icon name="trophy" size={20} />
        <span class={styles.bossName}>{boss.name}</span>
      </div>
      <p class={styles.panelBody}>{boss.description}</p>
      <div class={styles.bossHpTrack} role="progressbar" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Boss 进度">
        <div class={styles.bossHpFill} style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
      <div class={styles.bossMeta}>
        <span class="numeral">
          {boss.currentPoints} / {boss.targetPoints}
        </span>
        <span>还差 {remaining} 点</span>
      </div>
      <p class={styles.panelBody} style={{ fontSize: 12 }}>
        只按班级行为累计：专注、笔记、答疑、互助和挑战，不涉及任何个人成绩。
      </p>
      <p class={styles.panelBody} style={{ fontSize: 12 }}>
        奖励：{boss.reward}
      </p>
    </section>
  )
}

function SeatModal({
  seat,
  onClose,
  onDone,
}: {
  seat: ClassroomSeat
  onClose: () => void
  onDone: () => void
}): preact.JSX.Element {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const send = async (kind: 'note' | 'snack' | 'lamp'): Promise<void> => {
    if (!seat.userId) return
    setBusy(true)
    try {
      await classroomApi.encourage({ recipientId: seat.userId, kind, message: kind === 'note' ? message : '' })
      showToast(kind === 'note' ? '鼓励已送达。' : kind === 'snack' ? '零食已送出。' : '台灯已点亮。')
      onDone()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '发送失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class={styles.modalOverlay} onClick={onClose} role="presentation">
      <div class={styles.modal} role="dialog" aria-modal="true" aria-label={`${seat.nickname ?? '同学'}的座位`} onClick={(event) => event.stopPropagation()}>
        <div class={styles.modalHead}>
          <Avatar name={seat.nickname ?? '?'} src={seat.avatarUrl} seed={seat.userId ?? ''} size={48} />
          <div>
            <div style={{ fontWeight: 600 }}>{seat.nickname}</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>
              {seat.presence === 'focus' ? '正在专注' : seat.presence === 'rest' ? '休息中' : '未设置状态'}
              {seat.gender ? ` · ${genderLabel(seat.gender)}` : ''}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" style={{ marginLeft: 'auto' }} class={styles.seatEmpty}>
            <Icon name="close" size={18} />
          </button>
        </div>

        <div class={styles.modalActions}>
          <textarea
            class="textarea"
            style={{ minHeight: 64 }}
            placeholder="写一句鼓励的话（最多 120 字）"
            maxLength={120}
            value={message}
            onInput={(event) => setMessage((event.currentTarget as HTMLTextAreaElement).value)}
            aria-label="鼓励留言"
          />
          <Button variant="primary" block onClick={() => void send('note')} loading={busy} disabled={message.trim().length === 0}>
            <Icon name="note" size={16} /> 投递鼓励纸条
          </Button>
          <div class={styles.actionRow}>
            <button type="button" class={styles.actionBtn} onClick={() => void send('snack')} disabled={busy}>
              <Icon name="snack" size={20} /> 送零食
            </button>
            <button type="button" class={styles.actionBtn} onClick={() => void send('lamp')} disabled={busy}>
              <Icon name="lamp" size={20} /> 点台灯
            </button>
          </div>
        </div>
        <Notice tone="info" icon="info">
          鼓励会以站内通知送达，不会公开你的身份。
        </Notice>
      </div>
    </div>
  )
}

export function useClassroomPresence(): void {
  // reserved for future presence switching hooks
  useMemo(() => undefined, [])
}

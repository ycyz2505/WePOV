import { useEffect, useState } from 'preact/hooks'
import { capsuleApi } from '../../lib/api'
import type { CapsuleDetail, CapsuleVisibility } from '../../lib/types'
import { AppShell } from '../../components/AppShell'
import { Avatar, Button, StateBlock, TextArea } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { useAsync, describeError } from '../../lib/useAsync'
import { formatCountdown, formatDateTime } from '../../lib/format'
import { navigate } from '../../lib/router'
import { showToast } from '../../lib/toast'
import { isSuperAdmin } from '../../lib/session'
import styles from './capsule.module.css'

const VISIBILITY_LABELS: Record<CapsuleVisibility, string> = {
  class: '全班可见',
  recipient: '指定接收',
  self: '只给自己',
  collaborative: '共同创作',
}

export function CapsuleDetailPage({ capsuleId }: { capsuleId: string }): preact.JSX.Element {
  const detail = useAsync(() => capsuleApi.get(capsuleId), [capsuleId])

  return (
    <AppShell activeKey="capsule" title="时光胶囊">
      <div class={styles.detail}>
        <button type="button" class={styles.back} onClick={() => navigate('/capsules')}>
          <Icon name="arrow-left" size={16} /> 返回胶囊列表
        </button>
        {detail.state.status === 'loading' ? <p class={styles.countdownLabel}>加载中…</p> : null}
        {detail.state.status === 'error' ? (
          <StateBlock icon="alert" title={describeError(detail.state.error).title} body={describeError(detail.state.error).detail} tone="danger">
            <Button variant="quiet" onClick={detail.reload}>
              重试
            </Button>
          </StateBlock>
        ) : null}
        {detail.state.status === 'success' ? (
          <CapsuleBody capsule={detail.state.data} onChanged={detail.reload} />
        ) : null}
      </div>
    </AppShell>
  )
}

function CapsuleBody({ capsule, onChanged }: { capsule: CapsuleDetail; onChanged: () => void }): preact.JSX.Element {
  const [remaining, setRemaining] = useState(() => new Date(capsule.unlockAt).getTime() - Date.now())
  const [contributing, setContributing] = useState(false)
  const [contribution, setContribution] = useState('')
  const [busy, setBusy] = useState(false)
  const superAdmin = isSuperAdmin.value

  useEffect(() => {
    if (!capsule.locked) return undefined
    const timer = window.setInterval(() => {
      setRemaining(new Date(capsule.unlockAt).getTime() - Date.now())
    }, 1000)
    return () => window.clearInterval(timer)
  }, [capsule.locked, capsule.unlockAt])

  const submitContribution = async (): Promise<void> => {
    if (!contribution.trim()) {
      showToast('写点什么再投稿吧。', 'error')
      return
    }
    setBusy(true)
    try {
      await capsuleApi.contribute(capsule.id, contribution.trim(), [])
      setContribution('')
      setContributing(false)
      showToast('已封存到胶囊里。')
      onChanged()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '投稿失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const delay = async (): Promise<void> => {
    const input = window.prompt('新的解锁时间（ISO 格式，例如 2027-06-01T09:00:00+08:00）', capsule.unlockAt)
    if (!input) return
    setBusy(true)
    try {
      await capsuleApi.delay(capsule.id, input)
      showToast('解锁时间已延后。')
      onChanged()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '操作失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div class={styles.detailHead}>
        <h1 class={styles.detailTitle}>{capsule.title}</h1>
        <div class={styles.cardMeta}>
          <span>{VISIBILITY_LABELS[capsule.visibility]}</span>
          <span>创建于 {formatDateTime(capsule.createdAt)}</span>
          <span>投稿截止 {formatDateTime(capsule.contributionDeadline)}</span>
        </div>
      </div>

      {capsule.locked ? (
        <div class={styles.sealedBox}>
          <span class={styles.sealedIcon}>
            <Icon name="lock" size={32} />
          </span>
          <p style={{ color: 'var(--ink-muted)', fontSize: 13 }}>胶囊尚未解锁，内容暂时封存</p>
          <div class={styles.countdown}>{formatCountdown(remaining)}</div>
          <p class={styles.countdownLabel}>解锁时间 {formatDateTime(capsule.unlockAt)}</p>
        </div>
      ) : (
        <>
          {capsule.content ? <div class={styles.contentBox}>{capsule.content}</div> : null}
          {capsule.mediaUrls.length > 0 ? (
            <div class={styles.mediaStrip}>
              {capsule.mediaUrls.map((url) => (
                <img key={url} src={url} alt="胶囊照片" loading="lazy" />
              ))}
            </div>
          ) : null}
        </>
      )}

      {capsule.canContribute ? (
        <div>
          {contributing ? (
            <div class={styles.form}>
              <TextArea
                label="投稿内容"
                hint="你的内容会封存到胶囊里，解锁时才能被看到。"
                value={contribution}
                maxLength={1000}
                counterMax={1000}
                rows={4}
                onInput={(event) => setContribution((event.currentTarget as HTMLTextAreaElement).value)}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="primary" onClick={() => void submitContribution()} loading={busy}>
                  封存投稿
                </Button>
                <Button variant="quiet" onClick={() => setContributing(false)}>
                  取消
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="primary" onClick={() => setContributing(true)}>
              <Icon name="plus" size={16} /> 向胶囊投稿
            </Button>
          )}
        </div>
      ) : null}

      {capsule.contributors.length > 0 ? (
        <div>
          <p class={styles.countdownLabel} style={{ marginBottom: 6 }}>
            贡献者（{capsule.contributors.length}）
          </p>
          <div class={styles.contributorList}>
            {capsule.contributors.map((person) => (
              <span key={person.userId} class={styles.contributor}>
                <Avatar name={person.nickname} src={person.avatarUrl ?? undefined} size={22} seed={person.userId} />
                {person.nickname}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {capsule.visibility === 'recipient' && capsule.recipients.length > 0 ? (
        <div>
          <p class={styles.countdownLabel} style={{ marginBottom: 6 }}>
            接收人（{capsule.recipients.length}）
          </p>
          <div class={styles.contributorList}>
            {capsule.recipients.map((person) => (
              <span key={person.userId} class={styles.contributor}>
                <Avatar name={person.nickname} src={person.avatarUrl ?? undefined} size={22} seed={person.userId} />
                {person.nickname}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {superAdmin ? (
        <div>
          <Button variant="quiet" onClick={() => void delay()} loading={busy}>
            <Icon name="clock" size={16} /> 超级管理员：延后解锁
          </Button>
        </div>
      ) : null}
    </>
  )
}

import { useEffect, useState } from 'preact/hooks'
import { capsuleApi, profileApi } from '../../lib/api'
import type { CapsuleVisibility, FollowUser } from '../../lib/types'
import { AppShell } from '../../components/AppShell'
import { Avatar, Button, Field, Notice, TextArea, TextField } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { navigate } from '../../lib/router'
import { showToast } from '../../lib/toast'
import styles from './capsule.module.css'

const VISIBILITY_OPTIONS: Array<{ value: CapsuleVisibility; title: string; description: string }> = [
  { value: 'class', title: '全班可见', description: '解锁后全班同学都能打开。' },
  { value: 'recipient', title: '指定接收', description: '只有你选择的同学在解锁后能看到。' },
  { value: 'self', title: '只给自己', description: '写给未来的自己，只有你能打开。' },
  { value: 'collaborative', title: '共同创作', description: '在截止前邀请同学一起往里投稿。' },
]

function toLocalInput(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function defaultUnlock(): string {
  const d = new Date()
  d.setMonth(d.getMonth() + 1)
  return toLocalInput(d)
}

export function CapsuleCreatePage(): preact.JSX.Element {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [visibility, setVisibility] = useState<CapsuleVisibility>('class')
  const [unlockAt, setUnlockAt] = useState(defaultUnlock)
  const [contributionDeadline, setContributionDeadline] = useState(defaultUnlock)
  const [recipientIds, setRecipientIds] = useState<string[]>([])
  const [followers, setFollowers] = useState<FollowUser[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (visibility !== 'recipient') return
    void (async () => {
      try {
        const me = await profileApi.me()
        const page = await profileApi.following(me.userId)
        setFollowers(page.items)
      } catch {
        setFollowers([])
      }
    })()
  }, [visibility])

  const toggleRecipient = (userId: string): void => {
    setRecipientIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    )
  }

  const submit = async (): Promise<void> => {
    if (!title.trim()) {
      showToast('请填写胶囊标题。', 'error')
      return
    }
    if (!content.trim() && visibility !== 'collaborative') {
      showToast('写点内容再封存吧。', 'error')
      return
    }
    if (visibility === 'recipient' && recipientIds.length === 0) {
      showToast('请至少选择一位接收人。', 'error')
      return
    }
    if (new Date(unlockAt).getTime() <= Date.now()) {
      showToast('解锁时间需要晚于现在。', 'error')
      return
    }
    setBusy(true)
    try {
      const capsule = await capsuleApi.create({
        title: title.trim(),
        content: content.trim(),
        visibility,
        recipientIds,
        unlockAt: new Date(unlockAt).toISOString(),
        contributionDeadline: new Date(contributionDeadline).toISOString(),
        mediaObjectKeys: [],
      })
      showToast('胶囊已封存。')
      navigate(`/capsules/${capsule.id}`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '创建失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppShell activeKey="capsule" title="新建胶囊">
      <div class={styles.page}>
        <button type="button" class={styles.back} onClick={() => navigate('/capsules')}>
          <Icon name="arrow-left" size={16} /> 返回胶囊列表
        </button>
        <div class={styles.form}>
          <TextField
            label="标题"
            value={title}
            maxLength={40}
            counterMax={40}
            placeholder="给这个胶囊起个名字"
            onInput={(event) => setTitle((event.currentTarget as HTMLInputElement).value)}
          />

          <Field label="可见范围" required>
            <div class={styles.visibilityChoices}>
              {VISIBILITY_OPTIONS.map((option) => (
                <label key={option.value} class={styles.visibilityOption} data-active={visibility === option.value}>
                  <input
                    type="radio"
                    name="visibility"
                    checked={visibility === option.value}
                    onChange={() => setVisibility(option.value)}
                    style={{ accentColor: 'var(--uniform-blue)', marginTop: 3 }}
                  />
                  <span>
                    <span class={styles.optionTitle}>{option.title}</span>
                    <br />
                    <span class={styles.optionDesc}>{option.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </Field>

          {visibility === 'recipient' ? (
            <Field label="接收人" hint="从你关注的同班同学中选择。">
              {followers.length === 0 ? (
                <p class={styles.countdownLabel}>你还没有关注同学，可以先在广场关注。</p>
              ) : (
                <div class={styles.contributorList}>
                  {followers.map((person) => {
                    const active = recipientIds.includes(person.userId)
                    return (
                      <button
                        key={person.userId}
                        type="button"
                        class={styles.contributor}
                        style={active ? { outline: '1.5px solid var(--uniform-blue)' } : undefined}
                        onClick={() => toggleRecipient(person.userId)}
                        aria-pressed={active}
                      >
                        <Avatar name={person.nickname} src={person.avatarUrl ?? undefined} size={22} seed={person.userId} />
                        {person.nickname}
                      </button>
                    )
                  })}
                </div>
              )}
            </Field>
          ) : null}

          <TextArea
            label={visibility === 'collaborative' ? '发起说明' : '胶囊内容'}
            hint="内容会在解锁前封存，到时才能被打开。"
            value={content}
            maxLength={2000}
            counterMax={2000}
            rows={6}
            onInput={(event) => setContent((event.currentTarget as HTMLTextAreaElement).value)}
          />

          <div class={styles.formRow}>
            <TextField
              label="解锁时间"
              type="datetime-local"
              value={unlockAt}
              onInput={(event) => setUnlockAt((event.currentTarget as HTMLInputElement).value)}
            />
            <TextField
              label="投稿截止"
              type="datetime-local"
              value={contributionDeadline}
              onInput={(event) => setContributionDeadline((event.currentTarget as HTMLInputElement).value)}
            />
          </div>

          <Notice tone="info" icon="lock">
            胶囊封存后，在解锁时间到达前谁都无法查看内容。
          </Notice>

          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="primary" onClick={() => void submit()} loading={busy}>
              封存胶囊
            </Button>
            <Button variant="quiet" onClick={() => navigate('/capsules')}>
              取消
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  )
}

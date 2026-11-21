import { useState } from 'preact/hooks'
import { partnerApi } from '../../lib/api'
import type { PartnerKind, PartnerPost } from '../../lib/types'
import { AppShell } from '../../components/AppShell'
import { Button, Field, Notice, TextArea, TextField } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { showToast } from '../../lib/toast'
import { navigate } from '../../lib/router'
import styles from './partner.module.css'

const KINDS: Array<{ key: PartnerKind; label: string }> = [
  { key: 'meal', label: '吃饭' },
  { key: 'study', label: '学习' },
  { key: 'sport', label: '运动' },
  { key: 'entertainment', label: '娱乐' },
  { key: 'travel', label: '出行' },
  { key: 'activity', label: '活动' },
  { key: 'other', label: '其他' },
]

function defaultStartsAt(): string {
  const date = new Date(Date.now() + 60 * 60 * 1000)
  date.setSeconds(0, 0)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

function defaultExpiresAt(): string {
  const date = new Date(Date.now() + 6 * 60 * 60 * 1000)
  date.setSeconds(0, 0)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

export function PartnerCreatePage(): preact.JSX.Element {
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<PartnerKind>('meal')
  const [startsAt, setStartsAt] = useState(defaultStartsAt())
  const [location, setLocation] = useState('')
  const [capacity, setCapacity] = useState(4)
  const [expiresAt, setExpiresAt] = useState(defaultExpiresAt())
  const [description, setDescription] = useState('')
  const [allowWaitlist, setAllowWaitlist] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    if (!title.trim()) {
      setError('请填写搭子标题。')
      return
    }
    if (!location.trim()) {
      setError('请填写集合地点。')
      return
    }
    if (new Date(expiresAt).getTime() <= Date.now()) {
      setError('报名截止时间需要晚于现在。')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const created: PartnerPost = await partnerApi.create({
        title: title.trim(),
        kind,
        startsAt: new Date(startsAt).toISOString(),
        location: location.trim(),
        capacity,
        expiresAt: new Date(expiresAt).toISOString(),
        description: description.trim(),
        allowWaitlist,
      })
      showToast('搭子已发布。')
      navigate(`/partners/${created.id}`, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '发布失败，请重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppShell activeKey="partner" title="发起搭子">
      <div class={styles.page}>
        <button type="button" class={styles.back} onClick={() => navigate('/partners')}>
          <Icon name="arrow-left" size={16} /> 返回搭子
        </button>

        <form
          class={styles.form}
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <TextField
            label="标题"
            value={title}
            maxLength={40}
            counterMax={40}
            required
            placeholder="例如：周三晚上一起去食堂"
            onInput={(event) => setTitle((event.currentTarget as HTMLInputElement).value)}
          />

          <Field label="类型" htmlFor="partner-kind">
            <select
              id="partner-kind"
              class="select"
              value={kind}
              onChange={(event) => setKind((event.currentTarget as HTMLSelectElement).value as PartnerKind)}
            >
              {KINDS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          <div class={styles.formRow}>
            <TextField
              label="开始时间"
              type="datetime-local"
              value={startsAt}
              required
              onInput={(event) => setStartsAt((event.currentTarget as HTMLInputElement).value)}
            />
            <TextField
              label="报名截止"
              type="datetime-local"
              value={expiresAt}
              required
              hint="过了截止时间后自动归档。"
              onInput={(event) => setExpiresAt((event.currentTarget as HTMLInputElement).value)}
            />
          </div>

          <div class={styles.formRow}>
            <TextField
              label="地点"
              value={location}
              maxLength={40}
              required
              placeholder="例如：三食堂二楼"
              onInput={(event) => setLocation((event.currentTarget as HTMLInputElement).value)}
            />
            <Field label="人数上限" htmlFor="partner-capacity" hint="含发起人，2–20 人。">
              <input
                id="partner-capacity"
                class="input"
                type="number"
                min={2}
                max={20}
                value={capacity}
                onInput={(event) => {
                  const value = Number((event.currentTarget as HTMLInputElement).value)
                  setCapacity(Number.isNaN(value) ? 2 : Math.min(20, Math.max(2, value)))
                }}
              />
            </Field>
          </div>

          <TextArea
            label="补充说明"
            value={description}
            maxLength={300}
            counterMax={300}
            rows={4}
            placeholder="想约什么、有什么要求，写清楚更容易找到人。"
            onInput={(event) => setDescription((event.currentTarget as HTMLTextAreaElement).value)}
          />

          <label class={styles.metaRow} style={{ gap: 8, alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={allowWaitlist}
              onChange={(event) => setAllowWaitlist((event.currentTarget as HTMLInputElement).checked)}
              style={{ accentColor: 'var(--uniform-blue)' }}
            />
            人数满了之后允许加入候补
          </label>

          {error ? (
            <Notice tone="danger" icon="alert">
              {error}
            </Notice>
          ) : null}

          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="primary" type="submit" loading={busy}>
              发布搭子
            </Button>
            <Button variant="quiet" onClick={() => navigate('/partners')}>
              取消
            </Button>
          </div>
        </form>
      </div>
    </AppShell>
  )
}

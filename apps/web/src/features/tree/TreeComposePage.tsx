import { useState } from 'preact/hooks'
import { treeApi } from '../../lib/api'
import type { TreePost } from '../../lib/types'
import { AppShell } from '../../components/AppShell'
import { Button, Chip, Field, Notice, TextArea, TextField } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { showToast } from '../../lib/toast'
import { navigate } from '../../lib/router'
import styles from './tree.module.css'

const SUGGESTED_TAGS = ['吐槽', '求助', '表白墙', '学习', '心情', '找搭子', '失物招领']

export function TreeComposePage(): preact.JSX.Element {
  const [content, setContent] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagDraft, setTagDraft] = useState('')
  const [allowBullet, setAllowBullet] = useState(false)
  const [pollEnabled, setPollEnabled] = useState(false)
  const [pollQuestion, setPollQuestion] = useState('')
  const [pollOptions, setPollOptions] = useState<string[]>(['', ''])
  const [pollMultiple, setPollMultiple] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const addTag = (raw: string): void => {
    const tag = raw.trim().replace(/^#/, '')
    if (!tag || tags.includes(tag) || tags.length >= 5) return
    setTags((current) => [...current, tag])
    setTagDraft('')
  }

  const validPoll =
    !pollEnabled ||
    (pollQuestion.trim().length > 0 && pollOptions.filter((option) => option.trim()).length >= 2)

  const submit = async (): Promise<void> => {
    if (!content.trim()) {
      setError('内容不能为空。')
      return
    }
    if (!validPoll) {
      setError('投票至少需要一个问题和一个以上选项。')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const created = await treeApi.create({
        content: content.trim(),
        tags,
        allowBulletScreen: allowBullet,
        poll: pollEnabled
          ? {
              question: pollQuestion.trim(),
              options: pollOptions.map((option) => option.trim()).filter(Boolean),
              multiple: pollMultiple,
            }
          : undefined,
      })
      showToast('已匿名发布。')
      navigate(`/tree/${created.id}`, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '发布失败，请重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppShell activeKey="tree" title="发树洞">
      <div class={styles.page} style={{ maxWidth: 720 }}>
        <button type="button" class={styles.footAction} onClick={() => navigate('/tree')}>
          <Icon name="arrow-left" size={16} /> 返回树洞
        </button>

        <Notice tone="info" icon="eye-off">
          树洞默认匿名，别人只会看到系统分配的马甲。只有总管理员在审计时可查看真实身份。
        </Notice>

        <div class={styles.composer}>
          <TextArea
            label="内容"
            value={content}
            maxLength={2000}
            counterMax={2000}
            rows={8}
            placeholder="想说的话，写在这里。"
            onInput={(event) => setContent((event.currentTarget as HTMLTextAreaElement).value)}
          />

          <div>
            <p class={styles.alias} style={{ marginBottom: 6 }}>
              标签（最多 5 个）
            </p>
            <div class={styles.tagInputRow}>
              {tags.map((tag) => (
                <Chip key={tag} active onClick={() => setTags((current) => current.filter((item) => item !== tag))}>
                  #{tag} ×
                </Chip>
              ))}
              <input
                class="input"
                style={{ maxWidth: 160 }}
                value={tagDraft}
                placeholder="输入后回车"
                maxLength={12}
                onInput={(event) => setTagDraft((event.currentTarget as HTMLInputElement).value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    addTag(tagDraft)
                  }
                }}
              />
            </div>
            <div class={styles.tagInputRow} style={{ marginTop: 8 }}>
              {SUGGESTED_TAGS.filter((tag) => !tags.includes(tag)).map((tag) => (
                <Chip key={tag} onClick={() => addTag(tag)}>
                  #{tag}
                </Chip>
              ))}
            </div>
          </div>

          <label class={styles.switchRow}>
            <button
              type="button"
              class={styles.switch}
              data-on={allowBullet}
              role="switch"
              aria-checked={allowBullet}
              onClick={() => setAllowBullet((value) => !value)}
            >
              <span class={styles.switchKnob} />
            </button>
            允许这条帖子进入弹幕墙
          </label>

          <label class={styles.switchRow}>
            <button
              type="button"
              class={styles.switch}
              data-on={pollEnabled}
              role="switch"
              aria-checked={pollEnabled}
              onClick={() => setPollEnabled((value) => !value)}
            >
              <span class={styles.switchKnob} />
            </button>
            附带投票
          </label>

          {pollEnabled ? (
            <div class={styles.pollEditor}>
              <TextField
                label="投票问题"
                value={pollQuestion}
                maxLength={60}
                counterMax={60}
                onInput={(event) => setPollQuestion((event.currentTarget as HTMLInputElement).value)}
              />
              {pollOptions.map((option, index) => (
                <div key={index} class={styles.pollOptionRow}>
                  <input
                    class="input"
                    value={option}
                    maxLength={40}
                    placeholder={`选项 ${index + 1}`}
                    aria-label={`选项 ${index + 1}`}
                    onInput={(event) => {
                      const value = (event.currentTarget as HTMLInputElement).value
                      setPollOptions((current) => current.map((item, i) => (i === index ? value : item)))
                    }}
                  />
                  {pollOptions.length > 2 ? (
                    <Button
                      size="sm"
                      variant="quiet"
                      iconOnly
                      aria-label="删除选项"
                      onClick={() => setPollOptions((current) => current.filter((_, i) => i !== index))}
                    >
                      <Icon name="close" size={16} />
                    </Button>
                  ) : null}
                </div>
              ))}
              {pollOptions.length < 6 ? (
                <Button size="sm" variant="quiet" onClick={() => setPollOptions((current) => [...current, ''])}>
                  + 添加选项
                </Button>
              ) : null}
              <label class={styles.switchRow}>
                <button
                  type="button"
                  class={styles.switch}
                  data-on={pollMultiple}
                  role="switch"
                  aria-checked={pollMultiple}
                  onClick={() => setPollMultiple((value) => !value)}
                >
                  <span class={styles.switchKnob} />
                </button>
                允许多选
              </label>
            </div>
          ) : null}

          {error ? (
            <Notice tone="danger" icon="alert">
              {error}
            </Notice>
          ) : null}

          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="primary" onClick={() => void submit()} loading={busy}>
              匿名发布
            </Button>
            <Button variant="quiet" onClick={() => navigate('/tree')}>
              取消
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  )
}

import { useState } from 'preact/hooks'
import { treeApi } from '../../lib/api'
import type { TreePost } from '../../lib/types'
import { Avatar, Button, Notice } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { showToast } from '../../lib/toast'
import { formatRelative } from '../../lib/format'
import { navigate } from '../../lib/router'
import { isAdmin } from '../../lib/session'
import { cn } from '../../lib/cn'
import styles from './tree.module.css'

const REPORT_REASONS = [
  { key: 'harassment', label: '人身攻击' },
  { key: 'bullying', label: '欺凌' },
  { key: 'privacy', label: '隐私' },
  { key: 'sexual', label: '色情' },
  { key: 'danger', label: '危险行为' },
  { key: 'spam', label: '垃圾内容' },
  { key: 'other', label: '其他' },
]

const QUICK_REACTIONS = ['👍', '🫂', '💪', '😄', '👀']

export function PostCard({
  post,
  onChanged,
  compact,
}: {
  post: TreePost
  onChanged?: () => void
  compact?: boolean
}): preact.JSX.Element {
  const [reportOpen, setReportOpen] = useState(false)
  const [reactions, setReactions] = useState(post.reactions)
  const [moderating, setModerating] = useState(false)

  const react = async (emoji: string): Promise<void> => {
    try {
      const result = await treeApi.react(post.id, emoji)
      setReactions(result.reactions)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '操作失败', 'error')
    }
  }

  const moderate = async (action: 'hide' | 'collapse'): Promise<void> => {
    if (!isAdmin.value) return
    setModerating(true)
    try {
      const { adminApi } = await import('../../lib/api')
      await adminApi.moderate({
        targetType: 'tree_post',
        targetId: post.id,
        action,
        reason: '',
        showReasonToSubject: false,
        showOperator: false,
      })
      showToast(action === 'hide' ? '已隐藏' : '已折叠')
      onChanged?.()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '操作失败', 'error')
    } finally {
      setModerating(false)
    }
  }

  return (
    <article class={styles.postCard}>
      <div class={styles.postHead}>
        <Avatar name={post.alias} size={26} seed={post.id} />
        <span class={styles.alias}>{post.alias}</span>
        {post.isOp ? <span class={styles.opTag}>楼主</span> : null}
        <span class={styles.postTime}>{formatRelative(post.createdAt)}</span>
      </div>

      {post.moderation ? (
        <div class={styles.moderated}>
          {post.moderation.placeholder}
          {post.moderation.reason ? <div style={{ marginTop: 4 }}>理由：{post.moderation.reason}</div> : null}
          {post.moderation.operatorName ? <div style={{ marginTop: 2 }}>操作：{post.moderation.operatorName}</div> : null}
        </div>
      ) : (
        <>
          {compact ? (
            <button
              type="button"
              class={cn(styles.postContent, styles.postContentLink)}
              onClick={() => navigate(`/tree/${post.id}`)}
            >
              {post.content.length > 120 ? `${post.content.slice(0, 120)}…` : post.content}
            </button>
          ) : (
            <p class={styles.postContent}>{post.content}</p>
          )}

          {post.tags.length > 0 ? (
            <div class={styles.tags}>
              {post.tags.map((tag) => (
                <span key={tag} class={styles.tag}>
                  #{tag}
                </span>
              ))}
            </div>
          ) : null}

          {post.poll ? <PollBlock post={post} onChanged={onChanged} /> : null}
        </>
      )}

      <div class={styles.postFoot}>
        {QUICK_REACTIONS.map((emoji) => {
          const existing = reactions.find((reaction) => reaction.emoji === emoji)
          return (
            <button
              key={emoji}
              type="button"
              class={styles.reactionBtn}
              data-active={existing?.reacted ?? false}
              onClick={() => void react(emoji)}
            >
              <span>{emoji}</span>
              {existing && existing.count > 0 ? <span class="numeral">{existing.count}</span> : null}
            </button>
          )
        })}
        <button type="button" class={styles.footAction} onClick={() => navigate(`/tree/${post.id}`)}>
          <Icon name="message" size={14} /> {post.commentCount}
        </button>
        <button type="button" class={styles.footAction} onClick={() => setReportOpen(true)}>
          <Icon name="flag" size={14} /> 举报
        </button>
      </div>

      {isAdmin.value ? (
        <div class={styles.modBar}>
          <Button size="sm" variant="quiet" onClick={() => void moderate('hide')} loading={moderating}>
            隐藏
          </Button>
          <Button size="sm" variant="quiet" onClick={() => void moderate('collapse')} loading={moderating}>
            折叠
          </Button>
        </div>
      ) : null}

      {reportOpen ? (
        <ReportModal
          targetType="tree_post"
          targetId={post.id}
          onClose={() => setReportOpen(false)}
        />
      ) : null}
    </article>
  )
}

function PollBlock({ post, onChanged }: { post: TreePost; onChanged?: () => void }): preact.JSX.Element {
  const poll = post.poll
  const [voted, setVoted] = useState(poll?.options.some((option) => option.voted) ?? false)
  const [selection, setSelection] = useState<string[]>([])

  if (!poll) return <></>
  const total = poll.totalVotes

  const vote = async (): Promise<void> => {
    if (selection.length === 0) return
    try {
      await treeApi.vote(post.id, selection)
      setVoted(true)
      onChanged?.()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '投票失败', 'error')
    }
  }

  return (
    <div class={styles.poll}>
      <p class={styles.pollQuestion}>{poll.question}</p>
      {poll.options.map((option) => {
        const ratio = total > 0 ? Math.round((option.votes / total) * 100) : 0
        const selected = selection.includes(option.id)
        return (
          <label
            key={option.id}
            class={styles.pollOption}
            style={selected ? { borderColor: 'var(--uniform-blue)' } : undefined}
          >
            {voted ? <span class={styles.pollBar} style={{ width: `${ratio}%` }} /> : null}
            {!voted ? (
              <input
                type={poll.multiple ? 'checkbox' : 'radio'}
                name={`poll-${post.id}`}
                checked={selected}
                onChange={() =>
                  setSelection((current) =>
                    poll.multiple
                      ? current.includes(option.id)
                        ? current.filter((id) => id !== option.id)
                        : [...current, option.id]
                      : [option.id],
                  )
                }
                style={{ accentColor: 'var(--uniform-blue)' }}
              />
            ) : null}
            <span class={styles.pollLabel}>{option.label}</span>
            {voted ? (
              <span class={styles.pollCount}>
                {option.votes} · {ratio}%
              </span>
            ) : null}
          </label>
        )
      })}
      {!voted ? (
        <Button size="sm" variant="primary" onClick={() => void vote()} disabled={selection.length === 0}>
          投票
        </Button>
      ) : (
        <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>共 {total} 票</span>
      )}
    </div>
  )
}

export function ReportModal({
  targetType,
  targetId,
  onClose,
}: {
  targetType: 'tree_post' | 'tree_comment' | 'partner_post' | 'profile' | 'media'
  targetId: string
  onClose: () => void
}): preact.JSX.Element {
  const [reason, setReason] = useState('harassment')
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    setBusy(true)
    try {
      await treeApi.report({ targetType, targetId, reason, details })
      showToast('已提交举报，管理员会处理。')
      onClose()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '举报失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class={styles.modalOverlay} onClick={onClose} role="presentation">
      <div class={styles.modal} role="dialog" aria-modal="true" aria-label="举报内容" onClick={(event) => event.stopPropagation()}>
        <h3 class={styles.modalTitle}>举报</h3>
        <div class={styles.reasonList}>
          {REPORT_REASONS.map((option) => (
            <label key={option.key} class={styles.reasonOption} data-active={reason === option.key}>
              <input
                type="radio"
                name="report-reason"
                checked={reason === option.key}
                onChange={() => setReason(option.key)}
                style={{ accentColor: 'var(--uniform-blue)' }}
              />
              {option.label}
            </label>
          ))}
        </div>
        <textarea
          class="textarea"
          placeholder="补充说明（可选，最多 500 字）"
          maxLength={500}
          value={details}
          onInput={(event) => setDetails((event.currentTarget as HTMLTextAreaElement).value)}
        />
        <Notice tone="info" icon="info">
          举报仅管理员可见，不会向对方透露举报人。
        </Notice>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="primary" onClick={() => void submit()} loading={busy}>
            提交举报
          </Button>
          <Button variant="quiet" onClick={onClose}>
            取消
          </Button>
        </div>
      </div>
    </div>
  )
}

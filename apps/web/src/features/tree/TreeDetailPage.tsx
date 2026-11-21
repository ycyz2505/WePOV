import { useState } from 'preact/hooks'
import { treeApi } from '../../lib/api'
import type { TreeComment, TreePost } from '../../lib/types'
import { AppShell } from '../../components/AppShell'
import { Avatar, Button, Notice, StateBlock, TextArea } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { useAsync, describeError } from '../../lib/useAsync'
import { showToast } from '../../lib/toast'
import { formatRelative } from '../../lib/format'
import { navigate } from '../../lib/router'
import { isSuperAdmin } from '../../lib/session'
import { PostCard, ReportModal } from './PostCard'
import styles from './tree.module.css'

export function TreeDetailPage({ postId }: { postId: string }): preact.JSX.Element {
  const post = useAsync(() => treeApi.get(postId), [postId])
  const comments = useAsync(() => treeApi.comments(postId), [postId])
  const [replyTo, setReplyTo] = useState<TreeComment | null>(null)
  const [revealed, setRevealed] = useState<{ realName: string; studentNumber: string } | null>(null)

  const data: TreePost | null = post.state.status === 'success' ? post.state.data : null

  const reveal = async (): Promise<void> => {
    try {
      const result = await treeApi.revealIdentity(postId)
      setRevealed({ realName: result.realName, studentNumber: result.studentNumber })
    } catch (error) {
      showToast(error instanceof Error ? error.message : '无法查看', 'error')
    }
  }

  return (
    <AppShell activeKey="tree" title="树洞帖子">
      <div class={styles.page}>
        <button type="button" class={styles.footAction} onClick={() => navigate('/tree')}>
          <Icon name="arrow-left" size={16} /> 返回树洞
        </button>

        {post.state.status === 'loading' ? <p class={styles.postContent}>加载中…</p> : null}
        {post.state.status === 'error' ? (
          <StateBlock icon="alert" title={describeError(post.state.error).title} body={describeError(post.state.error).detail} tone="danger">
            <Button variant="quiet" onClick={post.reload}>
              重试
            </Button>
          </StateBlock>
        ) : null}

        {data ? (
          <>
            <PostCard post={data} onChanged={post.reload} />

            {isSuperAdmin.value ? (
              <div class={styles.revealBox}>
                {revealed ? (
                  <>
                    <strong>真实身份：</strong>
                    {revealed.realName}（学号 {revealed.studentNumber}）
                    <p style={{ marginTop: 4, color: 'var(--ink-muted)' }}>
                      查看身份会写入审计日志，仅总管理员可用。
                    </p>
                  </>
                ) : (
                  <Button size="sm" variant="quiet" onClick={() => void reveal()}>
                    <Icon name="eye" size={16} /> 查看发帖人身份（总管理员）
                  </Button>
                )}
              </div>
            ) : null}

            <h2 class={styles.headTitle}>评论 {data.commentCount}</h2>

            <CommentComposer postId={postId} parent={replyTo} onPosted={() => {
              setReplyTo(null)
              comments.reload()
              post.reload()
            }} onCancelReply={() => setReplyTo(null)} />

            {comments.state.status === 'loading' ? <p class={styles.postTime}>加载评论…</p> : null}
            {comments.state.status === 'error' ? (
              <p class={styles.moderated}>评论加载失败，{describeError(comments.state.error).detail}</p>
            ) : null}
            {comments.state.status === 'success' ? (
              comments.state.data.items.length === 0 ? (
                <p class={styles.moderated}>还没有评论，来做第一个回应的人。</p>
              ) : (
                <div class={styles.comments}>
                  {comments.state.data.items.map((comment) => (
                    <CommentRow
                      key={comment.id}
                      comment={comment}
                      onReply={() => setReplyTo(comment)}
                      onChanged={comments.reload}
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

function CommentComposer({
  postId,
  parent,
  onPosted,
  onCancelReply,
}: {
  postId: string
  parent: TreeComment | null
  onPosted: () => void
  onCancelReply: () => void
}): preact.JSX.Element {
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    if (!content.trim()) return
    setBusy(true)
    try {
      await treeApi.comment(postId, { content: content.trim(), parentCommentId: parent?.id ?? null })
      setContent('')
      onPosted()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '评论失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class={styles.composer}>
      {parent ? (
        <Notice tone="info" icon="message">
          正在回复 {parent.alias}
          <button type="button" class={styles.footAction} style={{ marginLeft: 8 }} onClick={onCancelReply}>
            取消
          </button>
        </Notice>
      ) : null}
      <TextArea
        label="匿名评论"
        value={content}
        maxLength={300}
        counterMax={300}
        rows={3}
        placeholder="友善地回应，别人也在认真生活。"
        onInput={(event) => setContent((event.currentTarget as HTMLTextAreaElement).value)}
      />
      <div>
        <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={!content.trim()}>
          发送
        </Button>
      </div>
    </div>
  )
}

function CommentRow({
  comment,
  onReply,
  onChanged,
}: {
  comment: TreeComment
  onReply: () => void
  onChanged: () => void
}): preact.JSX.Element {
  const [reportOpen, setReportOpen] = useState(false)

  return (
    <div class={styles.comment}>
      <Avatar name={comment.alias} size={30} seed={comment.id} />
      <div class={styles.commentBody}>
        <div class={styles.commentHead}>
          <span class={styles.alias}>{comment.alias}</span>
          {comment.isOp ? <span class={styles.opTag}>楼主</span> : null}
          <span class={styles.postTime}>{formatRelative(comment.createdAt)}</span>
        </div>
        {comment.moderation ? (
          <p class={styles.moderated}>{comment.moderation.placeholder}</p>
        ) : (
          <p class={styles.commentText}>{comment.content}</p>
        )}
        <div class={styles.commentActions}>
          {!comment.moderation ? (
            <button type="button" class={styles.footAction} onClick={onReply}>
              回复
            </button>
          ) : null}
          <button type="button" class={styles.footAction} onClick={() => setReportOpen(true)}>
            举报
          </button>
          {comment.isMine ? (
            <button
              type="button"
              class={styles.footAction}
              onClick={() => {
                void treeApi
                  .remove(comment.id)
                  .then(onChanged)
                  .catch(() => showToast('删除失败', 'error'))
              }}
            >
              删除
            </button>
          ) : null}
        </div>
      </div>
      {reportOpen ? (
        <ReportModal targetType="tree_comment" targetId={comment.id} onClose={() => setReportOpen(false)} />
      ) : null}
    </div>
  )
}

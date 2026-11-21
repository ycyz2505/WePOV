import { useState } from 'preact/hooks'
import { adminApi } from '../../lib/api'
import type { AdminReport, AlbumReviewItem } from '../../lib/types'
import { AppShell } from '../../components/AppShell'
import { Badge, Button, Field, Notice, StateBlock, TextArea, TextField } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { useAsync, describeError } from '../../lib/useAsync'
import { formatRelative } from '../../lib/format'
import { showToast } from '../../lib/toast'
import { navigate } from '../../lib/router'
import styles from './admin.module.css'

type ModTab = 'reports' | 'album'

const REASON_LABELS: Record<string, string> = {
  harassment: '骚扰',
  bullying: '霸凌',
  privacy: '隐私',
  sexual: '色情',
  danger: '危险',
  spam: '垃圾信息',
  other: '其他',
}

export function AdminModerationPage(): preact.JSX.Element {
  const [tab, setTab] = useState<ModTab>('reports')

  return (
    <AppShell activeKey="admin" title="审核队列">
      <div class={styles.page}>
        <div class={styles.headRow}>
          <h1 class={styles.headTitle}>审核队列</h1>
          <Button variant="quiet" onClick={() => navigate('/admin')}>
            <Icon name="arrow-left" size={16} /> 返回管理首页
          </Button>
        </div>
        <div class={styles.subtabs} role="tablist">
          <button
            type="button"
            class={`${styles.subtab} ${tab === 'reports' ? styles.subtabActive : ''}`}
            role="tab"
            aria-selected={tab === 'reports'}
            onClick={() => setTab('reports')}
          >
            举报队列
          </button>
          <button
            type="button"
            class={`${styles.subtab} ${tab === 'album' ? styles.subtabActive : ''}`}
            role="tab"
            aria-selected={tab === 'album'}
            onClick={() => setTab('album')}
          >
            相册审核
          </button>
        </div>
        {tab === 'reports' ? <ReportsPanel /> : <AlbumQueuePanel />}
      </div>
    </AppShell>
  )
}

function ReportsPanel(): preact.JSX.Element {
  const reports = useAsync(() => adminApi.reports({ status: 'open' }), [])

  return (
    <>
      {reports.state.status === 'loading' ? <p class={styles.rowText}>加载中…</p> : null}
      {reports.state.status === 'error' ? (
        <StateBlock icon="alert" title={describeError(reports.state.error).title} body={describeError(reports.state.error).detail} tone="danger">
          <Button variant="quiet" onClick={reports.reload}>
            重试
          </Button>
        </StateBlock>
      ) : null}
      {reports.state.status === 'success' && reports.state.data.items.length === 0 ? (
        <StateBlock icon="check" title="没有待处理的举报" body="所有举报都已经处理完毕。" />
      ) : null}
      {reports.state.status === 'success' && reports.state.data.items.length > 0 ? (
        <div class={styles.section}>
          {reports.state.data.items.map((report) => (
            <ReportRow key={report.id} report={report} onDone={reports.reload} />
          ))}
        </div>
      ) : null}
    </>
  )
}

function ReportRow({ report, onDone }: { report: AdminReport; onDone: () => void }): preact.JSX.Element {
  const [expanded, setExpanded] = useState(false)

  return (
    <div class={styles.row}>
      <div class={styles.rowBody}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span class={styles.rowTitle}>{REASON_LABELS[report.reason] ?? report.reason}</span>
          <Badge tone="sunset">{report.targetType}</Badge>
          <span class={styles.rowMeta}>{formatRelative(report.createdAt)}</span>
        </div>
        <span class={styles.rowText}>{report.preview}</span>
        {report.details ? <span class={styles.rowText}>补充：{report.details}</span> : null}
        <span class={styles.rowMeta}>举报人：{report.reporterNickname ?? '匿名'}</span>
      </div>
      <div class={styles.rowActions}>
        <Button size="sm" variant="quiet" onClick={() => setExpanded((value) => !value)}>
          {expanded ? '收起' : '处理'}
        </Button>
      </div>
      {expanded ? (
        <ModerationForm
          targetType={report.targetType}
          targetId={report.targetId}
          onDone={() => {
            setExpanded(false)
            onDone()
          }}
        />
      ) : null}
    </div>
  )
}

function ModerationForm({
  targetType,
  targetId,
  onDone,
}: {
  targetType: string
  targetId: string
  onDone: () => void
}): preact.JSX.Element {
  const [action, setAction] = useState<'hide' | 'remove' | 'collapse' | 'restore' | 'mute' | 'unmute'>('hide')
  const [reason, setReason] = useState('')
  const [showReason, setShowReason] = useState(false)
  const [showOperator, setShowOperator] = useState(false)
  const [duration, setDuration] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    setBusy(true)
    try {
      await adminApi.moderate({
        targetType,
        targetId,
        action,
        reason: reason.trim(),
        showReasonToSubject: showReason,
        showOperator,
        ...(action === 'mute' && duration ? { durationMinutes: Number(duration) } : {}),
      })
      showToast('处理完成。')
      onDone()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '操作失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ flexBasis: '100%', display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 8 }}>
      <div class={styles.filterRow}>
        <Field label="处理方式">
          <select
            value={action}
            onChange={(event) => setAction((event.currentTarget as HTMLSelectElement).value as typeof action)}
            style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--desk)', background: 'var(--paper-raised)', color: 'var(--ink)' }}
          >
            <option value="hide">隐藏</option>
            <option value="remove">删除</option>
            <option value="collapse">折叠</option>
            <option value="restore">恢复</option>
            <option value="mute">禁言</option>
            <option value="unmute">解除禁言</option>
          </select>
        </Field>
        {action === 'mute' ? (
          <TextField
            label="禁言时长（分钟）"
            type="number"
            value={duration}
            placeholder="例如 1440"
            onInput={(event) => setDuration((event.currentTarget as HTMLInputElement).value)}
          />
        ) : null}
      </div>
      <TextArea
        label="处理理由"
        value={reason}
        maxLength={500}
        counterMax={500}
        rows={2}
        onInput={(event) => setReason((event.currentTarget as HTMLTextAreaElement).value)}
      />
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
          <input type="checkbox" checked={showReason} onChange={(event) => setShowReason((event.currentTarget as HTMLInputElement).checked)} />
          向被处理人展示理由
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
          <input type="checkbox" checked={showOperator} onChange={(event) => setShowOperator((event.currentTarget as HTMLInputElement).checked)} />
          向被处理人展示操作人
        </label>
      </div>
      <div>
        <Button variant="primary" onClick={() => void submit()} loading={busy}>
          确认处理
        </Button>
      </div>
    </div>
  )
}

function AlbumQueuePanel(): preact.JSX.Element {
  const queue = useAsync(() => adminApi.albumQueue(), [])

  const decide = async (item: AlbumReviewItem, decision: 'approve' | 'reject'): Promise<void> => {
    try {
      await adminApi.albumDecide(item.id, decision)
      showToast(decision === 'approve' ? '已通过。' : '已驳回。')
      queue.reload()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '操作失败', 'error')
    }
  }

  const typeLabel: Record<AlbumReviewItem['type'], string> = {
    media_delete: '删除照片',
    folder_move: '移动文件夹',
    folder_delete: '删除文件夹',
  }

  return (
    <>
      {queue.state.status === 'loading' ? <p class={styles.rowText}>加载中…</p> : null}
      {queue.state.status === 'error' ? (
        <StateBlock icon="alert" title={describeError(queue.state.error).title} body={describeError(queue.state.error).detail} tone="danger">
          <Button variant="quiet" onClick={queue.reload}>
            重试
          </Button>
        </StateBlock>
      ) : null}
      {queue.state.status === 'success' && queue.state.data.items.length === 0 ? (
        <StateBlock icon="check" title="相册没有待审核的申请" body="照片删除和文件夹修改申请都会出现在这里。" />
      ) : null}
      {queue.state.status === 'success' && queue.state.data.items.length > 0 ? (
        <div class={styles.section}>
          <Notice tone="info" icon="info">
            通过删除申请后照片会从相册移除；通过文件夹修改会执行对应操作。
          </Notice>
          {queue.state.data.items.map((item) => (
            <div key={item.id} class={styles.row}>
              <div class={styles.rowBody}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Badge tone="sunset">{typeLabel[item.type]}</Badge>
                  <span class={styles.rowTitle}>{item.targetName}</span>
                  <span class={styles.rowMeta}>{formatRelative(item.createdAt)}</span>
                </div>
                <span class={styles.rowText}>申请人：{item.subjectNickname} · 理由：{item.reason}</span>
              </div>
              <div class={styles.rowActions}>
                <Button size="sm" variant="primary" onClick={() => void decide(item, 'approve')}>
                  通过
                </Button>
                <Button size="sm" variant="quiet" onClick={() => void decide(item, 'reject')}>
                  驳回
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </>
  )
}

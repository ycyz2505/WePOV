import { useState } from 'preact/hooks'
import { adminApi } from '../../lib/api'
import type { LogEntry, SemanticEvent, TrafficStats } from '../../lib/types'
import { AppShell } from '../../components/AppShell'
import { Button, Chip, StateBlock, TextField } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { useAsync, describeError } from '../../lib/useAsync'
import { formatBytes, formatDateTime, formatRelative } from '../../lib/format'
import { navigate } from '../../lib/router'
import styles from './admin.module.css'

type LogTab = 'traffic' | 'http' | 'semantic'

const RANGES: Array<{ key: TrafficStats['range']; label: string }> = [
  { key: 'today', label: '今日' },
  { key: '7d', label: '7 天' },
  { key: '30d', label: '30 天' },
]

export function AdminLogsPage(): preact.JSX.Element {
  const [tab, setTab] = useState<LogTab>('traffic')

  return (
    <AppShell activeKey="admin" title="日志与统计">
      <div class={styles.page}>
        <div class={styles.headRow}>
          <h1 class={styles.headTitle}>日志与统计</h1>
          <Button variant="quiet" onClick={() => navigate('/admin')}>
            <Icon name="arrow-left" size={16} /> 返回管理首页
          </Button>
        </div>
        <div class={styles.subtabs} role="tablist">
          <button type="button" class={`${styles.subtab} ${tab === 'traffic' ? styles.subtabActive : ''}`} role="tab" aria-selected={tab === 'traffic'} onClick={() => setTab('traffic')}>
            流量统计
          </button>
          <button type="button" class={`${styles.subtab} ${tab === 'http' ? styles.subtabActive : ''}`} role="tab" aria-selected={tab === 'http'} onClick={() => setTab('http')}>
            HTTP 日志
          </button>
          <button type="button" class={`${styles.subtab} ${tab === 'semantic' ? styles.subtabActive : ''}`} role="tab" aria-selected={tab === 'semantic'} onClick={() => setTab('semantic')}>
            语义事件
          </button>
        </div>
        {tab === 'traffic' ? <TrafficPanel /> : null}
        {tab === 'http' ? <HttpLogPanel /> : null}
        {tab === 'semantic' ? <SemanticPanel /> : null}
      </div>
    </AppShell>
  )
}

function TrafficPanel(): preact.JSX.Element {
  const [range, setRange] = useState<TrafficStats['range']>('today')
  const traffic = useAsync(() => adminApi.traffic(range), [range])

  return (
    <>
      <div class={styles.rangeRow}>
        {RANGES.map((option) => (
          <Chip key={option.key} active={range === option.key} onClick={() => setRange(option.key)}>
            {option.label}
          </Chip>
        ))}
      </div>
      {traffic.state.status === 'loading' ? <p class={styles.rowText}>加载中…</p> : null}
      {traffic.state.status === 'error' ? (
        <StateBlock icon="alert" title={describeError(traffic.state.error).title} body={describeError(traffic.state.error).detail} tone="danger">
          <Button variant="quiet" onClick={traffic.reload}>
            重试
          </Button>
        </StateBlock>
      ) : null}
      {traffic.state.status === 'success' ? (
        <>
          <div class={styles.statGrid}>
            <Stat label="访问量 PV" value={traffic.state.data.pv} />
            <Stat label="独立访客 UV" value={traffic.state.data.uv} />
            <Stat label="活跃账号" value={traffic.state.data.activeUsers} />
            <Stat label="峰值 QPS" value={traffic.state.data.peakQps} />
            <Stat label="p50 延迟" value={`${traffic.state.data.p50Ms}ms`} />
            <Stat label="p95 延迟" value={`${traffic.state.data.p95Ms}ms`} />
            <Stat label="错误率" value={`${(traffic.state.data.errorRate * 100).toFixed(1)}%`} danger={traffic.state.data.errorRate > 0.02} />
            <Stat label="登录失败" value={traffic.state.data.loginFailures} danger={traffic.state.data.loginFailures > 0} />
            <Stat label="限流次数" value={traffic.state.data.throttled} />
            <Stat label="存储增长" value={formatBytes(traffic.state.data.storageGrowthBytes)} />
            <Stat label="管理操作" value={traffic.state.data.moderationActions} />
            <Stat label="匿名追溯" value={traffic.state.data.identityReveals} />
          </div>
          {traffic.state.data.moduleUsage.length > 0 ? (
            <div class={styles.section}>
              <span class={styles.sectionTitle}>模块使用分布</span>
              {traffic.state.data.moduleUsage.map((usage) => (
                <div key={usage.module} class={styles.row} style={{ padding: '6px 0' }}>
                  <span class={styles.rowBody}>{usage.module}</span>
                  <span class={styles.rowMeta}>{usage.count}</span>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </>
  )
}

function Stat({ label, value, danger }: { label: string; value: string | number; danger?: boolean }): preact.JSX.Element {
  return (
    <div class={styles.stat}>
      <span class={styles.statLabel}>{label}</span>
      <span class={`${styles.statValue} ${danger ? styles.statValueDanger : ''}`}>{value}</span>
    </div>
  )
}

function HttpLogPanel(): preact.JSX.Element {
  const [route, setRoute] = useState('')
  const [status, setStatus] = useState('')
  const [requestId, setRequestId] = useState('')
  const [query, setQuery] = useState<{ route?: string; status?: string; requestId?: string }>({})
  const logs = useAsync(() => adminApi.logs(query), [query])

  const applyFilters = (): void => {
    setQuery({
      ...(route.trim() ? { route: route.trim() } : {}),
      ...(status.trim() ? { status: status.trim() } : {}),
      ...(requestId.trim() ? { requestId: requestId.trim() } : {}),
    })
  }

  return (
    <>
      <div class={styles.filterRow}>
        <TextField label="路由" value={route} placeholder="/api/v1/..." onInput={(event) => setRoute((event.currentTarget as HTMLInputElement).value)} />
        <TextField label="状态码" value={status} placeholder="如 500" onInput={(event) => setStatus((event.currentTarget as HTMLInputElement).value)} />
        <TextField label="请求 ID" value={requestId} onInput={(event) => setRequestId((event.currentTarget as HTMLInputElement).value)} />
        <Button variant="quiet" onClick={applyFilters}>
          筛选
        </Button>
      </div>
      {logs.state.status === 'loading' ? <p class={styles.rowText}>加载中…</p> : null}
      {logs.state.status === 'error' ? (
        <StateBlock icon="alert" title={describeError(logs.state.error).title} body={describeError(logs.state.error).detail} tone="danger">
          <Button variant="quiet" onClick={logs.reload}>
            重试
          </Button>
        </StateBlock>
      ) : null}
      {logs.state.status === 'success' && logs.state.data.items.length === 0 ? (
        <StateBlock icon="list" title="没有匹配的请求日志" body="调整筛选条件再试试。" />
      ) : null}
      {logs.state.status === 'success' && logs.state.data.items.length > 0 ? (
        <div class={styles.section}>
          {logs.state.data.items.map((entry) => (
            <HttpLogRow key={entry.id} entry={entry} />
          ))}
        </div>
      ) : null}
    </>
  )
}

function HttpLogRow({ entry }: { entry: LogEntry }): preact.JSX.Element {
  const ok = entry.status < 400
  return (
    <div class={styles.logRow}>
      <span class={`${styles.logStatus} ${ok ? styles.logStatusOk : styles.logStatusErr}`}>{entry.status}</span>
      <span class={styles.logRoute} title={`${entry.method} ${entry.route}`}>
        {entry.method} {entry.route}
      </span>
      <span class={styles.logMeta}>{entry.durationMs}ms</span>
      <span class={styles.logMeta}>{formatBytes(entry.responseBytes)}</span>
      <span class={styles.logMeta} title={entry.requestId}>
        {entry.accountSummary ?? '匿名'}
      </span>
      <span class={styles.logMeta}>{formatRelative(entry.at)}</span>
    </div>
  )
}

function SemanticPanel(): preact.JSX.Element {
  const [kind, setKind] = useState('')
  const [query, setQuery] = useState<{ kind?: string }>({})
  const events = useAsync(() => adminApi.semantic(query), [query])

  return (
    <>
      <div class={styles.filterRow}>
        <TextField label="事件类型" value={kind} placeholder="如 login、upload" onInput={(event) => setKind((event.currentTarget as HTMLInputElement).value)} />
        <Button variant="quiet" onClick={() => setQuery(kind.trim() ? { kind: kind.trim() } : {})}>
          筛选
        </Button>
      </div>
      {events.state.status === 'loading' ? <p class={styles.rowText}>加载中…</p> : null}
      {events.state.status === 'error' ? (
        <StateBlock icon="alert" title={describeError(events.state.error).title} body={describeError(events.state.error).detail} tone="danger">
          <Button variant="quiet" onClick={events.reload}>
            重试
          </Button>
        </StateBlock>
      ) : null}
      {events.state.status === 'success' && events.state.data.items.length === 0 ? (
        <StateBlock icon="list" title="没有语义事件" body="登录、上传、审核等业务操作会记录在这里。" />
      ) : null}
      {events.state.status === 'success' && events.state.data.items.length > 0 ? (
        <div class={styles.section}>
          {events.state.data.items.map((event) => (
            <SemanticRow key={event.id} event={event} />
          ))}
        </div>
      ) : null}
    </>
  )
}

function SemanticRow({ event }: { event: SemanticEvent }): preact.JSX.Element {
  return (
    <div class={styles.row} style={{ padding: '8px 0' }}>
      <div class={styles.rowBody}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span class={styles.rowTitle}>{event.kind}</span>
          <span class={styles.rowMeta}>{formatDateTime(event.at)}</span>
        </div>
        <span class={styles.rowText}>
          {event.actorSummary} → {event.targetSummary}
          {event.detail ? ` · ${event.detail}` : ''}
        </span>
      </div>
    </div>
  )
}

import { useState } from 'preact/hooks'
import { adminApi } from '../../lib/api'
import type { AppVersionPolicy } from '../../lib/types'
import { AppShell } from '../../components/AppShell'
import { Badge, Button, Notice, StateBlock, TextArea, TextField } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { useAsync, describeError } from '../../lib/useAsync'
import { formatDateTime } from '../../lib/format'
import { showToast } from '../../lib/toast'
import { navigate } from '../../lib/router'
import styles from './admin.module.css'

export function AdminSecurityPage(): preact.JSX.Element {
  const security = useAsync(() => adminApi.security(), [])
  const version = useAsync(() => adminApi.versionPolicy(), [])

  const exportData = async (): Promise<void> => {
    try {
      const outcome = await adminApi.exportData()
      showToast('导出已生成。')
      window.open(outcome.url, '_blank', 'noopener')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '导出失败', 'error')
    }
  }

  return (
    <AppShell activeKey="admin" title="安全设置">
      <div class={styles.page}>
        <div class={styles.headRow}>
          <h1 class={styles.headTitle}>安全设置</h1>
          <Button variant="quiet" onClick={() => navigate('/admin')}>
            <Icon name="arrow-left" size={16} /> 返回管理首页
          </Button>
        </div>

        <div class={styles.section}>
          <span class={styles.sectionTitle}>会话与告警</span>
          {security.state.status === 'loading' ? <p class={styles.rowText}>加载中…</p> : null}
          {security.state.status === 'error' ? (
            <StateBlock icon="alert" title={describeError(security.state.error).title} body={describeError(security.state.error).detail} tone="danger">
              <Button variant="quiet" onClick={security.reload}>
                重试
              </Button>
            </StateBlock>
          ) : null}
          {security.state.status === 'success' ? (
            <>
              <div class={styles.statGrid}>
                <div class={styles.stat}>
                  <span class={styles.statLabel}>活跃会话</span>
                  <span class={styles.statValue}>{security.state.data.activeSessionCount}</span>
                </div>
                <div class={styles.stat}>
                  <span class={styles.statLabel}>异常会话</span>
                  <span class={`${styles.statValue} ${security.state.data.abnormalSessionCount > 0 ? styles.statValueDanger : ''}`}>
                    {security.state.data.abnormalSessionCount}
                  </span>
                </div>
              </div>
              {security.state.data.classPasscodeRotatedAt ? (
                <p class={styles.rowMeta}>班级口令上次更换：{formatDateTime(security.state.data.classPasscodeRotatedAt)}</p>
              ) : null}
              {security.state.data.alerts.length > 0 ? (
                <div>
                  <p class={styles.rowText}>安全告警</p>
                  {security.state.data.alerts.map((alert) => (
                    <div key={alert.id} class={styles.row} style={{ padding: '6px 0' }}>
                      <div class={styles.rowBody}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <Badge tone={alert.level === 'critical' ? 'danger' : alert.level === 'warn' ? 'sunset' : 'default'}>
                            {alert.level}
                          </Badge>
                          <span class={styles.rowText}>{alert.message}</span>
                        </div>
                        <span class={styles.rowMeta}>{formatDateTime(alert.at)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p class={styles.rowText}>当前没有安全告警。</p>
              )}
            </>
          ) : null}
        </div>

        <div class={styles.section}>
          <span class={styles.sectionTitle}>数据导出</span>
          <Notice tone="info" icon="info">
            导出会生成一个临时下载链接，包含名单、内容与统计。查看和导出日志本身都会记入不可删除的审计。
          </Notice>
          <div>
            <Button variant="quiet" onClick={() => void exportData()}>
              <Icon name="download" size={16} /> 生成导出包
            </Button>
          </div>
        </div>

        <div class={styles.section}>
          <span class={styles.sectionTitle}>App 版本策略</span>
          <p class={styles.rowText}>低于最低支持版本的客户端会被强制要求更新。</p>
          {version.state.status === 'loading' ? <p class={styles.rowText}>加载中…</p> : null}
          {version.state.status === 'error' ? (
            <StateBlock icon="alert" title={describeError(version.state.error).title} body={describeError(version.state.error).detail} tone="danger">
              <Button variant="quiet" onClick={version.reload}>
                重试
              </Button>
            </StateBlock>
          ) : null}
          {version.state.status === 'success' ? (
            <VersionPolicyForm
              key={`${version.state.data.latestVersionCode}-${version.state.data.minSupportedVersionCode}`}
              policy={version.state.data}
              onSaved={version.reload}
            />
          ) : null}
        </div>
      </div>
    </AppShell>
  )
}

function VersionPolicyForm({ policy, onSaved }: { policy: AppVersionPolicy; onSaved: () => void }): preact.JSX.Element {
  const [minCode, setMinCode] = useState(policy.minSupportedVersionCode)
  const [latestName, setLatestName] = useState(policy.latestVersionName)
  const [latestCode, setLatestCode] = useState(policy.latestVersionCode)
  const [notes, setNotes] = useState(policy.notes)
  const [busy, setBusy] = useState(false)

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await adminApi.updateVersionPolicy({
        minSupportedVersionCode: minCode,
        latestVersionName: latestName.trim(),
        latestVersionCode: latestCode,
        notes: notes.trim(),
      })
      showToast('版本策略已更新。')
      onSaved()
    } catch (err) {
      showToast(err instanceof Error ? err.message : '保存失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div class={styles.formRow}>
        <TextField
          label="最低支持版本号（code）"
          type="number"
          value={String(minCode)}
          onInput={(event) => setMinCode(Number((event.currentTarget as HTMLInputElement).value))}
        />
        <TextField
          label="最新版本名"
          value={latestName}
          onInput={(event) => setLatestName((event.currentTarget as HTMLInputElement).value)}
        />
      </div>
      <TextField
        label="最新版本号（code）"
        type="number"
        value={String(latestCode)}
        onInput={(event) => setLatestCode(Number((event.currentTarget as HTMLInputElement).value))}
      />
      <TextArea
        label="更新说明"
        value={notes}
        maxLength={500}
        counterMax={500}
        rows={3}
        onInput={(event) => setNotes((event.currentTarget as HTMLTextAreaElement).value)}
      />
      <div>
        <Button variant="primary" onClick={() => void save()} loading={busy}>
          保存版本策略
        </Button>
      </div>
    </>
  )
}

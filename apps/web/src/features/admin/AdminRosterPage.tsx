import { useState } from 'preact/hooks'
import { adminApi } from '../../lib/api'
import type { AdminUser, RosterImportResult } from '../../lib/types'
import { AppShell } from '../../components/AppShell'
import { Badge, Button, Notice, StateBlock } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { useAsync, describeError } from '../../lib/useAsync'
import { showToast } from '../../lib/toast'
import { navigate } from '../../lib/router'
import { parseRosterCsv } from './rosterCsv'
import styles from './admin.module.css'

const ROLE_LABELS: Record<AdminUser['role'], string> = {
  student: '学生',
  general_admin: '一般管理员',
  super_admin: '超级管理员',
}

export function AdminRosterPage(): preact.JSX.Element {
  const roster = useAsync(() => adminApi.roster(), [])
  const [csv, setCsv] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<RosterImportResult | null>(null)

  const parsed = csv.trim() ? parseRosterCsv(csv) : null

  const runImport = async (): Promise<void> => {
    if (!csv.trim()) {
      showToast('请先粘贴或选择名单内容。', 'error')
      return
    }
    if (parsed && parsed.duplicateNicknames.length > 0) {
      showToast(`昵称重复：${parsed.duplicateNicknames.slice(0, 3).join('、')}，请先修正。`, 'error')
      return
    }
    setImporting(true)
    setResult(null)
    try {
      const outcome = await adminApi.importRoster(csv)
      setResult(outcome)
      if (outcome.errors.length === 0) {
        showToast(`导入完成：新增 ${outcome.created}，更新 ${outcome.updated}，跳过 ${outcome.skipped}。`)
        setCsv('')
      } else {
        showToast(`导入完成，但有 ${outcome.errors.length} 行需要处理。`, 'error')
      }
      roster.reload()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '导入失败', 'error')
    } finally {
      setImporting(false)
    }
  }

  const onFile = async (file: File): Promise<void> => {
    const text = await file.text()
    setCsv(text)
  }

  const updateRole = async (user: AdminUser, role: AdminUser['role']): Promise<void> => {
    try {
      await adminApi.updateRole(user.id, role)
      showToast('角色已更新。')
      roster.reload()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '操作失败', 'error')
    }
  }

  const toggleHidden = async (user: AdminUser): Promise<void> => {
    try {
      await adminApi.hideUser(user.id, !user.hidden)
      showToast(user.hidden ? '已恢复展示。' : '已从广场隐藏。')
      roster.reload()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '操作失败', 'error')
    }
  }

  const resetPassword = async (user: AdminUser): Promise<void> => {
    if (!window.confirm(`重置 ${user.realName} 的密码？对方下次登录需要修改密码。`)) return
    try {
      const outcome = await adminApi.resetPassword(user.id)
      showToast(`新初始密码：${outcome.initialPassword}（只显示这一次，请尽快转交）`)
      roster.reload()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '操作失败', 'error')
    }
  }

  return (
    <AppShell activeKey="admin" title="名单与账号">
      <div class={styles.page}>
        <div class={styles.headRow}>
          <h1 class={styles.headTitle}>名单与账号</h1>
          <Button variant="quiet" onClick={() => navigate('/admin')}>
            <Icon name="arrow-left" size={16} /> 返回管理首页
          </Button>
        </div>

        <div class={styles.section}>
          <span class={styles.sectionTitle}>导入名单</span>
          <Notice tone="info" icon="info">
            字段顺序：学号,真实姓名,性别,昵称,初始密码。支持逗号、中文逗号、制表符、引号、BOM 和 # 注释行。昵称必须全站唯一。
          </Notice>
          <label class={styles.rowText} style={{ cursor: 'pointer' }}>
            <input
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              hidden
              onChange={(event) => {
                const file = (event.currentTarget as HTMLInputElement).files?.[0]
                if (file) void onFile(file)
              }}
            />
            <span style={{ color: 'var(--uniform-blue)' }}>选择 CSV 文件</span>
          </label>
          <textarea
            class={styles.csvBox}
            value={csv}
            placeholder={'# 可选注释\n20240101,张三,男,小张,abc12345\n20240102,李四,女,小李,'}
            onInput={(event) => setCsv((event.currentTarget as HTMLTextAreaElement).value)}
          />
          {parsed ? (
            <p class={styles.rowText}>
              已解析 {parsed.rows.length} 行
              {parsed.issues.length > 0 ? `，${parsed.issues.length} 个提醒` : ''}
              {parsed.duplicateNicknames.length > 0 ? `，重复昵称：${parsed.duplicateNicknames.join('、')}` : ''}
            </p>
          ) : null}
          {parsed && parsed.issues.length > 0 ? (
            <ul class={styles.errorList}>
              {parsed.issues.slice(0, 8).map((issue) => (
                <li key={`${issue.line}-${issue.message}`}>
                  第 {issue.line} 行：{issue.message}
                </li>
              ))}
            </ul>
          ) : null}
          <div>
            <Button variant="primary" onClick={() => void runImport()} loading={importing}>
              开始导入
            </Button>
          </div>
          {result ? <ImportResult result={result} /> : null}
        </div>

        <div class={styles.headRow}>
          <span class={styles.sectionTitle}>全部成员</span>
        </div>
        {roster.state.status === 'loading' ? <p class={styles.rowText}>加载中…</p> : null}
        {roster.state.status === 'error' ? (
          <StateBlock icon="alert" title={describeError(roster.state.error).title} body={describeError(roster.state.error).detail} tone="danger">
            <Button variant="quiet" onClick={roster.reload}>
              重试
            </Button>
          </StateBlock>
        ) : null}
        {roster.state.status === 'success' && roster.state.data.items.length === 0 ? (
          <StateBlock icon="users" title="还没有成员" body="先导入一份名单吧。" />
        ) : null}
        {roster.state.status === 'success' && roster.state.data.items.length > 0 ? (
          <div class={styles.tableWrap}>
            <table class={styles.table}>
              <thead>
                <tr>
                  <th>真实姓名</th>
                  <th>昵称</th>
                  <th>性别</th>
                  <th>角色</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {roster.state.data.items.map((user) => (
                  <tr key={user.id}>
                    <td>{user.realName}</td>
                    <td>{user.nickname}</td>
                    <td>{user.gender}</td>
                    <td>
                      <select
                        value={user.role}
                        onChange={(event) => void updateRole(user, (event.currentTarget as HTMLSelectElement).value as AdminUser['role'])}
                        aria-label={`设置 ${user.realName} 的角色`}
                      >
                        <option value="student">学生</option>
                        <option value="general_admin">一般管理员</option>
                        <option value="super_admin">超级管理员</option>
                      </select>
                    </td>
                    <td>
                      {user.hidden ? <Badge>已隐藏</Badge> : <Badge tone="success">正常</Badge>}
                      {user.mustChangePassword ? <Badge tone="sunset">待改密</Badge> : null}
                    </td>
                    <td>
                      <div class={styles.rowActions}>
                        <Button size="sm" variant="quiet" onClick={() => void toggleHidden(user)}>
                          {user.hidden ? '恢复' : '隐藏'}
                        </Button>
                        <Button size="sm" variant="quiet" onClick={() => void resetPassword(user)}>
                          重置密码
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <p class={styles.rowMeta}>角色对应：{Object.entries(ROLE_LABELS).map(([key, label]) => `${key}=${label}`).join('，')}</p>
      </div>
    </AppShell>
  )
}

function ImportResult({ result }: { result: RosterImportResult }): preact.JSX.Element {
  return (
    <div class={styles.importResult}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Badge tone="success">新增 {result.created}</Badge>
        <Badge tone="accent">更新 {result.updated}</Badge>
        <Badge>跳过 {result.skipped}</Badge>
        {result.errors.length > 0 ? <Badge tone="danger">错误 {result.errors.length}</Badge> : null}
      </div>
      {result.errors.length > 0 ? (
        <ul class={styles.errorList}>
          {result.errors.map((error) => (
            <li key={`${error.line}-${error.message}`}>
              第 {error.line} 行：{error.message}
            </li>
          ))}
        </ul>
      ) : null}
      {result.generatedPasswords.length > 0 ? (
        <div>
          <p class={styles.rowText}>生成的初始密码（只显示这一次，请尽快转交或导出）：</p>
          <table class={styles.passwordTable}>
            <thead>
              <tr>
                <th>学号</th>
                <th>真实姓名</th>
                <th>初始密码</th>
              </tr>
            </thead>
            <tbody>
              {result.generatedPasswords.map((entry) => (
                <tr key={entry.studentNumber}>
                  <td>{entry.studentNumber}</td>
                  <td>{entry.realName}</td>
                  <td>{entry.initialPassword}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}

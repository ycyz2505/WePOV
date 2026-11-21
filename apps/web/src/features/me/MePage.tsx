import { useState } from 'preact/hooks'
import { profileApi, sessionApi } from '../../lib/api'
import { AppShell } from '../../components/AppShell'
import { Avatar, Badge, Button, Notice, StateBlock, TextField } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { useAsync, describeError } from '../../lib/useAsync'
import { formatRelative, genderLabel } from '../../lib/format'
import { navigate } from '../../lib/router'
import { showToast } from '../../lib/toast'
import {
  changePassword,
  currentUser,
  idleTimeoutMinutes,
  logout,
  setIdleTimeout,
} from '../../lib/session'
import styles from './me.module.css'

export function MePage(): preact.JSX.Element {
  const me = useAsync(() => profileApi.me(), [])
  const sessions = useAsync(() => sessionApi.list(), [])
  const [showPassword, setShowPassword] = useState(false)
  const user = currentUser.value

  const doLogout = async (): Promise<void> => {
    await logout()
    navigate('/login')
  }

  const revoke = async (id: string): Promise<void> => {
    try {
      await sessionApi.revoke(id)
      sessions.reload()
      showToast('该设备已退出登录。')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '操作失败', 'error')
    }
  }

  const revokeAll = async (): Promise<void> => {
    if (!window.confirm('退出所有其他设备？当前设备会保留。')) return
    try {
      await sessionApi.revokeAll()
      sessions.reload()
      showToast('其他设备已全部退出。')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '操作失败', 'error')
    }
  }

  if (!user) return <AppShell activeKey="me" title="我的"><p>正在加载…</p></AppShell>

  return (
    <AppShell activeKey="me" title="我的">
      <div class={styles.page}>
        <div class={styles.profileCard}>
          <Avatar name={user.nickname} src={user.avatarUrl ?? undefined} size={56} seed={user.id} />
          <div class={styles.profileInfo}>
            <span class={styles.profileName}>{user.nickname}</span>
            <span class={styles.profileSub}>
              {user.realName} · {genderLabel(user.gender)}
            </span>
            <span class={styles.profileSub}>
              {user.role === 'super_admin' ? '超级管理员' : user.role === 'general_admin' ? '管理员' : '同学'}
            </span>
          </div>
          <Button variant="quiet" onClick={() => navigate('/plaza/me')}>
            <Icon name="edit" size={16} /> 编辑资料
          </Button>
        </div>

        {me.state.status === 'success' ? (
          <div class={styles.section}>
            <p class={styles.profileSub}>{me.state.data.signature || '还没有个性签名。'}</p>
            <div class={styles.inlineRow}>
              <Badge tone="accent">关注 {me.state.data.followingCount}</Badge>
              <Badge>粉丝 {me.state.data.followerCount}</Badge>
              <Badge tone="sunset">获赞 {me.state.data.likeCount}</Badge>
            </div>
          </div>
        ) : null}

        <div class={styles.section}>
          <div class={styles.sectionHead}>
            <span class={styles.sectionTitle}>登录设备</span>
            <Button size="sm" variant="quiet" onClick={() => void revokeAll()}>
              退出其他设备
            </Button>
          </div>
          {sessions.state.status === 'loading' ? <p class={styles.profileSub}>加载中…</p> : null}
          {sessions.state.status === 'error' ? (
            <StateBlock icon="alert" title={describeError(sessions.state.error).title} body={describeError(sessions.state.error).detail} tone="danger">
              <Button variant="quiet" onClick={sessions.reload}>
                重试
              </Button>
            </StateBlock>
          ) : null}
          {sessions.state.status === 'success'
            ? sessions.state.data.items.map((session) => (
                <div key={session.id} class={styles.sessionRow}>
                  <Icon name="device" size={20} />
                  <div class={styles.sessionInfo}>
                    <span class={styles.sessionName}>
                      {session.deviceName}
                      {session.current ? <span class={styles.currentTag}> · 当前设备</span> : null}
                    </span>
                    <span class={styles.sessionMeta}>
                      {session.mode === 'persistent' ? '长期登录' : '临时登录'} · 最近活跃 {formatRelative(session.lastSeenAt)}
                    </span>
                  </div>
                  {session.current ? null : (
                    <Button size="sm" variant="quiet" onClick={() => void revoke(session.id)}>
                      退出
                    </Button>
                  )}
                </div>
              ))
            : null}
        </div>

        <div class={styles.section}>
          <div class={styles.sectionHead}>
            <span class={styles.sectionTitle}>安全</span>
          </div>
          <div class={styles.linkList}>
            <button type="button" class={styles.linkRow} onClick={() => setShowPassword((value) => !value)}>
              <Icon name="lock" size={18} /> 修改密码
              <span class={styles.linkChevron}>
                <Icon name={showPassword ? 'chevron-down' : 'chevron-right'} size={16} />
              </span>
            </button>
            {showPassword ? <ChangePasswordForm /> : null}
          </div>
        </div>

        <div class={styles.section}>
          <div class={styles.sectionHead}>
            <span class={styles.sectionTitle}>自动退出</span>
          </div>
          <p class={styles.profileSub}>长时间无操作会自动退出登录，保护账号安全。</p>
          <IdleTimeoutControl />
        </div>

        {user.role === 'super_admin' ? (
          <div class={styles.linkList}>
            <button type="button" class={styles.linkRow} onClick={() => navigate('/admin')}>
              <Icon name="shield" size={18} /> 进入管理后台
              <span class={styles.linkChevron}>
                <Icon name="chevron-right" size={16} />
              </span>
            </button>
          </div>
        ) : null}

        <div>
          <Button variant="danger" onClick={() => void doLogout()}>
            <Icon name="logout" size={16} /> 退出登录
          </Button>
        </div>
      </div>
    </AppShell>
  )
}

function ChangePasswordForm(): preact.JSX.Element {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    setError(null)
    if (next.length < 8) {
      setError('新密码至少 8 位。')
      return
    }
    if (next !== confirm) {
      setError('两次输入的新密码不一致。')
      return
    }
    setBusy(true)
    try {
      await changePassword({ currentPasswordInput: current, newPassword: next, confirmPassword: confirm })
      showToast('密码已修改。')
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '修改失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 8 }}>
      {error ? <Notice tone="danger" icon="alert">{error}</Notice> : null}
      <TextField
        label="当前密码"
        type="password"
        value={current}
        onInput={(event) => setCurrent((event.currentTarget as HTMLInputElement).value)}
      />
      <div class={styles.formRow}>
        <TextField
          label="新密码"
          type="password"
          hint="至少 8 位"
          value={next}
          onInput={(event) => setNext((event.currentTarget as HTMLInputElement).value)}
        />
        <TextField
          label="确认新密码"
          type="password"
          value={confirm}
          onInput={(event) => setConfirm((event.currentTarget as HTMLInputElement).value)}
        />
      </div>
      <div>
        <Button variant="primary" onClick={() => void submit()} loading={busy}>
          保存新密码
        </Button>
      </div>
    </div>
  )
}

function IdleTimeoutControl(): preact.JSX.Element {
  const [minutes, setMinutes] = useState(idleTimeoutMinutes.value)
  const [busy, setBusy] = useState(false)

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await setIdleTimeout(minutes)
      showToast(`已设置为 ${minutes} 分钟无操作后退出。`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class={styles.inlineRow}>
      <input
        type="range"
        min={5}
        max={60}
        step={5}
        value={minutes}
        class={styles.range}
        aria-label="自动退出时间（分钟）"
        onInput={(event) => setMinutes(Number((event.currentTarget as HTMLInputElement).value))}
      />
      <span class={styles.rangeValue}>{minutes} 分钟</span>
      <Button size="sm" variant="quiet" onClick={() => void save()} loading={busy} disabled={minutes === idleTimeoutMinutes.value}>
        保存
      </Button>
    </div>
  )
}

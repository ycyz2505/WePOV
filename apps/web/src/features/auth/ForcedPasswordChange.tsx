import { useState } from 'preact/hooks'
import { changePassword, logout, currentUser } from '../../lib/session'
import { Button, Notice } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { cn } from '../../lib/cn'
import styles from './login.module.css'

type FieldKey = 'current' | 'next' | 'confirm'

const ORDER: FieldKey[] = ['current', 'next', 'confirm']

const LABELS: Record<FieldKey, string> = {
  current: '当前密码',
  next: '新密码',
  confirm: '确认新密码',
}

const HINTS: Record<FieldKey, string> = {
  current: '输入登录时使用的密码',
  next: '至少 8 位',
  confirm: '再输入一次新密码',
}

const NUMERIC_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']
const ALPHA_ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm']

/**
 * First-login forced password change. Rendered immediately after login when the
 * account still uses an initial password. Shares the password page's on-screen
 * keypad and containment anti-peek mask, and cannot be skipped.
 */
export function ForcedPasswordChange({ onDone }: { onDone: () => void }): preact.JSX.Element {
  const [values, setValues] = useState<Record<FieldKey, string>>({ current: '', next: '', confirm: '' })
  const [active, setActive] = useState<FieldKey>('current')
  const [keypad, setKeypad] = useState<'numeric' | 'alpha'>('alpha')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const user = currentUser.value

  const append = (char: string): void => {
    setValues((current) => {
      const existing = current[active]
      if (existing.length >= 256) return current
      return { ...current, [active]: existing + char }
    })
  }

  const backspace = (): void => {
    setValues((current) => ({ ...current, [active]: Array.from(current[active]).slice(0, -1).join('') }))
  }

  const clear = (): void => {
    setValues((current) => ({ ...current, [active]: '' }))
  }

  const submit = async (): Promise<void> => {
    setError(null)
    if (values.current.length === 0) {
      setActive('current')
      setError('请先输入当前密码。')
      return
    }
    if (values.next.length < 8) {
      setActive('next')
      setError('新密码至少 8 位。')
      return
    }
    if (values.next !== values.confirm) {
      setActive('confirm')
      setError('两次输入的新密码不一致。')
      return
    }
    if (values.next === values.current) {
      setActive('next')
      setError('新密码不能和当前密码相同。')
      return
    }
    setBusy(true)
    try {
      await changePassword({
        currentPasswordInput: values.current,
        newPassword: values.next,
        confirmPassword: values.confirm,
      })
      onDone()
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : '修改失败，请重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main class={styles.login}>
      <div class={styles.inner}>
        <div class={styles.head}>
          <h1 class={styles.title}>先设置一个新密码</h1>
          <p class={styles.sub}>
            {user ? `${user.nickname}，` : ''}你正在使用初始密码，为了账号安全，需要先修改密码才能继续使用。
          </p>
        </div>

        <div class={styles.modeGroup}>
          {ORDER.map((key) => {
            const isActive = active === key
            const filled = values[key].length
            return (
              <button
                key={key}
                type="button"
                class={styles.modeOption}
                data-active={isActive}
                onClick={() => {
                  setActive(key)
                  setError(null)
                }}
                aria-pressed={isActive}
              >
                <span class={styles.modeText}>
                  <span class={styles.modeTitle}>
                    {LABELS[key]}
                    {filled > 0 ? <span class="numeral" style={{ marginLeft: 8, color: 'var(--muted)' }}>{filled} 位</span> : null}
                  </span>
                  <span class={styles.modeDesc}>{HINTS[key]}</span>
                </span>
              </button>
            )
          })}
        </div>

        <div>
          <div class={styles.maskDisplay} aria-live="polite" aria-label={`${LABELS[active]}（掩码）`}>
            {values[active].length > 0 ? (
              <span>{'•'.repeat(Array.from(values[active]).length)}</span>
            ) : (
              <span class={styles.maskEmpty}>{LABELS[active]}</span>
            )}
          </div>
          <p class={styles.maskNote} style={{ marginTop: 6 }}>
            支持包含式防窥：前后多输入几个无关字符也能通过，屏幕只显示掩码。
          </p>
        </div>

        {error ? (
          <Notice tone="danger" icon="alert">
            {error}
          </Notice>
        ) : null}

        <div class={styles.actions}>
          <Button variant="primary" block onClick={() => void submit()} loading={busy}>
            保存新密码并继续
          </Button>
        </div>

        <div class={styles.keypadWrap}>
          <div class={styles.keypadHead}>
            <span class={styles.maskNote}>屏幕键盘</span>
            <div class={styles.keypadToggle} role="tablist" aria-label="键盘类型">
              <button
                type="button"
                data-active={keypad === 'numeric'}
                onClick={() => setKeypad('numeric')}
                aria-pressed={keypad === 'numeric'}
              >
                数字
              </button>
              <button
                type="button"
                data-active={keypad === 'alpha'}
                onClick={() => setKeypad('alpha')}
                aria-pressed={keypad === 'alpha'}
              >
                全键盘
              </button>
            </div>
          </div>

          {keypad === 'numeric' ? (
            <div class={cn(styles.keypad, styles.keypadNumeric)}>
              {NUMERIC_KEYS.slice(0, 9).map((key) => (
                <button key={key} type="button" class={styles.key} onClick={() => append(key)}>
                  {key}
                </button>
              ))}
              <button type="button" class={cn(styles.key, styles.keyAction)} onClick={clear} aria-label="清空">
                C
              </button>
              <button type="button" class={styles.key} onClick={() => append('0')}>
                0
              </button>
              <button type="button" class={cn(styles.key, styles.keyAction)} onClick={backspace} aria-label="退格">
                <Icon name="backspace" size={20} />
              </button>
            </div>
          ) : (
            <div class={cn(styles.keypad, styles.keypadAlpha)}>
              {ALPHA_ROWS.flatMap((row) =>
                Array.from(row).map((char) => (
                  <button key={char} type="button" class={styles.key} onClick={() => append(char)}>
                    {char}
                  </button>
                )),
              )}
              <button type="button" class={styles.key} onClick={() => append('-')}>
                -
              </button>
              <button type="button" class={styles.key} onClick={() => append('_')}>
                _
              </button>
              <button type="button" class={styles.key} onClick={() => append('.')}>
                .
              </button>
              <button type="button" class={cn(styles.key, styles.keyAction)} onClick={backspace} aria-label="退格">
                <Icon name="backspace" size={18} />
              </button>
              <button type="button" class={cn(styles.key, styles.keyAction)} onClick={clear} aria-label="清空">
                C
              </button>
            </div>
          )}
        </div>

        <div class={styles.actions}>
          <Button variant="quiet" block onClick={() => void logout()}>
            退出登录
          </Button>
        </div>
      </div>
    </main>
  )
}

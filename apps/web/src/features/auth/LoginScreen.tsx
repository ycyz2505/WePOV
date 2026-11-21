import { useMemo, useState } from 'preact/hooks'
import { gatewayApi } from '../../lib/api'
import { login } from '../../lib/session'
import type { GatewayMember, SessionMode } from '../../lib/types'
import { Avatar, Button, Notice } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { useAsync } from '../../lib/useAsync'
import { cn } from '../../lib/cn'
import picker from '../gateway/gateway.module.css'
import styles from './login.module.css'

type Step = 'pick' | 'password'

interface LoginScreenProps {
  onLoggedIn: () => void
}

export function LoginScreen({ onLoggedIn }: LoginScreenProps): preact.JSX.Element {
  const [step, setStep] = useState<Step>('pick')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<GatewayMember | null>(null)
  const [mode, setMode] = useState<SessionMode>('temporary')

  const members = useAsync<{ items: GatewayMember[] }>(() => gatewayApi.members(), [])

  const filtered = useMemo(() => {
    if (members.state.status !== 'success') return []
    const needle = query.trim().toLowerCase()
    if (!needle) return members.state.data.items
    return members.state.data.items.filter((member) => {
      return (
        member.nickname.toLowerCase().includes(needle) ||
        member.realName.toLowerCase().includes(needle) ||
        member.pinyinInitials.toLowerCase().includes(needle)
      )
    })
  }, [members.state, query])

  if (step === 'password' && selected) {
    return (
      <PasswordStep
        member={selected}
        mode={mode}
        onModeChange={setMode}
        onBack={() => {
          setStep('pick')
          setSelected(null)
        }}
        onLoggedIn={onLoggedIn}
      />
    )
  }

  return (
    <main class={picker.picker}>
      <div class={picker.pickerInner}>
        <div class={picker.pickerHead}>
          <h1 class={picker.pickerTitle}>选择你的身份</h1>
          <p class={picker.pickerSub}>搜索昵称、真实姓名或拼音首字母。</p>
        </div>

        <div class={picker.searchRow}>
          <span class={picker.searchIcon}>
            <Icon name="search" size={18} />
          </span>
          <input
            class={picker.searchInput}
            type="search"
            placeholder="搜索"
            aria-label="搜索成员"
            value={query}
            onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
          />
        </div>

        {members.state.status === 'loading' ? (
          <div class={picker.memberList}>
            {Array.from({ length: 6 }, (_, index) => (
              <div class={picker.memberRow} key={index} aria-hidden="true">
                <span class={picker.memberMeta} style={{ flex: 1 }}>
                  <span class={picker.memberName} style={{ display: 'block', height: 16, width: '40%', background: 'var(--desk-soft)', borderRadius: 4 }} />
                </span>
              </div>
            ))}
          </div>
        ) : members.state.status === 'error' ? (
          <Notice tone="danger" icon="alert">
            无法加载成员名单，请检查网络后重试。
          </Notice>
        ) : filtered.length === 0 ? (
          <p class={picker.emptyHint}>没有匹配的成员，换个关键词试试。</p>
        ) : (
          <div class={picker.memberList} role="listbox" aria-label="成员名单">
            {filtered.map((member) => (
              <button
                key={member.userId}
                class={picker.memberRow}
                role="option"
                aria-selected={selected?.userId === member.userId}
                onClick={() => {
                  setSelected(member)
                  setStep('password')
                }}
              >
                <Avatar name={member.nickname} src={member.avatarUrl} seed={member.userId} size={38} />
                <span class={picker.memberMeta}>
                  <span class={picker.memberName}>{member.nickname}</span>
                  <span class={picker.memberReal}>{member.realName}</span>
                </span>
                <span class={picker.memberInitials}>{member.pinyinInitials}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}

interface PasswordStepProps {
  member: GatewayMember
  mode: SessionMode
  onModeChange: (mode: SessionMode) => void
  onBack: () => void
  onLoggedIn: () => void
}

function PasswordStep({ member, mode, onModeChange, onBack, onLoggedIn }: PasswordStepProps): preact.JSX.Element {
  const [value, setValue] = useState('')
  const [keypad, setKeypad] = useState<'numeric' | 'alpha'>('numeric')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const append = (char: string): void => {
    setValue((current) => (current.length >= 256 ? current : current + char))
  }
  const backspace = (): void => {
    setValue((current) => Array.from(current).slice(0, -1).join(''))
  }
  const clear = (): void => setValue('')

  const submit = async (): Promise<void> => {
    if (value.length === 0) {
      setError('请输入密码。')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await login({ userId: member.userId, passwordInput: value, mode })
      setValue('')
      onLoggedIn()
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : '密码不正确，请重试。')
      setValue('')
    } finally {
      setSubmitting(false)
    }
  }

  const numericKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']
  const alphaRows = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm']

  return (
    <main class={styles.login}>
      <div class={styles.inner}>
        <div class={styles.selectedCard}>
          <Avatar name={member.nickname} src={member.avatarUrl} seed={member.userId} size={44} />
          <span class={styles.selectedMeta}>
            <span class={styles.selectedName}>{member.nickname}</span>
            <span class={styles.selectedReal}>{member.realName}</span>
          </span>
          <button type="button" class={styles.changeLink} onClick={onBack}>
            换人
          </button>
        </div>

        <div>
          <div class={styles.maskDisplay} aria-live="polite" aria-label="已输入的密码（掩码）">
            {value.length > 0 ? (
              <span>{'•'.repeat(Array.from(value).length)}</span>
            ) : (
              <span class={styles.maskEmpty}>输入密码</span>
            )}
          </div>
          <p class={styles.maskNote} style={{ marginTop: 6 }}>
            支持包含式防窥：前后多输入几个无关字符也能登录，只会显示掩码。
          </p>
        </div>

        {error ? (
          <Notice tone="danger" icon="alert">
            {error}
          </Notice>
        ) : null}

        <div class={styles.modeGroup}>
          <label class={styles.modeOption} data-active={mode === 'temporary'}>
            <input
              type="radio"
              name="login-mode"
              checked={mode === 'temporary'}
              onChange={() => onModeChange('temporary')}
            />
            <span class={styles.modeText}>
              <span class={styles.modeTitle}>临时登录</span>
              <span class={styles.modeDesc}>令牌只留在当前标签页，关闭即失效，10 分钟无操作自动退出。</span>
            </span>
          </label>
          <label class={styles.modeOption} data-active={mode === 'persistent'}>
            <input
              type="radio"
              name="login-mode"
              checked={mode === 'persistent'}
              onChange={() => onModeChange('persistent')}
            />
            <span class={styles.modeText}>
              <span class={styles.modeTitle}>长期登录</span>
              <span class={styles.modeDesc}>仅用于个人设备，30 天滑动有效。公共设备请勿选择。</span>
            </span>
          </label>
        </div>

        <Notice tone="warn" icon="alert">
          <strong>班内大屏务必选择临时登录。</strong>
        </Notice>

        <div class={styles.actions}>
          <Button variant="primary" block onClick={() => void submit()} loading={submitting}>
            登录
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
              {numericKeys.slice(0, 9).map((key) => (
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
              {alphaRows.flatMap((row) =>
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
      </div>
    </main>
  )
}

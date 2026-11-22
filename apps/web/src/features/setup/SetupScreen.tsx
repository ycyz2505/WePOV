import { useEffect, useState } from 'preact/hooks'
import { setupApi } from '../../lib/api'
import { verifyGateway } from '../../lib/session'
import { Button, Notice, TextField } from '../../components/ui'
import styles from './setup.module.css'

/**
 * First-run setup. Shown only while the deployment has no class row: the first
 * person picking the class passcode becomes the super admin, and chooses their
 * own password here (no seeded credentials exist).
 */
export function SetupScreen({ onDone }: { onDone: () => void }): preact.JSX.Element {
  const [passcode, setPasscode] = useState('')
  const [passcodeAgain, setPasscodeAgain] = useState('')
  const [realName, setRealName] = useState('')
  const [nickname, setNickname] = useState('')
  const [password, setPassword] = useState('')
  const [passwordAgain, setPasswordAgain] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    document.title = '首次设置'
  }, [])

  const submit = async (event: Event): Promise<void> => {
    event.preventDefault()
    if (passcode.length < 4) {
      setError('班级口令至少 4 位。')
      return
    }
    if (passcode !== passcodeAgain) {
      setError('两次输入的班级口令不一致。')
      return
    }
    if (!realName.trim()) {
      setError('请填写真实姓名。')
      return
    }
    if (!nickname.trim()) {
      setError('请填写昵称。')
      return
    }
    if (password.length < 8) {
      setError('总管理员密码至少 8 位。')
      return
    }
    if (password !== passwordAgain) {
      setError('两次输入的密码不一致。')
      return
    }

    setBusy(true)
    setError(null)
    try {
      await setupApi.initialize({
        passcode,
        realName: realName.trim(),
        nickname: nickname.trim(),
        password,
      })
      // The passcode was just chosen here, so admit this device immediately.
      await verifyGateway(passcode, false)
      onDone()
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : '初始化失败，请重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main class={styles.page}>
      <div class={styles.card}>
        <header class={styles.head}>
          <h1 class={styles.title}>首次设置</h1>
          <p class={styles.sub}>
            这是本班空间的第一次启动。请设置班级口令，并创建第一位总管理员；之后不可再通过此页面修改。
          </p>
        </header>

        <form class={styles.form} onSubmit={(event) => void submit(event)}>
          <section class={styles.section}>
            <h2 class={styles.sectionTitle}>班级口令</h2>
            <p class={styles.hint}>本班成员进入空间时输入，务必告知全班并妥善保管。</p>
            <TextField
              label="班级口令"
              type="password"
              autoComplete="new-password"
              value={passcode}
              maxLength={128}
              onInput={(event) => setPasscode((event.currentTarget as HTMLInputElement).value)}
            />
            <TextField
              label="再次输入班级口令"
              type="password"
              autoComplete="new-password"
              value={passcodeAgain}
              maxLength={128}
              onInput={(event) => setPasscodeAgain((event.currentTarget as HTMLInputElement).value)}
            />
          </section>

          <section class={styles.section}>
            <h2 class={styles.sectionTitle}>总管理员</h2>
            <p class={styles.hint}>真实姓名与昵称之后可由管理员在名册中调整。</p>
            <TextField
              label="真实姓名"
              value={realName}
              maxLength={30}
              onInput={(event) => setRealName((event.currentTarget as HTMLInputElement).value)}
            />
            <TextField
              label="昵称"
              value={nickname}
              maxLength={12}
              onInput={(event) => setNickname((event.currentTarget as HTMLInputElement).value)}
            />
            <TextField
              label="登录密码"
              type="password"
              autoComplete="new-password"
              hint="至少 8 位，可用字母、数字与符号。"
              value={password}
              maxLength={64}
              onInput={(event) => setPassword((event.currentTarget as HTMLInputElement).value)}
            />
            <TextField
              label="再次输入密码"
              type="password"
              autoComplete="new-password"
              value={passwordAgain}
              maxLength={64}
              onInput={(event) => setPasswordAgain((event.currentTarget as HTMLInputElement).value)}
            />
          </section>

          {error ? (
            <Notice tone="danger" icon="alert">
              {error}
            </Notice>
          ) : null}

          <Button variant="primary" block type="submit" loading={busy}>
            完成设置并进入
          </Button>
        </form>
      </div>
    </main>
  )
}

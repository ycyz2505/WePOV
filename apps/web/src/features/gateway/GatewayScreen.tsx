import { useEffect, useState } from 'preact/hooks'
import { gatewayApi } from '../../lib/api'
import { verifyGateway } from '../../lib/session'
import { Button, Field, Notice } from '../../components/ui'
import { Icon } from '../../components/Icon'
import styles from './gateway.module.css'

export function GatewayScreen({ onVerified }: { onVerified: () => void }): preact.JSX.Element {
  const [passcode, setPasscode] = useState('')
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    // Privacy: blank page/title/favicon until verified.
    document.title = ''
  }, [])

  const submit = async (event: Event): Promise<void> => {
    event.preventDefault()
    if (passcode.length < 4) {
      setError('口令至少 4 位，请完整输入。')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await verifyGateway(passcode, remember)
      setPasscode('')
      onVerified()
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : '口令不正确，请向班内管理员确认后重试。',
      )
      setPasscode('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main class={styles.gate}>
      <div class={styles.gateInner}>
        <form class={styles.passcodeForm} onSubmit={(event) => void submit(event)}>
          <Field label="输入口令" htmlFor="gateway-passcode" hint="仅本班成员持有，用于进入班级空间。">
            <input
              id="gateway-passcode"
              class={styles.passcodeInput}
              type="password"
              inputMode="text"
              autoComplete="off"
              autoFocus
              value={passcode}
              maxLength={128}
              onInput={(event) => setPasscode((event.currentTarget as HTMLInputElement).value)}
              aria-invalid={error ? 'true' : undefined}
            />
          </Field>

          {error ? (
            <Notice tone="danger" icon="alert">
              {error}
            </Notice>
          ) : null}

          <label class={styles.rememberRow}>
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember((event.currentTarget as HTMLInputElement).checked)}
            />
            在这台设备上记住口令
          </label>

          <Button variant="primary" block type="submit" loading={submitting}>
            进入
          </Button>
        </form>
      </div>
    </main>
  )
}

export async function probeGateway(): Promise<boolean> {
  try {
    const status = await gatewayApi.status()
    return status.verified
  } catch {
    return false
  }
}

export { Icon }

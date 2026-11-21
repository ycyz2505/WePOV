import { useEffect, useState } from 'preact/hooks'
import { getUpdaterBridge, type UpdaterStatus } from '../lib/device'
import { Button, Notice } from './ui'
import { Icon } from './Icon'
import styles from './UpdateGate.module.css'

/**
 * Full-screen blocking update gate for the Android shell.
 * On the web (no native bridge) this renders nothing.
 */
export function UpdateGate(): preact.JSX.Element | null {
  const [status, setStatus] = useState<UpdaterStatus | null>(null)
  const bridge = getUpdaterBridge()

  useEffect(() => {
    if (!bridge) return undefined
    setStatus(bridge.getStatus())
    bridge.check()
    const unsubscribe = bridge.subscribe((next) => setStatus(next))
    return unsubscribe
  }, [bridge])

  if (!bridge || !status) return null

  const blockingPhases = new Set(['required', 'hard-block', 'downloading', 'verifying', 'ready', 'installing', 'error'])
  const mustBlock =
    blockingPhases.has(status.phase) ||
    (status.latestVersionCode !== null && status.latestVersionCode > status.currentVersionCode)

  if (!mustBlock) return null

  const latest = status.latestVersionName ?? '新版本'
  const current = status.currentVersionName
  const downloading = status.phase === 'downloading' || status.phase === 'verifying'
  const ready = status.phase === 'ready'

  return (
    <div class={styles.overlay} role="alertdialog" aria-modal="true" aria-labelledby="update-title">
      <div class={styles.panel}>
        <span class={styles.mark}>WePOV</span>
        <h1 class={styles.title} id="update-title">
          需要更新后才能继续使用
        </h1>
        <div class={styles.versionRow}>
          <span class="numeral">当前 {current}</span>
          <Icon name="chevron-right" size={14} class={styles.arrow} />
          <span class="numeral" style={{ color: 'var(--uniform-blue)' }}>
            最新 {latest}
          </span>
        </div>

        {status.notes ? <div class={styles.notes}>{status.notes}</div> : null}

        {downloading ? (
          <div>
            <div class={styles.progressTrack} role="progressbar" aria-valuenow={Math.round(status.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div class={styles.progressBar} style={{ width: `${Math.round(status.progress * 100)}%` }} />
            </div>
            <div class={styles.metaRow} style={{ marginTop: 6 }}>
              <span>{status.phase === 'verifying' ? '校验安装包…' : '正在下载'}</span>
              <span>{Math.round(status.progress * 100)}%</span>
            </div>
          </div>
        ) : null}

        {status.phase === 'error' ? (
          <Notice tone="danger" icon="alert">
            <span class={styles.error}>{status.error ?? '下载失败。'}</span>
            <p class={styles.footNote} style={{ marginTop: 6 }}>
              可以重试，或切换到其他镜像源。所有镜像都失败时请稍后再试。
            </p>
          </Notice>
        ) : null}

        {status.mirrors.length > 0 ? (
          <div class={styles.mirror}>
            当前镜像：{status.mirrors[status.mirrorIndex]?.label ?? '默认'} ·{' '}
            {status.mirrors[status.mirrorIndex]?.url ?? ''}
          </div>
        ) : null}

        <div class={styles.actions}>
          {ready ? (
            <Button variant="primary" block onClick={() => bridge.install()}>
              立即安装
            </Button>
          ) : downloading ? (
            <Button variant="quiet" block disabled>
              下载中，请稍候
            </Button>
          ) : (
            <Button variant="primary" block onClick={() => bridge.download()}>
              {status.phase === 'error' ? '重新下载' : '下载更新'}
            </Button>
          )}
          {status.phase === 'error' && status.mirrors.length > 1 ? (
            <Button
              variant="quiet"
              block
              onClick={() => bridge.download((status.mirrorIndex + 1) % status.mirrors.length)}
            >
              切换镜像重试
            </Button>
          ) : null}
        </div>

        <p class={styles.footNote}>
          更新是进入 App 的必要步骤，无法跳过。网页端不受此限制。
        </p>
      </div>
    </div>
  )
}

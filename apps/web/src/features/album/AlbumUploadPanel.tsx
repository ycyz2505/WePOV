import { useState } from 'preact/hooks'
import { uploadApi } from '../../lib/api'
import type { MediaItem, UploadTier } from '../../lib/types'
import { Button, Notice } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { showToast } from '../../lib/toast'
import { formatBytes } from '../../lib/format'
import { TIER_PRESETS, encodeImage } from '../../lib/image'
import styles from './album.module.css'

interface UploadEntry {
  id: string
  file: File
  previewUrl: string
  originalBytes: number
  tier: UploadTier
  estimatedBytes: number | null
  estimating: boolean
  status: 'ready' | 'uploading' | 'done' | 'error' | 'duplicate'
  error?: string
}

const ONE_MB = 1024 * 1024

const TIER_ORDER: UploadTier[] = ['original', 'high', 'standard', 'compact']

export function AlbumUploadPanel({
  folderId,
  onUploaded,
  onClose,
}: {
  folderId: string | null
  onUploaded: () => void
  onClose: () => void
}): preact.JSX.Element {
  const [entries, setEntries] = useState<UploadEntry[]>([])
  const [uploading, setUploading] = useState(false)
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null)

  const addFiles = async (files: FileList | File[]): Promise<void> => {
    const list = Array.from(files).filter((file) => file.type.startsWith('image/'))
    const next: UploadEntry[] = list.map((file) => ({
      id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      originalBytes: file.size,
      tier: file.size > ONE_MB ? 'high' : 'standard',
      estimatedBytes: null,
      estimating: true,
      status: 'ready',
    }))
    setEntries((current) => [...current, ...next])
    // estimate each
    for (const entry of next) {
      void estimateOne(entry)
    }
  }

  const estimateOne = async (entry: UploadEntry): Promise<void> => {
    try {
      const encoded = await encodeImage(entry.file, { tier: entry.tier })
      setEntries((current) =>
        current.map((item) =>
          item.id === entry.id ? { ...item, estimatedBytes: encoded.bytes, estimating: false } : item,
        ),
      )
    } catch {
      setEntries((current) =>
        current.map((item) => (item.id === entry.id ? { ...item, estimatedBytes: item.originalBytes, estimating: false } : item)),
      )
    }
  }

  const changeTier = async (entryId: string, tier: UploadTier): Promise<void> => {
    setEntries((current) =>
      current.map((item) => (item.id === entryId ? { ...item, tier, estimating: true } : item)),
    )
    const entry = entries.find((item) => item.id === entryId)
    if (!entry) return
    const updated: UploadEntry = { ...entry, tier, estimating: true }
    try {
      const encoded = await encodeImage(updated.file, { tier })
      setEntries((current) =>
        current.map((item) =>
          item.id === entryId ? { ...item, estimatedBytes: encoded.bytes, estimating: false } : item,
        ),
      )
    } catch {
      setEntries((current) =>
        current.map((item) => (item.id === entryId ? { ...item, estimating: false } : item)),
      )
    }
  }

  const removeEntry = (id: string): void => {
    setEntries((current) => {
      const target = current.find((item) => item.id === id)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return current.filter((item) => item.id !== id)
    })
  }

  const uploadAll = async (): Promise<void> => {
    if (!folderId) {
      showToast('请先进入一个文件夹再上传。', 'error')
      return
    }
    setUploading(true)
    setDuplicateWarning(null)
    for (const entry of entries) {
      if (entry.status === 'done') continue
      setEntries((current) =>
        current.map((item) => (item.id === entry.id ? { ...item, status: 'uploading' } : item)),
      )
      try {
        const encoded = await encodeImage(entry.file, { tier: entry.tier })
        const intent = await uploadApi.intent({
          folderId,
          filename: entry.file.name,
          mime: encoded.mime,
          originalBytes: entry.originalBytes,
          finalBytes: encoded.bytes,
          width: encoded.width,
          height: encoded.height,
          sha256: encoded.sha256,
          tier: entry.tier,
          capturedAt: null,
          preserveOriginalBytes: entry.tier === 'original',
        })
        const response = await fetch(intent.uploadUrl, {
          method: intent.method,
          headers: intent.headers,
          body: encoded.blob,
        })
        if (!response.ok) throw new Error(`上传失败（${response.status}）`)
        const media: MediaItem = await uploadApi.complete(intent.uploadId)
        if (media.duplicateOf) {
          setDuplicateWarning(`「${entry.file.name}」和已有照片重复，已自动复用，不重复占用空间。`)
          setEntries((current) =>
            current.map((item) => (item.id === entry.id ? { ...item, status: 'duplicate' } : item)),
          )
        } else {
          setEntries((current) =>
            current.map((item) => (item.id === entry.id ? { ...item, status: 'done' } : item)),
          )
        }
      } catch (error) {
        setEntries((current) =>
          current.map((item) =>
            item.id === entry.id
              ? { ...item, status: 'error', error: error instanceof Error ? error.message : '上传失败' }
              : item,
          ),
        )
      }
    }
    setUploading(false)
    onUploaded()
  }

  const hasLarge = entries.some((entry) => entry.originalBytes > ONE_MB)
  const largestBytes = entries.reduce((max, entry) => Math.max(max, entry.originalBytes), 0)
  const pendingCount = entries.filter((entry) => entry.status !== 'done' && entry.status !== 'duplicate').length

  return (
    <div class={styles.uploadPanel}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <strong>上传照片</strong>
        <Button size="sm" variant="quiet" onClick={onClose}>
          收起
        </Button>
      </div>

      <label class={styles.dropzone}>
        <Icon name="upload" size={28} />
        <span>点击选择照片，支持一次多选</span>
        <span style={{ fontSize: 12 }}>图片只会在你的浏览器里压缩，再上传到班级存储。</span>
        <input
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            const files = (event.currentTarget as HTMLInputElement).files
            if (files) void addFiles(files)
          }}
        />
      </label>

      {duplicateWarning ? (
        <Notice tone="info" icon="check">
          {duplicateWarning}
        </Notice>
      ) : null}

      {entries.map((entry) => (
        <div key={entry.id} class={styles.uploadRow} style={{ alignItems: 'flex-start' }}>
          <img
            src={entry.previewUrl}
            alt=""
            style={{ width: 48, height: 48, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
          />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span class={styles.uploadRowName}>{entry.file.name}</span>
            <span class={styles.uploadState}>
              原图 {formatBytes(entry.originalBytes)}
              {entry.estimating
                ? ' · 预计大小计算中…'
                : entry.estimatedBytes !== null
                  ? ` · ${TIER_PRESETS[entry.tier].label}约 ${formatBytes(entry.estimatedBytes)}`
                  : ''}
            </span>
            {entry.status === 'ready' ? (
              <div class={styles.tierChoices}>
                {TIER_ORDER.map((tier) => (
                  <label key={tier} class={styles.tierOption} data-active={entry.tier === tier}>
                    <input
                      type="radio"
                      name={`tier-${entry.id}`}
                      checked={entry.tier === tier}
                      onChange={() => void changeTier(entry.id, tier)}
                      style={{ accentColor: 'var(--uniform-blue)', marginTop: 2 }}
                    />
                    <span>
                      <span class={styles.tierTitle}>{TIER_PRESETS[tier].label}</span>
                      <span class={styles.tierDesc}> · {TIER_PRESETS[tier].description}</span>
                      {entry.tier === tier && entry.estimatedBytes !== null ? (
                        <span class={styles.tierEstimate}> 预计 {formatBytes(entry.estimatedBytes)}</span>
                      ) : null}
                    </span>
                  </label>
                ))}
              </div>
            ) : null}
            {entry.status === 'uploading' ? <span class={styles.uploadState}>上传中…</span> : null}
            {entry.status === 'done' ? (
              <span class={styles.uploadState} style={{ color: 'var(--success)' }}>
                已上传
              </span>
            ) : null}
            {entry.status === 'duplicate' ? (
              <span class={styles.uploadState} style={{ color: 'var(--uniform-blue)' }}>
                重复照片，已复用
              </span>
            ) : null}
            {entry.status === 'error' ? (
              <span class={styles.uploadState} style={{ color: 'var(--annotation)' }}>
                {entry.error}
              </span>
            ) : null}
          </div>
          <Button size="sm" variant="quiet" iconOnly aria-label="移除" onClick={() => removeEntry(entry.id)}>
            <Icon name="close" size={16} />
          </Button>
        </div>
      ))}

      {hasLarge ? <LargeImageWarning originalBytes={largestBytes} /> : null}

      {entries.length > 0 ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="primary" onClick={() => void uploadAll()} loading={uploading} disabled={pendingCount === 0 || !folderId}>
            上传 {pendingCount > 0 ? `${pendingCount} 张` : ''}
          </Button>
          <Button variant="quiet" onClick={onClose}>
            完成
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function LargeImageWarning({ originalBytes }: { originalBytes: number }): preact.JSX.Element {
  const sizeMb = (originalBytes / (1024 * 1024)).toFixed(1)
  return (
    <div class={styles.warningBox}>
      <p class={styles.warningTitle}>原图超过 1 MB</p>
      <p style={{ marginTop: 6 }}>这张原图大小为 {sizeMb} MB。</p>
      <p style={{ marginTop: 6 }}>
        班级相册总空间有限，所有人的照片共同使用约 10 GB 存储。原图超过 1 MB
        时，建议选择高清压缩；压缩只会调整存储体积，并会在上传前展示预计大小。
      </p>
      <p style={{ marginTop: 6 }}>
        空间用满后，全班将无法继续上传照片或生成大型导出包，只能先删除已有文件，或者等有同学愿意爆金币来帮忙扩容。
      </p>
    </div>
  )
}

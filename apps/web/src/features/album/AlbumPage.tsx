import { useState } from 'preact/hooks'
import { albumApi } from '../../lib/api'
import type { AlbumFolder, MediaItem, StorageUsage } from '../../lib/types'
import { AppShell } from '../../components/AppShell'
import { Badge, Button, Notice, StateBlock, TextField } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { useAsync, describeError } from '../../lib/useAsync'
import { showToast } from '../../lib/toast'
import { formatBytes, formatDateTime, percent } from '../../lib/format'
import { navigate } from '../../lib/router'
import { downloadUrl, supportsFileSystemAccess, zipToBlob, zipToDisk, downloadBlob } from '../../lib/zip'
import { AlbumUploadPanel } from './AlbumUploadPanel'
import styles from './album.module.css'

export function AlbumPage({ folderId }: { folderId: string | null }): preact.JSX.Element {
  const folders = useAsync(() => albumApi.folders(folderId), [folderId])
  const media = useAsync(() => albumApi.media(folderId), [folderId])
  const storage = useAsync(() => albumApi.storage(), [])
  const [showUpload, setShowUpload] = useState(false)
  const [newFolder, setNewFolder] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [zipping, setZipping] = useState(false)
  const [zipProgress, setZipProgress] = useState<{ completed: number; total: number } | null>(null)

  const storageData: StorageUsage | null = storage.state.status === 'success' ? storage.state.data : null
  const mediaItems = media.state.status === 'success' ? media.state.data.items : []
  const folderItems = folders.state.status === 'success' ? folders.state.data.items : []
  const breadcrumb = folders.state.status === 'success' ? folders.state.data.breadcrumb : []
  const currentName = breadcrumb.length > 0 ? breadcrumb[breadcrumb.length - 1]?.name ?? '相册' : '相册'
  const deleteOnly = storageData?.deleteOnly ?? false

  const createFolder = async (): Promise<void> => {
    if (!newFolder.trim()) return
    setCreatingFolder(true)
    try {
      await albumApi.createFolder(folderId, newFolder.trim())
      setNewFolder('')
      folders.reload()
      showToast('文件夹已创建。')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '创建失败', 'error')
    } finally {
      setCreatingFolder(false)
    }
  }

  const toggleSelect = (id: string): void => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const downloadSingle = async (item: MediaItem): Promise<void> => {
    if (!item.downloadUrl) {
      showToast('该文件暂时无法下载。', 'error')
      return
    }
    try {
      await downloadUrl(item.downloadUrl, item.filename)
    } catch {
      showToast('下载失败，请重试。', 'error')
    }
  }

  const downloadFolderZip = async (): Promise<void> => {
    const targets = selected.size > 0 ? mediaItems.filter((item) => selected.has(item.id)) : mediaItems
    const downloadable = targets.filter((item) => item.downloadUrl)
    if (downloadable.length === 0) {
      showToast('当前没有可下载的文件。', 'error')
      return
    }
    setZipping(true)
    setZipProgress({ completed: 0, total: downloadable.length })
    try {
      const ticket = await albumApi.downloadZipTicket(downloadable.map((item) => item.id))
      const entries: Array<{ filename: string; data: Blob }> = []
      for (const entry of ticket.items) {
        const response = await fetch(entry.url, { credentials: 'same-origin' })
        if (!response.ok) continue
        entries.push({ filename: entry.filename, data: await response.blob() })
      }
      const name = `${currentName}.zip`
      if (supportsFileSystemAccess()) {
        const result = await zipToDisk(entries, name, (progress) =>
          setZipProgress({ completed: progress.completed, total: progress.total }),
        )
        if (result === 'saved') {
          showToast('压缩包已保存。')
        } else {
          const blob = await zipToBlob(entries)
          downloadBlob(blob, name)
        }
      } else {
        const blob = await zipToBlob(entries, (progress) =>
          setZipProgress({ completed: progress.completed, total: progress.total }),
        )
        downloadBlob(blob, name)
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : '打包下载失败', 'error')
    } finally {
      setZipping(false)
      setZipProgress(null)
    }
  }

  return (
    <AppShell activeKey="album" title="相册">
      <div class={styles.page}>
        <div class={styles.breadcrumb}>
          <button type="button" class={styles.crumb} onClick={() => navigate('/albums')}>
            相册
          </button>
          {breadcrumb.map((crumb, index) => (
            <span key={crumb.id ?? 'root'} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span class={styles.crumbSep}>/</span>
              <button
                type="button"
                class={crumb.id === folderId ? `${styles.crumb} ${styles.crumbCurrent}` : styles.crumb}
                onClick={() => navigate(crumb.id ? `/albums/${crumb.id}` : '/albums')}
                aria-current={crumb.id === folderId ? 'page' : undefined}
              >
                {crumb.name}
              </button>
              {index === breadcrumb.length - 1 ? null : null}
            </span>
          ))}
        </div>

        {storageData ? <StorageMeter storage={storageData} /> : null}

        <div class={styles.toolbar}>
          <Button
            variant="primary"
            onClick={() => setShowUpload((value) => !value)}
            disabled={deleteOnly}
            title={deleteOnly ? '空间不足，暂时只能删除文件' : undefined}
          >
            <Icon name="upload" size={16} /> 上传照片
          </Button>
          <Button variant="quiet" onClick={() => void downloadFolderZip()} loading={zipping}>
            <Icon name="download" size={16} /> {selected.size > 0 ? `打包下载选中 ${selected.size}` : '打包下载当前文件夹'}
          </Button>
          {mediaItems.length > 0 ? (
            <Button
              variant="quiet"
              onClick={() => setSelected((current) => (current.size === mediaItems.length ? new Set() : new Set(mediaItems.map((item) => item.id))))}
            >
              {selected.size === mediaItems.length ? '取消全选' : '全选'}
            </Button>
          ) : null}
        </div>

        {zipProgress ? (
          <div class={styles.uploadRow}>
            <span class={styles.uploadRowName}>正在打包…</span>
            <div class={styles.progressTrack}>
              <div
                class={styles.progressFill}
                style={{ width: `${zipProgress.total > 0 ? (zipProgress.completed / zipProgress.total) * 100 : 0}%` }}
              />
            </div>
            <span class={styles.uploadState}>
              {zipProgress.completed}/{zipProgress.total}
            </span>
          </div>
        ) : null}

        {showUpload && !deleteOnly ? (
          <AlbumUploadPanel
            folderId={folderId}
            onUploaded={() => {
              media.reload()
              storage.reload()
              folders.reload()
            }}
            onClose={() => setShowUpload(false)}
          />
        ) : null}

        {deleteOnly ? (
          <Notice tone="warn" icon="alert">
            班级存储空间低于 5%，现在只能删除文件，无法继续上传。请先清理不需要的照片，或等有同学扩容。
          </Notice>
        ) : storageData?.warning ? (
          <Notice tone="warn" icon="alert">
            班级存储空间低于 15%，建议选择更省空间的压缩档位上传。
          </Notice>
        ) : null}

        <div class={styles.formRow}>
          <TextField
            label="新建文件夹"
            value={newFolder}
            maxLength={30}
            placeholder="例如：运动会"
            onInput={(event) => setNewFolder((event.currentTarget as HTMLInputElement).value)}
          />
          <Button variant="quiet" onClick={() => void createFolder()} loading={creatingFolder} disabled={!newFolder.trim()}>
            新建
          </Button>
        </div>

        {folderItems.length > 0 ? (
          <div class={styles.folderGrid}>
            {folderItems.map((folder) => (
              <FolderCard
                key={folder.id}
                folder={folder}
                onOpen={() => navigate(`/albums/${folder.id}`)}
                onChanged={() => {
                  folders.reload()
                  media.reload()
                }}
              />
            ))}
          </div>
        ) : null}

        {media.state.status === 'loading' ? <p class={styles.storageLabel}>加载照片…</p> : null}
        {media.state.status === 'error' ? (
          <StateBlock icon="alert" title={describeError(media.state.error).title} body={describeError(media.state.error).detail} tone="danger">
            <Button variant="quiet" onClick={media.reload}>
              重试
            </Button>
          </StateBlock>
        ) : null}
        {media.state.status === 'success' && mediaItems.length === 0 && folderItems.length === 0 ? (
          <StateBlock
            icon="album"
            title="这个文件夹还是空的"
            body={deleteOnly ? '空间不足，暂时无法上传新照片。' : '上传第一张照片，和大家一起记录。'}
          >
            {!deleteOnly ? (
              <Button variant="primary" onClick={() => setShowUpload(true)}>
                上传照片
              </Button>
            ) : null}
          </StateBlock>
        ) : null}

        {mediaItems.length > 0 ? (
          <div class={styles.mediaGrid}>
            {mediaItems.map((item) => (
              <MediaTile
                key={item.id}
                item={item}
                selected={selected.has(item.id)}
                onToggle={() => toggleSelect(item.id)}
                onDownload={() => void downloadSingle(item)}
                onDeleted={() => {
                  media.reload()
                  storage.reload()
                }}
              />
            ))}
          </div>
        ) : null}
      </div>
    </AppShell>
  )
}

function StorageMeter({ storage }: { storage: StorageUsage }): preact.JSX.Element {
  const ratio = percent(storage.usedBytes, storage.totalBytes)
  const tone = ratio >= 95 ? styles.meterDanger : ratio >= 85 ? styles.meterWarn : ''
  return (
    <div class={styles.storageMeter}>
      <div class={styles.storageTop}>
        <span class={styles.storageLabel}>
          班级存储 {formatBytes(storage.usedBytes)} / {formatBytes(storage.totalBytes)}
        </span>
        <span class={styles.storageValue}>{ratio}%</span>
      </div>
      <div class={styles.meterTrack}>
        <div class={`${styles.meterFill} ${tone}`} style={{ width: `${Math.min(100, ratio)}%` }} />
      </div>
      <div class={styles.storageBreakdown}>
        <span>照片 {formatBytes(storage.mediaBytes)}</span>
        <span>日志 {formatBytes(storage.logBytes)}</span>
        <span>临时 {formatBytes(storage.tempBytes)}</span>
      </div>
    </div>
  )
}

function FolderCard({
  folder,
  onOpen,
  onChanged,
}: {
  folder: AlbumFolder
  onOpen: () => void
  onChanged: () => void
}): preact.JSX.Element {
  const [requestOpen, setRequestOpen] = useState(false)

  return (
    <>
      <div class={styles.folderCard} onClick={onOpen} role="button" tabIndex={0} onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}>
        <span class={styles.folderIcon}>
          <Icon name="folder" size={26} />
        </span>
        <span class={styles.folderName}>{folder.name}</span>
        <span class={styles.folderMeta}>
          {folder.mediaCount} 张 · {folder.folderCount} 个子文件夹
        </span>
        {folder.pendingChange ? (
          <span class={styles.pendingTag}>待审核：{folder.pendingChange === 'move' ? '移动' : '删除'}</span>
        ) : null}
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          <Button
            size="sm"
            variant="quiet"
            onClick={(event) => {
              event.stopPropagation()
              setRequestOpen(true)
            }}
          >
            申请修改
          </Button>
        </div>
      </div>
      {requestOpen ? (
        <FolderRequestModal folder={folder} onClose={() => setRequestOpen(false)} onChanged={onChanged} />
      ) : null}
    </>
  )
}

function FolderRequestModal({
  folder,
  onClose,
  onChanged,
}: {
  folder: AlbumFolder
  onClose: () => void
  onChanged: () => void
}): preact.JSX.Element {
  const [operation, setOperation] = useState<'move' | 'delete'>('delete')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    if (!reason.trim()) {
      showToast('请填写申请理由。', 'error')
      return
    }
    setBusy(true)
    try {
      if (operation === 'delete') {
        await albumApi.requestFolderChange(folder.id, { operation: 'delete', reason: reason.trim() })
      } else {
        await albumApi.requestFolderChange(folder.id, {
          operation: 'move',
          targetParentId: folder.parentId,
          reason: reason.trim(),
        })
      }
      showToast('申请已提交，等待管理员审核。')
      onChanged()
      onClose()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '提交失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class={styles.modalOverlay} onClick={onClose} role="presentation">
      <div class={styles.modal} role="dialog" aria-modal="true" aria-label="申请修改文件夹" onClick={(event) => event.stopPropagation()}>
        <h3 class={styles.modalTitle}>申请修改「{folder.name}」</h3>
        <p class={styles.storageLabel}>普通同学不能直接删除或移动文件夹，需要管理员审核。</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="sm" variant={operation === 'delete' ? 'danger' : 'quiet'} onClick={() => setOperation('delete')}>
            申请删除
          </Button>
          <Button size="sm" variant={operation === 'move' ? 'primary' : 'quiet'} onClick={() => setOperation('move')}>
            申请移动
          </Button>
        </div>
        <TextField
          label="申请理由"
          value={reason}
          maxLength={100}
          counterMax={100}
          onInput={(event) => setReason((event.currentTarget as HTMLInputElement).value)}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="primary" onClick={() => void submit()} loading={busy}>
            提交申请
          </Button>
          <Button variant="quiet" onClick={onClose}>
            取消
          </Button>
        </div>
      </div>
    </div>
  )
}

function MediaTile({
  item,
  selected,
  onToggle,
  onDownload,
  onDeleted,
}: {
  item: MediaItem
  selected: boolean
  onToggle: () => void
  onDownload: () => void
  onDeleted: () => void
}): preact.JSX.Element {
  const [deleteOpen, setDeleteOpen] = useState(false)
  const reviewBadge =
    item.reviewStatus === 'pending_delete'
      ? { tone: 'sunset' as const, label: '待删除' }
      : item.reviewStatus === 'hidden'
        ? { tone: 'default' as const, label: '已隐藏' }
        : null

  return (
    <div class={styles.mediaTile} style={selected ? { outline: '2px solid var(--uniform-blue)', outlineOffset: -1 } : undefined}>
      <label style={{ cursor: 'pointer', position: 'relative', display: 'block' }}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`选择 ${item.filename}`}
          style={{ position: 'absolute', top: 8, left: 8, zIndex: 2, accentColor: 'var(--uniform-blue)', width: 18, height: 18 }}
        />
        {item.thumbnailUrl ? (
          <img class={styles.thumb} src={item.thumbnailUrl} alt={item.filename} loading="lazy" decoding="async" />
        ) : (
          <span class={styles.thumbPlaceholder}>
            <Icon name="image" size={30} />
          </span>
        )}
        {reviewBadge ? (
          <span class={styles.tileBadge}>
            <Badge tone={reviewBadge.tone}>{reviewBadge.label}</Badge>
          </span>
        ) : null}
      </label>
      <div class={styles.mediaInfo}>
        <span class={styles.mediaName} title={item.filename}>
          {item.filename}
        </span>
        <span class={styles.mediaMeta}>
          {formatBytes(item.finalBytes)} · {formatDateTime(item.uploadedAt)}
        </span>
        <span class={styles.mediaMeta}>{item.uploaderNickname}</span>
      </div>
      <div class={styles.mediaActions}>
        <Button size="sm" variant="quiet" onClick={onDownload} disabled={!item.downloadUrl}>
          下载
        </Button>
        {item.reviewStatus === 'approved' ? (
          <Button size="sm" variant="quiet" onClick={() => setDeleteOpen(true)}>
            申请删除
          </Button>
        ) : null}
      </div>
      {deleteOpen ? (
        <DeleteRequestModal item={item} onClose={() => setDeleteOpen(false)} onDeleted={onDeleted} />
      ) : null}
    </div>
  )
}

function DeleteRequestModal({
  item,
  onClose,
  onDeleted,
}: {
  item: MediaItem
  onClose: () => void
  onDeleted: () => void
}): preact.JSX.Element {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    if (!reason.trim()) {
      showToast('请填写删除理由。', 'error')
      return
    }
    setBusy(true)
    try {
      await albumApi.requestDelete(item.id, reason.trim())
      showToast('删除申请已提交，审核前照片会立即对你隐藏。')
      onDeleted()
      onClose()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '提交失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class={styles.modalOverlay} onClick={onClose} role="presentation">
      <div class={styles.modal} role="dialog" aria-modal="true" aria-label="申请删除照片" onClick={(event) => event.stopPropagation()}>
        <h3 class={styles.modalTitle}>申请删除这张照片</h3>
        <p class={styles.storageLabel}>{item.filename}</p>
        <Notice tone="info" icon="info">
          提交后照片会立即从相册隐藏，管理员审核通过后彻底删除。
        </Notice>
        <TextField
          label="删除理由"
          value={reason}
          maxLength={100}
          counterMax={100}
          onInput={(event) => setReason((event.currentTarget as HTMLInputElement).value)}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="danger" onClick={() => void submit()} loading={busy}>
            提交删除申请
          </Button>
          <Button variant="quiet" onClick={onClose}>
            取消
          </Button>
        </div>
      </div>
    </div>
  )
}

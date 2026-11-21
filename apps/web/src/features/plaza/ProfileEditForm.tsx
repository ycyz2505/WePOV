import { useState } from 'preact/hooks'
import { profileApi } from '../../lib/api'
import type { ProfileDetail } from '../../lib/types'
import { Button, Field, Notice, TextArea, TextField } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { processAvatar, processBackground } from '../../lib/image'
import { showToast } from '../../lib/toast'
import { formatBytes } from '../../lib/format'
import styles from './plaza.module.css'

interface EditFormProps {
  profile: ProfileDetail
  onSaved: (profile: ProfileDetail) => void
  onCancel: () => void
}

export function ProfileEditForm({ profile, onSaved, onCancel }: EditFormProps): preact.JSX.Element {
  const [nickname, setNickname] = useState(profile.nickname)
  const [signature, setSignature] = useState(profile.signature)
  const [introduction, setIntroduction] = useState(profile.introduction)
  const [birthday, setBirthday] = useState(profile.birthday ?? '')
  const [birthdayVisible, setBirthdayVisible] = useState(profile.birthdayVisible)
  const [avatarKey, setAvatarKey] = useState<string | null>(null)
  const [backgroundKey, setBackgroundKey] = useState<string | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(profile.avatarUrl)
  const [backgroundPreview, setBackgroundPreview] = useState<string | null>(profile.backgroundUrl)
  const [clearBackground, setClearBackground] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pickAvatar = async (file: File): Promise<void> => {
    try {
      const result = await processAvatar(file)
      if (!result.withinLimit) {
        showToast('头像压缩后仍超过 40 KB，请换一张更简单的图片。', 'error')
        return
      }
      const preview = URL.createObjectURL(result.blob)
      setAvatarPreview(preview)
      const ticket = await uploadImageForProfile(result.blob, 'avatar')
      setAvatarKey(ticket)
      showToast(`头像已处理：${formatBytes(result.bytes)}`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : '头像处理失败', 'error')
    }
  }

  const pickBackground = async (file: File): Promise<void> => {
    try {
      const result = await processBackground(file)
      if (!result.withinLimit) {
        showToast('背景压缩后仍超过 120 KB，请换一张更简单的图片。', 'error')
        return
      }
      const preview = URL.createObjectURL(result.blob)
      setBackgroundPreview(preview)
      setClearBackground(false)
      const ticket = await uploadImageForProfile(result.blob, 'background')
      setBackgroundKey(ticket)
      showToast(`背景已处理：${formatBytes(result.bytes)}`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : '背景处理失败', 'error')
    }
  }

  const submit = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      const updated = await profileApi.update({
        nickname: nickname.trim(),
        signature: signature.trim(),
        introduction: introduction.trim(),
        birthday: birthday || null,
        birthdayVisible,
        ...(avatarKey ? { avatarObjectKey: avatarKey } : {}),
        ...(clearBackground
          ? { backgroundObjectKey: null }
          : backgroundKey
            ? { backgroundObjectKey: backgroundKey }
            : {}),
      })
      showToast('资料已保存。')
      onSaved(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败，请重试。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      class={styles.editForm}
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div>
        <p class={styles.previewLabel}>头像（256×256，≤40 KB）</p>
        <div class={styles.imageEditRow}>
          <span class={[styles.imagePreview, styles.avatarPreview].join(' ')}>
            {avatarPreview ? (
              <img src={avatarPreview} alt="头像预览" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              '未上传'
            )}
          </span>
          <label class={styles.userName} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', border: '1px solid var(--desk)', borderRadius: 6, padding: '8px 12px' }}>
            <Icon name="upload" size={16} /> 上传头像
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = (event.currentTarget as HTMLInputElement).files?.[0]
                if (file) void pickAvatar(file)
              }}
            />
          </label>
        </div>
      </div>

      <div>
        <p class={styles.previewLabel}>背景（960×320，≤120 KB）</p>
        <div class={styles.imageEditRow}>
          <span class={[styles.imagePreview, styles.bgPreview].join(' ')}>
            {!clearBackground && backgroundPreview ? (
              <img src={backgroundPreview} alt="背景预览" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              '无背景'
            )}
          </span>
          <label class={styles.userName} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', border: '1px solid var(--desk)', borderRadius: 6, padding: '8px 12px' }}>
            <Icon name="image" size={16} /> 上传背景
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = (event.currentTarget as HTMLInputElement).files?.[0]
                if (file) void pickBackground(file)
              }}
            />
          </label>
          <Button
            size="sm"
            variant="quiet"
            onClick={() => {
              setClearBackground(true)
              setBackgroundPreview(null)
              setBackgroundKey(null)
            }}
          >
            清除背景
          </Button>
        </div>
        <p class={styles.previewLabel} style={{ marginTop: 6 }}>
          优先 WebP，不支持时自动回退 JPEG。图片只在你的浏览器里压缩后上传。
        </p>
      </div>

      <TextField
        label="昵称"
        value={nickname}
        counterMax={12}
        required
        maxLength={12}
        hint="全站不区分大小写唯一，1–12 字。"
        onInput={(event) => setNickname((event.currentTarget as HTMLInputElement).value)}
      />

      <TextField
        label="个性签名"
        value={signature}
        counterMax={30}
        maxLength={30}
        onInput={(event) => setSignature((event.currentTarget as HTMLInputElement).value)}
      />

      <TextArea
        label="个人介绍"
        value={introduction}
        counterMax={200}
        maxLength={200}
        rows={4}
        onInput={(event) => setIntroduction((event.currentTarget as HTMLTextAreaElement).value)}
      />

      <Field label="生日" htmlFor="edit-birthday" hint="只有你选择公开时，全班才能看到。">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            id="edit-birthday"
            class="input"
            type="date"
            value={birthday}
            style={{ maxWidth: 200 }}
            onInput={(event) => setBirthday((event.currentTarget as HTMLInputElement).value)}
          />
          <label class={styles.toggleRow}>
            <button
              type="button"
              class={styles.switch}
              data-on={birthdayVisible}
              role="switch"
              aria-checked={birthdayVisible}
              onClick={() => setBirthdayVisible((value) => !value)}
            >
              <span class={styles.switchKnob} />
            </button>
            公开生日
          </label>
        </div>
      </Field>

      <Notice tone="info" icon="info">
        真实姓名、性别和学号由总管理员维护，普通同学不能修改；学号也不会展示在任何卡片上。
      </Notice>

      {error ? (
        <Notice tone="danger" icon="alert">
          {error}
        </Notice>
      ) : null}

      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="primary" type="submit" loading={saving}>
          保存资料
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          取消
        </Button>
      </div>
    </form>
  )
}

async function uploadImageForProfile(blob: Blob, kind: 'avatar' | 'background'): Promise<string> {
  // Avatars/backgrounds bypass the album pipeline: the server stores them under
  // the caller's own prefix and returns the object key.
  const mime = blob.type === 'image/png' || blob.type === 'image/jpeg' ? blob.type : 'image/webp'
  const prepared = blob.type === mime ? blob : new Blob([blob], { type: mime })
  const dataBase64 = await blobToBase64(prepared)
  const result = await profileApi.uploadAsset({ kind, mime, dataBase64 })
  return result.objectKey
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(blob)
  })
}

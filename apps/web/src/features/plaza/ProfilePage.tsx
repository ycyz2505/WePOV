import { useEffect, useState } from 'preact/hooks'
import { profileApi, followApi } from '../../lib/api'
import type { FollowUser, ProfileDetail } from '../../lib/types'
import { AppShell } from '../../components/AppShell'
import { Avatar, Button, Notice, Skeleton, StateBlock } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { useAsync, describeError } from '../../lib/useAsync'
import { showToast } from '../../lib/toast'
import { formatDate, genderLabel } from '../../lib/format'
import { navigate } from '../../lib/router'
import { currentUser } from '../../lib/session'
import { cn } from '../../lib/cn'
import { ProfileEditForm } from './ProfileEditForm'
import styles from './plaza.module.css'

type Tab = 'profile' | 'following' | 'followers'

export function ProfilePage({ userId }: { userId: string }): preact.JSX.Element {
  const me = currentUser.value
  const isSelf = userId === 'me' || userId === me?.id
  const profile = useAsync<ProfileDetail>(
    () => (isSelf ? profileApi.me() : profileApi.get(userId)),
    [userId, isSelf],
  )
  const [tab, setTab] = useState<Tab>('profile')
  const [editing, setEditing] = useState(false)

  const data = profile.state.status === 'success' ? profile.state.data : null
  const title = data ? `${data.nickname} 的空间` : '个人空间'

  return (
    <AppShell activeKey="plaza" title={title}>
      {profile.state.status === 'loading' ? <ProfileSkeleton /> : null}
      {profile.state.status === 'error' ? (
        <ErrorState error={profile.state.error} onRetry={profile.reload} />
      ) : null}

      {data ? (
        <div class={styles.profileLayout}>
          <aside class={styles.profileAside}>
            <div class={styles.bigCard}>
              <div class={styles.bigCover}>
                {data.backgroundUrl ? <img class={styles.bigCoverImg} src={data.backgroundUrl} alt="" /> : null}
              </div>
              <div class={styles.bigBody}>
                <span class={styles.bigAvatar}>
                  <Avatar name={data.nickname} src={data.avatarUrl} seed={data.userId} size={74} />
                </span>
                <div>
                  <div class={styles.bigName}>{data.nickname}</div>
                  <div class={styles.bigReal}>
                    {data.realName} · {genderLabel(data.gender)}
                  </div>
                </div>
                {data.isMutual ? (
                  <span class={styles.mutualTag}>
                    <Icon name="users" size={12} /> 你们互相关注
                  </span>
                ) : null}
                <div class={styles.statRow}>
                  <button type="button" class={styles.stat} onClick={() => setTab('following')}>
                    <span class={styles.statValue}>{data.followingCount}</span>
                    <span class={styles.statLabel}>关注</span>
                  </button>
                  <button type="button" class={styles.stat} onClick={() => setTab('followers')}>
                    <span class={styles.statValue}>{data.followerCount}</span>
                    <span class={styles.statLabel}>粉丝</span>
                  </button>
                  <div class={styles.stat}>
                    <span class={styles.statValue}>{data.likeCount}</span>
                    <span class={styles.statLabel}>点赞</span>
                  </div>
                </div>
                {isSelf ? (
                  <Button variant="quiet" block onClick={() => setEditing((value) => !value)}>
                    <Icon name="edit" size={16} /> {editing ? '退出编辑' : '编辑资料'}
                  </Button>
                ) : (
                  <FollowButton profile={data} onChanged={profile.reload} />
                )}
              </div>
            </div>
          </aside>

          <div class={styles.profileMain}>
            <div class={styles.filterRow} role="tablist" aria-label="空间分区">
              <button
                type="button"
                class={cn(styles.userName, tab === 'profile' && styles.nickname)}
                role="tab"
                aria-selected={tab === 'profile'}
                onClick={() => setTab('profile')}
                style={{ padding: '8px 4px', borderBottom: tab === 'profile' ? '2px solid var(--uniform-blue)' : '2px solid transparent' }}
              >
                资料
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'following'}
                onClick={() => setTab('following')}
                style={{ padding: '8px 4px', color: tab === 'following' ? 'var(--ink)' : 'var(--ink-muted)', borderBottom: tab === 'following' ? '2px solid var(--uniform-blue)' : '2px solid transparent', background: 'none', border: 'none', borderBottomWidth: 2, borderBottomStyle: 'solid', borderBottomColor: tab === 'following' ? 'var(--uniform-blue)' : 'transparent', cursor: 'pointer', fontSize: 14 }}
              >
                关注 {data.followingCount}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'followers'}
                onClick={() => setTab('followers')}
                style={{ padding: '8px 4px', color: tab === 'followers' ? 'var(--ink)' : 'var(--ink-muted)', background: 'none', border: 'none', borderBottomWidth: 2, borderBottomStyle: 'solid', borderBottomColor: tab === 'followers' ? 'var(--uniform-blue)' : 'transparent', cursor: 'pointer', fontSize: 14 }}
              >
                粉丝 {data.followerCount}
              </button>
            </div>

            {editing && isSelf ? (
              <ProfileEditForm
                profile={data}
                onSaved={(updated) => {
                  setEditing(false)
                  profile.setData(() => updated)
                }}
                onCancel={() => setEditing(false)}
              />
            ) : tab === 'profile' ? (
              <ProfileDetails profile={data} />
            ) : tab === 'following' ? (
              <FollowList userId={data.userId} kind="following" />
            ) : (
              <FollowList userId={data.userId} kind="followers" />
            )}
          </div>
        </div>
      ) : null}
    </AppShell>
  )
}

function ProfileDetails({ profile }: { profile: ProfileDetail }): preact.JSX.Element {
  return (
    <div class={styles.detailList}>
      <div class={styles.detailRow}>
        <span class={styles.detailLabel}>昵称</span>
        <span class={styles.detailValue}>{profile.nickname}</span>
      </div>
      <div class={styles.detailRow}>
        <span class={styles.detailLabel}>真实姓名</span>
        <span class={styles.detailValue}>{profile.realName}</span>
      </div>
      <div class={styles.detailRow}>
        <span class={styles.detailLabel}>性别</span>
        <span class={styles.detailValue}>{genderLabel(profile.gender)}</span>
      </div>
      <div class={styles.detailRow}>
        <span class={styles.detailLabel}>生日</span>
        <span class={styles.detailValue}>
          {profile.birthdayVisible && profile.birthday ? formatDate(profile.birthday) : '生日未公开'}
        </span>
      </div>
      <div class={styles.detailRow}>
        <span class={styles.detailLabel}>个性签名</span>
        <span class={styles.detailValue}>{profile.signature || '还没有签名'}</span>
      </div>
      <div class={styles.detailRow}>
        <span class={styles.detailLabel}>个人介绍</span>
        <span class={styles.detailValue}>{profile.introduction || '还没有介绍'}</span>
      </div>
      <div class={styles.detailRow}>
        <span class={styles.detailLabel}>最近更新</span>
        <span class={`${styles.detailValue} numeral`}>
          {formatDate(profile.updatedAt)}
        </span>
      </div>
    </div>
  )
}

function FollowButton({ profile, onChanged }: { profile: ProfileDetail; onChanged: () => void }): preact.JSX.Element {
  const [following, setFollowing] = useState(profile.isFollowing)
  const [busy, setBusy] = useState(false)

  const toggle = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = following
        ? await followApi.unfollow(profile.userId)
        : await followApi.follow(profile.userId)
      setFollowing(result.following)
      onChanged()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '操作失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant={following ? 'quiet' : 'primary'} block onClick={() => void toggle()} loading={busy}>
      {following ? '已关注' : '关注'}
    </Button>
  )
}

function FollowList({ userId, kind }: { userId: string; kind: 'following' | 'followers' }): preact.JSX.Element {
  const list = useAsync(
    () => (kind === 'following' ? profileApi.following(userId) : profileApi.followers(userId)),
    [userId, kind],
  )

  if (list.state.status === 'loading') {
    return (
      <div>
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} class={styles.userRow} aria-hidden="true">
            <Skeleton width="40px" height={40} radius={20} />
            <div style={{ flex: 1 }}>
              <Skeleton width="40%" height={14} />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (list.state.status === 'error') {
    return <ErrorState error={list.state.error} onRetry={list.reload} />
  }

  if (list.state.status !== 'success') {
    return <div />
  }

  if (list.state.data.items.length === 0) {
    return (
      <StateBlock
        icon="users"
        title={kind === 'following' ? '还没有关注任何人' : '还没有粉丝'}
        body={kind === 'following' ? '在广场找到感兴趣的同学，点关注即可。' : '当有同学关注你时，会出现在这里。'}
      />
    )
  }

  return (
    <div>
      {list.state.data.items.map((user) => (
        <FollowRow key={user.userId} user={user} onChanged={list.reload} />
      ))}
    </div>
  )
}

function FollowRow({ user, onChanged }: { user: FollowUser; onChanged: () => void }): preact.JSX.Element {
  const [following, setFollowing] = useState(user.isFollowing)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!confirming) return undefined
    const timer = window.setTimeout(() => setConfirming(false), 3000)
    return () => window.clearTimeout(timer)
  }, [confirming])

  const act = async (): Promise<void> => {
    if (following && !confirming) {
      setConfirming(true)
      return
    }
    setBusy(true)
    try {
      const result = following
        ? await followApi.unfollow(user.userId)
        : await followApi.follow(user.userId)
      setFollowing(result.following)
      setConfirming(false)
      onChanged()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '操作失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class={styles.userRow}>
      <Avatar name={user.nickname} src={user.avatarUrl} seed={user.userId} size={40} />
      <div class={styles.userMeta}>
        <button
          type="button"
          class={styles.userName}
          onClick={() => navigate(`/plaza/${user.userId}`)}
        >
          {user.nickname}
        </button>
        <span class={styles.userSub}>
          {user.realName} · {genderLabel(user.gender)}
          {user.isMutual ? ' · 互相关注' : ''}
        </span>
      </div>
      <Button
        size="sm"
        variant={following ? (confirming ? 'danger' : 'quiet') : 'primary'}
        onClick={() => void act()}
        loading={busy}
      >
        {following ? (confirming ? '确认取关' : '已关注') : '关注'}
      </Button>
    </div>
  )
}

function ProfileSkeleton(): preact.JSX.Element {
  return (
    <div class={styles.profileLayout}>
      <div class={styles.profileAside}>
        <div class={styles.bigCard}>
          <Skeleton height={120} radius={0} />
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Skeleton width="80px" height={80} radius={40} />
            <Skeleton width="50%" height={20} />
            <Skeleton width="70%" height={14} />
            <Skeleton width="100%" height={40} />
          </div>
        </div>
      </div>
      <div>
        <Skeleton width="100%" height={40} />
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} width="100%" height={20} />
          ))}
        </div>
      </div>
    </div>
  )
}

function ErrorState({ error, onRetry }: { error: Error; onRetry: () => void }): preact.JSX.Element {
  const info = describeError(error)
  return (
    <StateBlock icon="alert" title={info.title} body={info.detail} tone="danger">
      {info.retryable ? (
        <Button variant="quiet" onClick={onRetry}>
          <Icon name="refresh" size={16} /> 重试
        </Button>
      ) : null}
    </StateBlock>
  )
}

export { Notice }

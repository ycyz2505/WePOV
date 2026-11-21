import { useMemo, useState } from 'preact/hooks'
import { profileApi, followApi } from '../../lib/api'
import type { ProfileDetail, ProfileSearchQuery } from '../../lib/types'
import { AppShell } from '../../components/AppShell'
import { Avatar, Button, Chip, Skeleton, StateBlock } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { useAsync, describeError } from '../../lib/useAsync'
import { showToast } from '../../lib/toast'
import { genderLabel } from '../../lib/format'
import { navigate } from '../../lib/router'
import { currentUser } from '../../lib/session'
import styles from './plaza.module.css'

const FILTERS: Array<{ key: ProfileSearchQuery['filter']; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'following', label: '我的关注' },
  { key: 'followers', label: '我的粉丝' },
  { key: 'mutual', label: '互相关注' },
  { key: 'not_following', label: '尚未关注' },
]

const SORTS: Array<{ key: NonNullable<ProfileSearchQuery['sort']>; label: string }> = [
  { key: 'recent', label: '最近更新' },
  { key: 'nickname', label: '昵称' },
  { key: 'likes', label: '点赞量' },
  { key: 'followers', label: '粉丝量' },
]

const GENDERS: Array<{ key: string; label: string }> = [
  { key: '', label: '全部性别' },
  { key: 'male', label: '男' },
  { key: 'female', label: '女' },
]

export function PlazaPage(): preact.JSX.Element {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [filter, setFilter] = useState<ProfileSearchQuery['filter']>('all')
  const [sort, setSort] = useState<NonNullable<ProfileSearchQuery['sort']>>('recent')
  const [gender, setGender] = useState('')
  const [accumulated, setAccumulated] = useState<ProfileDetail[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  // debounce search input
  useMemo(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 280)
    return () => window.clearTimeout(timer)
  }, [query])

  const firstPage = useAsync(
    () => profileApi.list({ q: debounced || undefined, filter, sort, gender: gender || undefined, limit: 30 }),
    [debounced, filter, sort, gender],
  )

  const items = useMemo(() => {
    if (firstPage.state.status !== 'success') return []
    return [...firstPage.state.data.items, ...accumulated]
  }, [firstPage.state, accumulated])

  const nextCursor = firstPage.state.status === 'success' ? cursor : null

  const loadMore = async (): Promise<void> => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await profileApi.list({
        q: debounced || undefined,
        filter,
        sort,
        gender: gender || undefined,
        cursor: nextCursor,
        limit: 30,
      })
      setAccumulated((current) => [...current, ...page.items])
      setCursor(page.nextCursor)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '加载失败', 'error')
    } finally {
      setLoadingMore(false)
    }
  }

  // reset accumulated when filters change
  useMemo(() => {
    setAccumulated([])
    setCursor(firstPage.state.status === 'success' ? firstPage.state.data.nextCursor : null)
  }, [debounced, filter, sort, gender, firstPage.state.status])

  return (
    <AppShell activeKey="plaza" title="广场">
      <div class={styles.page}>
        <div class={styles.toolbar}>
          <div class={styles.searchRow}>
            <div class={styles.searchBox}>
              <span class={styles.searchIcon}>
                <Icon name="search" size={18} />
              </span>
              <input
                class={styles.searchInput}
                type="search"
                placeholder="搜索昵称、真实姓名或拼音首字母"
                aria-label="搜索同学"
                value={query}
                onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
              />
            </div>
            <label class={styles.selectWrap}>
              排序
              <select
                class={styles.select}
                value={sort}
                onChange={(event) => setSort((event.currentTarget as HTMLSelectElement).value as typeof sort)}
                aria-label="排序方式"
              >
                {SORTS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label class={styles.selectWrap}>
              性别
              <select
                class={styles.select}
                value={gender}
                onChange={(event) => setGender((event.currentTarget as HTMLSelectElement).value)}
                aria-label="性别筛选"
              >
                {GENDERS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div class={styles.filterRow} role="tablist" aria-label="关注筛选">
            {FILTERS.map((option) => (
              <Chip
                key={option.key}
                active={filter === option.key}
                onClick={() => setFilter(option.key)}
              >
                {option.label}
              </Chip>
            ))}
          </div>
        </div>

        {firstPage.state.status === 'loading' ? (
          <div class={styles.cardGrid}>
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} class={styles.personCard} style={{ padding: 0 }} aria-hidden="true">
                <Skeleton height={84} radius={0} />
                <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Skeleton width="50%" height={16} />
                  <Skeleton width="70%" height={12} />
                  <Skeleton width="100%" height={12} />
                </div>
              </div>
            ))}
          </div>
        ) : firstPage.state.status === 'error' ? (
          <ErrorState error={firstPage.state.error} onRetry={firstPage.reload} />
        ) : items.length === 0 ? (
          <EmptyState hasQuery={debounced.length > 0 || filter !== 'all'} onReset={() => {
            setQuery('')
            setFilter('all')
            setGender('')
          }} />
        ) : (
          <>
            <div class={styles.cardGrid}>
              {items.map((profile) => (
                <PersonCard key={profile.userId} profile={profile} onChanged={firstPage.reload} />
              ))}
            </div>
            {nextCursor ? (
              <div style={{ textAlign: 'center', marginTop: 8 }}>
                <Button variant="quiet" onClick={() => void loadMore()} loading={loadingMore}>
                  加载更多
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </AppShell>
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

function EmptyState({ hasQuery, onReset }: { hasQuery: boolean; onReset: () => void }): preact.JSX.Element {
  return (
    <StateBlock
      icon="users"
      title={hasQuery ? '没有找到匹配的同学' : '广场还是空的'}
      body={hasQuery ? '换个关键词，或清除筛选条件再试。' : '等第一批同学加入后，这里会展示每个人的卡片。'}
    >
      {hasQuery ? (
        <Button variant="quiet" onClick={onReset}>
          清除筛选
        </Button>
      ) : null}
    </StateBlock>
  )
}

export function PersonCard({
  profile,
  onChanged,
}: {
  profile: ProfileDetail
  onChanged?: () => void
}): preact.JSX.Element {
  const [following, setFollowing] = useState(profile.isFollowing)
  const [mutual, setMutual] = useState(profile.isMutual)
  const [likeCount, setLikeCount] = useState(profile.likeCount)
  const [busy, setBusy] = useState(false)
  const me = currentUser.value
  const isSelf = me?.id === profile.userId

  const toggleFollow = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = following
        ? await followApi.unfollow(profile.userId)
        : await followApi.follow(profile.userId)
      setFollowing(result.following)
      setMutual(result.mutual)
      onChanged?.()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '操作失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const like = async (): Promise<void> => {
    if (isSelf) return
    try {
      const result = await followApi.like(profile.userId)
      setLikeCount(result.likeCount)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '点赞失败', 'error')
    }
  }

  return (
    <article class={styles.personCard}>
      <div class={styles.cover}>
        {profile.backgroundUrl ? (
          <img class={styles.coverImg} src={profile.backgroundUrl} alt="" loading="lazy" />
        ) : null}
      </div>
      <div class={styles.cardBody}>
        <div class={styles.cardTop}>
          <span class={styles.cardAvatar}>
            <Avatar name={profile.nickname} src={profile.avatarUrl} seed={profile.userId} size={52} />
          </span>
          {!isSelf ? (
            <Button
              size="sm"
              variant={following ? 'quiet' : 'primary'}
              class={styles.followBtn}
              onClick={() => void toggleFollow()}
              loading={busy}
            >
              {following ? '已关注' : '关注'}
            </Button>
          ) : null}
        </div>

        <div class={styles.cardNames}>
          <div class={styles.nicknameRow}>
            <a
              class={styles.nickname}
              href={`/plaza/${profile.userId}`}
              onClick={(event) => {
                event.preventDefault()
                navigate(`/plaza/${profile.userId}`)
              }}
            >
              {profile.nickname}
            </a>
            <span class={styles.realName}>{profile.realName}</span>
            {mutual ? (
              <span class={styles.mutualTag}>
                <Icon name="users" size={12} /> 互相关注
              </span>
            ) : null}
          </div>
          <div class={styles.cardMeta}>
            <span class={styles.cardMetaItem}>{genderLabel(profile.gender)}</span>
            <span class={styles.cardMetaItem}>
              <Icon name="calendar" size={12} />
              {profile.birthdayVisible && profile.birthday ? profile.birthday : '生日未公开'}
            </span>
          </div>
        </div>

        {profile.signature ? <p class={styles.signature}>{profile.signature}</p> : null}
        {profile.introduction ? <p class={styles.intro}>{profile.introduction}</p> : null}

        <div class={styles.cardFooter}>
          <div class={styles.countRow}>
            <button type="button" class={styles.countBtn} onClick={() => void like()} aria-label="点赞">
              <Icon name="heart" size={14} />
              <strong>{likeCount}</strong>
            </button>
            <span class={styles.countBtn}>
              关注 <strong>{profile.followingCount}</strong>
            </span>
            <span class={styles.countBtn}>
              粉丝 <strong>{profile.followerCount}</strong>
            </span>
          </div>
        </div>
      </div>
    </article>
  )
}

export { genderLabel }

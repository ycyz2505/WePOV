import { useEffect, useState } from 'preact/hooks'
import { treeApi } from '../../lib/api'
import { AppShell } from '../../components/AppShell'
import { Button, Chip, StateBlock } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { useAsync, describeError } from '../../lib/useAsync'
import { navigate } from '../../lib/router'
import { cn } from '../../lib/cn'
import styles from './tree.module.css'

const TAGS = ['全部', '吐槽', '求助', '表白墙', '学习', '心情', '找搭子', '失物招领']

export function BulletWallPage(): preact.JSX.Element {
  const [tag, setTag] = useState('全部')
  const [animated, setAnimated] = useState(true)
  const [paused, setPaused] = useState(false)
  const wall = useAsync(
    () => treeApi.bullets(tag === '全部' ? undefined : tag),
    [tag],
  )

  const items = wall.state.status === 'success' ? wall.state.data.items : []

  // Respect reduced-motion: default to static list
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    setAnimated(!media.matches)
  }, [])

  return (
    <AppShell activeKey="tree" title="弹幕墙">
      <div class={styles.page}>
        <button type="button" class={styles.footAction} onClick={() => navigate('/tree')}>
          <Icon name="arrow-left" size={16} /> 返回树洞
        </button>

        <div class={styles.wallControls}>
          {TAGS.map((option) => (
            <Chip key={option} active={tag === option} onClick={() => setTag(option)}>
              {option}
            </Chip>
          ))}
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="quiet" onClick={() => setAnimated((value) => !value)}>
            {animated ? '切换为静态列表' : '切换为弹幕'}
          </Button>
          {animated ? (
            <Button size="sm" variant="quiet" onClick={() => setPaused((value) => !value)}>
              {paused ? '继续' : '暂停'}
            </Button>
          ) : null}
        </div>

        {wall.state.status === 'error' ? (
          <StateBlock icon="alert" title={describeError(wall.state.error).title} body={describeError(wall.state.error).detail} tone="danger">
            <Button variant="quiet" onClick={wall.reload}>
              重试
            </Button>
          </StateBlock>
        ) : null}

        {wall.state.status === 'success' && items.length === 0 ? (
          <StateBlock icon="message" title="弹幕墙还是空的" body="在发帖时勾选“允许进入弹幕墙”，内容就会出现在这里。" />
        ) : null}

        {items.length > 0 && animated ? (
          <div class={styles.wallWrap} aria-label="弹幕墙，内容持续滚动">
            {items.map((item, index) => (
              <span
                key={item.id}
                class={styles.wallLane}
                style={{
                  top: `${8 + (index % 9) * 10}%`,
                  animationDuration: `${16 + (index % 5) * 4}s`,
                  animationDelay: `${index * 1.6}s`,
                  animationPlayState: paused ? 'paused' : 'running',
                }}
              >
                {item.content}
              </span>
            ))}
          </div>
        ) : null}

        {items.length > 0 && !animated ? (
          <div class={styles.wallStatic}>
            {items.map((item) => (
              <div key={item.id} class={styles.wallStaticItem}>
                {item.content}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </AppShell>
  )
}

export { cn }

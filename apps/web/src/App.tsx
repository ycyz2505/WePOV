import { useEffect, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import { initRouter, navigate, parseLocation, routePath } from './lib/router'
import { matchRoute, type RouteMatch } from './lib/routes'
import { initNetworkWatch } from './lib/network'
import { initSessionLifecycle } from './lib/idle'
import {
  authReady,
  checkGateway,
  currentUser,
  gatewayChecking,
  gatewayVerified,
  isAdmin,
  isSuperAdmin,
  loadSession,
  registerVersionGate,
  sessionExpired,
  unreadCount,
} from './lib/session'
import { notificationApi } from './lib/api'
import type { AppVersionPolicy } from './lib/types'
import { notificationStream } from './lib/sse'
import { showToast } from './lib/toast'
import { UpdateGate } from './components/UpdateGate'
import { ToastHost } from './components/ToastHost'
import { AppShell } from './components/AppShell'
import { Button, StateBlock } from './components/ui'
import { Viewfinder } from './components/Viewfinder'
import { GatewayScreen } from './features/gateway/GatewayScreen'
import { LoginScreen } from './features/auth/LoginScreen'
import { ForcedPasswordChange } from './features/auth/ForcedPasswordChange'
import { ClassroomPage } from './features/classroom/ClassroomPage'
import { PlazaPage } from './features/plaza/PlazaPage'
import { ProfilePage } from './features/plaza/ProfilePage'
import { TreePage } from './features/tree/TreePage'
import { TreeComposePage } from './features/tree/TreeComposePage'
import { TreeDetailPage } from './features/tree/TreeDetailPage'
import { TreeMinePage } from './features/tree/TreeMinePage'
import { BulletWallPage } from './features/tree/BulletWallPage'
import { PartnerPage } from './features/partner/PartnerPage'
import { PartnerCreatePage } from './features/partner/PartnerCreatePage'
import { PartnerDetailPage } from './features/partner/PartnerDetailPage'
import { AlbumPage } from './features/album/AlbumPage'
import { CapsuleListPage } from './features/capsule/CapsuleListPage'
import { CapsuleCreatePage } from './features/capsule/CapsuleCreatePage'
import { CapsuleDetailPage } from './features/capsule/CapsuleDetailPage'
import { NotificationsPage } from './features/notifications/NotificationsPage'
import { MePage } from './features/me/MePage'
import { AdminHomePage } from './features/admin/AdminHomePage'
import { AdminRosterPage } from './features/admin/AdminRosterPage'
import { AdminModerationPage } from './features/admin/AdminModerationPage'
import { AdminRecyclePage } from './features/admin/AdminRecyclePage'
import { AdminLogsPage } from './features/admin/AdminLogsPage'
import { AdminSecurityPage } from './features/admin/AdminSecurityPage'
import styles from './App.module.css'

export function App(): JSX.Element {
  const [versionPolicy, setVersionPolicy] = useState<AppVersionPolicy | null>(null)

  // One-time boot: router, network watch, idle lifecycle, gateway + session probe.
  useEffect(() => {
    const cleanups = [initRouter(), initNetworkWatch(), initSessionLifecycle()]
    void (async () => {
      const verified = await checkGateway()
      if (verified) {
        await loadSession().catch(() => {
          /* network errors surface through the UI; treat as signed-out */
        })
      }
    })()
    return () => {
      for (const cleanup of cleanups) cleanup()
    }
  }, [])

  // Register the HTTP 426 version gate handler.
  useEffect(() => {
    registerVersionGate((policy) => setVersionPolicy(policy))
  }, [])

  // Notify when a live session is dropped (401 mid-use).
  useEffect(() => {
    if (sessionExpired.value && !currentUser.value) {
      showToast('登录状态已失效，请重新登录。', 'error')
    }
  }, [sessionExpired.value, currentUser.value])

  // Connect the notification stream and seed the unread badge while signed in.
  useEffect(() => {
    const user = currentUser.value
    if (!user) {
      notificationStream.disconnect()
      return undefined
    }
    notificationStream.connect()
    void notificationApi
      .unreadCount()
      .then((result) => {
        unreadCount.value = result.count
      })
      .catch(() => {
        /* badge stays at last known value */
      })
    return () => {
      notificationStream.disconnect()
    }
  }, [currentUser.value])

  return (
    <>
      <UpdateGate />
      <ToastHost />
      {versionPolicy ? <VersionBlockOverlay policy={versionPolicy} /> : <AppGates />}
    </>
  )
}

function AppGates(): JSX.Element {
  // Privacy gateway: nothing but the passcode screen until verified.
  if (gatewayChecking.value) {
    return <BootSplash />
  }
  if (!gatewayVerified.value) {
    return (
      <GatewayScreen
        onVerified={() => {
          void loadSession().catch(() => {
            /* handled inside; user lands on login screen */
          })
        }}
      />
    )
  }
  if (!authReady.value) {
    return <BootSplash />
  }

  const user = currentUser.value
  if (!user) {
    return <LoginScreen onLoggedIn={() => undefined} />
  }
  if (user.mustChangePassword) {
    return <ForcedPasswordChange onDone={() => navigate('/classroom', { replace: true })} />
  }

  return <RoutedApp />
}

function RoutedApp(): JSX.Element {
  const { pathname } = parseLocation(routePath.value)
  const match = matchRoute(pathname)

  if (match.name.startsWith('admin') && !isAdmin.value) {
    return (
      <AppShell activeKey="plaza" title="没有权限">
        <StateBlock icon="lock" title="需要管理员权限" body="这个页面只对班内管理员开放。如果你认为这是误判，请联系班级管理员。">
          <Button variant="quiet" onClick={() => navigate('/plaza')}>
            返回广场
          </Button>
        </StateBlock>
      </AppShell>
    )
  }

  const superOnly = match.name === 'admin-roster' || match.name === 'admin-recycle' || match.name === 'admin-logs' || match.name === 'admin-security'
  if (superOnly && !isSuperAdmin.value) {
    return (
      <AppShell activeKey="admin" title="没有权限">
        <StateBlock icon="lock" title="需要超级管理员权限" body="这个页面只对超级管理员开放。一般管理员可以处理审核队列。">
          <Button variant="quiet" onClick={() => navigate('/admin')}>
            返回管理首页
          </Button>
        </StateBlock>
      </AppShell>
    )
  }

  return (
    <>
      <a href="#main-content" class="skip-link">
        跳到主内容
      </a>
      <div key={pathname} class={styles.route}>
        {renderRoute(match)}
      </div>
    </>
  )
}

function renderRoute(match: RouteMatch): JSX.Element {
  switch (match.name) {
    case 'classroom':
      return <ClassroomPage />
    case 'plaza':
      return <PlazaPage />
    case 'profile':
      return <ProfilePage userId={match.params.userId ?? 'me'} />
    case 'tree':
      return <TreePage />
    case 'tree-new':
      return <TreeComposePage />
    case 'tree-wall':
      return <BulletWallPage />
    case 'tree-mine':
      return <TreeMinePage />
    case 'tree-detail':
      return <TreeDetailPage postId={match.params.id ?? ''} />
    case 'partners':
      return <PartnerPage />
    case 'partner-new':
      return <PartnerCreatePage />
    case 'partner-detail':
      return <PartnerDetailPage partnerId={match.params.id ?? ''} />
    case 'albums':
      return <AlbumPage folderId={null} />
    case 'album-folder':
      return <AlbumPage folderId={match.params.folderId ?? null} />
    case 'capsules':
      return <CapsuleListPage />
    case 'capsule-new':
      return <CapsuleCreatePage />
    case 'capsule-detail':
      return <CapsuleDetailPage capsuleId={match.params.id ?? ''} />
    case 'notifications':
      return <NotificationsPage />
    case 'me':
      return <MePage />
    case 'admin':
      return <AdminHomePage />
    case 'admin-roster':
      return <AdminRosterPage />
    case 'admin-moderation':
      return <AdminModerationPage />
    case 'admin-recycle':
      return <AdminRecyclePage />
    case 'admin-logs':
      return <AdminLogsPage />
    case 'admin-security':
      return <AdminSecurityPage />
    default:
      return <NotFoundPage path={match.params.path ?? ''} />
  }
}

function NotFoundPage({ path }: { path: string }): JSX.Element {
  return (
    <AppShell activeKey="plaza" title="页面不存在">
      <StateBlock icon="search" title="这个页面不存在" body={`没有找到 ${path || '该地址'}。可能是链接有误，或者内容已经被删除。`}>
        <Button variant="primary" onClick={() => navigate('/classroom')}>
          回到教室
        </Button>
      </StateBlock>
    </AppShell>
  )
}

function BootSplash(): JSX.Element {
  return (
    <div class={styles.splash} role="status" aria-live="polite">
      <Viewfinder class={styles.splashFrame}>
        <div class={styles.splashInner}>
          <span class={styles.splashMark}>WePOV</span>
          <span class={styles.splashNote}>正在准备…</span>
        </div>
      </Viewfinder>
    </div>
  )
}

function VersionBlockOverlay({ policy }: { policy: AppVersionPolicy }): JSX.Element {
  return (
    <div class={styles.versionOverlay} role="alertdialog" aria-modal="true" aria-labelledby="version-title">
      <div class={styles.versionPanel}>
        <span class={styles.versionMark}>WePOV</span>
        <h1 class={styles.versionTitle} id="version-title">
          需要更新后才能继续使用
        </h1>
        <p class={styles.versionBody}>
          当前网页版本已低于最低支持版本，部分功能或接口已不再兼容。请刷新页面获取最新版本。
        </p>
        <p class={styles.versionNotes}>
          最新版本 {policy.latestVersionName}（{policy.latestVersionCode}），最低支持 {policy.minSupportedVersionCode}。
        </p>
        {policy.notes ? <div class={styles.versionNotes}>{policy.notes}</div> : null}
        <Button variant="primary" block onClick={() => window.location.reload()}>
          刷新页面
        </Button>
        <p class={styles.versionFoot}>如果刷新后仍然出现，请联系班级管理员。</p>
      </div>
    </div>
  )
}

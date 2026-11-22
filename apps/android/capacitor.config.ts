import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.wepov.client',
  appName: '第一人称',
  webDir: '../web/dist',
  bundledWebRuntime: false,
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  server: {
    androidScheme: 'https',
    hostname: 'wepov.local',
    // 客户端加载线上站点：唯一的平台差异是原生强制更新器。
    // 站点换域名时需重新发版 APK。
    url: 'https://wepov.go.altare.global',
    allowNavigation: ['*.altare.global', 'github.com', 'api.github.com'],
  },
}

export default config

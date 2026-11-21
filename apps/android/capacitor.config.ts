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
    allowNavigation: ['*.altare.app', '*.altare.global', 'github.com', 'api.github.com'],
  },
}

export default config

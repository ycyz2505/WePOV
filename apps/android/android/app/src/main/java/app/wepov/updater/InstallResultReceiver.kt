package app.wepov.updater

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class InstallResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        // 安装器返回后不做任何“已更新”假设：下次启动仍以真实 versionCode 判定。
        UpdateRepository.clearCache(context)
    }
}

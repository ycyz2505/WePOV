package app.wepov.updater

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * 强制更新门禁。状态只保存在内存中，由原生层负责检查、下载、校验和拉起安装器；
 * WebView 只负责展示，无法绕过。
 */
object UpdateGate {
    private const val CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000L
    private const val UNKNOWN_GRACE_MS = 15 * 60 * 1000L

    private val worker = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "wepov-updater").apply { isDaemon = true }
    }
    private val main = Handler(Looper.getMainLooper())
    private val busy = AtomicBoolean(false)

    @Volatile private var lastCheckAt = 0L
    @Volatile private var lastKnownGoodAt = 0L
    @Volatile private var snapshot = GateSnapshot(GateState.CHECKING, 0, "")
    @Volatile private var listener: ((GateSnapshot) -> Unit)? = null
    @Volatile private var manifestSources: List<String> = emptyList()
    @Volatile private var pendingApk: File? = null

    fun configure(sources: List<String>) {
        manifestSources = sources.filter { it.startsWith("https://") }
    }

    fun current(): GateSnapshot = snapshot

    fun observe(callback: ((GateSnapshot) -> Unit)?) {
        listener = callback
        callback?.invoke(snapshot)
    }

    fun onForeground(activity: Activity) {
        val now = System.currentTimeMillis()
        if (now - lastCheckAt < CHECK_INTERVAL_MS) return
        check(activity)
    }

    fun check(activity: Activity) {
        val (code, name) = UpdateRepository.currentVersion(activity)
        if (manifestSources.isEmpty()) {
            publish(GateSnapshot(GateState.UNKNOWN, code, name, message = "未配置更新源"))
            return
        }
        publish(GateSnapshot(GateState.CHECKING, code, name))
        worker.execute {
            lastCheckAt = System.currentTimeMillis()
            try {
                val manifest = UpdateRepository.fetchManifest(manifestSources)
                lastKnownGoodAt = System.currentTimeMillis()
                when {
                    code < manifest.minSupportedVersionCode ->
                        publish(GateSnapshot(GateState.HARD_BLOCK, code, name, manifest = manifest))
                    code < manifest.versionCode ->
                        publish(GateSnapshot(GateState.REQUIRED, code, name, manifest = manifest))
                    else ->
                        publish(GateSnapshot(GateState.UP_TO_DATE, code, name, manifest = manifest))
                }
            } catch (error: Exception) {
                val withinGrace = System.currentTimeMillis() - lastKnownGoodAt < UNKNOWN_GRACE_MS
                publish(
                    GateSnapshot(
                        state = GateState.UNKNOWN,
                        currentVersionCode = code,
                        currentVersionName = name,
                        message = if (withinGrace) "暂时无法确认版本，稍后自动重试" else "无法确认版本，请检查网络后重试",
                    ),
                )
            }
        }
    }

    fun download(activity: Activity, mirrorIndex: Int = 0) {
        val current = snapshot
        val manifest = current.manifest ?: return
        if (!busy.compareAndSet(false, true)) return

        worker.execute {
            val mirrorCount = manifest.mirrors.size
            val start = mirrorIndex.coerceIn(0, mirrorCount - 1)
            val attempted = mutableListOf<String>()
            for (offset in 0 until mirrorCount) {
                val mirror = manifest.mirrors[(start + offset) % mirrorCount]
                attempted.add(mirror)
                try {
                    publish(
                        current.copy(
                            state = GateState.DOWNLOADING,
                            progressPercent = 0,
                            bytesDownloaded = 0,
                            bytesTotal = 0,
                            activeMirror = mirror,
                            attemptedMirrors = attempted.size,
                            message = null,
                        ),
                    )
                    val outcome = UpdateRepository.downloadApk(activity, mirror, manifest.apkSha256) { done, total ->
                        val percent = if (total > 0) ((done * 100) / total).toInt() else 0
                        publish(
                            current.copy(
                                state = GateState.DOWNLOADING,
                                progressPercent = percent.coerceIn(0, 100),
                                bytesDownloaded = done,
                                bytesTotal = total,
                                activeMirror = mirror,
                                attemptedMirrors = attempted.size,
                            ),
                        )
                    }
                    publish(current.copy(state = GateState.VERIFYING, activeMirror = mirror, attemptedMirrors = attempted.size))
                    if (!Signatures.matchesInstalledApp(activity, outcome.file.absolutePath)) {
                        outcome.file.delete()
                        throw UpdateError("签名与当前应用不一致")
                    }
                    pendingApk = outcome.file
                    busy.set(false)
                    publish(
                        current.copy(
                            state = GateState.READY,
                            progressPercent = 100,
                            bytesTotal = outcome.file.length(),
                            bytesDownloaded = outcome.file.length(),
                            activeMirror = mirror,
                            attemptedMirrors = attempted.size,
                            message = null,
                        ),
                    )
                    return@execute
                } catch (error: Exception) {
                    // 换下一个源继续尝试
                }
            }
            busy.set(false)
            publish(
                current.copy(
                    state = GateState.FAILED,
                    message = "所有下载源都失败了，请切换网络后重试",
                    attemptedMirrors = attempted.size,
                ),
            )
        }
    }

    fun install(activity: Activity) {
        val apk = pendingApk
        if (apk == null || !apk.exists()) {
            publish(snapshot.copy(state = GateState.FAILED, message = "安装包不存在，请重新下载"))
            return
        }
        launchInstaller(activity, apk)
    }

    fun switchMirror(activity: Activity) {
        val current = snapshot
        val manifest = current.manifest ?: return
        if (manifest.mirrors.size <= 1) return
        download(activity, (current.attemptedMirrors) % manifest.mirrors.size)
    }

    fun clearPending() {
        pendingApk?.delete()
        pendingApk = null
    }

    private fun launchInstaller(activity: Activity, apk: File) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !activity.packageManager.canRequestPackageInstalls()
        ) {
            publish(snapshot.copy(state = GateState.FAILED, message = "请允许安装未知来源应用后重试"))
            val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}"))
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            activity.startActivity(intent)
            return
        }
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", apk)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        publish(snapshot.copy(state = GateState.INSTALLING, message = null))
        activity.startActivity(intent)
    }

    private fun publish(next: GateSnapshot) {
        snapshot = next
        main.post { listener?.invoke(next) }
    }
}

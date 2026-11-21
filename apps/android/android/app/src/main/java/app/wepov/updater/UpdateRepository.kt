package app.wepov.updater

import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

class UpdateError(message: String, cause: Throwable? = null) : Exception(message, cause)

data class DownloadOutcome(
    val file: File,
    val sha256: String,
    val bytes: Long,
)

object UpdateRepository {
    private const val CONNECT_TIMEOUT_MS = 12_000
    private const val READ_TIMEOUT_MS = 30_000
    private const val MAX_MANIFEST_BYTES = 256 * 1024
    private const val MAX_APK_BYTES = 160L * 1024 * 1024
    private const val USER_AGENT = "WePOV-Updater/1"

    fun currentVersion(context: Context): Pair<Long, String> {
        val info: PackageInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.packageManager.getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(0))
        } else {
            @Suppress("DEPRECATION")
            context.packageManager.getPackageInfo(context.packageName, 0)
        }
        val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.longVersionCode
        } else {
            @Suppress("DEPRECATION")
            info.versionCode.toLong()
        }
        val name = info.versionName ?: "0"
        return code to name
    }

    fun fetchManifest(sources: List<String>): UpdateManifest {
        var lastError: Exception? = null
        for (source in sources) {
            try {
                val body = readText(source, MAX_MANIFEST_BYTES)
                val manifest = UpdateManifest.parse(body)
                if (manifest.mirrors.isEmpty()) {
                    throw UpdateError("清单没有可用的下载地址")
                }
                return manifest
            } catch (error: Exception) {
                lastError = error
            }
        }
        throw UpdateError("无法获取版本清单，请检查网络后重试", lastError)
    }

    private fun readText(url: String, limit: Int): String {
        val connection = open(url)
        connection.connect()
        if (connection.responseCode !in 200..299) {
            connection.disconnect()
            throw UpdateError("版本清单返回 ${connection.responseCode}")
        }
        val bytes = connection.inputStream.use { readLimited(it, limit) }
        connection.disconnect()
        return String(bytes, Charsets.UTF_8)
    }

    private fun open(url: String): HttpURLConnection {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.instanceFollowRedirects = true
        connection.connectTimeout = CONNECT_TIMEOUT_MS
        connection.readTimeout = READ_TIMEOUT_MS
        connection.setRequestProperty("User-Agent", USER_AGENT)
        connection.setRequestProperty("Accept", "application/json, application/vnd.android.package-archive, */*")
        return connection
    }

    private fun readLimited(input: InputStream, limit: Int): ByteArray {
        val buffer = ByteArray(8192)
        val output = java.io.ByteArrayOutputStream()
        var total = 0
        while (true) {
            val read = input.read(buffer)
            if (read <= 0) break
            total += read
            if (total > limit) throw UpdateError("响应体超过允许大小")
            output.write(buffer, 0, read)
        }
        return output.toByteArray()
    }

    fun downloadApk(
        context: Context,
        mirror: String,
        expectedSha256: String,
        onProgress: (downloaded: Long, total: Long) -> Unit,
    ): DownloadOutcome {
        val target = File(context.cacheDir, "wepov-update.apk")
        val partial = File(context.cacheDir, "wepov-update.apk.part")
        if (target.exists()) target.delete()
        if (partial.exists()) partial.delete()

        val connection = open(mirror)
        connection.connect()
        if (connection.responseCode !in 200..299) {
            connection.disconnect()
            throw UpdateError("下载源返回 ${connection.responseCode}")
        }
        val total = connection.contentLengthLong.coerceAtLeast(0L)
        if (total > MAX_APK_BYTES) {
            connection.disconnect()
            throw UpdateError("安装包体积异常")
        }

        val digest = MessageDigest.getInstance("SHA-256")
        var downloaded = 0L
        try {
            connection.inputStream.use { input ->
                partial.outputStream().buffered().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read <= 0) break
                        downloaded += read
                        if (downloaded > MAX_APK_BYTES) throw UpdateError("安装包超过体积上限")
                        digest.update(buffer, 0, read)
                        output.write(buffer, 0, read)
                        onProgress(downloaded, total)
                    }
                }
            }
        } catch (error: Exception) {
            partial.delete()
            connection.disconnect()
            throw UpdateError("下载中断：${error.message ?: "网络错误"}", error)
        }
        connection.disconnect()

        val actual = digest.digest().joinToString("") { "%02x".format(it) }
        if (!actual.equals(expectedSha256, ignoreCase = true)) {
            partial.delete()
            throw UpdateError("安装包校验失败，已拒绝安装")
        }
        if (!partial.renameTo(target)) {
            partial.delete()
            throw UpdateError("无法保存安装包")
        }
        return DownloadOutcome(target, actual, downloaded)
    }

    fun clearCache(context: Context) {
        File(context.cacheDir, "wepov-update.apk").delete()
        File(context.cacheDir, "wepov-update.apk.part").delete()
    }
}

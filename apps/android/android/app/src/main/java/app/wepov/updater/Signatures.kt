package app.wepov.updater

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import java.security.MessageDigest

object Signatures {
    private fun sha256Hex(bytes: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
        return digest.joinToString("") { "%02x".format(it) }
    }

    private fun currentSigners(context: Context): List<String> {
        val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            context.packageManager.getPackageInfo(
                context.packageName,
                PackageManager.GET_SIGNING_CERTIFICATES,
            )
        } else {
            @Suppress("DEPRECATION")
            context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_SIGNATURES)
        }
        val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.signingInfo?.apkContentsSigners ?: emptyArray()
        } else {
            @Suppress("DEPRECATION")
            info.signatures ?: emptyArray()
        }
        return signatures.map { sha256Hex(it.toByteArray()) }
    }

    private fun archiveSigners(context: Context, apkPath: String): List<String> {
        val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            context.packageManager.getPackageArchiveInfo(
                apkPath,
                PackageManager.GET_SIGNING_CERTIFICATES,
            )
        } else {
            @Suppress("DEPRECATION")
            context.packageManager.getPackageArchiveInfo(apkPath, PackageManager.GET_SIGNATURES)
        } ?: return emptyList()

        val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.signingInfo?.apkContentsSigners ?: emptyArray()
        } else {
            @Suppress("DEPRECATION")
            info.signatures ?: emptyArray()
        }
        return signatures.map { sha256Hex(it.toByteArray()) }
    }

    /**
     * 下载的 APK 必须与当前安装包使用同一套签名证书，否则视为被替换。
     * 不依赖仓库内硬编码指纹，避免证书轮换后永久失效。
     */
    fun matchesInstalledApp(context: Context, apkPath: String): Boolean {
        val current = currentSigners(context)
        val candidate = archiveSigners(context, apkPath)
        if (current.isEmpty() || candidate.isEmpty()) return false
        return current.toSet() == candidate.toSet()
    }
}

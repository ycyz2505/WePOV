package app.wepov.updater

import org.json.JSONArray
import org.json.JSONObject

data class UpdateManifest(
    val versionCode: Long,
    val versionName: String,
    val minSupportedVersionCode: Long,
    val apkUrl: String,
    val apkSha256: String,
    val releaseNotes: String,
    val publishedAt: String,
    val mirrors: List<String>,
) {
    val isHardBlock: Boolean get() = false

    companion object {
        fun parse(raw: String): UpdateManifest {
            val json = JSONObject(raw)
            val mirrors = mutableListOf<String>()
            val array: JSONArray? = json.optJSONArray("mirrors")
            if (array != null) {
                for (index in 0 until array.length()) {
                    val value = array.optString(index, "")
                    if (value.isNotBlank()) mirrors.add(value)
                }
            }
            val apkUrl = json.getString("apkUrl")
            if (apkUrl.isNotBlank()) mirrors.add(0, apkUrl)
            val sha = json.getString("apkSha256").lowercase()
            require(sha.length == 64 && sha.all { it in "0123456789abcdef" }) { "清单校验值格式不正确" }
            return UpdateManifest(
                versionCode = json.getLong("versionCode"),
                versionName = json.optString("versionName", ""),
                minSupportedVersionCode = json.optLong("minSupportedVersionCode", 0L),
                apkUrl = apkUrl,
                apkSha256 = sha,
                releaseNotes = json.optString("releaseNotes", ""),
                publishedAt = json.optString("publishedAt", ""),
                mirrors = mirrors.distinct(),
            )
        }
    }
}

enum class GateState {
    CHECKING,
    UP_TO_DATE,
    OPTIONAL,
    REQUIRED,
    HARD_BLOCK,
    UNKNOWN,
    DOWNLOADING,
    VERIFYING,
    READY,
    INSTALLING,
    FAILED,
}

data class GateSnapshot(
    val state: GateState,
    val currentVersionCode: Long,
    val currentVersionName: String,
    val manifest: UpdateManifest? = null,
    val progressPercent: Int = 0,
    val bytesDownloaded: Long = 0,
    val bytesTotal: Long = 0,
    val activeMirror: String? = null,
    val attemptedMirrors: Int = 0,
    val message: String? = null,
) {
    fun toJson(): JSONObject {
        val json = JSONObject()
        json.put("phase", phaseName())
        json.put("state", state.name.lowercase())
        json.put("currentVersionCode", currentVersionCode)
        json.put("currentVersionName", currentVersionName)
        json.put("progressPercent", progressPercent)
        json.put("progress", progressPercent / 100.0)
        json.put("bytesDownloaded", bytesDownloaded)
        json.put("bytesTotal", bytesTotal)
        json.put("attemptedMirrors", attemptedMirrors)
        json.put("mirrorIndex", (attemptedMirrors - 1).coerceAtLeast(0))
        json.put("activeMirror", activeMirror ?: JSONObject.NULL)
        json.put("message", message ?: JSONObject.NULL)
        json.put("error", message ?: JSONObject.NULL)
        json.put("latestVersionCode", manifest?.versionCode ?: JSONObject.NULL)
        json.put("latestVersionName", manifest?.versionName ?: JSONObject.NULL)
        json.put("minSupportedVersionCode", manifest?.minSupportedVersionCode ?: JSONObject.NULL)
        json.put("notes", manifest?.releaseNotes ?: JSONObject.NULL)
        json.put("mirrors", mirrorsJson())
        return json
    }

    /** Web 契约里的 phase 名（连字符形式），与 apps/web/src/lib/device.ts 对齐。 */
    private fun phaseName(): String = when (state) {
        GateState.UP_TO_DATE -> "up-to-date"
        GateState.OPTIONAL -> "up-to-date"
        GateState.REQUIRED -> "required"
        GateState.HARD_BLOCK -> "hard-block"
        GateState.UNKNOWN -> "unknown"
        GateState.INSTALLING -> "installing"
        GateState.FAILED -> "error"
        else -> state.name.lowercase()
    }

    private fun mirrorsJson(): JSONArray {
        val array = JSONArray()
        manifest?.mirrors?.forEachIndexed { index, url ->
            val entry = JSONObject()
            entry.put("label", "源 ${index + 1}")
            entry.put("url", url)
            entry.put("sha256", manifest.apkSha256)
            array.put(entry)
        }
        return array
    }
}

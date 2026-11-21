package app.wepov.client

import android.webkit.JavascriptInterface
import app.wepov.updater.UpdateGate
import com.getcapacitor.Plugin
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject

@CapacitorPlugin(name = "WePOVUpdater")
class UpdatePlugin : Plugin() {

    override fun load() {
        val sources = listOf(
            "https://raw.githubusercontent.com/ycyz2505/WePOV/latest/update-manifest.json",
            "https://cdn.jsdelivr.net/gh/ycyz2505/WePOV@latest/update-manifest.json",
            "https://ghproxy.net/https://raw.githubusercontent.com/ycyz2505/WePOV/latest/update-manifest.json",
            "https://raw.gitmirror.com/ycyz2505/WePOV/latest/update-manifest.json",
        )
        UpdateGate.configure(sources)
        bridge?.webView?.addJavascriptInterface(Bridge(), "WePOVUpdaterNative")
        UpdateGate.observe { snapshot ->
            val quoted = JSONObject.quote(snapshot.toJson().toString())
            bridge?.webView?.post {
                bridge?.webView?.evaluateJavascript(
                    "window.__wepovUpdatePush&&window.__wepovUpdatePush($quoted)",
                    null,
                )
            }
        }
    }

    private inner class Bridge {
        @JavascriptInterface
        fun status(): String = UpdateGate.current().toJson().toString()

        @JavascriptInterface
        fun check() {
            val activity = activity ?: return
            activity.runOnUiThread { UpdateGate.check(activity) }
        }

        @JavascriptInterface
        fun download(mirrorIndex: Int) {
            val activity = activity ?: return
            activity.runOnUiThread { UpdateGate.download(activity, mirrorIndex.coerceAtLeast(0)) }
        }

        @JavascriptInterface
        fun install() {
            val activity = activity ?: return
            activity.runOnUiThread { UpdateGate.install(activity) }
        }

        @JavascriptInterface
        fun quit() {
            val activity = activity ?: return
            activity.runOnUiThread { activity.moveTaskToBack(true) }
        }
    }

    override fun handleOnDestroy() {
        UpdateGate.observe(null)
    }
}

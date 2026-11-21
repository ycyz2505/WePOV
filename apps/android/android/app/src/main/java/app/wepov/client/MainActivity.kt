package app.wepov.client

import android.os.Bundle
import android.webkit.WebView
import com.getcapacitor.BridgeActivity
import app.wepov.updater.UpdateGate

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(UpdatePlugin::class.java)
        super.onCreate(savedInstanceState)
    }

    override fun onResume() {
        super.onResume()
        UpdateGate.onForeground(this)
    }

    override fun onBackPressed() {
        val bridge = this.bridge
        if (bridge != null && bridge.webView != null) {
            val webView: WebView = bridge.webView
            if (webView.canGoBack()) {
                webView.goBack()
                return
            }
        }
        super.onBackPressed()
    }
}

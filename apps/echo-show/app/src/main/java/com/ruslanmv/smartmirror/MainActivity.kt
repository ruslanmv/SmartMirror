package com.ruslanmv.smartmirror

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback

/**
 * Thin Echo Show shell. The SmartMirror UI is the Vercel-hosted web app; this
 * activity only hosts it full-screen and exposes device capabilities that a
 * browser cannot reach (native camera, capability report) through
 * [SmartMirrorBridge]. D-pad keys reach the page as ordinary arrow keys.
 */
class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private lateinit var bridge: SmartMirrorBridge

    private val appOrigin: Uri by lazy { Uri.parse(BuildConfig.SMARTMIRROR_WEB_URL) }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#0B0A09"))
            isFocusable = true
            isFocusableInTouchMode = true
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            webViewClient = ShellWebViewClient()
            webChromeClient = object : WebChromeClient() {
                // The page never gets raw camera/mic access; captures go through the bridge.
                override fun onPermissionRequest(request: PermissionRequest) = request.deny()
            }
        }
        bridge = SmartMirrorBridge(this, webView)
        webView.addJavascriptInterface(bridge, SmartMirrorBridge.NAME)

        setContentView(webView)
        hideSystemBars()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        if (savedInstanceState == null) {
            webView.loadUrl(appOrigin.buildUpon().appendEncodedPath("smartmirror").build().toString())
        } else {
            webView.restoreState(savedInstanceState)
        }
        webView.requestFocus()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onDestroy() {
        webView.removeJavascriptInterface(SmartMirrorBridge.NAME)
        webView.destroy()
        super.onDestroy()
    }

    @Suppress("DEPRECATION")
    private fun hideSystemBars() {
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            )
    }

    /** Keep the bridge on the SmartMirror origin only; open anything else outside. */
    private inner class ShellWebViewClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url
            if (url.scheme == appOrigin.scheme && url.authority == appOrigin.authority) return false
            runCatching { startActivity(Intent(Intent.ACTION_VIEW, url)) }
            return true
        }
    }
}

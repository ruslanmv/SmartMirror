package com.ruslanmv.smartmirror

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts

/**
 * Thin Echo Show shell. The SmartMirror UI is the Vercel-hosted web app; this
 * activity only hosts it full-screen and exposes device capabilities that a
 * browser cannot reach (native camera, capability report) through
 * [SmartMirrorBridge]. D-pad keys reach the page as ordinary arrow keys.
 *
 * Camera paths, in the order the web app tries them:
 *  1. native capture through the bridge (system camera activity);
 *  2. getUserMedia inside this WebView, granted below for the app origin only;
 *  3. the companion phone (QR code), which needs neither.
 *
 * Pairing happens in the web app (show a code / type a code, OllaBridge).
 * The result is a sealed HttpOnly session cookie that this shell keeps in
 * the WebView cookie store and flushes to disk, so the screen stays paired
 * across restarts. The APK itself never sees an OllaBridge token.
 */
class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private lateinit var bridge: SmartMirrorBridge
    private lateinit var offlineView: TextView

    private val handler = Handler(Looper.getMainLooper())
    private val retry = Runnable { reloadApp() }
    private var mainFrameFailed = false

    private val appOrigin: Uri by lazy { Uri.parse(BuildConfig.SMARTMIRROR_WEB_URL) }

    /** A WebView camera request waiting for the Android CAMERA permission. */
    private var pendingWebCamera: PermissionRequest? = null

    private val webCameraPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val request = pendingWebCamera ?: return@registerForActivityResult
        pendingWebCamera = null
        if (granted) request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) else request.deny()
    }

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
                override fun onPermissionRequest(request: PermissionRequest) {
                    runOnUiThread { handleWebPermission(request) }
                }
            }
        }
        bridge = SmartMirrorBridge(this, webView)
        webView.addJavascriptInterface(bridge, SmartMirrorBridge.NAME)

        // The paired session is a first-party HttpOnly cookie; keep it, refuse third-party ones.
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, false)
        }

        offlineView = TextView(this).apply {
            text = getString(R.string.offline_message)
            setTextColor(Color.parseColor("#EFE6D8"))
            setBackgroundColor(Color.parseColor("#0B0A09"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 28f)
            gravity = Gravity.CENTER
            setLineSpacing(0f, 1.3f)
            isFocusable = true
            visibility = View.GONE
            setOnClickListener { reloadApp() } // OK on the remote, or a tap
        }
        setContentView(FrameLayout(this).apply {
            addView(webView, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
            addView(offlineView, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        })
        hideSystemBars()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        if (savedInstanceState == null) {
            webView.loadUrl(startUrl())
        } else {
            webView.restoreState(savedInstanceState)
        }
        webView.requestFocus()
    }

    /**
     * Grant getUserMedia video to the SmartMirror origin only. Microphone and
     * every other resource stay denied: voice goes through Alexa or the phone.
     */
    private fun handleWebPermission(request: PermissionRequest) {
        val fromApp = request.origin.scheme == appOrigin.scheme && request.origin.authority == appOrigin.authority
        val wantsVideo = request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
        if (!fromApp || !wantsVideo) {
            request.deny()
            return
        }
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
        } else {
            pendingWebCamera?.deny()
            pendingWebCamera = request
            webCameraPermission.launch(Manifest.permission.CAMERA)
        }
    }

    private fun startUrl(): String = appOrigin.buildUpon().appendEncodedPath("smartmirror").build().toString()

    private fun reloadApp() {
        handler.removeCallbacks(retry)
        val current = webView.url
        if (current.isNullOrEmpty() || current.startsWith("data:") || current == "about:blank") {
            webView.loadUrl(startUrl())
        } else {
            webView.reload()
        }
    }

    /** The app could not load (no network, Vercel down): say so and retry on our own. */
    private fun showOffline() {
        offlineView.visibility = View.VISIBLE
        offlineView.requestFocus()
        handler.removeCallbacks(retry)
        handler.postDelayed(retry, RETRY_MS)
    }

    private fun hideOffline() {
        handler.removeCallbacks(retry)
        if (offlineView.visibility == View.VISIBLE) {
            offlineView.visibility = View.GONE
            webView.requestFocus()
        }
    }

    override fun onPause() {
        // Persist the session cookie now: a power cut right after pairing must not lose it.
        CookieManager.getInstance().flush()
        super.onPause()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onDestroy() {
        handler.removeCallbacks(retry)
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

        override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
            mainFrameFailed = false
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) {
                mainFrameFailed = true
                showOffline()
            }
        }

        override fun onPageFinished(view: WebView, url: String?) {
            if (!mainFrameFailed) {
                hideOffline()
                CookieManager.getInstance().flush()
            }
        }
    }

    private companion object {
        const val RETRY_MS = 10_000L
    }
}

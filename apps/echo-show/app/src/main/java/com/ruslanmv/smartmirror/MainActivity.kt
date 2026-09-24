package com.ruslanmv.smartmirror

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
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
 */
class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private lateinit var bridge: SmartMirrorBridge

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

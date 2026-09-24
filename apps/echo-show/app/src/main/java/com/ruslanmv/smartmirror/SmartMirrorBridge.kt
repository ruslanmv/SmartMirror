package com.ruslanmv.smartmirror

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.os.Build
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/**
 * JavaScript interface injected as `window.SmartMirrorNative`.
 * Contract: packages/device-capabilities/src/native-bridge.ts
 *
 * Android JS interfaces are synchronous, so the capture result is delivered
 * back by calling `window.SmartMirrorNativeCallback.resolve(id, dataUrl, error)`.
 *
 * Capture uses the system camera intent, which maps onto [CameraSource.EchoShowCamera].
 * Whether an Echo Show build exposes a camera activity is still an open probe
 * (docs/device-testing/echo-show-21.md); the capability report says so honestly.
 */
class SmartMirrorBridge(
    private val activity: ComponentActivity,
    private val webView: WebView,
) {
    private var pendingCaptureId: String? = null

    private val takePicture = activity.registerForActivityResult(
        ActivityResultContracts.TakePicturePreview(),
    ) { bitmap -> finishCapture(bitmap?.let(::toDataUrl), if (bitmap == null) "cancelled" else null) }

    private val cameraPermission = activity.registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) takePicture.launch(null) else finishCapture(null, "camera permission denied")
    }

    @JavascriptInterface
    fun getCapabilities(): String {
        val pm = activity.packageManager
        return JSONObject()
            .put("camera", hasCameraActivity())
            .put("microphone", pm.hasSystemFeature(PackageManager.FEATURE_MICROPHONE))
            .put("touch", pm.hasSystemFeature(PackageManager.FEATURE_TOUCHSCREEN))
            .put("dpad", true)
            .toString()
    }

    @JavascriptInterface
    fun getDeviceInfo(): String = JSONObject()
        .put("shell", "echo-show")
        .put("shellVersion", BuildConfig.VERSION_NAME)
        .put("model", "${Build.MANUFACTURER} ${Build.MODEL}")
        .put("osVersion", "Android ${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})")
        .toString()

    @JavascriptInterface
    fun requestCapture(requestId: String) {
        activity.runOnUiThread {
            if (pendingCaptureId != null) {
                resolve(requestId, null, "capture already in progress")
                return@runOnUiThread
            }
            if (!hasCameraActivity()) {
                resolve(requestId, null, "camera not available on this device")
                return@runOnUiThread
            }
            pendingCaptureId = requestId
            val granted = activity.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
            if (granted) takePicture.launch(null) else cameraPermission.launch(Manifest.permission.CAMERA)
        }
    }

    private fun hasCameraActivity(): Boolean {
        val pm = activity.packageManager
        if (!pm.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)) return false
        return Intent(MediaStore.ACTION_IMAGE_CAPTURE).resolveActivity(pm) != null
    }

    private fun finishCapture(dataUrl: String?, error: String?) {
        val id = pendingCaptureId ?: return
        pendingCaptureId = null
        resolve(id, dataUrl, error)
    }

    private fun resolve(requestId: String, dataUrl: String?, error: String?) {
        val js = "window.SmartMirrorNativeCallback && window.SmartMirrorNativeCallback.resolve(" +
            "${JSONObject.quote(requestId)}, ${dataUrl?.let(JSONObject::quote) ?: "null"}, " +
            "${error?.let(JSONObject::quote) ?: "null"})"
        webView.post { webView.evaluateJavascript(js, null) }
    }

    private fun toDataUrl(bitmap: Bitmap): String {
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)
        return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    companion object {
        const val NAME = "SmartMirrorNative"
    }
}

package com.spendsense

import android.content.Intent
import android.provider.Settings
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.Arguments
import com.facebook.react.modules.core.DeviceEventManagerModule
import android.widget.Toast
import android.os.Handler
import android.os.Looper
import androidx.core.content.FileProvider
import java.io.File
import android.net.Uri
import android.graphics.Color
import android.graphics.PixelFormat
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView
import android.util.TypedValue
import kotlin.math.abs

class PorterModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    private var currentToast: Toast? = null
    private var floatingBubbleView: View? = null
    private var distanceOverlayView: View? = null
    private var distanceOverlayTextView: TextView? = null
    private var distanceOverlayHideRunnable: Runnable? = null
    private var distanceOverlayUpdateRunnable: Runnable? = null
    private var pendingDistanceOverlayMessage: String? = null
    private var pendingDistanceOverlayTtlMs: Long = 0L
    private var lastDistanceOverlayUpdateAt: Long = 0L
    private var windowManager: WindowManager? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    companion object {
        private const val DISTANCE_OVERLAY_MIN_UPDATE_MS = 750L
    }

    init {
        PorterAccessibilityService.reactContext = reactContext
    }

    override fun getName(): String {
        return "PorterModule"
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required by NativeEventEmitter; events are emitted manually from native code.
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required by NativeEventEmitter; listener bookkeeping is handled by JS subscriptions.
    }

    @ReactMethod
    fun isAccessibilityServiceEnabled(promise: Promise) {
        try {
            val enabled = PorterAccessibilityService.isServiceRunning
            promise.resolve(enabled)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun openAccessibilitySettings() {
        try {
            val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            reactApplicationContext.startActivity(intent)
        } catch (e: Exception) {
            // Ignore if activity cannot be resolved
        }
    }

    @ReactMethod
    fun isVolumeGuardEnabled(promise: Promise) {
        try {
            promise.resolve(PorterAccessibilityService.isVolumeGuardEnabled(reactApplicationContext))
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun setVolumeGuardEnabled(enabled: Boolean, promise: Promise) {
        try {
            PorterAccessibilityService.setVolumeGuardEnabled(reactApplicationContext, enabled)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun refreshVolumeGuardCaps(promise: Promise) {
        try {
            PorterAccessibilityService.captureCurrentVolumeCaps(reactApplicationContext)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun getPorterNativeDebugLogs(promise: Promise) {
        try {
            promise.resolve(PorterAccessibilityService.getNativeDebugLogs(reactApplicationContext))
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun clearPorterNativeDebugLogs(promise: Promise) {
        try {
            PorterAccessibilityService.clearNativeDebugLogs(reactApplicationContext)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun markDeliveryIssue(promise: Promise) {
        try {
            promise.resolve(PorterAccessibilityService.markDeliveryIssue(reactApplicationContext))
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun getDeliveryDebugBlackBox(promise: Promise) {
        try {
            promise.resolve(PorterAccessibilityService.getDeliveryDebugBlackBox(reactApplicationContext))
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun clearDeliveryDebugBlackBox(promise: Promise) {
        try {
            PorterAccessibilityService.clearDeliveryDebugBlackBox(reactApplicationContext)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun consumeBufferedPorterEvent(promise: Promise) {
        try {
            promise.resolve(PorterAccessibilityService.consumeBufferedPorterEvent(reactApplicationContext))
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }
    
    @ReactMethod
    fun showToastOverlay(message: String) {
        try {
            // Replace the previous toast instead of queueing many Porter updates.
            mainHandler.post {
                try {
                    currentToast?.cancel()
                    currentToast = Toast.makeText(reactApplicationContext, message, Toast.LENGTH_LONG)
                    currentToast?.show()
                } catch (e: Exception) {
                    // Safe to ignore UI exceptions from Toast
                }
            }
        } catch (e: Exception) {
            // Ignore
        }
    }

    @ReactMethod
    fun showOrUpdatePorterDistanceOverlay(message: String, ttlMs: Double, promise: Promise) {
        if (!Settings.canDrawOverlays(reactApplicationContext)) {
            promise.reject("PERMISSION_DENIED", "Overlay permission not granted")
            return
        }

        val safeTtlMs = ttlMs.toLong().coerceIn(3000L, 30000L)

        mainHandler.post {
            try {
                val now = System.currentTimeMillis()
                val hasVisibleOverlay = distanceOverlayView != null
                val isTooSoon = hasVisibleOverlay && now - lastDistanceOverlayUpdateAt < DISTANCE_OVERLAY_MIN_UPDATE_MS
                if (isTooSoon) {
                    pendingDistanceOverlayMessage = message
                    pendingDistanceOverlayTtlMs = safeTtlMs
                    if (distanceOverlayUpdateRunnable == null) {
                        val delayMs = (DISTANCE_OVERLAY_MIN_UPDATE_MS - (now - lastDistanceOverlayUpdateAt))
                            .coerceAtLeast(100L)
                        val updateRunnable = Runnable {
                            distanceOverlayUpdateRunnable = null
                            val pendingMessage = pendingDistanceOverlayMessage
                            val pendingTtl = pendingDistanceOverlayTtlMs
                            pendingDistanceOverlayMessage = null
                            pendingDistanceOverlayTtlMs = 0L
                            if (pendingMessage != null) {
                                applyDistanceOverlayUpdate(pendingMessage, pendingTtl)
                            }
                        }
                        distanceOverlayUpdateRunnable = updateRunnable
                        mainHandler.postDelayed(updateRunnable, delayMs)
                    }
                    PorterAccessibilityService.appendNativeLog(
                        reactApplicationContext,
                        "overlay_update_throttled",
                        "Coalesced native distance overlay update",
                        reactApplicationContext.packageName,
                        "native_overlay"
                    )
                    promise.resolve(false)
                    return@post
                }

                applyDistanceOverlayUpdate(message, safeTtlMs)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("OVERLAY_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun hidePorterDistanceOverlay(promise: Promise) {
        mainHandler.post {
            try {
                hideDistanceOverlayInternal()
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("OVERLAY_ERROR", e.message, e)
            }
        }
    }

    private fun getWindowManager(): WindowManager {
        val existing = windowManager
        if (existing != null) return existing
        val manager = reactApplicationContext.getSystemService(android.content.Context.WINDOW_SERVICE) as WindowManager
        windowManager = manager
        return manager
    }

    private fun createDistanceOverlayParams(): WindowManager.LayoutParams {
        return WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.END
            x = dp(8f)
            y = dp(360f)
            alpha = 0.9f
        }
    }

    private fun applyDistanceOverlayUpdate(message: String, ttlMs: Long) {
        val manager = getWindowManager()
        val overlay = distanceOverlayView ?: createDistanceOverlayView()
        if (distanceOverlayTextView?.text?.toString() != message) {
            distanceOverlayTextView?.text = message
        }

        if (distanceOverlayView == null) {
            distanceOverlayView = overlay
            manager.addView(overlay, createDistanceOverlayParams())
            PorterAccessibilityService.appendNativeLog(
                reactApplicationContext,
                "overlay_repositioned_below_fare",
                "Distance overlay positioned below Porter fare area",
                reactApplicationContext.packageName,
                "native_overlay"
            )
        }

        lastDistanceOverlayUpdateAt = System.currentTimeMillis()

        distanceOverlayHideRunnable?.let { mainHandler.removeCallbacks(it) }
        distanceOverlayHideRunnable = Runnable {
            hideDistanceOverlayInternal()
        }
        mainHandler.postDelayed(distanceOverlayHideRunnable!!, ttlMs)
    }

    private fun createDistanceOverlayView(): View {
        val frame = FrameLayout(reactApplicationContext)
        frame.isClickable = false
        frame.isFocusable = false

        val shape = android.graphics.drawable.GradientDrawable().apply {
            shape = android.graphics.drawable.GradientDrawable.RECTANGLE
            cornerRadius = dp(14f).toFloat()
            setColor(Color.parseColor("#EAF5FF"))
            setStroke(dp(1f), Color.parseColor("#2563EB"))
        }
        frame.background = shape
        frame.alpha = 0.96f
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
            frame.elevation = dp(8f).toFloat()
        }

        val textView = TextView(reactApplicationContext).apply {
            text = ""
            textSize = 12f
            setTextColor(Color.parseColor("#10233F"))
            gravity = Gravity.CENTER
            includeFontPadding = false
            setLineSpacing(dp(1f).toFloat(), 1.0f)
            maxWidth = dp(190f)
        }
        distanceOverlayTextView = textView

        frame.addView(textView, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            gravity = Gravity.CENTER
            leftMargin = dp(10f)
            topMargin = dp(7f)
            rightMargin = dp(10f)
            bottomMargin = dp(7f)
        })

        return frame
    }

    private fun hideDistanceOverlayInternal() {
        distanceOverlayHideRunnable?.let { mainHandler.removeCallbacks(it) }
        distanceOverlayHideRunnable = null
        distanceOverlayUpdateRunnable?.let { mainHandler.removeCallbacks(it) }
        distanceOverlayUpdateRunnable = null
        pendingDistanceOverlayMessage = null
        pendingDistanceOverlayTtlMs = 0L

        val overlay = distanceOverlayView
        if (overlay != null && windowManager != null) {
            try {
                windowManager?.removeView(overlay)
            } catch (_: Exception) {
                // Ignore already-removed overlay windows.
            }
        }

        distanceOverlayView = null
        distanceOverlayTextView = null
        lastDistanceOverlayUpdateAt = 0L
    }

    private fun dp(value: Float): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value,
            reactApplicationContext.resources.displayMetrics
        ).toInt()
    }

    /**
     * Write text content to a temp file in cache/exports/ and share it via FileProvider.
     * This bypasses the Android Binder transaction size limit that causes
     * "Failed to open share dialog" when using Share.share() with large text payloads.
     */
    @ReactMethod
    fun shareTextFile(content: String, fileName: String, title: String, promise: Promise) {
        try {
            val exportsDir = File(reactApplicationContext.cacheDir, "exports")
            if (!exportsDir.exists()) exportsDir.mkdirs()

            val file = File(exportsDir, fileName)
            file.writeText(content)

            val authority = "${reactApplicationContext.packageName}.fileprovider"
            val uri = FileProvider.getUriForFile(reactApplicationContext, authority, file)

            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                type = "application/json"
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_SUBJECT, title)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }

            val chooser = Intent.createChooser(shareIntent, title).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactApplicationContext.startActivity(chooser)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SHARE_FILE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun canDrawOverlays(promise: Promise) {
        promise.resolve(Settings.canDrawOverlays(reactApplicationContext))
    }

    @ReactMethod
    fun openOverlaySettings() {
        try {
            val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + reactApplicationContext.packageName))
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            reactApplicationContext.startActivity(intent)
        } catch (e: Exception) {
            val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            reactApplicationContext.startActivity(intent)
        }
    }

    @ReactMethod
    fun showIssueBubble(promise: Promise) {
        if (!Settings.canDrawOverlays(reactApplicationContext)) {
            promise.reject("PERMISSION_DENIED", "Overlay permission not granted")
            return
        }

        Handler(Looper.getMainLooper()).post {
            try {
                if (floatingBubbleView != null) {
                    promise.resolve(true)
                    return@post
                }

                windowManager = getWindowManager()

                val params = WindowManager.LayoutParams(
                    WindowManager.LayoutParams.WRAP_CONTENT,
                    WindowManager.LayoutParams.WRAP_CONTENT,
                    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                    PixelFormat.TRANSLUCENT
                ).apply {
                    gravity = Gravity.CENTER_VERTICAL or Gravity.START
                    x = 0
                    y = 100
                }

                val frame = FrameLayout(reactApplicationContext)
                val textView = TextView(reactApplicationContext).apply {
                    text = "⚠️"
                    textSize = 24f
                    gravity = Gravity.CENTER
                }
                
                val shape = android.graphics.drawable.GradientDrawable().apply {
                    shape = android.graphics.drawable.GradientDrawable.OVAL
                    setColor(Color.parseColor("#E53935"))
                    setStroke(3, Color.WHITE)
                }
                frame.background = shape
                
                val size = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 56f, reactApplicationContext.resources.displayMetrics).toInt()
                frame.addView(textView, FrameLayout.LayoutParams(size, size).apply {
                    gravity = Gravity.CENTER
                })

                frame.setOnTouchListener(object : View.OnTouchListener {
                    private var initialX = 0
                    private var initialY = 0
                    private var initialTouchX = 0f
                    private var initialTouchY = 0f
                    private val touchSlop = 15f

                    override fun onTouch(v: View, event: MotionEvent): Boolean {
                        when (event.action) {
                            MotionEvent.ACTION_DOWN -> {
                                initialX = params.x
                                initialY = params.y
                                initialTouchX = event.rawX
                                initialTouchY = event.rawY
                                return true
                            }
                            MotionEvent.ACTION_MOVE -> {
                                params.x = initialX + (event.rawX - initialTouchX).toInt()
                                params.y = initialY + (event.rawY - initialTouchY).toInt()
                                windowManager?.updateViewLayout(floatingBubbleView, params)
                                return true
                            }
                            MotionEvent.ACTION_UP -> {
                                val dx = abs(event.rawX - initialTouchX)
                                val dy = abs(event.rawY - initialTouchY)
                                if (dx < touchSlop && dy < touchSlop) {
                                    try {
                                        val snapshot = PorterAccessibilityService.markDeliveryIssue(reactApplicationContext)
                                        val event = Arguments.createMap().apply {
                                            putString("nativeSnapshot", snapshot)
                                        }
                                        reactApplicationContext
                                            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                                            .emit("onDeliveryIssueBubbleTap", event)
                                        Toast.makeText(reactApplicationContext, "Delivery issue marked", Toast.LENGTH_SHORT).show()
                                    } catch (e: Exception) {
                                        // Ignore
                                    }
                                }
                                return true
                            }
                        }
                        return false
                    }
                })

                floatingBubbleView = frame
                windowManager?.addView(floatingBubbleView, params)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("OVERLAY_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun hideIssueBubble(promise: Promise) {
        Handler(Looper.getMainLooper()).post {
            try {
                if (floatingBubbleView != null && windowManager != null) {
                    windowManager?.removeView(floatingBubbleView)
                    floatingBubbleView = null
                }
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("OVERLAY_ERROR", e.message, e)
            }
        }
    }
}

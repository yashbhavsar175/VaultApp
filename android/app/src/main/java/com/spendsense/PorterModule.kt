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
    private var windowManager: WindowManager? = null

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
            Handler(Looper.getMainLooper()).post {
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

                windowManager = reactApplicationContext.getSystemService(android.content.Context.WINDOW_SERVICE) as WindowManager

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

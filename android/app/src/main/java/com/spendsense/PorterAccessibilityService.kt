package com.spendsense

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.util.Log
import android.content.Intent
import android.content.Context
import android.graphics.Bitmap
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Display
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.Arguments
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

class PorterAccessibilityService : AccessibilityService() {

    companion object {
        var reactContext: ReactApplicationContext? = null
        var isServiceRunning = false
        private const val TAG = "PorterAccessibility"
        private const val DISPATCH_DEBOUNCE_MS = 250L
        private const val DISPATCH_THROTTLE_MS = 600L
        private const val DUPLICATE_REFRESH_MS = 2500L
        private const val OCR_MIN_INTERVAL_MS = 900L
        private const val OCR_DUPLICATE_REFRESH_MS = 2500L
        private const val PREFS_NAME = "spendsense_volume_guard"
        private const val NATIVE_LOG_PREFS_NAME = "spendsense_porter_native_logs"
        private const val KEY_NATIVE_LOGS = "logs"
        private const val KEY_ENABLED = "enabled"
        private const val MAX_NATIVE_LOGS = 250
        private val VOLUME_GUARD_PACKAGES = listOf(
            "porter",
            "swiggy",
            "zomato",
            "blinkit",
            "zepto",
            "dunzo",
            "rapido",
            "shadowfax",
            "uber",
            "ola"
        )

        fun captureCurrentVolumeCaps(context: Context) {
            val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit()
                .putInt("stream_${AudioManager.STREAM_MUSIC}", audioManager.getStreamVolume(AudioManager.STREAM_MUSIC))
                .putInt("stream_${AudioManager.STREAM_ALARM}", audioManager.getStreamVolume(AudioManager.STREAM_ALARM))
                .putInt("stream_${AudioManager.STREAM_RING}", audioManager.getStreamVolume(AudioManager.STREAM_RING))
                .putInt("stream_${AudioManager.STREAM_NOTIFICATION}", audioManager.getStreamVolume(AudioManager.STREAM_NOTIFICATION))
                .apply()
        }

        fun setVolumeGuardEnabled(context: Context, enabled: Boolean) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            if (enabled) captureCurrentVolumeCaps(context)
            prefs.edit().putBoolean(KEY_ENABLED, enabled).apply()
        }

        fun isVolumeGuardEnabled(context: Context): Boolean {
            return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getBoolean(KEY_ENABLED, false)
        }

        fun appendNativeLog(
            context: Context,
            stage: String,
            message: String,
            packageName: String = "",
            eventType: String = "",
            textLength: Int = 0,
            sample: String = ""
        ) {
            try {
                val prefs = context.getSharedPreferences(NATIVE_LOG_PREFS_NAME, Context.MODE_PRIVATE)
                val existing = JSONArray(prefs.getString(KEY_NATIVE_LOGS, "[]") ?: "[]")
                val next = JSONArray()
                val entry = JSONObject()
                    .put("time", System.currentTimeMillis())
                    .put("stage", stage)
                    .put("message", message)
                    .put("packageName", packageName)
                    .put("eventType", eventType)
                    .put("textLength", textLength)
                    .put("sample", sample)

                next.put(entry)
                val limit = minOf(existing.length(), MAX_NATIVE_LOGS - 1)
                for (i in 0 until limit) {
                    next.put(existing.getJSONObject(i))
                }

                prefs.edit().putString(KEY_NATIVE_LOGS, next.toString()).apply()
            } catch (e: Exception) {
                Log.w(TAG, "Could not append native Porter log", e)
            }
        }

        fun getNativeDebugLogs(context: Context): String {
            return context
                .getSharedPreferences(NATIVE_LOG_PREFS_NAME, Context.MODE_PRIVATE)
                .getString(KEY_NATIVE_LOGS, "[]") ?: "[]"
        }

        fun clearNativeDebugLogs(context: Context) {
            context
                .getSharedPreferences(NATIVE_LOG_PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_NATIVE_LOGS, "[]")
                .apply()
        }

        fun clampAudioForGuard(context: Context) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            if (!prefs.getBoolean(KEY_ENABLED, false)) return

            val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            val streams = listOf(
                AudioManager.STREAM_MUSIC,
                AudioManager.STREAM_ALARM,
                AudioManager.STREAM_RING,
                AudioManager.STREAM_NOTIFICATION
            )

            for (stream in streams) {
                val cap = prefs.getInt("stream_$stream", audioManager.getStreamVolume(stream))
                val current = audioManager.getStreamVolume(stream)
                if (current > cap) {
                    try {
                        audioManager.setStreamVolume(stream, cap, 0)
                    } catch (e: SecurityException) {
                        Log.w(TAG, "Volume guard could not clamp stream $stream", e)
                    }
                }
            }

            preferNonSpeakerRoute(audioManager)
        }

        private fun preferNonSpeakerRoute(audioManager: AudioManager) {
            try {
                audioManager.isSpeakerphoneOn = false

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    val bluetoothDevice = audioManager
                        .getDevices(AudioManager.GET_DEVICES_OUTPUTS)
                        .firstOrNull { device ->
                            device.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
                                device.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
                                device.type == AudioDeviceInfo.TYPE_BLE_HEADSET ||
                                device.type == AudioDeviceInfo.TYPE_BLE_SPEAKER
                        }

                    if (bluetoothDevice != null) {
                        audioManager.setCommunicationDevice(bluetoothDevice)
                    }
                }
            } catch (e: SecurityException) {
                Log.w(TAG, "Volume guard could not prefer Bluetooth route", e)
            } catch (e: Exception) {
                Log.w(TAG, "Volume guard route preference failed", e)
            }
        }
    }

    private val handler = Handler(Looper.getMainLooper())
    private var pendingDispatch: Runnable? = null
    private var pendingPackageName: String = ""
    private var pendingTextContent: String = ""
    private var pendingEventType: String = ""
    private var lastSentTime: Long = 0
    private var lastTextHash: Int = 0
    private val ocrExecutor = Executors.newSingleThreadExecutor()
    private val textRecognizer by lazy {
        TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    }
    private var isOcrInFlight = false
    private var lastOcrRequestTime: Long = 0
    private var lastOcrDispatchTime: Long = 0
    private var lastOcrTextHash: Int = 0
    private var lastVolumeLogTime: Long = 0
    private var lastEmptyLogTime: Long = 0

    override fun onServiceConnected() {
        super.onServiceConnected()
        isServiceRunning = true
        val info = AccessibilityServiceInfo()
        // Listen to ALL event types to catch popups, dialogs, overlays, and content changes
        info.eventTypes = AccessibilityEvent.TYPES_ALL_MASK
        info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
        info.flags = AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
                     AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS or
                     AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS
        info.notificationTimeout = 300
        this.serviceInfo = info
        Log.d(TAG, "Service Connected with TYPES_ALL_MASK")
        appendNativeLog(applicationContext, "service", "Accessibility service connected with TYPES_ALL_MASK")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (event.packageName == null) return
        val packageName = event.packageName.toString()
        
        // Only process Porter app events
        val isPorterPackage = packageName.contains("porter", ignoreCase = true)
        val isVolumeGuardPackage = VOLUME_GUARD_PACKAGES.any { packageName.contains(it, ignoreCase = true) }
        if (isVolumeGuardPackage) {
            clampVolumeBurst()
            appendThrottledVolumeLog(packageName, AccessibilityEvent.eventTypeToString(event.eventType))
        }

        if (!isPorterPackage) {
            return
        }

        val eventType = AccessibilityEvent.eventTypeToString(event.eventType)
        appendNativeLog(applicationContext, "event", "Porter event received", packageName, eventType)

        // Try to get text from the Porter event source first, then Porter-owned windows.
        // Avoid reading SystemUI/status-bar windows because they produce notification/battery text noise.
        // Porter popups often arrive in pieces; debounce below lets the final text settle before JS parses it.
        val allTextList = mutableListOf<String>()
        val windowDiagnostics = mutableListOf<String>()
        var hasPorterOwnedSource = false
        
        // 1. Extract from event source node (catches popup/dialog content)
        val sourceNode = event.source
        if (sourceNode != null) {
            val sourcePackage = sourceNode.packageName?.toString() ?: ""
            val sourceClass = sourceNode.className?.toString() ?: ""
            windowDiagnostics.add("source=$sourcePackage/$sourceClass")
            if (isPorterOwnedPackage(sourcePackage)) {
                hasPorterOwnedSource = true
                allTextList.addAll(extractAllText(sourceNode))
            }
        }
        
        // 2. Also extract from event text, but only when it looks like a ride.
        // Porter/SystemUI sometimes sends app labels like "Application icon" with Porter as the
        // event package; dispatching those overwrites the last useful debug state.
        for (charSeq in event.text) {
            val t = charSeq?.toString()?.trim() ?: ""
            if (
                t.isNotEmpty() &&
                (hasPorterOwnedSource || looksLikePorterRideText(t)) &&
                !isPorterChromeNoise(t) &&
                !allTextList.contains(t)
            ) {
                allTextList.add(t)
            }
        }
        
        // 3. Fall back to reading ALL windows (to catch overlays/dialogs that might be in separate windows)
        val windowsList = this.windows
        for (window in windowsList) {
            val rootNode = window.root
            if (rootNode != null) {
                val rootPackage = rootNode.packageName?.toString() ?: ""
                val rootClass = rootNode.className?.toString() ?: ""
                windowDiagnostics.add("windowType=${window.type} root=$rootPackage/$rootClass")

                if (isPorterOwnedPackage(rootPackage)) {
                    val rootTexts = extractAllText(rootNode)
                    for (t in rootTexts) {
                        if (!allTextList.contains(t)) {
                            allTextList.add(t)
                        }
                    }
                }
            }
        }
        
        val fullText = allTextList.joinToString(" || ")
        
        if (fullText.isNotEmpty()) {
            if (isNotificationOrSystemNoise(fullText) || isPorterChromeNoise(fullText)) {
                appendNativeLog(
                    applicationContext,
                    "notification_noise",
                    "Ignored notification/status-bar text from Porter package. Windows: ${windowDiagnostics.joinToString(" | ")}",
                    packageName,
                    eventType,
                    fullText.length,
                    fullText
                )
                return
            }

            pendingPackageName = packageName
            pendingTextContent = fullText
            pendingEventType = eventType

            appendNativeLog(
                applicationContext,
                "extract",
                "Extracted Porter-owned text parts=${allTextList.size}. Windows: ${windowDiagnostics.joinToString(" | ")}",
                packageName,
                eventType,
                fullText.length,
                fullText
            )

            pendingDispatch?.let { handler.removeCallbacks(it) }

            val now = System.currentTimeMillis()
            if (now - lastSentTime > DISPATCH_THROTTLE_MS) {
                dispatchPendingEvent()
            } else {
                val dispatch = Runnable { dispatchPendingEvent() }
                pendingDispatch = dispatch
                handler.postDelayed(dispatch, DISPATCH_DEBOUNCE_MS)
            }
        } else {
            appendThrottledEmptyLog(packageName, eventType, windowDiagnostics.joinToString(" | "))

            if (shouldTryOcr(windowDiagnostics)) {
                requestOcrFallback(packageName, eventType, windowDiagnostics.joinToString(" | "))
            }
        }
    }

    private fun isPorterOwnedPackage(packageName: String): Boolean {
        return packageName.contains("porter", ignoreCase = true)
    }

    private fun appendThrottledVolumeLog(packageName: String, eventType: String) {
        val now = System.currentTimeMillis()
        if (now - lastVolumeLogTime < 3000L) return
        lastVolumeLogTime = now
        appendNativeLog(
            applicationContext,
            "volume_guard",
            "Matched guarded app package; clamped volume burst",
            packageName,
            eventType
        )
    }

    private fun appendThrottledEmptyLog(packageName: String, eventType: String, diagnostics: String) {
        val now = System.currentTimeMillis()
        val hasOcrCandidate = diagnostics.contains("root=com.theporter", ignoreCase = true) &&
            diagnostics.contains("windowType=3", ignoreCase = true)

        if (!hasOcrCandidate && now - lastEmptyLogTime < 2000L) return
        lastEmptyLogTime = now

        appendNativeLog(
            applicationContext,
            "extract_empty",
            "Porter event had no readable Porter-owned text. Windows: $diagnostics",
            packageName,
            eventType
        )
    }

    private fun looksLikePorterRideText(text: String): Boolean {
        val lower = text.lowercase()
        val hasPickup = lower.contains("pickup") || lower.contains("pick up")
        val hasDrop = lower.contains("drop") || lower.contains("destination")
        val hasAccept = lower.contains("accept") || lower.contains("swipe")
        val hasCurrency = lower.contains("₹") || lower.contains("rs")

        return hasPickup && (hasDrop || hasAccept || hasCurrency)
    }

    private fun isPorterChromeNoise(text: String): Boolean {
        val normalized = text
            .lowercase()
            .split("||")
            .map { it.trim() }
            .filter { it.isNotEmpty() }

        if (normalized.isEmpty()) return false
        if (looksLikePorterRideText(text)) return false

        val chromeParts = setOf(
            "application icon",
            "porter partner",
            "porter",
            "app icon",
            "notification",
            "notifications"
        )

        return normalized.size <= 2 && normalized.all { part -> chromeParts.contains(part) }
    }

    private fun shouldTryOcr(windowDiagnostics: List<String>): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return false

        val hasPorterOverlay = windowDiagnostics.any { diagnostic ->
            diagnostic.contains("root=com.theporter", ignoreCase = true) &&
                diagnostic.contains("windowType=3", ignoreCase = true)
        }
        if (!hasPorterOverlay) return false

        val now = System.currentTimeMillis()
        if (isOcrInFlight || now - lastOcrRequestTime < OCR_MIN_INTERVAL_MS) return false

        return true
    }

    private fun requestOcrFallback(packageName: String, eventType: String, diagnostics: String) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return

        lastOcrRequestTime = System.currentTimeMillis()
        isOcrInFlight = true

        appendNativeLog(
            applicationContext,
            "ocr_request",
            "Trying screenshot OCR fallback. Windows: $diagnostics",
            packageName,
            eventType
        )

        takeScreenshot(
            Display.DEFAULT_DISPLAY,
            ocrExecutor,
            object : TakeScreenshotCallback {
                override fun onSuccess(screenshot: ScreenshotResult) {
                    try {
                        val hardwareBitmap = Bitmap.wrapHardwareBuffer(
                            screenshot.hardwareBuffer,
                            screenshot.colorSpace
                        )

                        if (hardwareBitmap == null) {
                            isOcrInFlight = false
                            screenshot.hardwareBuffer.close()
                            appendNativeLog(
                                applicationContext,
                                "ocr_empty",
                                "Screenshot bitmap was unavailable",
                                packageName,
                                eventType
                            )
                            return
                        }

                        val bitmap = hardwareBitmap.copy(Bitmap.Config.ARGB_8888, false)
                        screenshot.hardwareBuffer.close()
                        runTextRecognition(bitmap, packageName, eventType)
                    } catch (e: Exception) {
                        isOcrInFlight = false
                        try {
                            screenshot.hardwareBuffer.close()
                        } catch (_: Exception) {
                        }
                        appendNativeLog(
                            applicationContext,
                            "ocr_failed",
                            "Screenshot OCR setup failed: ${e.message}",
                            packageName,
                            eventType
                        )
                    }
                }

                override fun onFailure(errorCode: Int) {
                    isOcrInFlight = false
                    appendNativeLog(
                        applicationContext,
                        "ocr_failed",
                        "takeScreenshot failed with code $errorCode",
                        packageName,
                        eventType
                    )
                }
            }
        )
    }

    private fun runTextRecognition(bitmap: Bitmap, packageName: String, eventType: String) {
        val image = InputImage.fromBitmap(bitmap, 0)
        textRecognizer
            .process(image)
            .addOnSuccessListener(ocrExecutor) { result ->
                isOcrInFlight = false
                val ocrText = result.textBlocks
                    .flatMap { block -> block.lines }
                    .joinToString(" || ") { line -> line.text.trim() }
                    .trim()

                if (ocrText.isEmpty()) {
                    appendNativeLog(
                        applicationContext,
                        "ocr_empty",
                        "OCR completed but found no text",
                        packageName,
                        eventType
                    )
                    return@addOnSuccessListener
                }

                val ocrHash = ocrText.hashCode()
                val now = System.currentTimeMillis()
                if (ocrHash == lastOcrTextHash && now - lastOcrDispatchTime < OCR_DUPLICATE_REFRESH_MS) {
                    appendNativeLog(
                        applicationContext,
                        "ocr_duplicate",
                        "Suppressed duplicate OCR text",
                        packageName,
                        eventType,
                        ocrText.length,
                        ocrText
                    )
                    return@addOnSuccessListener
                }

                if (!looksLikePorterRideOcr(ocrText)) {
                    appendNativeLog(
                        applicationContext,
                        "ocr_ignored",
                        "OCR text did not look like a Porter ride request",
                        packageName,
                        eventType,
                        ocrText.length,
                        ocrText
                    )
                    return@addOnSuccessListener
                }

                lastOcrTextHash = ocrHash
                lastOcrDispatchTime = now
                appendNativeLog(
                    applicationContext,
                    "ocr_success",
                    "OCR extracted Porter ride text",
                    packageName,
                    eventType,
                    ocrText.length,
                    ocrText
                )

                sendEventToJS(packageName, ocrText, "${eventType}_OCR")
            }
            .addOnFailureListener(ocrExecutor) { e ->
                isOcrInFlight = false
                appendNativeLog(
                    applicationContext,
                    "ocr_failed",
                    "ML Kit text recognition failed: ${e.message}",
                    packageName,
                    eventType
                )
            }
    }

    private fun looksLikePorterRideOcr(text: String): Boolean {
        val lower = text.lowercase()
        val hasPickup = lower.contains("pickup") || lower.contains("pick up") || lower.contains("píckup")
        val hasDrop = lower.contains("drop") || lower.contains("destination")
        val hasAccept = lower.contains("accept") || lower.contains("swipe")
        val hasCurrency = lower.contains("₹") || lower.contains("rs") || lower.matches(Regex("(?s).*\\b[4-9][0-9]\\b.*"))

        return hasPickup && (hasDrop || hasAccept || hasCurrency)
    }

    private fun isNotificationOrSystemNoise(text: String): Boolean {
        val lower = text.lowercase()
        val hasRideSignal =
            lower.contains("pickup") ||
                lower.contains("drop") ||
                lower.contains("accept in") ||
                lower.contains("₹") ||
                lower.contains("rs")

        val hasSystemSignal =
            lower.contains("notification:") ||
                lower.contains("battery") ||
                lower.contains("volte") ||
                lower.contains("vonr") ||
                lower.contains("true5g") ||
                lower.contains("airtel") ||
                lower.contains("jio")

        return hasSystemSignal && !hasRideSignal
    }

    private fun clampVolumeBurst() {
        val delays = longArrayOf(0L, 150L, 350L, 700L, 1200L, 2000L, 3200L)
        for (delay in delays) {
            handler.postDelayed({
                PorterAccessibilityService.clampAudioForGuard(applicationContext)
            }, delay)
        }
    }

    private fun dispatchPendingEvent() {
        val fullText = pendingTextContent
        if (fullText.isEmpty()) return

        val currentTime = System.currentTimeMillis()
        val textHash = fullText.hashCode()

        // Suppress tight duplicates, but allow occasional repeats so JS can keep the overlay alive.
        if (textHash == lastTextHash && currentTime - lastSentTime < DUPLICATE_REFRESH_MS) {
            appendNativeLog(
                applicationContext,
                "duplicate",
                "Suppressed duplicate text before JS dispatch",
                pendingPackageName,
                pendingEventType,
                fullText.length,
                fullText
            )
            return
        }

        lastTextHash = textHash
        lastSentTime = currentTime

        Log.d(
            TAG,
            "Event[$pendingEventType] from $pendingPackageName, len=${fullText.length}"
        )

        sendEventToJS(pendingPackageName, fullText, pendingEventType)
    }

    private fun extractAllText(node: AccessibilityNodeInfo): List<String> {
        val texts = mutableListOf<String>()
        
        // Capture text from the node
        if (node.text != null && node.text.toString().trim().isNotEmpty()) {
            texts.add(node.text.toString().trim())
        }
        
        // Also capture contentDescription (some apps use this for addresses/labels)
        if (node.contentDescription != null && node.contentDescription.toString().trim().isNotEmpty()) {
            val desc = node.contentDescription.toString().trim()
            if (!texts.contains(desc)) {
                texts.add(desc)
            }
        }
        
        // Recurse into children
        for (i in 0 until node.childCount) {
            val child = node.getChild(i)
            if (child != null) {
                texts.addAll(extractAllText(child))
            }
        }
        return texts
    }

    private fun sendEventToJS(packageName: String, textContent: String, eventType: String) {
        if (reactContext != null && reactContext!!.hasActiveReactInstance()) {
            val params: WritableMap = Arguments.createMap()
            params.putString("packageName", packageName)
            params.putString("textContent", textContent)
            params.putString("eventType", eventType)
            
            reactContext!!
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("onPorterScreenChange", params)
            appendNativeLog(
                applicationContext,
                "dispatch",
                "Dispatched Porter event to React Native",
                packageName,
                eventType,
                textContent.length,
                textContent
            )
        } else {
            Log.w(TAG, "ReactContext not available, cannot send event to JS")
            appendNativeLog(
                applicationContext,
                "dispatch_failed",
                "ReactContext not active, could not send event to JS",
                packageName,
                eventType,
                textContent.length,
                textContent
            )
        }
    }

    override fun onInterrupt() {
        Log.d(TAG, "Service Interrupted")
        appendNativeLog(applicationContext, "service", "Accessibility service interrupted")
        pendingDispatch?.let { handler.removeCallbacks(it) }
        pendingDispatch = null
        isServiceRunning = false
    }
    
    override fun onUnbind(intent: Intent?): Boolean {
        appendNativeLog(applicationContext, "service", "Accessibility service unbound")
        pendingDispatch?.let { handler.removeCallbacks(it) }
        pendingDispatch = null
        isServiceRunning = false
        return super.onUnbind(intent)
    }
}

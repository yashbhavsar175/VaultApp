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
        private const val ACCESSIBILITY_EVENT_COALESCE_MS = 220L
        private const val OCR_MIN_INTERVAL_MS = 900L
        private const val OCR_DUPLICATE_REFRESH_MS = 2500L
        private const val OCR_UNSUPPORTED_BACKOFF_MS = 10 * 60_000L
        private const val PORTER_EVENT_MIN_INTERVAL_MS = 120L
        private const val VOLUME_CLAMP_MIN_INTERVAL_MS = 2500L
        private const val BUFFERED_PORTER_EVENT_TTL_MS = 45_000L
        private const val MAX_TEXT_NODE_DEPTH = 40
        private const val MAX_TEXT_NODES = 450
        private const val MAX_LOG_MESSAGE_LENGTH = 240
        private const val PREFS_NAME = "spendsense_volume_guard"
        private const val NATIVE_LOG_PREFS_NAME = "spendsense_porter_native_logs"
        private const val KEY_NATIVE_LOGS = "logs"
        private const val KEY_NATIVE_INCIDENTS = "incidents"
        private const val KEY_BUFFERED_PORTER_EVENT = "buffered_porter_event"
        private const val KEY_ENABLED = "enabled"
        private const val MAX_NATIVE_LOGS = 400
        private const val MAX_NATIVE_INCIDENTS = 10
        private const val MAX_NATIVE_INCIDENT_EVENTS = 80
        private const val INCIDENT_CONTEXT_MS = 10 * 60 * 1000L
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
        private val PORTER_EVENT_TYPES = setOf(
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED,
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED,
            AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED
        )

        private var cachedNativeLogs: JSONArray? = null
        private var bufferedPorterEvent: JSONObject? = null

        fun captureCurrentVolumeCaps(context: Context) {
            val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit()
                .putInt("stream_${AudioManager.STREAM_MUSIC}", audioManager.getStreamVolume(AudioManager.STREAM_MUSIC))
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
                val existing = cachedNativeLogs ?: JSONArray(prefs.getString(KEY_NATIVE_LOGS, "[]") ?: "[]")
                val next = JSONArray()
                val entry = JSONObject()
                    .put("time", System.currentTimeMillis())
                    .put("stage", stage)
                    .put("message", compactLogMessage(message))
                    .put("packageName", packageName)
                    .put("eventType", eventType)
                    .put("textLength", textLength)
                    .put("sample", compactTextSample(sample))

                next.put(entry)
                val limit = minOf(existing.length(), MAX_NATIVE_LOGS - 1)
                for (i in 0 until limit) {
                    next.put(existing.getJSONObject(i))
                }

                cachedNativeLogs = next
                prefs.edit().putString(KEY_NATIVE_LOGS, next.toString()).apply()

                if (shouldPinIncident(stage)) {
                    pinNativeIncident(context, "auto:$stage", entry, next)
                }
            } catch (e: Exception) {
                Log.w(TAG, "Could not append native Porter log", e)
            }
        }

        private fun shouldPinIncident(stage: String): Boolean {
            val normalized = stage.lowercase()
            return normalized == "event_error" ||
                normalized == "service_disabled" ||
                normalized == "service_crash" ||
                normalized == "audio_route_anomaly" ||
                normalized == "volume_route_anomaly" ||
                normalized.contains("crash")
        }

        private fun compactLogMessage(message: String): String {
            return if (message.length <= MAX_LOG_MESSAGE_LENGTH) {
                message
            } else {
                "${message.take(MAX_LOG_MESSAGE_LENGTH)}..."
            }
        }

        private fun compactTextSample(sample: String): String {
            if (sample.isBlank()) return ""
            if (sample.startsWith("redacted len=")) return sample
            return "redacted len=${sample.length} hash=${sample.hashCode()}"
        }

        private fun sanitizeStoredNativeLogs(context: Context) {
            try {
                val prefs = context.getSharedPreferences(NATIVE_LOG_PREFS_NAME, Context.MODE_PRIVATE)
                val existing = cachedNativeLogs ?: JSONArray(prefs.getString(KEY_NATIVE_LOGS, "[]") ?: "[]")
                var changed = false

                for (i in 0 until existing.length()) {
                    val entry = existing.optJSONObject(i) ?: continue
                    val message = entry.optString("message", "")
                    val sample = entry.optString("sample", "")
                    val compactMessage = compactLogMessage(message)
                    val compactSample = compactTextSample(sample)

                    if (compactMessage != message) {
                        entry.put("message", compactMessage)
                        changed = true
                    }
                    if (compactSample != sample) {
                        entry.put("sample", compactSample)
                        changed = true
                    }
                }

                if (changed) {
                    cachedNativeLogs = existing
                    prefs.edit().putString(KEY_NATIVE_LOGS, existing.toString()).apply()
                } else {
                    cachedNativeLogs = existing
                }
            } catch (e: Exception) {
                Log.w(TAG, "Could not sanitize native Porter logs", e)
            }
        }

        fun getNativeDebugLogs(context: Context): String {
            sanitizeStoredNativeLogs(context)
            return context
                .getSharedPreferences(NATIVE_LOG_PREFS_NAME, Context.MODE_PRIVATE)
                .getString(KEY_NATIVE_LOGS, "[]") ?: "[]"
        }

        fun markDeliveryIssue(context: Context): String {
            val prefs = context.getSharedPreferences(NATIVE_LOG_PREFS_NAME, Context.MODE_PRIVATE)
            val logs = cachedNativeLogs ?: JSONArray(prefs.getString(KEY_NATIVE_LOGS, "[]") ?: "[]")
            val marker = JSONObject()
                .put("time", System.currentTimeMillis())
                .put("stage", "incident")
                .put("message", "User marked delivery issue")
                .put("packageName", "")
                .put("eventType", "MANUAL")
                .put("textLength", 0)
                .put("sample", "")

            pinNativeIncident(context, "manual", marker, logs)
            return getDeliveryDebugBlackBox(context)
        }

        fun getDeliveryDebugBlackBox(context: Context): String {
            sanitizeStoredNativeLogs(context)
            val prefs = context.getSharedPreferences(NATIVE_LOG_PREFS_NAME, Context.MODE_PRIVATE)
            val volumePrefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val logs = cachedNativeLogs ?: JSONArray(prefs.getString(KEY_NATIVE_LOGS, "[]") ?: "[]")
            val incidents = JSONArray(prefs.getString(KEY_NATIVE_INCIDENTS, "[]") ?: "[]")
            val now = System.currentTimeMillis()

            val recentEvents = JSONArray()
            for (i in 0 until logs.length()) {
                val entry = logs.optJSONObject(i) ?: continue
                if (now - entry.optLong("time", 0L) <= INCIDENT_CONTEXT_MS) {
                    recentEvents.put(entry)
                }
                if (recentEvents.length() >= MAX_NATIVE_INCIDENT_EVENTS) break
            }

            val snapshot = JSONObject()
                .put("version", 1)
                .put("generatedAt", now)
                .put("serviceRunning", isServiceRunning)
                .put("volumeGuardEnabled", volumePrefs.getBoolean(KEY_ENABLED, false))
                .put("limits", JSONObject()
                    .put("maxNativeLogs", MAX_NATIVE_LOGS)
                    .put("maxPinnedIncidents", MAX_NATIVE_INCIDENTS)
                    .put("incidentContextMinutes", INCIDENT_CONTEXT_MS / 60000)
                )
                .put("normalEvents", logs)
                .put("recentEvents", recentEvents)
                .put("pinnedIncidents", incidents)

            return snapshot.toString()
        }

        fun clearNativeDebugLogs(context: Context) {
            cachedNativeLogs = JSONArray()
            context
                .getSharedPreferences(NATIVE_LOG_PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_NATIVE_LOGS, "[]")
                .apply()
        }

        fun clearDeliveryDebugBlackBox(context: Context) {
            cachedNativeLogs = JSONArray()
            context
                .getSharedPreferences(NATIVE_LOG_PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_NATIVE_LOGS, "[]")
                .putString(KEY_NATIVE_INCIDENTS, "[]")
                .remove(KEY_BUFFERED_PORTER_EVENT)
                .apply()
            bufferedPorterEvent = null
        }

        fun consumeBufferedPorterEvent(context: Context): String {
            val prefs = context.getSharedPreferences(NATIVE_LOG_PREFS_NAME, Context.MODE_PRIVATE)
            val event = bufferedPorterEvent ?: readPersistedBufferedPorterEvent(prefs) ?: return ""

            val createdAt = event.optLong("createdAt", 0L)
            if (createdAt <= 0L || System.currentTimeMillis() - createdAt > BUFFERED_PORTER_EVENT_TTL_MS) {
                bufferedPorterEvent = null
                prefs.edit().remove(KEY_BUFFERED_PORTER_EVENT).apply()
                return ""
            }

            bufferedPorterEvent = null
            prefs.edit().remove(KEY_BUFFERED_PORTER_EVENT).apply()
            return event.toString()
        }

        private fun readPersistedBufferedPorterEvent(prefs: android.content.SharedPreferences): JSONObject? {
            return try {
                val raw = prefs.getString(KEY_BUFFERED_PORTER_EVENT, "") ?: ""
                if (raw.isBlank()) {
                    null
                } else {
                    val event = JSONObject(raw)
                    val rawText = event.optString("textContent", "")
                    if (rawText.isNotBlank()) {
                        event.remove("textContent")
                        if (!event.has("textLength")) {
                            event.put("textLength", rawText.length)
                        }
                        if (!event.has("textSummary")) {
                            event.put("textSummary", compactTextSample(rawText))
                        }
                    }
                    event.put("textContentAvailable", false)
                    event
                }
            } catch (_: Exception) {
                null
            }
        }

        private fun pinNativeIncident(
            context: Context,
            reason: String,
            trigger: JSONObject,
            availableLogs: JSONArray
        ) {
            try {
                val prefs = context.getSharedPreferences(NATIVE_LOG_PREFS_NAME, Context.MODE_PRIVATE)
                val existingIncidents = JSONArray(prefs.getString(KEY_NATIVE_INCIDENTS, "[]") ?: "[]")
                val contextEvents = JSONArray()
                val now = System.currentTimeMillis()

                contextEvents.put(trigger)
                for (i in 0 until availableLogs.length()) {
                    val entry = availableLogs.optJSONObject(i) ?: continue
                    if (entry.optLong("time", 0L) <= 0L) continue
                    if (now - entry.optLong("time", 0L) > INCIDENT_CONTEXT_MS) continue
                    if (contextEvents.length() >= MAX_NATIVE_INCIDENT_EVENTS) break
                    contextEvents.put(entry)
                }

                val incident = JSONObject()
                    .put("id", "native-${now}-${reason.hashCode()}")
                    .put("time", now)
                    .put("source", "native")
                    .put("reason", compactLogMessage(reason))
                    .put("serviceRunning", isServiceRunning)
                    .put("volumeGuardEnabled", context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                        .getBoolean(KEY_ENABLED, false))
                    .put("eventCount", contextEvents.length())
                    .put("events", contextEvents)

                val next = JSONArray()
                next.put(incident)
                val limit = minOf(existingIncidents.length(), MAX_NATIVE_INCIDENTS - 1)
                for (i in 0 until limit) {
                    next.put(existingIncidents.getJSONObject(i))
                }

                prefs.edit().putString(KEY_NATIVE_INCIDENTS, next.toString()).apply()
            } catch (e: Exception) {
                Log.w(TAG, "Could not pin native delivery incident", e)
            }
        }

        fun clampAudioForGuard(context: Context) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            if (!prefs.getBoolean(KEY_ENABLED, false)) return

            val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
            val cap = getSafeMusicCap(prefs, audioManager) ?: return
            val current = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC)
            if (current <= cap) {
                Log.d(TAG, "Volume guard skipped music current=$current cap=$cap route=${getAudioRouteSummary(audioManager)}")
                return
            }

            try {
                audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, cap, 0)
                Log.d(TAG, "Volume guard clamped music $current->$cap route=${getAudioRouteSummary(audioManager)}")
                appendNativeLog(
                    context,
                    "volume_clamp",
                    "Clamped music volume $current->$cap. ${getAudioRouteSummary(audioManager)}"
                )
            } catch (e: SecurityException) {
                Log.w(TAG, "Volume guard could not clamp music stream", e)
            }
        }

        private fun getSafeMusicCap(
            prefs: android.content.SharedPreferences,
            audioManager: AudioManager
        ): Int? {
            val maxVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
            if (maxVolume <= 0) return null

            val savedCap = prefs.getInt(
                "stream_${AudioManager.STREAM_MUSIC}",
                audioManager.getStreamVolume(AudioManager.STREAM_MUSIC)
            )
            if (savedCap < 0) return null

            val minFloor = minOf(maxVolume, maxOf(2, (maxVolume + 4) / 5))
            return savedCap.coerceIn(minFloor, maxVolume)
        }

        private fun getAudioRouteSummary(audioManager: AudioManager): String {
            return "${getActiveAudioRouteSummary(audioManager)}; ${getAvailableAudioOutputsSummary(audioManager)}"
        }

        @Suppress("DEPRECATION")
        private fun getActiveAudioRouteSummary(audioManager: AudioManager): String {
            val mediaSignals = mutableListOf<String>()
            return try {
                if (audioManager.isBluetoothA2dpOn) mediaSignals.add("bluetooth_a2dp")
                if (audioManager.isWiredHeadsetOn) mediaSignals.add("wired_headset")
                if (audioManager.isSpeakerphoneOn) mediaSignals.add("speakerphone")

                val mediaRoute = if (mediaSignals.isEmpty()) {
                    "speaker_or_unknown"
                } else {
                    mediaSignals.joinToString("+")
                }

                val communicationRoute =
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        audioManager.communicationDevice?.let { simpleAudioDeviceType(it.type) } ?: "none"
                    } else {
                        "unsupported"
                    }

                "activeAudioRoute=media:$mediaRoute,communication:$communicationRoute"
            } catch (e: Exception) {
                "activeAudioRoute=unknown:${e.javaClass.simpleName}"
            }
        }

        private fun getAvailableAudioOutputsSummary(audioManager: AudioManager): String {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return "availableAudioOutputs=unknown"

            return try {
                val outputs = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
                val hasWired = outputs.any { device ->
                    device.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
                        device.type == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
                        device.type == AudioDeviceInfo.TYPE_USB_HEADSET
                }
                val hasBluetooth = outputs.any { device ->
                    device.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
                        device.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
                        (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                            device.type == AudioDeviceInfo.TYPE_BLE_HEADSET)
                }
                val hasSpeaker = outputs.any { device ->
                    device.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
                }

                "availableAudioOutputs=wired:$hasWired,bt:$hasBluetooth,speaker:$hasSpeaker,count:${outputs.size}"
            } catch (e: Exception) {
                "availableAudioOutputs=unknown:${e.javaClass.simpleName}"
            }
        }

        private fun simpleAudioDeviceType(type: Int): String {
            return when (type) {
                AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "speaker"
                AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> "wired_headphones"
                AudioDeviceInfo.TYPE_WIRED_HEADSET -> "wired_headset"
                AudioDeviceInfo.TYPE_USB_HEADSET -> "usb_headset"
                AudioDeviceInfo.TYPE_BLUETOOTH_A2DP -> "bluetooth_a2dp"
                AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "bluetooth_sco"
                else -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                    type == AudioDeviceInfo.TYPE_BLE_HEADSET
                ) {
                    "ble_headset"
                } else {
                    "type_$type"
                }
            }
        }
    }

    private val handler = Handler(Looper.getMainLooper())
    private val accessibilityExecutor = Executors.newSingleThreadExecutor()
    private val accessibilityWorkLock = Any()
    private var pendingAccessibilityEvent: AccessibilityEvent? = null
    private var accessibilityWorkScheduled = false
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
    private var ocrUnsupportedUntil: Long = 0
    private var lastOcrUnsupportedLogTime: Long = 0
    private var lastVolumeLogTime: Long = 0
    private var lastVolumeClampRequestTime: Long = 0
    private var lastEmptyLogTime: Long = 0
    private var lastPorterProcessTime: Long = 0
    private var lastAnrGuardLogTime: Long = 0

    override fun onServiceConnected() {
        super.onServiceConnected()
        isServiceRunning = true
        sanitizeStoredNativeLogs(applicationContext)
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

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        try {
            handleAccessibilityEvent(event)
        } catch (t: Throwable) {
            Log.e(TAG, "Accessibility event handling failed safely", t)
            appendNativeLog(
                applicationContext,
                "event_error",
                "Accessibility event failed safely: ${t.javaClass.simpleName}: ${t.message}",
                event?.packageName?.toString() ?: "",
                safeEventType(event)
            )
        }
    }

    private fun handleAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        val packageName = event.packageName?.toString()?.trim().orEmpty()
        if (packageName.isEmpty()) return
        val eventType = safeEventType(event)
        
        // Only process Porter app events
        val isPorterPackage = packageName.contains("porter", ignoreCase = true)
        val isVolumeGuardPackage = VOLUME_GUARD_PACKAGES.any { packageName.contains(it, ignoreCase = true) }
        if (isVolumeGuardPackage) {
            requestVolumeClampBurst()
            appendThrottledVolumeLog(packageName, eventType)
        }

        if (!isPorterPackage) {
            return
        }

        if (!isUsefulPorterEvent(event)) {
            return
        }

        enqueuePorterEvent(event)
    }

    private fun enqueuePorterEvent(event: AccessibilityEvent) {
        val eventCopy = try {
            AccessibilityEvent.obtain(event)
        } catch (e: Exception) {
            appendAnrGuardLogAsync(
                "anr_guard_event_dropped",
                "Dropped Porter event copy failure: ${e.javaClass.simpleName}",
                event.packageName?.toString().orEmpty(),
                safeEventType(event)
            )
            return
        }

        var replacedPending = false
        synchronized(accessibilityWorkLock) {
            replacedPending = pendingAccessibilityEvent != null
            pendingAccessibilityEvent?.recycle()
            pendingAccessibilityEvent = eventCopy
            if (!accessibilityWorkScheduled) {
                accessibilityWorkScheduled = true
                handler.postDelayed({
                    accessibilityExecutor.execute { processLatestPorterEventOffMainThread() }
                }, ACCESSIBILITY_EVENT_COALESCE_MS)
            }
        }

        if (replacedPending) {
            appendAnrGuardLogAsync(
                "accessibility_event_coalesced",
                "Coalesced rapid Porter accessibility event; latest event kept",
                event.packageName?.toString().orEmpty(),
                safeEventType(event)
            )
        }
    }

    private fun processLatestPorterEventOffMainThread() {
        val eventToProcess = synchronized(accessibilityWorkLock) {
            val latest = pendingAccessibilityEvent
            pendingAccessibilityEvent = null
            accessibilityWorkScheduled = false
            latest
        } ?: return

        try {
            appendAnrGuardLogAsync(
                "main_thread_work_avoided",
                "Processing Porter text extraction off accessibility callback thread",
                eventToProcess.packageName?.toString().orEmpty(),
                safeEventType(eventToProcess)
            )
            processPorterEventSnapshot(eventToProcess)
        } catch (t: Throwable) {
            Log.e(TAG, "Off-main Porter event processing failed safely", t)
            appendNativeLog(
                applicationContext,
                "event_error",
                "Off-main Porter event failed safely: ${t.javaClass.simpleName}: ${t.message}",
                eventToProcess.packageName?.toString() ?: "",
                safeEventType(eventToProcess)
            )
        } finally {
            eventToProcess.recycle()
        }
    }

    private fun appendAnrGuardLogAsync(stage: String, message: String, packageName: String, eventType: String) {
        val now = System.currentTimeMillis()
        if (now - lastAnrGuardLogTime < 1000L && stage != "anr_guard_event_dropped") return
        lastAnrGuardLogTime = now
        accessibilityExecutor.execute {
            appendNativeLog(applicationContext, stage, message, packageName, eventType)
        }
    }

    private fun processPorterEventSnapshot(event: AccessibilityEvent) {
        val packageName = event.packageName?.toString()?.trim().orEmpty()
        if (packageName.isEmpty()) return
        val eventType = safeEventType(event)

        val now = System.currentTimeMillis()
        if (now - lastPorterProcessTime < PORTER_EVENT_MIN_INTERVAL_MS) {
            appendNativeLog(
                applicationContext,
                "anr_guard_event_dropped",
                "Dropped rapid Porter event after coalescing",
                packageName,
                eventType
            )
            return
        }
        lastPorterProcessTime = now

        appendNativeLog(applicationContext, "event", "Porter event received", packageName, eventType)

        // Try to get text from the Porter event source first, then Porter-owned windows.
        // Avoid reading SystemUI/status-bar windows because they produce notification/battery text noise.
        // Porter popups often arrive in pieces; debounce below lets the final text settle before JS parses it.
        val allTextList = mutableListOf<String>()
        val windowDiagnostics = mutableListOf<String>()
        var hasPorterOwnedSource = false
        
        // 1. Extract from event source node (catches popup/dialog content)
        val sourceNode = try {
            event.source
        } catch (e: Exception) {
            windowDiagnostics.add("source_error=${e.javaClass.simpleName}")
            null
        }
        if (sourceNode != null) {
            try {
                val sourcePackage = sourceNode.packageName?.toString() ?: ""
                val sourceClass = sourceNode.className?.toString() ?: ""
                windowDiagnostics.add("source=$sourcePackage/$sourceClass")
                if (isPorterOwnedPackage(sourcePackage)) {
                    hasPorterOwnedSource = true
                    allTextList.addAll(extractAllText(sourceNode))
                }
            } catch (e: Exception) {
                windowDiagnostics.add("source_read_error=${e.javaClass.simpleName}")
            }
        }
        
        // 2. Also extract from event text, but only when it looks like a ride.
        // Porter/SystemUI sometimes sends app labels like "Application icon" with Porter as the
        // event package; dispatching those overwrites the last useful debug state.
        val eventTexts = try {
            event.text ?: emptyList<CharSequence>()
        } catch (e: Exception) {
            windowDiagnostics.add("event_text_error=${e.javaClass.simpleName}")
            emptyList()
        }
        for (charSeq in eventTexts) {
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
        val windowsList = try {
            this.windows ?: emptyList()
        } catch (e: Exception) {
            windowDiagnostics.add("windows_error=${e.javaClass.simpleName}")
            emptyList()
        }
        for (window in windowsList) {
            try {
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
            } catch (e: Exception) {
                windowDiagnostics.add("window_read_error=${e.javaClass.simpleName}")
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
                val dispatch = Runnable {
                    accessibilityExecutor.execute { dispatchPendingEvent() }
                }
                pendingDispatch = dispatch
                handler.postDelayed(dispatch, DISPATCH_DEBOUNCE_MS)
            }
        } else {
            appendThrottledEmptyLog(packageName, eventType, windowDiagnostics.joinToString(" | "))

            if (shouldTryOcr(windowDiagnostics, packageName, eventType)) {
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
            "Matched guarded app package; requested music volume clamp. ${getAudioRouteSummaryForService()}",
            packageName,
            eventType
        )
    }

    private fun safeEventType(event: AccessibilityEvent?): String {
        if (event == null) return "TYPE_UNKNOWN"
        return try {
            AccessibilityEvent.eventTypeToString(event.eventType)
        } catch (_: Exception) {
            "TYPE_UNKNOWN"
        }
    }

    private fun isUsefulPorterEvent(event: AccessibilityEvent): Boolean {
        return try {
            PORTER_EVENT_TYPES.contains(event.eventType)
        } catch (_: Exception) {
            false
        }
    }

    private fun appendThrottledEmptyLog(packageName: String, eventType: String, diagnostics: String) {
        val now = System.currentTimeMillis()
        val hasOcrCandidate = diagnostics.contains("root=com.theporter", ignoreCase = true) &&
            diagnostics.contains("windowType=3", ignoreCase = true)

        if (!hasOcrCandidate && now - lastEmptyLogTime < 2000L) return
        lastEmptyLogTime = now

        appendNativeLog(
            applicationContext,
            "no_readable_text",
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

    private fun shouldTryOcr(windowDiagnostics: List<String>, packageName: String, eventType: String): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return false

        val hasPorterOverlay = windowDiagnostics.any { diagnostic ->
            diagnostic.contains("root=com.theporter", ignoreCase = true) &&
                diagnostic.contains("windowType=3", ignoreCase = true)
        }
        if (!hasPorterOverlay) return false

        val now = System.currentTimeMillis()
        if (now < ocrUnsupportedUntil) {
            appendThrottledOcrUnsupportedLog(packageName, eventType, "screenshot capability unavailable")
            return false
        }
        if (isOcrInFlight || now - lastOcrRequestTime < OCR_MIN_INTERVAL_MS) return false

        return true
    }

    private fun markOcrUnsupported(packageName: String, eventType: String, reason: String) {
        ocrUnsupportedUntil = System.currentTimeMillis() + OCR_UNSUPPORTED_BACKOFF_MS
        appendThrottledOcrUnsupportedLog(packageName, eventType, reason)
    }

    private fun appendThrottledOcrUnsupportedLog(packageName: String, eventType: String, reason: String) {
        val now = System.currentTimeMillis()
        if (now - lastOcrUnsupportedLogTime < OCR_UNSUPPORTED_BACKOFF_MS) return
        lastOcrUnsupportedLogTime = now
        appendNativeLog(
            applicationContext,
            "ocr_unsupported",
            "OCR fallback unsupported: $reason",
            packageName,
            eventType
        )
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

        try {
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
                        markOcrUnsupported(packageName, eventType, "takeScreenshot failed with code $errorCode")
                    }
                }
            )
        } catch (e: Exception) {
            isOcrInFlight = false
            markOcrUnsupported(packageName, eventType, "takeScreenshot request failed: ${e.message}")
        }
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

    private fun requestVolumeClampBurst() {
        val now = System.currentTimeMillis()
        if (now - lastVolumeClampRequestTime < VOLUME_CLAMP_MIN_INTERVAL_MS) return
        lastVolumeClampRequestTime = now
        clampVolumeBurst()
    }

    private fun clampVolumeBurst() {
        val delays = longArrayOf(0L, 1200L)
        for (delay in delays) {
            handler.postDelayed({
                try {
                    PorterAccessibilityService.clampAudioForGuard(applicationContext)
                } catch (e: Exception) {
                    Log.w(TAG, "Volume guard clamp failed safely", e)
                    appendNativeLog(
                        applicationContext,
                        "volume_guard_error",
                        "Volume guard clamp failed safely: ${e.message}"
                    )
                }
            }, delay)
        }
    }

    private fun getAudioRouteSummaryForService(): String {
        val audioManager = applicationContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
            ?: return "route=unknown"
        return getAudioRouteSummary(audioManager)
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
        extractAllTextSafely(node, texts, 0, intArrayOf(0))
        return texts
    }

    private fun extractAllTextSafely(
        node: AccessibilityNodeInfo,
        texts: MutableList<String>,
        depth: Int,
        visitedCount: IntArray
    ) {
        if (depth > MAX_TEXT_NODE_DEPTH || visitedCount[0] >= MAX_TEXT_NODES) return
        visitedCount[0] += 1

        try {
            val text = node.text?.toString()?.trim().orEmpty()
            if (text.isNotEmpty() && !texts.contains(text)) {
                texts.add(text)
            }

            val desc = node.contentDescription?.toString()?.trim().orEmpty()
            if (desc.isNotEmpty() && !texts.contains(desc)) {
                texts.add(desc)
            }

            val childCount = node.childCount
            for (i in 0 until childCount) {
                if (visitedCount[0] >= MAX_TEXT_NODES) return
                val child = try {
                    node.getChild(i)
                } catch (_: Exception) {
                    null
                }

                if (child != null) {
                    extractAllTextSafely(child, texts, depth + 1, visitedCount)
                }
            }
        } catch (e: Exception) {
            appendNativeLog(
                applicationContext,
                "extract_error",
                "Node text extraction failed safely: ${e.message}"
            )
        }
    }

    private fun sendEventToJS(packageName: String, textContent: String, eventType: String) {
        val currentReactContext = reactContext
        if (currentReactContext != null && currentReactContext.hasActiveReactInstance()) {
            val params: WritableMap = Arguments.createMap()
            params.putString("packageName", packageName)
            params.putString("textContent", textContent)
            params.putString("eventType", eventType)

            try {
                currentReactContext
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
            } catch (e: Exception) {
                Log.w(TAG, "ReactContext dispatch failed safely", e)
                bufferLatestPorterEvent(packageName, textContent, eventType, "dispatch_failed")
                appendNativeLog(
                    applicationContext,
                    "dispatch_failed",
                    "ReactContext dispatch failed safely; buffered latest Porter event: ${e.message}",
                    packageName,
                    eventType,
                    textContent.length,
                    textContent
                )
            }
        } else {
            Log.w(TAG, "ReactContext not available, cannot send event to JS")
            bufferLatestPorterEvent(packageName, textContent, eventType, "js_context_inactive")
            appendNativeLog(
                applicationContext,
                "js_context_inactive",
                "ReactContext not active; buffered latest Porter event for JS pull",
                packageName,
                eventType,
                textContent.length,
                textContent
            )
        }
    }

    private fun bufferLatestPorterEvent(
        packageName: String,
        textContent: String,
        eventType: String,
        reason: String
    ) {
        try {
            val createdAt = System.currentTimeMillis()
            val event = JSONObject()
                .put("createdAt", createdAt)
                .put("packageName", packageName)
                .put("eventType", eventType)
                .put("textContent", textContent)
                .put("textLength", textContent.length)
                .put("textSummary", compactTextSample(textContent))
                .put("textContentAvailable", true)
                .put("reason", reason)
            val persistedEvent = JSONObject()
                .put("createdAt", createdAt)
                .put("packageName", packageName)
                .put("eventType", eventType)
                .put("textLength", textContent.length)
                .put("textSummary", compactTextSample(textContent))
                .put("textContentAvailable", false)
                .put("reason", reason)

            bufferedPorterEvent = event
            applicationContext
                .getSharedPreferences(NATIVE_LOG_PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_BUFFERED_PORTER_EVENT, persistedEvent.toString())
                .apply()
        } catch (e: Exception) {
            Log.w(TAG, "Could not buffer Porter event", e)
        }
    }

    override fun onInterrupt() {
        Log.d(TAG, "Service Interrupted")
        appendNativeLog(applicationContext, "service", "Accessibility service interrupted")
        pendingDispatch?.let { handler.removeCallbacks(it) }
        pendingDispatch = null
        synchronized(accessibilityWorkLock) {
            pendingAccessibilityEvent?.recycle()
            pendingAccessibilityEvent = null
            accessibilityWorkScheduled = false
        }
        isServiceRunning = false
    }
    
    override fun onUnbind(intent: Intent?): Boolean {
        appendNativeLog(applicationContext, "service", "Accessibility service unbound")
        pendingDispatch?.let { handler.removeCallbacks(it) }
        pendingDispatch = null
        synchronized(accessibilityWorkLock) {
            pendingAccessibilityEvent?.recycle()
            pendingAccessibilityEvent = null
            accessibilityWorkScheduled = false
        }
        isServiceRunning = false
        return super.onUnbind(intent)
    }
}

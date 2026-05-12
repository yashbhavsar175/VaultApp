package com.spendsense

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.util.Log
import android.content.Intent
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.Arguments

class PorterAccessibilityService : AccessibilityService() {

    companion object {
        var reactContext: ReactApplicationContext? = null
        var isServiceRunning = false
        private const val TAG = "PorterAccessibility"
    }

    private var lastEventTime: Long = 0
    private var lastTextHash: Int = 0

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
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (event.packageName == null) return
        val packageName = event.packageName.toString()
        
        // Only process Porter app events (and WhatsApp for testing)
        if (!packageName.contains("porter", ignoreCase = true) && 
            !packageName.contains("whatsapp", ignoreCase = true)) {
            return
        }

        // Throttle events to max 1 per 500ms
        val currentTime = System.currentTimeMillis()
        if (currentTime - lastEventTime < 500) {
            return
        }

        // Try to get text from the event source first (popup/dialog), then fall back to rootInActiveWindow
        val allTextList = mutableListOf<String>()
        
        // 1. Extract from event source node (catches popup/dialog content)
        val sourceNode = event.source
        if (sourceNode != null) {
            allTextList.addAll(extractAllText(sourceNode))
            sourceNode.recycle()
        }
        
        // 2. Also extract from event text (sometimes popups send text directly in event)
        if (event.text != null) {
            for (charSeq in event.text) {
                val t = charSeq?.toString()?.trim() ?: ""
                if (t.isNotEmpty() && !allTextList.contains(t)) {
                    allTextList.add(t)
                }
            }
        }
        
        // 3. Fall back to root window if source didn't give enough data
        if (allTextList.size < 3) {
            val rootNode = rootInActiveWindow
            if (rootNode != null) {
                val rootTexts = extractAllText(rootNode)
                for (t in rootTexts) {
                    if (!allTextList.contains(t)) {
                        allTextList.add(t)
                    }
                }
                rootNode.recycle()
            }
        }
        
        val fullText = allTextList.joinToString(" || ")
        
        // Only send if text has actually changed (by hash comparison)
        if (fullText.isNotEmpty()) {
            val textHash = fullText.hashCode()
            if (textHash != lastTextHash) {
                lastTextHash = textHash
                lastEventTime = currentTime
                
                val eventType = AccessibilityEvent.eventTypeToString(event.eventType)
                Log.d(TAG, "Event[$eventType] from $packageName, textParts=${allTextList.size}, len=${fullText.length}")
                
                sendEventToJS(packageName, fullText, eventType)
            }
        }
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
                child.recycle()
            }
        }
        return texts
    }

    private fun sendEventToJS(packageName: String, textContent: String, eventType: String) {
        if (reactContext != null && reactContext!!.hasActiveCatalystInstance()) {
            val params: WritableMap = Arguments.createMap()
            params.putString("packageName", packageName)
            params.putString("textContent", textContent)
            params.putString("eventType", eventType)
            
            reactContext!!
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("onPorterScreenChange", params)
        } else {
            Log.w(TAG, "ReactContext not available, cannot send event to JS")
        }
    }

    override fun onInterrupt() {
        Log.d(TAG, "Service Interrupted")
        isServiceRunning = false
    }
    
    override fun onUnbind(intent: Intent?): Boolean {
        isServiceRunning = false
        return super.onUnbind(intent)
    }
}

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
    }

    private var lastEventTime: Long = 0

    override fun onServiceConnected() {
        super.onServiceConnected()
        isServiceRunning = true
        val info = AccessibilityServiceInfo()
        info.eventTypes = AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED or AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
        info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
        info.flags = AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
        this.serviceInfo = info
        Log.d("PorterAccessibility", "Service Connected")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (event.packageName == null) return
        val packageName = event.packageName.toString()
        
        // We want to trigger when Porter app is on screen, or WhatsApp for easy testing
        if (!packageName.contains("porter", ignoreCase = true) && !packageName.contains("whatsapp", ignoreCase = true)) {
            return
        }

        // Throttle events to max 1 per second to avoid crashing the RN Bridge
        val currentTime = System.currentTimeMillis()
        if (currentTime - lastEventTime < 1000) {
            return
        }

        val rootNode = rootInActiveWindow ?: return
        val allTextList = extractAllText(rootNode)
        val fullText = allTextList.joinToString(" || ")
        
        if (fullText.isNotEmpty()) {
            lastEventTime = currentTime
            sendEventToJS(packageName, fullText)
        }
    }

    private fun extractAllText(node: AccessibilityNodeInfo): List<String> {
        val texts = mutableListOf<String>()
        if (node.text != null && node.text.toString().trim().isNotEmpty()) {
            texts.add(node.text.toString().trim())
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i)
            if (child != null) {
                texts.addAll(extractAllText(child))
                child.recycle()
            }
        }
        return texts
    }

    private fun sendEventToJS(packageName: String, textContent: String) {
        if (reactContext != null && reactContext!!.hasActiveCatalystInstance()) {
            val params: WritableMap = Arguments.createMap()
            params.putString("packageName", packageName)
            params.putString("textContent", textContent)
            
            reactContext!!
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("onPorterScreenChange", params)
        }
    }

    override fun onInterrupt() {
        Log.d("PorterAccessibility", "Service Interrupted")
        isServiceRunning = false
    }
    
    override fun onUnbind(intent: Intent?): Boolean {
        isServiceRunning = false
        return super.onUnbind(intent)
    }
}

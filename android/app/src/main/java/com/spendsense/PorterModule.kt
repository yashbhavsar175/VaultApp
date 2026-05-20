package com.spendsense

import android.content.Intent
import android.provider.Settings
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import android.widget.Toast
import android.os.Handler
import android.os.Looper

class PorterModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    private var currentToast: Toast? = null

    init {
        PorterAccessibilityService.reactContext = reactContext
    }

    override fun getName(): String {
        return "PorterModule"
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
        val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        reactApplicationContext.startActivity(intent)
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
    fun showToastOverlay(message: String) {
        // Replace the previous toast instead of queueing many Porter updates.
        Handler(Looper.getMainLooper()).post {
            currentToast?.cancel()
            currentToast = Toast.makeText(reactApplicationContext, message, Toast.LENGTH_LONG)
            currentToast?.show()
        }
    }
}

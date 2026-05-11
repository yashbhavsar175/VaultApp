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
    fun showToastOverlay(message: String) {
        // A simple native toast to show distance on top of Porter app
        Handler(Looper.getMainLooper()).post {
            Toast.makeText(reactApplicationContext, message, Toast.LENGTH_LONG).show()
        }
    }
}

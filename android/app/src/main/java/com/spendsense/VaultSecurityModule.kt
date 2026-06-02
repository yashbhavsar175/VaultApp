package com.spendsense

import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class VaultSecurityModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun getName(): String {
        return "VaultSecurityModule"
    }

    @ReactMethod
    fun setSecureWindow(enabled: Boolean, promise: Promise) {
        val activity = reactApplicationContext.currentActivity
        if (activity == null) {
            promise.resolve(false)
            return
        }

        mainHandler.post {
            try {
                if (enabled) {
                    activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
                } else {
                    activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
                }
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("VAULT_SECURE_WINDOW_ERROR", "Unable to update secure window")
            }
        }
    }
}

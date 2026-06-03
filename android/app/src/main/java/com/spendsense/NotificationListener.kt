package com.spendsense

import android.content.Intent
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log

class NotificationListener : NotificationListenerService() {

    companion object {
        private const val TAG = "NotificationListener"
        
        // Allowed app packages for notification processing
        private val ALLOWED_PACKAGES = setOf(
            "com.google.android.apps.nbu.paisa.user", // Google Pay
            "com.phonepe.app",                         // PhonePe
            "tech.ula",                                // Slice
            "indwin.c3.shareapp",                      // Slice
            "com.dreamplug.androidapp",                // CRED
            "in.amazon.mShop.android.shopping",        // Amazon Pay
            "net.one97.paytm",                         // Paytm
            "com.whatsapp",                            // WhatsApp (for UPI)
            "money.super.app",                         // Super.money (legacy)
            "money.super.payments"                     // Super.money
        )
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        try {
            val packageName = sbn.packageName
            
            // Filter: Only process allowed packages
            if (!ALLOWED_PACKAGES.contains(packageName)) {
                return
            }

            val notification = sbn.notification
            val extras = notification.extras

            val title = extras.getCharSequence("android.title")?.toString() ?: ""
            val text = extras.getCharSequence("android.text")?.toString() ?: ""
            
            // Skip if no meaningful content
            if (title.isEmpty() && text.isEmpty()) {
                return
            }

            Log.d(
                TAG,
                "Notification received package=$packageName titleLength=${title.length} textLength=${text.length} postTime=${sbn.postTime}"
            )

            // Start the headless JS service
            val serviceIntent = Intent(applicationContext, NotificationProcessorService::class.java)
            val bundle = Bundle()
            bundle.putString("packageName", packageName)
            bundle.putString("title", title)
            bundle.putString("text", text)
            bundle.putLong("timestamp", sbn.postTime)
            serviceIntent.putExtras(bundle)

            applicationContext.startService(serviceIntent)
            
        } catch (e: Exception) {
            Log.e(TAG, "Error processing notification", e)
        }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification) {
        // Not needed for our use case
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        Log.d(TAG, "Notification Listener Connected")
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        Log.d(TAG, "Notification Listener Disconnected")
    }
}

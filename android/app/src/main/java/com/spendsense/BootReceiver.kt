package com.spendsense

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Boot Receiver - Restarts background services after device reboot
 * This ensures SMS and Notification listeners continue working after restart
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            Log.d("BootReceiver", "Device boot completed - restarting background services")
            
            try {
                // The notification listener service will automatically restart
                // because it's a system-bound service
                
                // SMS receiver is already registered in manifest and will work automatically
                
                Log.d("BootReceiver", "Background services initialized after boot")
            } catch (e: Exception) {
                Log.e("BootReceiver", "Error initializing services after boot", e)
            }
        }
    }
}

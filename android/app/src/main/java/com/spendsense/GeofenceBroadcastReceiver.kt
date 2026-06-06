package com.spendsense

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingEvent

class GeofenceBroadcastReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val geofencingEvent = GeofencingEvent.fromIntent(intent)
        
        if (geofencingEvent == null) {
            Log.e("GeofenceReceiver", "GeofencingEvent is null")
            return
        }
        
        if (geofencingEvent.hasError()) {
            Log.e("GeofenceReceiver", "GeofencingEvent error: ${geofencingEvent.errorCode}")
            return
        }

        val geofenceTransition = geofencingEvent.geofenceTransition

        // Process ENTER and EXIT transitions
        if (geofenceTransition == Geofence.GEOFENCE_TRANSITION_ENTER || geofenceTransition == Geofence.GEOFENCE_TRANSITION_EXIT) {
            val triggeringGeofences = geofencingEvent.triggeringGeofences
            if (triggeringGeofences == null || triggeringGeofences.isEmpty()) return

            val geofenceIds = triggeringGeofences.map { it.requestId }.toTypedArray()
            
            val transitionTypeStr = if (geofenceTransition == Geofence.GEOFENCE_TRANSITION_ENTER) "arriving" else "leaving"

            Log.d("GeofenceReceiver", "Geofence transition $transitionTypeStr. Triggered count: ${geofenceIds.size}")

            val serviceIntent = Intent(context, GeofenceProcessorService::class.java)
            val taskData = Bundle()
            taskData.putStringArray("geofenceIds", geofenceIds)
            taskData.putString("transitionType", transitionTypeStr)
            serviceIntent.putExtra("taskData", taskData)
            
            context.startService(serviceIntent)
        } else {
            Log.d("GeofenceReceiver", "Ignoring geofence transition type: $geofenceTransition")
        }
    }
}

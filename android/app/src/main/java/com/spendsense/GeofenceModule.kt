package com.spendsense

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Intent
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingClient
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices

class GeofenceModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private var geofencingClient: GeofencingClient = LocationServices.getGeofencingClient(reactContext)

    override fun getName(): String {
        return "GeofenceModule"
    }

    private val geofencePendingIntent: PendingIntent by lazy {
        val intent = Intent(reactApplicationContext, GeofenceBroadcastReceiver::class.java)
        // FLAG_MUTABLE or FLAG_IMMUTABLE
        PendingIntent.getBroadcast(
            reactApplicationContext,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        )
    }

    @SuppressLint("MissingPermission")
    @ReactMethod
    fun syncGeofences(reminders: ReadableArray, promise: Promise) {
        try {
            val geofenceList = mutableListOf<Geofence>()
            
            for (i in 0 until reminders.size()) {
                val reminder = reminders.getMap(i)
                if (reminder == null) continue
                
                val id = reminder.getString("id") ?: continue
                val latitude = reminder.getDouble("latitude")
                val longitude = reminder.getDouble("longitude")
                val radius = reminder.getDouble("radius_meters").toFloat()
                val triggerTypeStr = if (reminder.hasKey("triggerType")) reminder.getString("triggerType") else "arriving"
                
                // Privacy logging
                Log.d("GeofenceModule", "Adding geofence for reminder: ${id.takeLast(6)}, radius: $radius, type: $triggerTypeStr")

                val transitionType = if (triggerTypeStr == "leaving") {
                    Geofence.GEOFENCE_TRANSITION_EXIT
                } else {
                    Geofence.GEOFENCE_TRANSITION_ENTER
                }

                geofenceList.add(
                    Geofence.Builder()
                        .setRequestId(id)
                        .setCircularRegion(latitude, longitude, radius)
                        .setExpirationDuration(Geofence.NEVER_EXPIRE)
                        .setTransitionTypes(transitionType)
                        .build()
                )
            }

            // Remove existing geofences and then add new ones
            geofencingClient.removeGeofences(geofencePendingIntent)?.addOnCompleteListener {
                if (geofenceList.isEmpty()) {
                    Log.d("GeofenceModule", "Cleared all geofences (none to add)")
                    promise.resolve(true)
                    return@addOnCompleteListener
                }

                val geofencingRequest = GeofencingRequest.Builder()
                    .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER or GeofencingRequest.INITIAL_TRIGGER_EXIT)
                    .addGeofences(geofenceList)
                    .build()

                geofencingClient.addGeofences(geofencingRequest, geofencePendingIntent)?.run {
                    addOnSuccessListener {
                        Log.d("GeofenceModule", "Successfully added ${geofenceList.size} geofences")
                        promise.resolve(true)
                    }
                    addOnFailureListener { e ->
                        Log.e("GeofenceModule", "Failed to add geofences: ${e.message}")
                        promise.reject("GEOFENCE_ADD_ERROR", e.message)
                    }
                }
            }
        } catch (e: Exception) {
            Log.e("GeofenceModule", "Exception in syncGeofences", e)
            promise.reject("GEOFENCE_SYNC_EXCEPTION", e.message)
        }
    }

    @ReactMethod
    fun clearGeofences(promise: Promise) {
        try {
            geofencingClient.removeGeofences(geofencePendingIntent)?.run {
                addOnSuccessListener {
                    Log.d("GeofenceModule", "Successfully cleared all geofences")
                    promise.resolve(true)
                }
                addOnFailureListener { e ->
                    Log.e("GeofenceModule", "Failed to clear geofences: ${e.message}")
                    promise.reject("GEOFENCE_CLEAR_ERROR", e.message)
                }
            }
        } catch (e: Exception) {
            Log.e("GeofenceModule", "Exception in clearGeofences", e)
            promise.reject("GEOFENCE_CLEAR_EXCEPTION", e.message)
        }
    }
}

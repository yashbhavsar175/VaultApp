package com.spendsense

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class GeofenceProcessorService : HeadlessJsTaskService() {
    
    override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
        return intent?.extras?.let { extras ->
            val taskData = extras.getBundle("taskData")
            val args = if (taskData != null) {
                Arguments.fromBundle(taskData)
            } else {
                Arguments.createMap()
            }
            HeadlessJsTaskConfig(
                "GeofenceProcessorTask",
                args,
                10000, // timeout in milliseconds (10 seconds)
                true  // allow task in foreground
            )
        }
    }
}

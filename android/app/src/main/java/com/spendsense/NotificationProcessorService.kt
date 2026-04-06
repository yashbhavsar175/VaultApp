package com.spendsense

import android.content.Intent
import android.os.Bundle
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class NotificationProcessorService : HeadlessJsTaskService() {

    override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
        return intent?.extras?.let { extras ->
            val taskData = Arguments.createMap()
            taskData.putString("packageName", extras.getString("packageName"))
            taskData.putString("title", extras.getString("title"))
            taskData.putString("text", extras.getString("text"))
            taskData.putDouble("timestamp", extras.getLong("timestamp").toDouble())

            HeadlessJsTaskConfig(
                "NotificationProcessor",
                taskData,
                30000, // 30 seconds timeout
                true   // Allow in foreground
            )
        }
    }
}

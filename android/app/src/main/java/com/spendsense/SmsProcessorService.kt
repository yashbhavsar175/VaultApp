package com.spendsense

import android.content.Intent
import android.os.Bundle
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class SmsProcessorService : HeadlessJsTaskService() {
    
    override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
        return intent?.extras?.let { extras ->
            val taskData = extras.getBundle("taskData")
            val args = if (taskData != null) {
                Arguments.fromBundle(taskData)
            } else {
                Arguments.createMap()
            }
            HeadlessJsTaskConfig(
                "SmsProcessorTask",
                args,
                5000, // timeout in milliseconds
                true  // allow task in foreground
            )
        }
    }
}

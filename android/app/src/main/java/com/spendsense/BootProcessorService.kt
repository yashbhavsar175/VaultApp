package com.spendsense

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class BootProcessorService : HeadlessJsTaskService() {
    
    override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
        return HeadlessJsTaskConfig(
            "BootProcessorTask",
            Arguments.createMap(),
            10000, // timeout in milliseconds (10 seconds)
            true  // allow task in foreground
        )
    }
}

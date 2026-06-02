package com.spendsense

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.provider.Telephony
import android.telephony.SmsMessage
import android.util.Log
import com.facebook.react.HeadlessJsTaskService

class SmsReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "SmsReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Telephony.Sms.Intents.SMS_RECEIVED_ACTION) {
            val bundle: Bundle? = intent.extras
            if (bundle != null) {
                try {
                    val pdus = bundle.get("pdus") as Array<*>
                    val messages = arrayOfNulls<SmsMessage>(pdus.size)
                    
                    for (i in pdus.indices) {
                        messages[i] = SmsMessage.createFromPdu(pdus[i] as ByteArray)
                    }
                    
                    // Concatenate multi-part SMS
                    val messageBody = StringBuilder()
                    var sender = ""
                    
                    for (message in messages) {
                        message?.let {
                            messageBody.append(it.messageBody)
                            if (sender.isEmpty()) {
                                sender = it.originatingAddress ?: ""
                            }
                        }
                    }
                    
                    val compactSender = sender.replace(Regex("""[\s()-]"""), "")
                    val senderKind = when {
                        sender.isBlank() -> "missing"
                        compactSender.matches(Regex("""\+?\d{6,}""")) -> "phone_like"
                        sender.matches(Regex("""[A-Za-z]{2}-.*""")) -> "dlt_prefixed"
                        sender.matches(Regex("""[A-Za-z0-9_-]+""")) -> "token"
                        else -> "other"
                    }
                    Log.d(TAG, "SMS Received senderPresent=${sender.isNotBlank()} senderKind=$senderKind")
                    Log.d(TAG, "SMS Body length: ${messageBody.length}")
                    
                    // Start Headless JS Service
                    val serviceIntent = Intent(context, SmsProcessorService::class.java)
                    val taskData = Bundle()
                    taskData.putString("sender", sender)
                    taskData.putString("body", messageBody.toString())
                    taskData.putLong("timestamp", System.currentTimeMillis())
                    
                    serviceIntent.putExtra("taskData", taskData)
                    context.startService(serviceIntent)
                    
                } catch (e: Exception) {
                    Log.e(TAG, "Error processing SMS: ${e.message}", e)
                }
            }
        }
    }
}

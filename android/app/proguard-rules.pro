# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# Keep SMS Receiver and Service classes
-keep class com.spendsense.SmsReceiver { *; }
-keep class com.spendsense.SmsProcessorService { *; }

# Keep React Native bridge methods
-keepclassmembers class * {
    @com.facebook.react.bridge.ReactMethod *;
}

# Keep BroadcastReceiver methods
-keepclassmembers class * extends android.content.BroadcastReceiver {
    public void onReceive(android.content.Context, android.content.Intent);
}

# Keep Service methods
-keepclassmembers class * extends android.app.Service {
    public android.os.IBinder onBind(android.content.Intent);
}

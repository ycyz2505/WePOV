-keep class app.wepov.client.** { *; }
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep class org.json.** { *; }
-dontwarn org.apache.**
-dontwarn okhttp3.**
-dontwarn okio.**

# 保留更新器与签名校验，避免被裁剪导致门禁失效
-keep class app.wepov.updater.** { *; }

# 保留行号用于崩溃定位，但隐藏源文件名
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

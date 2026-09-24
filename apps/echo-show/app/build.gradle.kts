plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The shell loads the Vercel-hosted UI. Override per build:
//   gradle :app:assembleDebug -PsmartmirrorWebUrl=https://smartmirror-git-my-branch.vercel.app
val smartmirrorWebUrl: String =
    (project.findProperty("smartmirrorWebUrl") as String?) ?: "https://smart-mirror.vercel.app"

android {
    namespace = "com.ruslanmv.smartmirror"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.ruslanmv.smartmirror"
        minSdk = 28
        targetSdk = 35
        versionCode = 2
        versionName = "0.2.0"
        buildConfigField("String", "SMARTMIRROR_WEB_URL", "\"$smartmirrorWebUrl\"")
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-gson:2.11.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")
}

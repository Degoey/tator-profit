import java.net.URI
import java.util.Properties

plugins {
    id("com.android.application")
}

/*
 * The Android side of Tatorprofit is a deliberately thin shell: it renders the
 * already-deployed Next.js application inside a hardened WebView.
 *
 * There is no business logic, no local database and no bundled copy of the web
 * app here. The session cookie, the `requireAdminCapability` guards and the
 * audit trail stay exactly where they are today: on the server.
 */

/** Absolute entry URL. Override with `-Ptatorprofit.appUrl=https://…`. */
val configuredAppUrl: String = (project.findProperty("tatorprofit.appUrl") as String?)
    ?.trim()
    ?.takeIf { it.isNotEmpty() }
    ?: "http://10.0.2.2:3000/admin"

val entryUri = URI(configuredAppUrl)
val entryScheme = entryUri.scheme?.lowercase()
require(
    (entryScheme == "http" || entryScheme == "https")
        && !entryUri.host.isNullOrEmpty()
        && entryUri.rawUserInfo == null
        && !configuredAppUrl.contains('"')
        && !configuredAppUrl.contains('\\')
        && configuredAppUrl.none { it.isISOControl() },
) {
    "tatorprofit.appUrl must be an absolute http(s) URL without credentials: $configuredAppUrl"
}
// Validate before any release task executes, including direct packaging tasks.
if (gradle.startParameter.taskNames.any { it.contains("release", ignoreCase = true) }) {
    require(entryScheme == "https") { "Release requires an HTTPS appUrl" }
    require(rootProject.file("keystore.properties").exists()) {
        "Release requires your own keystore.properties; debug keys are not production keys"
    }
}

/*
 * Release signing is opt-in: copy `keystore.properties.example` to
 * `keystore.properties` (git-ignored) and point it at the upload key. Without
 * that file a release build is signed with the local debug key, so the pipeline
 * still produces an installable artifact.
 */
val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) {
        keystorePropertiesFile.inputStream().use { load(it) }
    }
}

android {
    namespace = "com.tatorprofit.admin"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.tatorprofit.admin"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"

        // Single source of truth for the entry URL, read by MainActivity.
        buildConfigField("String", "APP_URL", "\"$configuredAppUrl\"")
    }

    signingConfigs {
        if (keystorePropertiesFile.exists()) {
            create("release") {
                storeFile = rootProject.file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        debug {
            // A separate id keeps a test build from overwriting a real install.
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }

        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            // No fallback to the debug key: a release build is either signed with
            // your upload key or left unsigned, never with a shared dev key.
            if (keystorePropertiesFile.exists()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    buildFeatures {
        // BuildConfig.APP_URL / BuildConfig.DEBUG are used by MainActivity.
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}



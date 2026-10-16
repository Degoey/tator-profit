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
 *
 * One project, three surfaces — anggota, admin and pemilik. They differ only in
 * package id, launcher label, icon artwork, entry URL and (for the owner console)
 * passkey support, so a hardening change lands in every APK at once instead of
 * drifting between three copies of the same Activity.
 */

/** One installable surface: what makes the three APKs different from each other. */
data class Surface(
    /** Flavor name; also the source-set directory under `app/src/`. */
    val name: String,
    val applicationId: String,
    /** Launcher label; mirrors `name` in the matching PWA manifest. */
    val label: String,
    /** Gradle property that overrides the entry URL for this surface. */
    val urlProperty: String,
    /** Entry URL used when the property is not set (emulator loopback alias). */
    val defaultUrl: String,
    /** Icon artwork basename inside `public/icons`. */
    val artwork: String,
)

val surfaces = listOf(
    Surface(
        name = "anggota",
        applicationId = "com.tatorprofit.app",
        label = "Tatorprofit",
        urlProperty = "tatorprofit.anggotaUrl",
        defaultUrl = "http://10.0.2.2:3000/dashboard",
        artwork = "icon-512.png",
    ),
    Surface(
        name = "admin",
        applicationId = "com.tatorprofit.admin",
        label = "Tatorprofit Admin",
        urlProperty = "tatorprofit.adminUrl",
        defaultUrl = "http://10.0.2.2:3000/admin",
        artwork = "admin-512.png",
    ),
    Surface(
        name = "owner",
        applicationId = "com.tatorprofit.owner",
        label = "Tatorprofit Pemilik",
        urlProperty = "tatorprofit.ownerUrl",
        defaultUrl = "http://10.0.2.2:3000/owner",
        artwork = "owner-512.png",
    ),
)

/** Absolute entry URL of a surface: the property when set, otherwise the default. */
fun entryUrlFor(surface: Surface): String =
    (project.findProperty(surface.urlProperty) as String?)
        ?.trim()
        ?.takeIf { it.isNotEmpty() }
        ?: surface.defaultUrl

val entryUrls: Map<Surface, String> = surfaces.associateWith(::entryUrlFor)

entryUrls.forEach { (surface, url) ->
    val uri = URI(url)
    val scheme = uri.scheme?.lowercase()
    require(
        (scheme == "http" || scheme == "https")
            && !uri.host.isNullOrEmpty()
            && uri.rawUserInfo == null
            && !url.contains('"')
            && !url.contains('\\')
            && url.none { it.isISOControl() },
    ) {
        "${surface.urlProperty} must be an absolute http(s) URL without credentials: $url"
    }
}

// Validate before any release task executes, including direct packaging tasks.
if (gradle.startParameter.taskNames.any { it.contains("release", ignoreCase = true) }) {
    entryUrls.forEach { (surface, url) ->
        require(URI(url).scheme?.lowercase() == "https") {
            "Release requires an HTTPS ${surface.urlProperty}"
        }
    }
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
    // R class and relative manifest names resolve against this, not against the
    // per-surface application id.
    namespace = "com.tatorprofit.wrapper"
    compileSdk = 35

    defaultConfig {
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }

    flavorDimensions += "surface"

    productFlavors {
        surfaces.forEach { surface ->
            create(surface.name) {
                dimension = "surface"
                applicationId = surface.applicationId
                resValue("string", "app_name", surface.label)
                // Single source of truth for the entry URL, read by the wrapper.
                buildConfigField("String", "APP_URL", "\"${entryUrls.getValue(surface)}\"")
            }
        }
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
        // BuildConfig.APP_URL / BuildConfig.DEBUG are used by the wrapper.
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    /*
     * Passkeys inside a WebView — needed by the owner console only, because it is
     * the one surface with a mandatory second factor (`/owner` asks for a passkey).
     * Declared for the owner flavor alone: the anggota and admin APKs must stay
     * dependency-free so a compromise of a third-party library cannot reach an
     * officer's session.
     */
    add("ownerImplementation", "androidx.webkit:webkit:1.14.0")
    add("ownerImplementation", "androidx.credentials:credentials:1.6.0")
    add("ownerImplementation", "androidx.credentials:credentials-play-services-auth:1.6.0")
}

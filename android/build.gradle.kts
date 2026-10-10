// Root build script of the Tatorprofit Android wrapper.
//
// The wrapper is a thin shell around the already-deployed Next.js application
// (see `app/src/main/java/com/tatorprofit/admin/MainActivity.java`), so there is
// exactly one plugin and no library module.
plugins {
    id("com.android.application") version "8.9.1" apply false
}

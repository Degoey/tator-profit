# Tatorprofit Admin â€” Android wrapper

A deliberately thin Android shell around the **already deployed** Next.js
application. It renders the web app in a hardened `WebView`; it contains no
business logic, no local database and no bundled copy of the web UI.

That is the whole point: authentication, RBAC (`requireAdminCapability`), the
audit trail and every money rule stay on the server, so the APK can never show a
number the web app would not show, and it never stores a balance on the device.

---

## 1. Requirements

| Tool | Version used | Notes |
| --- | --- | --- |
| JDK | 21 (Temurin) | AGP 8.9 needs 17+; `JAVA_HOME` must point at it |
| Gradle | 8.11.1 | via the wrapper, no local install needed |
| Android Gradle Plugin | 8.9.1 | declared in the root `build.gradle.kts` |
| Android SDK | `compileSdk 35`, build-tools 35 | `minSdk 24`, `targetSdk 35` |

The Gradle wrapper downloads Gradle itself; the SDK is located through
`android/local.properties`, which is **machine specific and git-ignored**. On a
new machine create it:

```properties
sdk.dir=C:/Users/<you>/AppData/Local/Android/Sdk
```

(Alternatively set the `ANDROID_HOME` environment variable. Android Studio writes
the same value with doubled backslashes, e.g. `sdk.dir=C\:` followed by the path
with every separator doubled; both forms resolve to the same directory.)

There are **no runtime dependencies**: the app is one Activity, two WebView
clients and Android framework classes only.

---

## 2. Point it at your server

The entry URL is a single Gradle property, `tatorprofit.appUrl`, defined in
`android/gradle.properties`:

```properties
tatorprofit.appUrl=http://10.0.2.2:3000/admin
```

* `10.0.2.2` is the **emulator's alias for the host machine**, so the default
  reaches `npm run dev` running on your PC. On a physical device use the LAN IP
  of that machine (`http://192.168.x.x:3000/admin`) or, better, the deployed
  HTTPS origin.
* Override per build instead of editing the file:

  ```powershell
  .\gradlew.bat assembleDebug "-Ptatorprofit.appUrl=https://app.tatorprofit.id/admin"
  ```

  > **Quote the whole argument.** Without the quotes, PowerShell/cmd splits
  > `-Pname=value` at the `=` and Gradle reports
  > `Cannot locate tasks that match '.appUrl=https'`. In `cmd.exe` the quotes are
  > harmless.

* `/admin` matches `start_url` in `src/app/manifest.ts`. The server guard
  redirects a signed-in member to `/dashboard`, so the same APK is safe for both
  roles.

Cleartext HTTP is only allowed by the **debug** network policy. A release build
therefore refuses to start against an `http://` URL, and it refuses to build at
all without an `https://` URL:

```
> Release requires an HTTPS appUrl
```

---

## 3. Build

```powershell
cd android

# Debug APK -> android/app/build/outputs/apk/debug/app-debug.apk
.\gradlew.bat assembleDebug

# Install on the connected device/emulator
.\gradlew.bat installDebug

# Release (needs keystore.properties, see below)
.\gradlew.bat assembleRelease
.\gradlew.bat bundleRelease      # AAB for Play
```

Debug builds use the package id `com.tatorprofit.admin.debug` (suffix added by
`applicationIdSuffix`), so a test build never overwrites a real install. Release
builds use `com.tatorprofit.admin`.

### Prebuilt debug APKs (`android/dist/`)

Because the entry URL is compiled in, one APK cannot serve both an emulator and a
physical phone. Two ready-to-install debug builds are kept in `android/dist/`
(both git-ignored via `*.apk`):

| File | Entry URL | Use it for |
| --- | --- | --- |
| `tatorprofit-admin-debug-emulator.apk` | `http://10.0.2.2:3000/admin` | an AVD on the same PC as `npm run dev` |
| `tatorprofit-admin-debug-lan.apk` | `http://192.168.1.15:3000/admin` | a phone on the same Wi-Fi (replace the IP with your PC's) |

Rebuild them with:

```powershell
cd android
.\gradlew.bat assembleDebug
Copy-Item app\build\outputs\apk\debug\app-debug.apk dist\tatorprofit-admin-debug-emulator.apk -Force

.\gradlew.bat assembleDebug "-Ptatorprofit.appUrl=http://<your-lan-ip>:3000/admin"
Copy-Item app\build\outputs\apk\debug\app-debug.apk dist\tatorprofit-admin-debug-lan.apk -Force
```

Install on the running emulator/device with `adb install -r <file>` (add
`-t` if the device rejects a debug build). A LAN build only works while
`npm run dev` is running **and** Windows Firewall allows inbound TCP 3000;
`10.0.2.2` needs no firewall rule because it never leaves the host.

#### Reaching `npm run dev` from a non-localhost origin

Two server-side gates must be opened before a phone or an emulator WebView can
talk to the dev server. Both are development-only; neither affects a production
HTTPS deployment.

1. **Dev resources (`/_next/*`, HMR socket).** Next 16 answers those requests
   with `403` for hosts it does not recognise. Add the host to
   `DEV_ALLOWED_ORIGINS` in `.env` (see `.env.example`) and restart `next dev`:

   ```dotenv
   DEV_ALLOWED_ORIGINS="10.0.2.2,192.168.1.15"
   ```

   Without it the page still loads, but hot reload never connects.

2. **CSRF origin guard.** Every mutating route calls `assertSameOrigin()`
   (`src/lib/request-origin.ts`). The dev server reports `request.url` as
   `localhost` even when the WebView addressed the LAN IP, so the guard compares
   the `Origin` header against the request's `Host` header (falling back to
   `request.url`, and honouring `X-Forwarded-Proto` behind a TLS proxy). A
   WebView that loads `http://<host>:3000/admin` therefore passes, while a
   cross-site `Origin` is still rejected with `403`.

### Signing a release

```powershell
cd android
keytool -genkeypair -v -keystore upload-key.jks -keyalg RSA -keysize 4096 `
        -validity 10000 -alias tatorprofit
Copy-Item keystore.properties.example keystore.properties
# then edit keystore.properties
```

`keystore.properties`, `*.jks` and every `*.apk`/`*.aab` are git-ignored. A
release build **never** falls back to the shared debug key: without
`keystore.properties` the release task fails on purpose.

---

## 4. Launcher icons

The icons are generated from the canonical PWA artwork in `public/icons`, so the
launcher icon and the browser-installed icon cannot drift apart:

```powershell
powershell -ExecutionPolicy Bypass -File android/tools/generate-icons.ps1
```

It writes, for each density bucket (`mdpi` â€¦ `xxxhdpi`):

| File | Purpose |
| --- | --- |
| `ic_launcher.png` | legacy icon, API < 26 |
| `ic_launcher_round.png` | legacy round icon |
| `ic_launcher_foreground.png` | adaptive foreground (108dp layer, mark at 62%) |

`res/mipmap-anydpi-v26/ic_launcher.xml` composes the adaptive icon from that
foreground plus the brand ink background. The script uses `System.Drawing` from
Windows PowerShell, so no npm package and no native build step is involved.

---

## 5. Security posture

`tests/android-wrapper.test.ts` locks every item below, so a change that weakens
the wrapper fails `npm test`.

| Concern | Behaviour |
| --- | --- |
| Permissions | only `INTERNET` and `ACCESS_NETWORK_STATE`; no camera, location, contacts or storage |
| Transport | cleartext refused (release `network_security_config`); mixed content `NEVER_ALLOW` |
| TLS | `onReceivedSslError` always calls `handler.cancel()`; `proceed()` appears nowhere |
| Navigation | only the configured origin replaces the document; other hosts and `mailto`/`tel`/`whatsapp` open in the system; `file:`, `content:` and `intent:` are blocked |
| Local files | `setAllowFileAccess(false)`, `setAllowContentAccess(false)`, no `addJavascriptInterface` |
| Device APIs | `onPermissionRequest` denies, geolocation always refused |
| Session | cookie stays in the WebView cookie jar, flushed on pause; `allowBackup="false"` keeps it out of adb backups; the only `getCookie` call forwards it to `DownloadManager` for a file the user asked for |
| Offline | a local asset page with no data, no `localStorage`, no `fetch` |

`WebView.setWebContentsDebuggingEnabled(true)` is debug-only.

---

## 6. What is intentionally not here

* **No `assetlinks.json`.** Digital Asset Links are only needed for a Trusted Web
  Activity (no URL bar at all). It requires a published HTTPS origin plus the
  release keystore SHA-256, so it can only be created once the production domain
  and upload key exist. The debug key fingerprint reported by
  `apksigner verify --print-certs` is the shared public Android debug key and
  must never be published in `assetlinks.json`.
* **No push notifications, no background sync, no offline data.** The panel is
  live-server-only by design.
* **No renderer-crash recovery.** If the WebView renderer process is killed by
  the system, Android restarts the app from the entry URL.
* **No deep links / app shortcuts.** The PWA manifest shortcuts still work in the
  browser-installed app.

Data inside the app still requires the Next.js server (and its database) to be
reachable; the wrapper adds no fallback of its own.

---

## 7. Tests

```powershell
npx tsx --test tests/android-wrapper.test.ts
```

37 assertions over the manifest, the network policies, the Activity source, the
brand tokens, the icons, the offline asset and (when present) the built APK. No
database, no emulator and no build are required.

---

## 8. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Blank page in the emulator | `npm run dev` is not running, or the URL is not `10.0.2.2` |
| Blank page on a phone | `localhost` points at the phone; use the LAN IP or the deployed origin |
| `ERR_CLEARTEXT_NOT_PERMITTED` | an `http://` URL in a release build; use HTTPS or a debug build |
| `SDK location not found` | create `android/local.properties` (section 1) |
| `Release requires an HTTPS appUrl` | pass `"-Ptatorprofit.appUrl=https://â€¦"` (quoted) |
| `Cannot locate tasks that match '.appUrl=https'` | unquoted `-Pâ€¦=â€¦` argument; wrap it in quotes |
| `Release requires your own keystore.properties` | create it from `keystore.properties.example` |
| Debugging the page | debug builds only: `chrome://inspect` on the host machine |

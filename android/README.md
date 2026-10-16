# Tatorprofit Android wrapper

One Gradle project that ships **three separate Android apps** around the
**already deployed** Next.js application. Each app renders one web surface in a
hardened `WebView`; none of them contains business logic, a local database or a
bundled copy of the web UI.

| Surface | Package id | Entry URL | Launcher label | Icon |
| --- | --- | --- | --- | --- |
| `anggota` | `com.tatorprofit.app` | `/dashboard` | Tatorprofit | green |
| `admin` | `com.tatorprofit.admin` | `/admin` | Tatorprofit Admin | blue |
| `owner` | `com.tatorprofit.owner` | `/owner` | Tatorprofit Pemilik | gold |

That is the whole point: authentication, RBAC (`requireAdminCapability`), the
audit trail and every money rule stay on the server, so an APK can never show a
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

The `anggota` and `admin` apps have **no runtime dependencies**: one Activity, two
WebView clients and Android framework classes only. The `owner` app adds the
credential libraries it needs for passkeys (section 6) — declared for that flavor
alone, so a third-party library can never sit inside an officer's session.

---

## 2. Point each surface at your server

The entry URL is one Gradle property per surface, defined in
`android/gradle.properties`:

```properties
tatorprofit.anggotaUrl=http://10.0.2.2:3000/dashboard
tatorprofit.adminUrl=http://10.0.2.2:3000/admin
tatorprofit.ownerUrl=http://10.0.2.2:3000/owner
```

* `10.0.2.2` is the **emulator's alias for the host machine**, so the defaults
  reach `npm run dev` running on your PC. On a physical device use the LAN IP of
  that machine (`http://192.168.x.x:3000/admin`) or, better, the deployed HTTPS
  origin.
* Override per build instead of editing the file:

  ```powershell
  .\gradlew.bat assembleDebug "-Ptatorprofit.ownerUrl=https://app.tatorprofitbos.my.id/owner"
  ```

  > **Quote the whole argument.** Without the quotes, PowerShell/cmd splits
  > `-Pname=value` at the `=` and Gradle reports
  > `Cannot locate tasks that match '.ownerUrl=https'`. In `cmd.exe` the quotes
  > are harmless.

* Each path matches the `start_url` of the matching PWA manifest
  (`src/app/manifest.ts`, `src/lib/config/admin-manifest.ts`,
  `src/app/owner/manifest.webmanifest/route.ts`). The server guard sends a
  signed-in member to `/dashboard` and refuses a non-admin at `/admin`, so an app
  opened by the wrong role shows the web app's own refusal instead of a local
  screen.

Cleartext HTTP is only allowed by the **debug** network policy. A release build
therefore refuses to start against an `http://` URL, and it refuses to build at
all without `https://` URLs:

```
> Release requires an HTTPS tatorprofit.ownerUrl
```

---

## 3. Build

```powershell
cd android

# All three debug APKs -> app/build/outputs/apk/<surface>/debug/app-<surface>-debug.apk
.\gradlew.bat assembleDebug

# All three release APKs (needs keystore.properties, see below)
.\gradlew.bat assembleRelease

# One surface only
.\gradlew.bat assembleOwnerRelease
.\gradlew.bat assembleAdminRelease
.\gradlew.bat assembleAnggotaRelease
```

Debug builds add the suffix `.debug` to the package id
(`com.tatorprofit.owner.debug`), so a test build never overwrites a real install.
Release builds use the ids in the table above.

### Reaching `npm run dev` from a non-localhost origin

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
`keystore.properties` the release task fails on purpose. All three surfaces are
signed with the same key, which is what lets an installed app be updated in place
— and what makes the published certificate fingerprint in
`src/lib/config/android-app-links.ts` meaningful.

---

## 4. Launcher icons

The icons are generated from the canonical PWA artwork in `public/icons`, so each
launcher icon matches the icon its own PWA manifest serves:

| Surface | Square artwork | Maskable artwork |
| --- | --- | --- |
| `anggota` | `icon-512.png` | `maskable-512.png` |
| `admin` | `admin-512.png` | `admin-maskable-512.png` |
| `owner` | `owner-512.png` | `owner-maskable-512.png` |

```powershell
powershell -ExecutionPolicy Bypass -File android/tools/generate-icons.ps1
```

On a machine without PowerShell (server, CI) run the twin script, which applies
the same rules:

```bash
python3 android/tools/generate-icons.py
```

Both write, per surface and density bucket (`mdpi` … `xxxhdpi`), into
`app/src/<surface>/res/`:

| File | Purpose |
| --- | --- |
| `ic_launcher.png` | legacy icon, API < 26 |
| `ic_launcher_round.png` | legacy round icon |
| `ic_launcher_foreground.png` | adaptive foreground (108dp layer, mark at 62%) |

`app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml` composes the adaptive icon
from that foreground plus the brand ink background, for every surface. The
PowerShell script uses `System.Drawing`, so it needs no npm package; the Python
twin needs Pillow (`pip install pillow`) and nothing else.

---

## 5. Security posture

`tests/android-wrapper.test.ts` locks every item below — for all three surfaces —
so a change that weakens one APK fails `npm test`.

| Concern | Behaviour |
| --- | --- |
| Permissions | the declared manifest asks only for `INTERNET` and `ACCESS_NETWORK_STATE`; no camera, location, contacts or storage |
| Transport | cleartext refused (release `network_security_config`); mixed content `NEVER_ALLOW` |
| TLS | `onReceivedSslError` always calls `handler.cancel()`; `proceed()` appears nowhere |
| Navigation | only the configured origin replaces the document; other hosts and `mailto`/`tel`/`whatsapp` open in the system; `file:`, `content:` and `intent:` are blocked |
| Local files | `setAllowFileAccess(false)`, `setAllowContentAccess(false)`, no `addJavascriptInterface` |
| Device APIs | `onPermissionRequest` denies, geolocation always refused |
| Session | cookie stays in the WebView cookie jar, flushed on pause; `allowBackup="false"` keeps it out of adb backups; the only `getCookie` call forwards it to `DownloadManager` for a file the user asked for |
| Offline | a local asset page with no data, no `localStorage`, no `fetch` |

`WebView.setWebContentsDebuggingEnabled(true)` is debug-only.

The `owner` APK's merged manifest additionally carries `USE_BIOMETRIC`,
`USE_FINGERPRINT` and a private `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, all
contributed by the credential libraries the passkey support needs. The `anggota`
and `admin` APKs carry none of them.

---

## 6. Passkeys in the owner app

The Konsol Pemilik (`/owner`) requires a passkey as its second factor. A plain
WebView refuses `navigator.credentials`, so the owner app enables the WebView
WebAuthn API in `OwnerActivity` (`WebSettingsCompat.setWebAuthenticationSupport`).
Three things must hold, or the owner sees a console they can never unlock:

1. **The credential libraries**, declared for the `owner` flavor only
   (`androidx.webkit`, `androidx.credentials`, `credentials-play-services-auth`).
2. **Digital Asset Links.** The web app serves
   `/.well-known/assetlinks.json` (a rewrite to `/api/android/assetlinks`) naming
   `com.tatorprofit.owner` and the release certificate's SHA-256 fingerprint. It
   must answer `200` with a JSON content type and must **not** redirect. Rotating
   the signing key means updating `src/lib/config/android-app-links.ts` and
   redeploying — otherwise the fingerprint prompt silently stops appearing.
3. **An up-to-date Android System WebView** on the device.

If the device cannot do passkeys at all, the app says so and opens the console in
the system browser instead of showing a dead screen.

---

## 7. What is intentionally not here

* **No push notifications, no background sync, no offline data.** Every surface is
  live-server-only by design.
* **No renderer-crash recovery.** If the WebView renderer process is killed by the
  system, Android restarts the app from the entry URL.
* **No deep links / app shortcuts.** The PWA manifest shortcuts still work in the
  browser-installed app. The assetlinks statement deliberately grants only
  `delegate_permission/common.get_login_creds`, not `common.handle_all_urls`.
* **No native money logic.** No balance, no queue, no receipt is computed on the
  device.

Data inside an app still requires the Next.js server (and its database) to be
reachable; the wrapper adds no fallback of its own.

---

## 8. Tests

```powershell
npx tsx --test tests/android-wrapper.test.ts
```

50 assertions over the shared manifest, the per-surface manifests, the network
policies, the Activity sources, the brand tokens, the icons, the passkey/assetlinks
wiring, the offline asset and (when present) the built APKs. No database, no
emulator and no build are required.

---

## 9. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Blank page in the emulator | `npm run dev` is not running, or the URL is not `10.0.2.2` |
| Blank page on a phone | `localhost` points at the phone; use the LAN IP or the deployed origin |
| `ERR_CLEARTEXT_NOT_PERMITTED` | an `http://` URL in a release build; use HTTPS or a debug build |
| `SDK location not found` | create `android/local.properties` (section 1) |
| `Release requires an HTTPS tatorprofit.<surface>Url` | pass the property with an `https://` value (quoted) |
| `Cannot locate tasks that match '.ownerUrl=https'` | unquoted `-P…=…` argument; wrap it in quotes |
| `Release requires your own keystore.properties` | create it from `keystore.properties.example` |
| Passkey prompt never appears in the owner app | check `/.well-known/assetlinks.json` answers `200` JSON with no redirect, that the fingerprint matches `apksigner verify --print-certs`, and that Android System WebView is current |
| Debugging the page | debug builds only: `chrome://inspect` on the host machine |

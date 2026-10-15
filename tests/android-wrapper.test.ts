/**
 * Guards the Android wrapper in `android/`.
 *
 * The assertions below are money-safety rules, not style preferences. A wrapper
 * that accepted a broken certificate, followed a link to another origin, or kept
 * a copy of the session outside the WebView cookie jar could hand an
 * administrator session to a page that never passed `requireAdminCapability`.
 *
 * Nothing here needs a database, an emulator or a built APK: it reads the
 * manifest, the resources and the Activity source directly.
 */
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { ADMIN_MANIFEST } from "../src/lib/config/admin-manifest";

/** `npm test` always runs from the repository root. */
const ROOT = process.cwd();

function readProjectFile(...segments: string[]): string {
  return readFileSync(path.join(ROOT, ...segments), "utf8");
}

function readAndroidFile(...segments: string[]): string {
  return readProjectFile("android", ...segments);
}

const APP_MAIN = ["app", "src", "main"] as const;
const RES_VALUES = [...APP_MAIN, "res", "values"] as const;

const manifestXml = readAndroidFile(...APP_MAIN, "AndroidManifest.xml");
const activitySource = readAndroidFile(
  ...APP_MAIN,
  "java",
  "com",
  "tatorprofit",
  "admin",
  "MainActivity.java",
);
const appGradle = readAndroidFile("app", "build.gradle.kts");
const rootGradle = readAndroidFile("build.gradle.kts");
const settingsGradle = readAndroidFile("settings.gradle.kts");
const gradleProperties = readAndroidFile("gradle.properties");
const releaseNetworkConfig = readAndroidFile(...APP_MAIN, "res", "xml", "network_security_config.xml");
const debugNetworkConfig = readAndroidFile(
  "app",
  "src",
  "debug",
  "res",
  "xml",
  "network_security_config.xml",
);
const colorsXml = readAndroidFile(...RES_VALUES, "colors.xml");
const stringsXml = readAndroidFile(...RES_VALUES, "strings.xml");
const themesXml = readAndroidFile(...RES_VALUES, "themes.xml");
const layoutXml = readAndroidFile(...APP_MAIN, "res", "layout", "activity_main.xml");
const offlineHtml = readAndroidFile(...APP_MAIN, "assets", "offline.html");
const adaptiveIconXml = readAndroidFile(...APP_MAIN, "res", "mipmap-anydpi-v26", "ic_launcher.xml");
const iconScript = readAndroidFile("tools", "generate-icons.ps1");

const globalsCss = readProjectFile("src", "app", "globals.css");
const gitignore = readProjectFile(".gitignore");

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Reads width and height from the IHDR chunk, so a renamed or truncated file fails. */
function readPngSize(absolutePath: string): { width: number; height: number } {
  const bytes = readFileSync(absolutePath);
  assert.ok(bytes.subarray(0, 8).equals(PNG_SIGNATURE), `${absolutePath} bukan berkas PNG`);
  assert.equal(bytes.subarray(12, 16).toString("ascii"), "IHDR", `${absolutePath} tanpa chunk IHDR`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Brand token from `src/app/globals.css`, e.g. `ink` -> `--color-ink`. */
function cssToken(name: string): string {
  return globalsCss.match(new RegExp(`--color-${name}:\\s*([^;]+);`))?.[1]?.trim() ?? "";
}

/** `<color name="…">` from `res/values/colors.xml`. */
function androidColor(name: string): string {
  return colorsXml.match(new RegExp(`<color name="${name}">\\s*([^<]+?)\\s*</color>`))?.[1] ?? "";
}

/** `key=value` from `android/gradle.properties`. */
function gradleProperty(name: string): string {
  return gradleProperties.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim() ?? "";
}

const declaredPermissions = [...manifestXml.matchAll(/<uses-permission android:name="([^"]+)"/g)].map(
  (match) => match[1],
);

/** Absolute entry URL the wrapper opens on launch. */
const configuredAppUrl = gradleProperty("tatorprofit.appUrl");

describe("manifest Android", () => {
  it("hanya meminta izin jaringan", () => {
    assert.deepEqual(declaredPermissions, [
      "android.permission.INTERNET",
      "android.permission.ACCESS_NETWORK_STATE",
    ]);
    // Kamera, lokasi, kontak dan penyimpanan tidak pernah dipakai shell ini.
    assert.equal(/CAMERA|LOCATION|CONTACTS|RECORD_AUDIO|WRITE_EXTERNAL/.test(manifestXml), false);
  });

  it("menonaktifkan cadangan aplikasi agar cookie sesi tidak bisa diekspor", () => {
    assert.match(manifestXml, /android:allowBackup="false"/);
  });

  it("memakai kebijakan jaringan eksplisit dan tidak membuka cleartext", () => {
    assert.match(manifestXml, /android:networkSecurityConfig="@xml\/network_security_config"/);
    assert.equal(manifestXml.includes('usesCleartextTraffic="true"'), false);
  });

  it("mengekspor satu aktivitas peluncur saja", () => {
    assert.match(manifestXml, /<activity\s+android:name="\.MainActivity"/);
    assert.match(manifestXml, /android:exported="true"/);
    assert.match(manifestXml, /android.intent.category.LAUNCHER/);
    assert.match(manifestXml, /android:launchMode="singleTask"/);
    // Rotasi tidak boleh membangun ulang WebView: sesi dan riwayat tetap utuh.
    assert.match(manifestXml, /orientation\|screenSize/);
    assert.equal((manifestXml.match(/<activity\b/g) ?? []).length, 1);
  });

  it("memberi tema gelap yang sama dengan warna shell web", () => {
    assert.match(manifestXml, /android:theme="@style\/Theme\.Tatorprofit"/);
    assert.match(themesXml, /android:Theme\.Material\.NoActionBar/);
    assert.match(themesXml, /<item name="android:windowBackground">@color\/brand_ink<\/item>/);
    assert.match(themesXml, /<item name="android:statusBarColor">@color\/brand_ink<\/item>/);
  });
});

describe("kebijakan jaringan wrapper", () => {
  it("menolak cleartext pada build rilis", () => {
    assert.match(releaseNetworkConfig, /<base-config cleartextTrafficPermitted="false">/);
    // Tidak ada pengecualian domain yang tersisa di build rilis.
    assert.equal(releaseNetworkConfig.includes("domain-config"), false);
  });

  it("hanya mengizinkan cleartext lewat override build debug", () => {
    assert.match(debugNetworkConfig, /<base-config cleartextTrafficPermitted="true">/);
    assert.match(debugNetworkConfig, /src\/main\/res\/xml\/network_security_config\.xml/);
  });
});

describe("pengerasan WebView", () => {
  it("menolak konten campuran dan penyimpanan formulir", () => {
    assert.match(activitySource, /setMixedContentMode\(WebSettings\.MIXED_CONTENT_NEVER_ALLOW\)/);
    assert.match(activitySource, /setSaveFormData\(false\)/);
  });

  it("mematikan akses berkas dan konten lokal dari halaman remote", () => {
    assert.match(activitySource, /setAllowFileAccess\(false\)/);
    assert.match(activitySource, /setAllowContentAccess\(false\)/);
    assert.equal(activitySource.includes("setAllowFileAccess(true)"), false);
    assert.equal(activitySource.includes("setAllowUniversalAccessFromFileURLs"), false);
  });

  it("tidak memasang jembatan JavaScript", () => {
    assert.equal(activitySource.includes("addJavascriptInterface"), false);
  });

  it("membatalkan koneksi bersertifikat rusak alih-alih melanjutkannya", () => {
    assert.match(activitySource, /public void onReceivedSslError\(/);
    assert.match(activitySource, /handler\.cancel\(\)/);
    assert.equal(/handler\.proceed\(/.test(activitySource), false);
  });

  it("menolak permintaan kamera, mikrofon dan lokasi", () => {
    assert.match(activitySource, /public void onPermissionRequest\(PermissionRequest request\)/);
    assert.match(activitySource, /request\.deny\(\)/);
    assert.match(activitySource, /callback\.invoke\(origin, false, false\)/);
    assert.match(activitySource, /setGeolocationEnabled\(false\)/);
    assert.equal(/\.grant\(/.test(activitySource), false);
  });

  it("membatasi dokumen yang boleh dimuat ke origin aplikasi", () => {
    assert.match(activitySource, /private boolean isAppHost\(String host\)/);
    assert.match(activitySource, /private boolean handleNavigation\(Uri uri\)/);
    assert.match(activitySource, /host\.equalsIgnoreCase\(appHost\)/);
    // Skema di luar http(s) yang diizinkan dibuka oleh aplikasi lain.
    assert.match(activitySource, /List\.of\("mailto", "tel", "sms", "smsto", "whatsapp", "market"\)/);
    // Skema berbahaya tidak pernah dimuat di dalam WebView.
    assert.match(activitySource, /Log\.w\(TAG, "Blocked navigation to scheme: "/);
  });

  it("hanya membaca cookie sesi untuk mengunduh berkas yang diminta", () => {
    const reads = activitySource.match(/getCookie\(/g) ?? [];
    assert.equal(reads.length, 1, "cookie hanya dibaca sekali, untuk unduhan");
    assert.match(activitySource, /request\.addRequestHeader\("Cookie", cookie\)/);
  });

  it("menempatkan bilah kemajuan di atas WebView yang dibuat di kode", () => {
    assert.match(layoutXml, /android:id="@\+id\/root"/);
    assert.match(layoutXml, /android:id="@\+id\/progress"/);
    assert.match(layoutXml, /progressTint="@color\/brand_neon"/);
    assert.match(layoutXml, /android:background="@color\/brand_ink"/);
    // WebView sengaja tidak ada di XML: dibuat di kode agar bisa dibangun ulang.
    assert.equal(layoutXml.includes("<WebView"), false);
    assert.match(activitySource, /created = new WebView\(this\)/);
    assert.match(activitySource, /rootLayout\.addView\(created, 0\)/);
  });
});

describe("sesi, unduhan dan unggahan", () => {
  it("menyimpan cookie sesi saat aplikasi dijeda", () => {
    assert.match(activitySource, /CookieManager\.getInstance\(\)\.flush\(\)/);
    assert.match(activitySource, /setAcceptCookie\(true\)/);
    assert.match(activitySource, /setAcceptThirdPartyCookies\(webView, false\)/);
  });

  it("meneruskan cookie ke DownloadManager untuk berkas bukti setoran", () => {
    assert.match(
      activitySource,
      /DownloadManager\.Request request = new DownloadManager\.Request\(uri\)/,
    );
    assert.match(
      activitySource,
      /setDestinationInExternalPublicDir\(Environment\.DIRECTORY_DOWNLOADS, fileName\)/,
    );
    assert.match(activitySource, /setDestinationInExternalFilesDir\(/);
  });

  it("mendukung unggahan bukti setoran dari halaman web", () => {
    assert.match(activitySource, /public boolean onShowFileChooser\(/);
    assert.match(activitySource, /params\.createIntent\(\), REQUEST_FILE_CHOOSER/);
    assert.match(activitySource, /callback\.onReceiveValue\(result\)/);
    // Callback harus selalu dijawab, termasuk saat pemilihan dibatalkan.
    assert.match(activitySource, /pendingFileCallback\.onReceiveValue\(null\)/);
  });

  it("membuka tautan luar seperti WhatsApp lewat aplikasi lain", () => {
    assert.match(activitySource, /startActivity\(new Intent\(Intent\.ACTION_VIEW, uri\)\)/);
    assert.match(activitySource, /catch \(ActivityNotFoundException error\)/);
  });

  it("mengikuti riwayat sebelum menutup aplikasi", () => {
    assert.match(activitySource, /if \(webView != null && webView\.canGoBack\(\)\)/);
    assert.match(activitySource, /webView\.goBack\(\)/);
    assert.match(activitySource, /registerOnBackInvokedCallback/);
  });
});

describe("kesesuaian brand dengan permukaan web", () => {
  it("memakai token warna yang sama dengan globals.css", () => {
    const expected: Array<[string, string]> = [
      ["ink", "brand_ink"],
      ["ink-soft", "brand_ink_soft"],
      ["ink-card", "brand_ink_card"],
      ["neon", "brand_neon"],
      ["neon-dim", "brand_neon_dim"],
      ["gold", "brand_gold"],
    ];

    for (const [token, resource] of expected) {
      assert.equal(
        androidColor(resource).toLowerCase(),
        cssToken(token).toLowerCase(),
        `${resource} harus sama dengan --color-${token}`,
      );
    }
  });

  it("memberi label peluncur yang sama dengan nama manifest PWA", () => {
    // Pembungkus Android ini adalah aplikasi **admin**: namanya mengikuti manifest
    // panel (`/admin/manifest.webmanifest`), bukan manifest anggota di akar.
    assert.equal(ADMIN_MANIFEST.name, "Tatorprofit Admin");
    assert.match(stringsXml, /<string name="app_name">Tatorprofit Admin<\/string>/);
  });

  it("mewarnai ikon adaptif dengan latar brand", () => {
    assert.match(adaptiveIconXml, /<background android:drawable="@color\/brand_ink" \/>/);
    assert.match(adaptiveIconXml, /<foreground android:drawable="@mipmap\/ic_launcher_foreground" \/>/);
  });
});

describe("konfigurasi build wrapper", () => {
  it("menargetkan Android 15 dengan dukungan mundur ke Android 7", () => {
    assert.match(appGradle, /namespace = "com\.tatorprofit\.admin"/);
    assert.match(appGradle, /applicationId = "com\.tatorprofit\.admin"/);
    assert.match(appGradle, /compileSdk = 35/);
    assert.match(appGradle, /minSdk = 24/);
    assert.match(appGradle, /targetSdk = 35/);
  });

  it("menyuntikkan satu sumber URL masuk sebagai BuildConfig", () => {
    assert.match(appGradle, /buildConfig = true/);
    assert.match(appGradle, /buildConfigField\("String", "APP_URL", "\\"\$configuredAppUrl\\""\)/);
    assert.match(activitySource, /webView\.loadUrl\(BuildConfig\.APP_URL\)/);
  });

  it("memakai /admin sebagai titik masuk, sama dengan manifest PWA", () => {
    const url = new URL(configuredAppUrl);

    assert.equal(url.protocol, "http:");
    assert.equal(url.hostname, "10.0.2.2", "default hanya untuk emulator");
    assert.equal(url.port, "3000");
    assert.equal(url.pathname, ADMIN_MANIFEST.start_url);
  });

  it("menolak rilis tanpa HTTPS dan tanpa kunci sendiri", () => {
    assert.match(appGradle, /require\(entryScheme == "https"\)/);
    assert.match(appGradle, /rootProject\.file\("keystore\.properties"\)\.exists\(\)/);
    // Rilis tidak pernah ditandatangani dengan kunci debug bersama.
    assert.equal(/signingConfig = signingConfigs\.getByName\("debug"\)/.test(appGradle), false);
  });

  it("memisahkan id paket build debug dari rilis", () => {
    assert.match(appGradle, /applicationIdSuffix = "\.debug"/);
  });

  it("tidak menambah dependensi runtime", () => {
    assert.equal(/\bimplementation\(|\bapi\(|\bkapt\(/.test(appGradle), false);
    assert.equal(/^dependencies\s*\{/m.test(appGradle), false);
  });

  it("memakai versi toolchain yang tersedia di mesin ini", () => {
    assert.match(rootGradle, /id\("com\.android\.application"\) version "8\.9\.1"/);
    assert.match(settingsGradle, /rootProject\.name = "TatorprofitAdmin"/);
    assert.match(settingsGradle, /include\(":app"\)/);
    assert.match(
      readAndroidFile("gradle", "wrapper", "gradle-wrapper.properties"),
      /gradle-8\.11\.1-bin\.zip/,
    );
  });

  it("tidak pernah menyimpan SDK lokal dan kunci penandatanganan di git", () => {
    for (const entry of [
      "android/local.properties",
      "android/keystore.properties",
      "android/*.jks",
      "android/.gradle/",
    ]) {
      assert.ok(gitignore.includes(entry), `${entry} harus diabaikan git`);
    }
    assert.ok(gitignore.includes("*.apk"), "APK tidak boleh ikut ter-commit");
  });
});

describe("ikon peluncur", () => {
  /** Density bucket -> legacy icon size in pixels. */
  const densities: Array<[string, number]> = [
    ["mdpi", 48],
    ["hdpi", 72],
    ["xhdpi", 96],
    ["xxhdpi", 144],
    ["xxxhdpi", 192],
  ];

  it("menyediakan ikon legacy, bulat dan lapisan adaptif di setiap densitas", () => {
    for (const [density, size] of densities) {
      const folder = path.join(ROOT, "android", ...APP_MAIN, "res", `mipmap-${density}`);

      const legacy = readPngSize(path.join(folder, "ic_launcher.png"));
      assert.equal(legacy.width, size, `lebar ic_launcher ${density}`);
      assert.equal(legacy.height, size, `tinggi ic_launcher ${density}`);

      const round = readPngSize(path.join(folder, "ic_launcher_round.png"));
      assert.equal(round.width, size, `lebar ic_launcher_round ${density}`);

      // Lapisan adaptif selalu 108dp, yaitu 2.25x ukuran ikon legacy.
      const layer = readPngSize(path.join(folder, "ic_launcher_foreground.png"));
      assert.equal(layer.width, Math.round(size * 2.25), `lebar foreground ${density}`);
      assert.equal(layer.height, layer.width, `foreground ${density} harus persegi`);
    }
  });

  it("menurunkan ikon dari aset PWA yang sama, tanpa mengunduh apa pun", () => {
    assert.match(iconScript, /icon-512\.png/);
    assert.match(iconScript, /maskable-512\.png/);
    assert.equal(/Invoke-WebRequest|npm install/.test(iconScript), false);
  });
});

describe("halaman offline lokal", () => {
  it("memakai token yang sama dengan yang diganti MainActivity", () => {
    assert.match(
      activitySource,
      /private static final String OFFLINE_URL_TOKEN = "__TATORPROFIT_APP_URL__"/,
    );
    assert.ok(offlineHtml.includes("__TATORPROFIT_APP_URL__"), "token harus ada di aset");
  });

  it("tidak menyimpan data apa pun di perangkat", () => {
    for (const forbidden of [
      "localStorage",
      "sessionStorage",
      "document.cookie",
      "indexedDB",
      "fetch(",
    ]) {
      assert.equal(
        offlineHtml.includes(forbidden),
        false,
        `halaman offline tidak boleh memakai ${forbidden}`,
      );
    }
  });

  it("memberi tombol coba lagi dan memuat ulang saat koneksi kembali", () => {
    assert.match(offlineHtml, /<button id="retry" type="button">Coba lagi<\/button>/);
    assert.match(offlineHtml, /window\.addEventListener\("online", retry\)/);
    // Token build-time tetap divalidasi sebelum dipakai sebagai tujuan navigasi.
    assert.ok(
      offlineHtml.includes("/^https?:\\/\\//i.test(target)"),
      "tujuan coba lagi harus divalidasi",
    );
  });

  it("hanya mengganti halaman saat frame utama gagal", () => {
    assert.match(activitySource, /if \(!request\.isForMainFrame\(\)\)/);
    assert.match(activitySource, /showOfflinePage\(\)/);
  });
});

describe("artefak APK", () => {
  it("menghasilkan APK debug yang bisa dipasang setelah di-build", () => {
    const apkPath = path.join(
      ROOT,
      "android",
      "app",
      "build",
      "outputs",
      "apk",
      "debug",
      "app-debug.apk",
    );

    let size = 0;
    try {
      size = statSync(apkPath).size;
    } catch {
      // Belum di-build: jalankan `cd android && ./gradlew assembleDebug`.
      return;
    }

    assert.ok(size > 10_000, "APK debug terlalu kecil untuk memuat WebView shell");
    assert.equal(
      readFileSync(apkPath).subarray(0, 2).toString("ascii"),
      "PK",
      "APK harus berupa arsip zip",
    );
  });
});

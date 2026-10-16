/**
 * Guards the Android wrapper in `android/`.
 *
 * The assertions below are money-safety rules, not style preferences. A wrapper
 * that accepted a broken certificate, followed a link to another origin, or kept
 * a copy of the session outside the WebView cookie jar could hand an
 * administrator session to a page that never passed `requireAdminCapability`.
 *
 * One project ships three surfaces — anggota, admin and pemilik — so most checks
 * run per surface: a hardening fix applied to only one APK is exactly the drift
 * this file exists to catch.
 *
 * Nothing here needs a database, an emulator or a built APK: it reads the
 * manifests, the resources and the Activity sources directly.
 */
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { ADMIN_MANIFEST } from "../src/lib/config/admin-manifest";
import {
  ANDROID_ASSET_LINKS,
  OWNER_ANDROID_CERT_SHA256,
  OWNER_ANDROID_PACKAGE,
} from "../src/lib/config/android-app-links";
import manifest from "../src/app/manifest";
/** `npm test` always runs from the repository root. */
const ROOT = process.cwd();

/** Root PWA manifest is a Next.js manifest route, so it exports a function. */
const rootPwaManifest = manifest();

function readProjectFile(...segments: string[]): string {
  return readFileSync(path.join(ROOT, ...segments), "utf8");
}

function readAndroidFile(...segments: string[]): string {
  return readProjectFile("android", ...segments);
}

const APP_MAIN = ["app", "src", "main"] as const;
const RES_VALUES = [...APP_MAIN, "res", "values"] as const;
const WRAPPER_PACKAGE = ["java", "com", "tatorprofit", "wrapper"] as const;

/**
 * The three installable surfaces, mirroring the `surfaces` list in
 * `android/app/build.gradle.kts`. A surface may not differ from the others in
 * anything that is not declared here.
 */
interface Surface {
  /** Gradle flavor name; also the source-set directory. */
  flavor: string;
  applicationId: string;
  label: string;
  urlProperty: string;
  /** Path the entry URL must end with (the matching PWA manifest start_url). */
  entryPath: string;
  /** PWA artwork basename the launcher icons are derived from. */
  artwork: string;
  maskableArtwork: string;
  activity: string;
  /** True when this surface needs passkeys inside the WebView. */
  passkey: boolean;
}

const SURFACES: Surface[] = [
  {
    flavor: "anggota",
    applicationId: "com.tatorprofit.app",
    label: "Tatorprofit",
    urlProperty: "tatorprofit.anggotaUrl",
    entryPath: "/dashboard",
    artwork: "icon-512.png",
    maskableArtwork: "maskable-512.png",
    activity: "com.tatorprofit.wrapper.SurfaceActivity",
    passkey: false,
  },
  {
    flavor: "admin",
    applicationId: "com.tatorprofit.admin",
    label: "Tatorprofit Admin",
    urlProperty: "tatorprofit.adminUrl",
    entryPath: "/admin",
    artwork: "admin-512.png",
    maskableArtwork: "admin-maskable-512.png",
    activity: "com.tatorprofit.wrapper.SurfaceActivity",
    passkey: false,
  },
  {
    flavor: "owner",
    applicationId: "com.tatorprofit.owner",
    label: "Tatorprofit Pemilik",
    urlProperty: "tatorprofit.ownerUrl",
    entryPath: "/owner",
    artwork: "owner-512.png",
    maskableArtwork: "owner-maskable-512.png",
    activity: "com.tatorprofit.wrapper.OwnerActivity",
    passkey: true,
  },
];

const manifestXml = readAndroidFile(...APP_MAIN, "AndroidManifest.xml");
const wrapperSource = readAndroidFile(...APP_MAIN, ...WRAPPER_PACKAGE, "WrapperActivity.java");
const surfaceSource = readAndroidFile(...APP_MAIN, ...WRAPPER_PACKAGE, "SurfaceActivity.java");
const ownerSource = readAndroidFile(
  "app",
  "src",
  "owner",
  ...WRAPPER_PACKAGE,
  "OwnerActivity.java",
);
const appGradle = readAndroidFile("app", "build.gradle.kts");
const rootGradle = readAndroidFile("build.gradle.kts");
const settingsGradle = readAndroidFile("settings.gradle.kts");
const gradleProperties = readAndroidFile("gradle.properties");
const releaseNetworkConfig = readAndroidFile(
  ...APP_MAIN,
  "res",
  "xml",
  "network_security_config.xml",
);
const debugNetworkConfig = readAndroidFile(
  "app",
  "src",
  "debug",
  "res",
  "xml",
  "network_security_config.xml",
);
const colorsXml = readAndroidFile(...RES_VALUES, "colors.xml");
const themesXml = readAndroidFile(...RES_VALUES, "themes.xml");
const layoutXml = readAndroidFile(...APP_MAIN, "res", "layout", "activity_main.xml");
const offlineHtml = readAndroidFile(...APP_MAIN, "assets", "offline.html");
const adaptiveIconXml = readAndroidFile(
  ...APP_MAIN,
  "res",
  "mipmap-anydpi-v26",
  "ic_launcher.xml",
);
const iconScript = readAndroidFile("tools", "generate-icons.ps1");
const iconScriptPy = readAndroidFile("tools", "generate-icons.py");
const ownerStringsXml = readAndroidFile("app", "src", "owner", "res", "values", "strings.xml");

const globalsCss = readProjectFile("src", "app", "globals.css");
const gitignore = readProjectFile(".gitignore");
const ownerManifestRoute = readProjectFile(
  "src",
  "app",
  "owner",
  "manifest.webmanifest",
  "route.ts",
);

/** Flavor manifest of a surface. */
function flavorManifest(surface: Surface): string {
  return readAndroidFile("app", "src", surface.flavor, "AndroidManifest.xml");
}

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

/** Entry URL configured for a surface. */
function entryUrl(surface: Surface): string {
  return gradleProperty(surface.urlProperty);
}

/** Absolute path of one launcher icon file of a surface. */
function iconPath(surface: Surface, density: string, file: string): string {
  return path.join(
    ROOT,
    "android",
    "app",
    "src",
    surface.flavor,
    "res",
    `mipmap-${density}`,
    file,
  );
}

const declaredPermissions = [...manifestXml.matchAll(/<uses-permission android:name="([^"]+)"/g)].map(
  (match) => match[1],
);

describe("manifest Android bersama", () => {
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

  it("tidak mendeklarasikan aktivitas peluncur di manifest bersama", () => {
    // Satu proyek, tiga aplikasi. Kalau peluncurnya ada di manifest bersama,
    // ketiga APK akan memasang peluncur yang sama.
    assert.equal(/<activity\b/.test(manifestXml), false);
  });
});

describe("manifes per permukaan", () => {
  for (const surface of SURFACES) {
    it(`${surface.flavor}: satu aktivitas peluncur dengan kelas, id paket dan label sendiri`, () => {
      const xml = flavorManifest(surface);

      assert.ok(
        xml.includes(`android:name="${surface.activity}"`),
        `${surface.flavor} harus meluncurkan ${surface.activity}`,
      );
      assert.match(xml, /android:exported="true"/);
      assert.match(xml, /android.intent.category.LAUNCHER/);
      assert.match(xml, /android:launchMode="singleTask"/);
      assert.match(xml, /android:theme="@style\/Theme\.Tatorprofit"/);
      // Rotasi tidak boleh membangun ulang WebView: sesi dan riwayat tetap utuh.
      assert.match(xml, /orientation\|screenSize/);
      assert.equal((xml.match(/<activity\b/g) ?? []).length, 1);
      assert.equal(/<uses-permission/.test(xml), false, "izin hanya di manifest bersama");

      assert.ok(
        appGradle.includes(`applicationId = "${surface.applicationId}"`),
        `${surface.flavor} harus memakai id paket ${surface.applicationId}`,
      );
      // Label peluncur diambil dari deklarasi permukaan, jadi tidak mungkin satu
      // APK memakai nama permukaan lain.
      assert.ok(
        appGradle.includes('resValue("string", "app_name", surface.label)'),
        `${surface.flavor} harus mengambil label dari deklarasi permukaannya`,
      );
      assert.ok(
        appGradle.includes(`label = "${surface.label}"`),
        `${surface.flavor} harus memakai label ${surface.label}`,
      );
    });
  }

  it("id paket ketiga permukaan berbeda satu sama lain", () => {
    const ids = SURFACES.map((surface) => surface.applicationId);
    assert.equal(new Set(ids).size, ids.length);
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
    assert.match(wrapperSource, /setMixedContentMode\(WebSettings\.MIXED_CONTENT_NEVER_ALLOW\)/);
    assert.match(wrapperSource, /setSaveFormData\(false\)/);
  });

  it("mematikan akses berkas dan konten lokal dari halaman remote", () => {
    assert.match(wrapperSource, /setAllowFileAccess\(false\)/);
    assert.match(wrapperSource, /setAllowContentAccess\(false\)/);
    assert.equal(wrapperSource.includes("setAllowFileAccess(true)"), false);
    assert.equal(wrapperSource.includes("setAllowUniversalAccessFromFileURLs"), false);
  });

  it("tidak memasang jembatan JavaScript", () => {
    assert.equal(wrapperSource.includes("addJavascriptInterface"), false);
  });

  it("membatalkan koneksi bersertifikat rusak alih-alih melanjutkannya", () => {
    assert.match(wrapperSource, /public void onReceivedSslError\(/);
    assert.match(wrapperSource, /handler\.cancel\(\)/);
    assert.equal(/handler\.proceed\(/.test(wrapperSource), false);
  });

  it("menolak permintaan kamera, mikrofon dan lokasi", () => {
    assert.match(wrapperSource, /public void onPermissionRequest\(PermissionRequest request\)/);
    assert.match(wrapperSource, /request\.deny\(\)/);
    assert.match(wrapperSource, /callback\.invoke\(origin, false, false\)/);
    assert.match(wrapperSource, /setGeolocationEnabled\(false\)/);
    assert.equal(/\.grant\(/.test(wrapperSource), false);
  });

  it("membatasi dokumen yang boleh dimuat ke origin aplikasi", () => {
    assert.match(wrapperSource, /private boolean isAppHost\(String host\)/);
    assert.match(wrapperSource, /private boolean handleNavigation\(Uri uri\)/);
    assert.match(wrapperSource, /host\.equalsIgnoreCase\(appHost\)/);
    // Skema di luar http(s) yang diizinkan dibuka oleh aplikasi lain.
    assert.match(
      wrapperSource,
      /List\.of\("mailto", "tel", "sms", "smsto", "whatsapp", "market"\)/,
    );
    // Skema berbahaya tidak pernah dimuat di dalam WebView.
    assert.match(wrapperSource, /Log\.w\(TAG, "Blocked navigation to scheme: "/);
  });

  it("hanya membaca cookie sesi untuk mengunduh berkas yang diminta", () => {
    const reads = wrapperSource.match(/getCookie\(/g) ?? [];
    assert.equal(reads.length, 1, "cookie hanya dibaca sekali, untuk unduhan");
    assert.match(wrapperSource, /request\.addRequestHeader\("Cookie", cookie\)/);
  });

  it("menempatkan bilah kemajuan di atas WebView yang dibuat di kode", () => {
    assert.match(layoutXml, /android:id="@\+id\/root"/);
    assert.match(layoutXml, /android:id="@\+id\/progress"/);
    assert.match(layoutXml, /progressTint="@color\/brand_neon"/);
    assert.match(layoutXml, /android:background="@color\/brand_ink"/);
    // WebView sengaja tidak ada di XML: dibuat di kode agar bisa dibangun ulang.
    assert.equal(layoutXml.includes("<WebView"), false);
    assert.match(wrapperSource, /created = new WebView\(this\)/);
    assert.match(wrapperSource, /rootLayout\.addView\(created, 0\)/);
  });
});

describe("sesi, unduhan dan unggahan", () => {
  it("menyimpan cookie sesi saat aplikasi dijeda", () => {
    assert.match(wrapperSource, /CookieManager\.getInstance\(\)\.flush\(\)/);
    assert.match(wrapperSource, /setAcceptCookie\(true\)/);
    assert.match(wrapperSource, /setAcceptThirdPartyCookies\(webView, false\)/);
  });

  it("meneruskan cookie ke DownloadManager untuk berkas bukti setoran", () => {
    assert.match(
      wrapperSource,
      /DownloadManager\.Request request = new DownloadManager\.Request\(uri\)/,
    );
    assert.match(
      wrapperSource,
      /setDestinationInExternalPublicDir\(Environment\.DIRECTORY_DOWNLOADS, fileName\)/,
    );
    assert.match(wrapperSource, /setDestinationInExternalFilesDir\(/);
  });

  it("mendukung unggahan bukti setoran dari halaman web", () => {
    assert.match(wrapperSource, /public boolean onShowFileChooser\(/);
    assert.match(wrapperSource, /params\.createIntent\(\), REQUEST_FILE_CHOOSER/);
    assert.match(wrapperSource, /callback\.onReceiveValue\(result\)/);
    // Callback harus selalu dijawab, termasuk saat pemilihan dibatalkan.
    assert.match(wrapperSource, /pendingFileCallback\.onReceiveValue\(null\)/);
  });

  it("membuka tautan luar seperti WhatsApp lewat aplikasi lain", () => {
    assert.match(wrapperSource, /startActivity\(new Intent\(Intent\.ACTION_VIEW, uri\)\)/);
    assert.match(wrapperSource, /catch \(ActivityNotFoundException error\)/);
  });

  it("mengikuti riwayat sebelum menutup aplikasi", () => {
    assert.match(wrapperSource, /if \(webView != null && webView\.canGoBack\(\)\)/);
    assert.match(wrapperSource, /webView\.goBack\(\)/);
    assert.match(wrapperSource, /registerOnBackInvokedCallback/);
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

  it("memberi setiap permukaan label yang sama dengan maniven PWA-nya", () => {
    const anggota = SURFACES.find((surface) => surface.flavor === "anggota");
    const admin = SURFACES.find((surface) => surface.flavor === "admin");
    const owner = SURFACES.find((surface) => surface.flavor === "owner");

    assert.equal(anggota?.label, rootPwaManifest.name);
    assert.equal(admin?.label, ADMIN_MANIFEST.name);
    // Manifest pemilik ditulis sebagai route handler, jadi dibaca dari berkasnya.
    assert.match(ownerManifestRoute, /name: "Tatorprofit Pemilik"/);
    assert.equal(owner?.label, "Tatorprofit Pemilik");
  });

  it("mewarnai ikon adaptif dengan latar brand", () => {
    assert.match(adaptiveIconXml, /<background android:drawable="@color\/brand_ink" \/>/);
    assert.match(
      adaptiveIconXml,
      /<foreground android:drawable="@mipmap\/ic_launcher_foreground" \/>/,
    );
  });

  it("memakai tema gelap yang sama dengan warna shell web", () => {
    assert.match(manifestXml, /android:theme="@style\/Theme\.Tatorprofit"/);
    assert.match(themesXml, /android:Theme\.Material\.NoActionBar/);
    assert.match(themesXml, /<item name="android:windowBackground">@color\/brand_ink<\/item>/);
    assert.match(themesXml, /<item name="android:statusBarColor">@color\/brand_ink<\/item>/);
  });
});

describe("konfigurasi build wrapper", () => {
  it("menargetkan Android 15 dengan dukungan mundur ke Android 7", () => {
    assert.match(appGradle, /namespace = "com\.tatorprofit\.wrapper"/);
    assert.match(appGradle, /compileSdk = 35/);
    assert.match(appGradle, /minSdk = 24/);
    assert.match(appGradle, /targetSdk = 35/);
  });

  it("menyuntikkan satu sumber URL masuk sebagai BuildConfig per permukaan", () => {
    assert.match(appGradle, /buildConfig = true/);
    assert.match(
      appGradle,
      /buildConfigField\("String", "APP_URL", "\\"\$\{entryUrls\.getValue\(surface\)\}\\""\)/,
    );
    assert.match(wrapperSource, /webView\.loadUrl\(BuildConfig\.APP_URL\)/);
  });

  it("memakai titik masuk yang sama dengan maniven PWA tiap permukaan", () => {
    for (const surface of SURFACES) {
      const url = new URL(entryUrl(surface));

      assert.equal(url.protocol, "http:", `${surface.flavor}: default hanya untuk emulator`);
      assert.equal(url.hostname, "10.0.2.2");
      assert.equal(url.port, "3000");
      assert.equal(url.pathname, surface.entryPath, `${surface.flavor}: titik masuk`);
    }
  });

  it("menolak rilis tanpa HTTPS dan tanpa kunci sendiri", () => {
    assert.match(appGradle, /require\(URI\(url\)\.scheme\?\.lowercase\(\) == "https"\)/);
    assert.match(appGradle, /rootProject\.file\("keystore\.properties"\)\.exists\(\)/);
    // Rilis tidak pernah ditandatangani dengan kunci debug bersama.
    assert.equal(/signingConfig = signingConfigs\.getByName\("debug"\)/.test(appGradle), false);
  });

  it("memisahkan id paket build debug dari rilis", () => {
    assert.match(appGradle, /applicationIdSuffix = "\.debug"/);
  });

  it("hanya permukaan pemilik yang membawa pustaka, dan hanya untuk passkey", () => {
    // Shell anggota dan admin wajib tanpa dependensi: sesi petugas tidak boleh
    // bergantung pada pustaka pihak ketiga.
    assert.equal(/\bimplementation\(/.test(appGradle), false, "tidak ada dependensi tanpa cakupan");

    const deps = [...appGradle.matchAll(/add\("(\w+Implementation)", "([^"]+)"\)/g)].map(
      (match) => ({ scope: match[1], artifact: match[2] }),
    );

    assert.ok(deps.length > 0, "permukaan pemilik butuh pustaka passkey");
    for (const dep of deps) {
      assert.equal(
        dep.scope,
        "ownerImplementation",
        `${dep.artifact} hanya untuk permukaan pemilik`,
      );
    }
    assert.deepEqual(
      deps.map((dep) => dep.artifact).sort(),
      [
        "androidx.credentials:credentials-play-services-auth:1.6.0",
        "androidx.credentials:credentials:1.6.0",
        "androidx.webkit:webkit:1.14.0",
      ].sort(),
    );
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

describe("permukaan pemilik dan passkey", () => {
  it("menyalakan WebAuthn WebView hanya di permukaan pemilik", () => {
    assert.match(
      ownerSource,
      /WebViewFeature\.isFeatureSupported\(WebViewFeature\.WEB_AUTHENTICATION\)/,
    );
    assert.match(
      ownerSource,
      /setWebAuthenticationSupport\(\s*settings, WebSettingsCompat\.WEB_AUTHENTICATION_SUPPORT_FOR_APP\)/,
    );
    // Jawaban WebView dibaca balik, tidak diasumsikan berhasil.
    assert.match(ownerSource, /getWebAuthenticationSupport\(settings\)/);
  });

  it("tidak membiarkan pemilik terkunci saat perangkat tidak bisa passkey", () => {
    assert.match(ownerSource, /openExternally\(Uri\.parse\(BuildConfig\.APP_URL\)\)/);
    assert.match(ownerSource, /finish\(\)/);
    assert.match(ownerStringsXml, /<string name="passkey_unavailable">/);
  });

  it("shell anggota dan admin tidak menyentuh pustaka passkey", () => {
    assert.equal(/androidx\./.test(surfaceSource), false);
    assert.equal(/onWebViewReady/.test(surfaceSource), false);
    assert.equal(surfaceSource.includes("WebAuthn"), false);
  });

  it("hook permukaan di kelas bersama memang kosong secara bawaan", () => {
    assert.match(
      wrapperSource,
      /protected void onWebViewReady\(WebView webView, WebSettings settings\) \{\s*\}/,
    );
    assert.match(wrapperSource, /onWebViewReady\(created, created\.getSettings\(\)\)/);
    // Kelas bersama tidak boleh mengunci satu permukaan: abstrak, tanpa peluncur.
    assert.match(wrapperSource, /public abstract class WrapperActivity extends Activity/);
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
    for (const surface of SURFACES) {
      for (const [density, size] of densities) {
        const legacy = readPngSize(iconPath(surface, density, "ic_launcher.png"));
        assert.equal(legacy.width, size, `${surface.flavor} ic_launcher ${density}`);
        assert.equal(legacy.height, size, `${surface.flavor} ic_launcher ${density}`);

        const round = readPngSize(iconPath(surface, density, "ic_launcher_round.png"));
        assert.equal(round.width, size, `${surface.flavor} ic_launcher_round ${density}`);

        // Lapisan adaptif selalu 108dp, yaitu 2.25x ukuran ikon legacy.
        const layer = readPngSize(iconPath(surface, density, "ic_launcher_foreground.png"));
        assert.equal(
          layer.width,
          Math.round(size * 2.25),
          `${surface.flavor} foreground ${density}`,
        );
        assert.equal(
          layer.height,
          layer.width,
          `${surface.flavor} foreground ${density} harus persegi`,
        );
      }
    }
  });

  it("menurunkan tiap permukaan dari karya PWA-nya sendiri, tanpa mengunduh apa pun", () => {
    for (const [nama, script] of [
      ["generate-icons.ps1", iconScript],
      ["generate-icons.py", iconScriptPy],
    ] as const) {
      assert.equal(/Invoke-WebRequest|npm install/.test(script), false);

      for (const surface of SURFACES) {
        assert.ok(
          script.includes(surface.artwork),
          `${nama} harus memakai ${surface.artwork} untuk ${surface.flavor}`,
        );
        assert.ok(
          script.includes(surface.maskableArtwork),
          `${nama} harus memakai ${surface.maskableArtwork} untuk ${surface.flavor}`,
        );
      }

      // Satu permukaan satu lambang: itu yang membedakan ketiga ikon di layar utama.
      assert.match(script, /icon-512\.png/);
      assert.match(script, /admin-512\.png/);
      assert.match(script, /owner-512\.png/);
    }
  });
});

describe("halaman offline lokal", () => {
  it("memakai token yang sama dengan yang diganti aktivitas", () => {
    assert.match(
      wrapperSource,
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
    assert.match(wrapperSource, /if \(!request\.isForMainFrame\(\)\)/);
    assert.match(wrapperSource, /showOfflinePage\(\)/);
  });
});

describe("tautan aset digital untuk passkey", () => {
  const assetLinksRoute = readProjectFile("src", "app", "api", "android", "assetlinks", "route.ts");
  const nextConfig = readProjectFile("next.config.ts");

  it("menyajikan pernyataan di jalur yang diambil Android, tanpa pengalihan", () => {
    // Android mengambil https://<domain>/.well-known/assetlinks.json dan menolak
    // 301/302: pengalihan akan mematikan passkey di aplikasi tanpa pesan galat.
    assert.match(
      nextConfig,
      /source: "\/\.well-known\/assetlinks\.json",\s*destination: "\/api\/android\/assetlinks"/,
    );
    assert.match(assetLinksRoute, /"content-type": "application\/json; charset=utf-8"/);
    assert.match(assetLinksRoute, /export const dynamic = "force-static"/);
  });

  it("hanya mengaitkan permukaan pemilik, dengan izin berbagi kredensial", () => {
    assert.equal(ANDROID_ASSET_LINKS.length, 1);
    const statement = ANDROID_ASSET_LINKS[0];
    assert.ok(statement, "pernyataan assetlinks harus ada");

    assert.deepEqual(statement.relation, ["delegate_permission/common.get_login_creds"]);
    assert.equal(statement.target.namespace, "android_app");
    assert.equal(statement.target.package_name, OWNER_ANDROID_PACKAGE);
    // Shell anggota dan admin tidak membawa pustaka kredensial, jadi tidak boleh
    // dikaitkan di sini.
    const linked = SURFACES.filter((surface) =>
      ANDROID_ASSET_LINKS.some((entry) => entry.target.package_name === surface.applicationId),
    );
    assert.deepEqual(
      linked.map((surface) => surface.flavor),
      ["owner"],
    );
  });

  it("memakai sidik jari sertifikat rilis yang sah", () => {
    // 32 byte, huruf besar, dipisah titik dua — bentuk yang dibaca Android.
    assert.match(OWNER_ANDROID_CERT_SHA256, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);

    const statement = ANDROID_ASSET_LINKS[0];
    assert.ok(statement, "pernyataan assetlinks harus ada");
    assert.equal(
      statement.target.sha256_cert_fingerprints[0],
      OWNER_ANDROID_CERT_SHA256,
    );
  });

  it("aplikasi pemilik menunjuk berkas pernyataan yang sama", () => {
    const owner = SURFACES.find((surface) => surface.flavor === "owner");
    assert.ok(owner, "permukaan pemilik harus terdaftar di daftar permukaan");

    assert.match(flavorManifest(owner), /android:name="asset_statements"/);
    assert.match(flavorManifest(owner), /android:resource="@string\/asset_statements"/);
    assert.match(
      ownerStringsXml,
      /https:\/\/app\.tatorprofitbos\.my\.id\/\.well-known\/assetlinks\.json/,
    );
  });
});

describe("artefak APK", () => {
  it("menghasilkan APK rilis yang bisa dipasang setelah di-build", () => {
    for (const surface of SURFACES) {
      const apkPath = path.join(
        ROOT,
        "android",
        "app",
        "build",
        "outputs",
        "apk",
        surface.flavor,
        "release",
        `app-${surface.flavor}-release.apk`,
      );

      let size = 0;
      try {
        size = statSync(apkPath).size;
      } catch {
        // Belum di-build: jalankan `cd android && ./gradlew assembleRelease`.
        continue;
      }

      assert.ok(size > 10_000, `APK ${surface.flavor} terlalu kecil untuk memuat WebView shell`);
      assert.equal(
        readFileSync(apkPath).subarray(0, 2).toString("ascii"),
        "PK",
        "APK harus berupa arsip zip",
      );
    }
  });
});

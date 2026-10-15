/**
 * Guards the installable-admin surface: the web app manifest, the generated
 * icons, the service worker and the "Install app" affordance.
 *
 * The service worker rules asserted below are money-safety rules, not style
 * preferences. A worker that answered `/api/*` from the cache, or that replayed
 * a stored navigation, could show an administrator a stale balance or a deposit
 * queue that had already been reviewed.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import manifest from "../src/app/manifest";
import { ADMIN_MANIFEST } from "../src/lib/config/admin-manifest";
import { InstallAppButton } from "../src/components/pwa/install-app-button";
import { ServiceWorkerRegistration } from "../src/components/pwa/service-worker-registration";

/** `npm test` always runs from the repository root. */
const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, "public");

function readProjectFile(...segments: string[]): string {
  return readFileSync(path.join(ROOT, ...segments), "utf8");
}

/** React SSR inserts `<!-- -->` between adjacent text nodes; strip it before matching copy. */
function render(element: ReactElement): string {
  return renderToStaticMarkup(element).replace(/<!--[\s\S]*?-->/g, "");
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Reads width and height from the IHDR chunk, so a renamed or truncated file fails. */
function readPngSize(publicPath: string): { width: number; height: number } {
  const bytes = readFileSync(path.join(PUBLIC_DIR, publicPath.replace(/^\//, "")));
  assert.ok(bytes.subarray(0, 8).equals(PNG_SIGNATURE), `${publicPath} bukan berkas PNG`);
  assert.equal(bytes.subarray(12, 16).toString("ascii"), "IHDR", `${publicPath} tanpa chunk IHDR`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const swSource = readProjectFile("public", "sw.js");
const adminShellSource = readProjectFile("src", "components", "admin", "admin-shell.tsx");
const ownerManifestRouteSource = readProjectFile(
  "src",
  "app",
  "owner",
  "manifest.webmanifest",
  "route.ts",
);

describe("manifest aplikasi anggota (akar)", () => {
  const appManifest = manifest();

  it("menjadikan /dashboard titik masuk aplikasi anggota", () => {
    assert.equal(appManifest.id, "/");
    assert.equal(appManifest.start_url, "/dashboard");
    assert.equal(appManifest.scope, "/");
    assert.equal(appManifest.display, "standalone");
    assert.equal(appManifest.lang, "id");
    assert.ok(appManifest.name, "name wajib ada");
    assert.ok(appManifest.short_name, "short_name wajib ada");
    // Label ikon di layar utama dipotong oleh peluncur, jadi harus ringkas.
    assert.ok((appManifest.short_name ?? "").length <= 12, "short_name harus ringkas");
  });

  it("memakai warna shell yang sama dengan token --color-ink", () => {
    const ink = readProjectFile("src", "app", "globals.css").match(/--color-ink:\s*([^;]+);/)?.[1];

    assert.equal(ink?.trim(), "#04070a");
    assert.equal(appManifest.theme_color, "#04070a");
    assert.equal(appManifest.background_color, "#04070a");
  });

  it("mendeklarasikan ikon 192 dan 512 beserta versi maskable", () => {
    const declared = (appManifest.icons ?? []).map(
      (icon) => `${icon.sizes}:${icon.purpose ?? "any"}`,
    );

    assert.ok(declared.includes("192x192:any"), "butuh ikon 192 any");
    assert.ok(declared.includes("512x512:any"), "butuh ikon 512 any");
    assert.ok(declared.includes("512x512:maskable"), "butuh ikon 512 maskable");
  });

  it("menyediakan setiap ikon sebagai PNG dengan ukuran yang cocok", () => {
    const icons = appManifest.icons ?? [];
    assert.ok(icons.length > 0, "manifest harus memuat ikon");

    for (const icon of icons) {
      const [width, height] = (icon.sizes ?? "").split("x").map(Number);
      const size = readPngSize(icon.src);

      assert.equal(icon.type, "image/png", `${icon.src} harus bertipe image/png`);
      assert.equal(size.width, width, `lebar ${icon.src}`);
      assert.equal(size.height, height, `tinggi ${icon.src}`);
    }
  });

  it("memakai artwork maskable yang berbeda dari ikon biasa", () => {
    // Safe-zone padding makes the two 512 icons genuinely different files.
    const plain = readFileSync(path.join(PUBLIC_DIR, "icons", "icon-512.png"));
    const maskable = readFileSync(path.join(PUBLIC_DIR, "icons", "maskable-512.png"));

    assert.equal(plain.equals(maskable), false, "ikon maskable harus punya zona aman");
  });
});

describe("manifest Panel Admin", () => {
  it("memakai id dan start_url /admin, terpisah dari aplikasi anggota dan Konsol Pemilik", () => {
    assert.equal(ADMIN_MANIFEST.id, "/admin");
    assert.equal(ADMIN_MANIFEST.start_url, "/admin");
    // Tiga permukaan = tiga aplikasi terpasang; id yang sama membuat yang kedua
    // menimpa yang pertama di layar utama.
    assert.notEqual(ADMIN_MANIFEST.id, manifest().id);
    assert.ok(
      ownerManifestRouteSource.includes('id: "/owner"'),
      "Konsol Pemilik harus tetap memakai id /owner",
    );
    assert.equal(ADMIN_MANIFEST.display, "standalone");
    assert.equal(ADMIN_MANIFEST.lang, "id");
    // Scope tetap "/" supaya pengalihan ke /login tidak membuka tab baru.
    assert.equal(ADMIN_MANIFEST.scope, "/");
    assert.ok((ADMIN_MANIFEST.short_name ?? "").length <= 12, "short_name harus ringkas");
    assert.equal(ADMIN_MANIFEST.theme_color, "#04070a");
  });

  it("memberi panel ikon birunya sendiri sebagai PNG dengan ukuran yang cocok", () => {
    const icons = ADMIN_MANIFEST.icons ?? [];
    const declared = icons.map((icon) => `${icon.sizes}:${icon.purpose ?? "any"}`);

    assert.ok(declared.includes("192x192:any"), "butuh ikon 192 any");
    assert.ok(declared.includes("512x512:any"), "butuh ikon 512 any");
    assert.ok(declared.includes("512x512:maskable"), "butuh ikon 512 maskable");

    for (const icon of icons) {
      const [width, height] = (icon.sizes ?? "").split("x").map(Number);
      const size = readPngSize(icon.src);

      assert.equal(size.width, width, `lebar ${icon.src}`);
      assert.equal(size.height, height, `tinggi ${icon.src}`);
    }

    // Ikon panel harus berbeda dari ikon anggota dan ikon pemilik, bukan sekadar
    // nama berkas yang berbeda.
    const adminIcon = readFileSync(path.join(PUBLIC_DIR, "icons", "admin-512.png"));
    for (const other of ["icon-512.png", "owner-512.png"]) {
      assert.equal(
        adminIcon.equals(readFileSync(path.join(PUBLIC_DIR, "icons", other))),
        false,
        `admin-512.png tidak boleh sama dengan ${other}`,
      );
    }
  });

  it("mengarahkan setiap pintasan ke halaman panel yang benar-benar ada", () => {
    const shortcuts = ADMIN_MANIFEST.shortcuts ?? [];
    assert.equal(shortcuts.length, 4, "empat pintasan diharapkan");

    for (const shortcut of shortcuts) {
      assert.ok(
        shortcut.url.startsWith("/admin/"),
        `${shortcut.url} harus halaman di dalam panel`,
      );

      const pageFile = path.join(
        ROOT,
        "src",
        "app",
        ...shortcut.url.replace(/^\//, "").split("/"),
        "page.tsx",
      );
      assert.ok(existsSync(pageFile), `${shortcut.url} tidak punya berkas halaman`);
    }
  });

  it("dilayani oleh route handler dan dipakai layout panel", () => {
    const route = readProjectFile("src", "app", "admin", "manifest.webmanifest", "route.ts");
    const layout = readProjectFile("src", "app", "admin", "layout.tsx");

    assert.ok(route.includes("ADMIN_MANIFEST"), "route harus memakai konfigurasi bersama");
    assert.ok(route.includes("application/manifest+json"));
    assert.ok(layout.includes('manifest: "/admin/manifest.webmanifest"'));
  });
});

describe("service worker: aturan keamanan dana", () => {
  it("tidak pernah menangani permintaan /api/*", () => {
    assert.ok(
      swSource.includes('url.pathname.startsWith("/api/")'),
      "permintaan API harus dilewatkan",
    );
    // The guard must precede every handler, so no handler can ever answer an API call.
    assert.ok(
      swSource.indexOf('startsWith("/api/")') < swSource.indexOf("event.respondWith"),
      "penjagaan /api/ harus mendahului seluruh handler",
    );
  });

  it("hanya menyimpan aset statis, tidak pernah HTML", () => {
    const writes = swSource.match(/cache\.put\(/g) ?? [];
    assert.equal(writes.length, 1, "hanya satu tempat yang boleh menulis cache");

    const navigation = swSource.slice(
      swSource.indexOf("async function networkFirstNavigation"),
      swSource.indexOf("async function cacheFirst"),
    );
    assert.ok(navigation.length > 0, "handler navigasi harus ada");
    assert.ok(navigation.includes("await fetch(request)"), "navigasi harus network-first");
    assert.equal(navigation.includes("cache.put"), false, "navigasi tidak boleh disimpan");

    const cacheFirst = swSource.slice(swSource.indexOf("async function cacheFirst"));
    assert.ok(cacheFirst.includes("cache.put"), "aset statis boleh disimpan");
    assert.ok(cacheFirst.includes('response.type === "basic"'), "hanya respons same-origin");
  });

  it("membatasi cache-first pada /_next/static/ dan /icons/", () => {
    const allowlist = [...swSource.matchAll(/url\.pathname\.startsWith\("([^"]+)"\)/g)]
      .map((match) => match[1])
      .sort();

    assert.deepEqual(allowlist, ["/_next/static/", "/api/", "/icons/"]);
  });

  it("melewati permintaan non-GET dan lintas asal", () => {
    assert.ok(swSource.includes('request.method !== "GET"'));
    assert.ok(swSource.includes("url.origin !== self.location.origin"));
  });

  it("menyajikan halaman offline tanpa data dan hanya mempra-cache aset statis", () => {
    assert.ok(swSource.includes('const OFFLINE_URL = "/offline"'));

    const precacheBlock = swSource.match(/const PRECACHE_URLS = \[([^\]]*)\]/)?.[1] ?? "";
    assert.ok(precacheBlock.includes("OFFLINE_URL"), "halaman offline harus dipra-cache");

    for (const url of precacheBlock.match(/"[^"]+"/g) ?? []) {
      assert.ok(
        url.startsWith('"/icons/'),
        `pra-cache hanya boleh memuat aset statis, bukan ${url}`,
      );
    }

    // The fallback page itself must stay outside the authenticated area.
    const offlinePage = readProjectFile("src", "app", "offline", "page.tsx");
    for (const forbidden of ["prisma", "fetch(", "/api/", "cookies(", "requireAdmin"]) {
      assert.equal(
        offlinePage.includes(forbidden),
        false,
        `halaman offline tidak boleh memakai ${forbidden}`,
      );
    }
  });

  it("membersihkan cache versi lama saat aktivasi", () => {
    assert.match(swSource, /const CACHE_VERSION = "tatorprofit-v\d+"/);
    assert.ok(swSource.includes("key.startsWith(CACHE_VERSION)"));
    assert.ok(swSource.includes("caches.delete(key)"));
  });

  it("dilayani tanpa cache agar versi baru langsung berlaku setelah deploy", () => {
    const config = readProjectFile("next.config.ts");

    assert.ok(config.includes('source: "/sw.js"'));
    assert.ok(config.includes("no-cache, no-store, must-revalidate"));
  });

  it("tidak menyimpan kredensial, token, atau sesi apa pun", () => {
    const lower = swSource.toLowerCase();

    for (const secret of ["token", "cookie", "authorization", "password", "session"]) {
      assert.equal(lower.includes(secret), false, `service worker tidak boleh menyebut ${secret}`);
    }
  });

  it("tidak membekukan HTML halaman aplikasi mana pun", () => {
    for (const page of ['"/admin"', '"/dashboard"', '"/login"', '"/profile"']) {
      assert.equal(swSource.includes(page), false, `${page} tidak boleh muncul di service worker`);
    }
  });
});
describe("tombol Pasang aplikasi", () => {
  it("merender tombol pada server agar terlihat sebelum hidrasi", () => {
    const html = render(createElement(InstallAppButton));

    assert.ok(html.includes("Pasang aplikasi admin"));
    assert.ok(html.includes("<button"));
    assert.ok(html.includes('type="button"'), "tombol tidak boleh mengirim formulir");
  });

  it("belum menampilkan petunjuk manual sebelum pengguna mengetuk", () => {
    const html = render(createElement(InstallAppButton));

    assert.equal(html.includes("Bagikan"), false, "petunjuk iOS hanya setelah ketukan");
    assert.equal(html.includes("menu browser"), false, "petunjuk Android hanya setelah ketukan");
  });

  it("menyiapkan petunjuk iOS dan Android untuk browser tanpa beforeinstallprompt", () => {
    const source = readProjectFile("src", "components", "pwa", "install-app-button.tsx");

    assert.ok(source.includes("beforeinstallprompt"), "peristiwa Chromium harus ditangkap");
    assert.ok(source.includes("appinstalled"), "status terpasang harus diikuti");
    assert.ok(source.includes("display-mode: standalone"), "mode mandiri harus dibaca");
    assert.ok(source.includes("Tambahkan ke Layar Utama"), "petunjuk iOS harus ada");
    assert.ok(source.includes("Instal aplikasi"), "petunjuk Android harus ada");
  });

  it("menyembunyikan tombol saat aplikasi sudah terpasang", () => {
    const source = readProjectFile("src", "components", "pwa", "install-app-button.tsx");

    // The installed state is read through an external store, never mirrored into
    // state from an effect, and the server snapshot is always "not installed".
    assert.ok(source.includes("useSyncExternalStore"));
    assert.ok(source.includes("if (installed) return null;"));
  });
});

describe("pendaftaran service worker", () => {
  it("tidak merender markup apa pun", () => {
    assert.equal(render(createElement(ServiceWorkerRegistration)), "");
  });

  it("hanya mendaftar pada produksi dan gagal secara senyap", () => {
    const source = readProjectFile(
      "src",
      "components",
      "pwa",
      "service-worker-registration.tsx",
    );

    assert.ok(source.includes('process.env.NODE_ENV !== "production"'));
    assert.ok(source.includes('serviceWorker.register("/sw.js", { scope: "/" })'));
    assert.ok(source.includes(".catch("), "kegagalan pendaftaran tidak boleh memblokir aplikasi");
  });
});

describe("pemasangan di permukaan admin", () => {
  it("mendaftarkan service worker dan metadata ikon di root layout", () => {
    const layout = readProjectFile("src", "app", "layout.tsx");

    assert.ok(layout.includes("<ServiceWorkerRegistration />"));
    assert.ok(layout.includes('themeColor: "#04070a"'));
    assert.ok(layout.includes("appleWebApp"));
    assert.ok(layout.includes('"/icons/apple-touch-icon.png"'));
  });

  it("merujuk ikon layout yang benar-benar ada sebagai PNG", () => {
    const referenced = [
      ...readProjectFile("src", "app", "layout.tsx").matchAll(/"(\/icons\/[^"]+)"/g),
    ].map((match) => match[1] ?? "");

    assert.ok(referenced.length >= 3, "layout harus merujuk ikon tab dan Apple");

    for (const url of referenced) {
      const size = readPngSize(url);
      assert.ok(size.width > 0 && size.height > 0, `${url} harus dapat dibaca`);
    }
  });

  it("menaruh tombol pasang di kerangka panel admin, bukan di halaman anggota", () => {
    assert.ok(
      adminShellSource.includes('<InstallAppButton label="Pasang aplikasi admin" />'),
      "kerangka panel admin harus menawarkan pemasangan aplikasinya",
    );

    for (const memberPage of ["page.tsx", "dashboard/page.tsx", "profile/page.tsx"]) {
      const source = readProjectFile("src", "app", ...memberPage.split("/"));

      assert.equal(
        source.includes("InstallAppButton"),
        false,
        `${memberPage} tidak boleh menawarkan pemasangan admin`,
      );
    }
  });
});



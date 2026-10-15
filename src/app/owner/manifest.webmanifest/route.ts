import { NextResponse } from "next/server";

/**
 * Manifest aplikasi Konsol Pemilik, dilayani di `/owner/manifest.webmanifest`.
 *
 * Ditulis sebagai route handler biasa, bukan `manifest.ts`, karena konvensi berkas
 * `manifest.ts` hanya berlaku di akar `app/` — berkas itu diabaikan begitu diletakkan
 * di dalam segmen rute (terbukti: `/owner/manifest.webmanifest` tidak muncul di daftar
 * rute hasil `next build`). Route handler juga tidak melewati layout `/owner`, jadi
 * browser tetap bisa mengambil manifest ini sebelum pemilik masuk — memang harus,
 * karena manifest dipakai justru untuk memasang aplikasinya.
 *
 * Konsol sengaja punya manifest sendiri, terpisah dari manifest anggota/admin di
 * `src/app/manifest.ts`: nama, ikon emas, dan `start_url` `/owner`, dengan `id` dan
 * `scope` `/owner` sehingga browser memperlakukannya sebagai aplikasi berbeda dan
 * keduanya bisa terpasang berdampingan.
 */
const MANIFEST = {
  id: "/owner",
  name: "Tatorprofit Pemilik",
  short_name: "TP Pemilik",
  description:
    "Konsol pemilik Tatorprofit: ringkasan platform, data anggota, jejak audit, dan keamanan akun.",
  start_url: "/owner",
  scope: "/owner",
  display: "standalone",
  orientation: "any",
  lang: "id",
  dir: "ltr",
  background_color: "#04070a",
  theme_color: "#04070a",
  categories: ["finance", "business", "productivity"],
  icons: [
    { src: "/icons/owner-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icons/owner-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icons/owner-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
  shortcuts: [
    { name: "Anggota", short_name: "Anggota", url: "/owner/pengguna" },
    { name: "Jejak audit", short_name: "Audit", url: "/owner/audit" },
    { name: "Keamanan", short_name: "Keamanan", url: "/owner/keamanan" },
  ],
} as const;

export function GET() {
  return NextResponse.json(MANIFEST, {
    headers: {
      "content-type": "application/manifest+json; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}

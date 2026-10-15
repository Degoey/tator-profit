import type { MetadataRoute } from "next";

/**
 * Manifest aplikasi **anggota**, dilayani Next.js di `/manifest.webmanifest`.
 *
 * Sejak Panel Admin (`/admin/manifest.webmanifest`) dan Konsol Pemilik
 * (`/owner/manifest.webmanifest`) punya manifest sendiri, berkas ini kembali ke
 * pengalaman anggota: `id` dan `start_url` menunjuk `/dashboard`. Sebelumnya
 * manifest akar menunjuk `/admin`, sehingga anggota yang memasang aplikasi dari
 * halaman mana pun justru menerima aplikasi admin dan langsung dipantulkan oleh
 * penjagaan halaman.
 *
 * Tidak ada backend baru di sini: jendela mandiri memakai cookie sesi yang sama
 * dan pemeriksaan izin yang sama di server.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Tatorprofit",
    short_name: "Tatorprofit",
    description:
      "Platform anggota Tatorprofit: program, imbalan, setoran manual, penarikan, dan jaringan rujukan.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "any",
    lang: "id",
    dir: "ltr",
    background_color: "#04070a",
    theme_color: "#04070a",
    categories: ["finance", "business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Dasbor", short_name: "Dasbor", url: "/dashboard" },
      { name: "Setor dana", short_name: "Setor", url: "/deposit" },
      { name: "Penarikan", short_name: "Tarik", url: "/withdrawal" },
      { name: "Imbalan", short_name: "Imbalan", url: "/rewards" },
    ],
  };
}

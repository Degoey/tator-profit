/**
 * Manifest aplikasi **Panel Admin** (peran biasa), dilayani di
 * `/admin/manifest.webmanifest`.
 *
 * Panel admin dipasang sebagai aplikasi tersendiri di layar utama petugas —
 * berdampingan dengan aplikasi anggota (`id: "/"`) dan Konsol Pemilik
 * (`id: "/owner"`). Objeknya sengaja disimpan di modul konfigurasi ini, bukan di
 * dalam route handler, supaya pengujian dapat mengimpornya langsung.
 *
 * `scope` dibiarkan `"/"` (bukan `"/admin"`): begitu sesi kedaluwarsa, penjaga
 * halaman mengalihkan ke `/login`, dan dengan scope sempit browser akan membuka
 * halaman masuk itu di tab baru sehingga petugas keluar dari aplikasinya.
 */
export const ADMIN_MANIFEST = {
  id: "/admin",
  name: "Tatorprofit Admin",
  short_name: "TP Admin",
  description:
    "Aplikasi admin Tatorprofit: tinjau setoran dan penarikan, selesaikan komisi, periksa jejak audit dan antrean anti-fraud.",
  start_url: "/admin",
  scope: "/",
  display: "standalone",
  orientation: "any",
  lang: "id",
  dir: "ltr",
  background_color: "#04070a",
  theme_color: "#04070a",
  categories: ["finance", "business", "productivity"],
  icons: [
    { src: "/icons/admin-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icons/admin-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    {
      src: "/icons/admin-maskable-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ],
  shortcuts: [
    { name: "Tinjauan deposit", short_name: "Deposit", url: "/admin/deposit" },
    { name: "Tinjauan penarikan", short_name: "Penarikan", url: "/admin/penarikan" },
    { name: "Jejak audit", short_name: "Audit", url: "/admin/audit" },
    { name: "Anti-fraud", short_name: "Anti-fraud", url: "/admin/fraud" },
  ],
} as const;

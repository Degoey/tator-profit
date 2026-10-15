import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { loadOwnerContext } from "@/lib/auth/owner-guard";

export const dynamic = "force-dynamic";
/**
 * Metadata konsol pemilik.
 *
 * `manifest` menunjuk manifest khusus `/owner` sehingga konsol bisa dipasang sebagai
 * aplikasi tersendiri (ikon emas, langsung membuka `/owner`), dan `appleWebApp`
 * membuat iOS memakai jendela standalone dengan ikon yang sama. Ikon ditulis di sini
 * juga karena Safari mengabaikan `manifest.icons` saat "Tambahkan ke Layar Utama".
 */
export const metadata: Metadata = {
  title: "Konsol Pemilik",
  description:
    "Konsol pemilik Tatorprofit: ringkasan platform, data anggota, jejak audit, dan keamanan akun.",
  applicationName: "Tatorprofit Pemilik",
  manifest: "/owner/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Pemilik",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [{ url: "/icons/owner-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/owner-apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

/**
 * Penjagaan tingkat pertama seluruh `/owner/**`.
 *
 * Hanya dua keadaan yang diputuskan di sini: konsol belum dikonfigurasi atau
 * akunnya bukan pemilik (404 — permukaan ini tidak diakui), dan tamu yang belum
 * masuk (diarahkan ke halaman masuk lalu kembali ke konsol). Sisa syaratnya
 * (2FA terdaftar, sesi terverifikasi) diperiksa per halaman lewat
 * `requireOwnerPage`, karena halaman pendaftaran dan verifikasi 2FA memang harus
 * dapat dibuka justru ketika syarat itu belum terpenuhi.
 */
export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const context = await loadOwnerContext();

  if (context.kind === "unconfigured" || context.kind === "forbidden") notFound();
  if (context.kind === "guest") redirect("/login?next=%2Fowner");

  return <>{children}</>;
}

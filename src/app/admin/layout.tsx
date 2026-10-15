import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

/**
 * Metadata Panel Admin.
 *
 * `manifest` menunjuk manifest khusus `/admin` sehingga panel dapat dipasang
 * sebagai aplikasi tersendiri (ikon biru, langsung membuka `/admin`), terpisah
 * dari aplikasi anggota di akar dan Konsol Pemilik di `/owner`.
 */
export const metadata: Metadata = {
  title: "Panel Admin",
  description:
    "Panel admin Tatorprofit: tinjau setoran dan penarikan, selesaikan komisi, periksa jejak audit dan antrean anti-fraud.",
  applicationName: "Tatorprofit Admin",
  manifest: "/admin/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Admin",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [{ url: "/icons/admin-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/admin-apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

/**
 * Penjagaan tingkat pertama seluruh `/admin/**` (peran biasa, tanpa faktor kedua).
 *
 * Hanya dua keadaan yang diputuskan di sini: tamu diarahkan masuk lalu kembali ke
 * panel, dan akun yang bukan admin — atau admin yang belum diberi peran admin —
 * dialihkan ke dasbor anggota. Sisa keputusan kapabilitas diambil per halaman,
 * yang menampilkan kartu "akses terbatas" alih-alih 404: permukaan ini bukan
 * rahasia seperti Konsol Pemilik.
 */
export default async function AdminConsoleLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=%2Fadmin");
  if (user.role !== "ADMIN" || !user.adminRole) redirect("/dashboard?error=forbidden");

  return <>{children}</>;
}

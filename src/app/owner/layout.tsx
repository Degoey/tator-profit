import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { loadOwnerContext } from "@/lib/auth/owner-guard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Konsol Pemilik" };

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

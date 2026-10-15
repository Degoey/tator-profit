import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Halaman lama antrean anti-fraud.
 *
 * Sejak antrean itu menjadi satu halaman kapabilitas di Panel Admin
 * (`/admin/fraud`), alamat lama ini hanya mengalihkan ke sana: satu permukaan
 * untuk satu kapabilitas, bukan dua halaman yang menampilkan antrean yang sama.
 * Penjagaannya tetap milik panel, jadi tamu diarahkan masuk lebih dulu dan peran
 * tanpa `readFraud` menerima kartu "akses terbatas" di halaman tujuan.
 */
export default function FraudReviewRedirectPage() {
  redirect("/admin/fraud");
}

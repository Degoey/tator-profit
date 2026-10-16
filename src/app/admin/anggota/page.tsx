import type { Metadata } from "next";

import { AdminShell } from "@/components/admin/admin-shell";
import { AdminMemberDirectory } from "@/components/payments/admin-member-directory";
import { requireAdminConsole } from "@/lib/auth/current-user";
import { isOwnerAccount } from "@/lib/config/owner";
import { listMemberDirectoryForConsole } from "@/lib/services/admin-console-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Direktori anggota" };

/**
 * Direktori anggota: hanya baca, untuk semua peran admin.
 *
 * Petugas perlu menjawab pertanyaan anggota ("berapa saldo saya?", "keanggotaan
 * saya aktif?") tanpa memegang kapabilitas uang. Karena itu halaman ini memuat
 * saldo dan jumlah keanggotaan, tetapi tidak satu pun tindakan yang memindahkan
 * uang: kredit saldo tetap milik pemilik (`creditBalance`).
 */
export default async function AdminMemberDirectoryPage() {
  const admin = await requireAdminConsole("/admin/anggota");
  const rows = await listMemberDirectoryForConsole();

  return (
    <AdminShell
      active="/admin/anggota"
      title="Direktori anggota"
      description="Daftar anggota beserta saldo imbalan, dana program, dan keanggotaannya, diambil langsung dari database. Halaman ini hanya membaca; menambah atau mengurangi saldo USDT dikerjakan pemilik di Konsol Pemilik."
      adminRole={admin.adminRole}
      username={admin.username}
      isOwner={isOwnerAccount(admin)}
    >
      <AdminMemberDirectory rows={rows} />
    </AdminShell>
  );
}
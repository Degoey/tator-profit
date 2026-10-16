import type { Metadata } from "next";

import { AdminShell } from "@/components/admin/admin-shell";
import { AdminRewardReview } from "@/components/payments/admin-reward-review";
import { canAdmin } from "@/lib/auth/admin-permissions";
import { requireAdminConsole } from "@/lib/auth/current-user";
import { isOwnerAccount } from "@/lib/config/owner";
import { adminRequestAuditIndex, listRewardQueueForConsole } from "@/lib/services/admin-console-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Imbalan anggota" };

/**
 * Siklus imbalan anggota.
 *
 * Imbalan bergerak dalam tiga langkah yang sengaja dipisah — catat, setujui,
 * bayarkan — supaya tidak ada saldo yang berpindah tanpa keputusan manusia:
 * `approve` menaruh nilai pada saldo menunggu, `pay` baru memindahkannya ke saldo
 * yang dapat dipakai anggota. Baris dapat dibaca seluruh peran admin, sedangkan
 * tindakannya memerlukan `manageFinance`; API-nya menolak peran lain di server.
 */
export default async function AdminRewardPage() {
  const admin = await requireAdminConsole("/admin/imbalan");
  const canManageFinance = canAdmin(admin.adminRole, "manageFinance");
  const rows = await listRewardQueueForConsole({
    auditIndex: await adminRequestAuditIndex(),
  });

  return (
    <AdminShell
      active="/admin/imbalan"
      title="Imbalan anggota"
      description="Menyetujui, membayarkan, menolak, atau membatalkan imbalan mingguan anggota. Pencatatan imbalan periode berjalan dijalankan dari halaman Keanggotaan, dan anggota menerima notifikasi setiap kali uang benar-benar berpindah."
      adminRole={admin.adminRole}
      username={admin.username}
      isOwner={isOwnerAccount(admin)}
    >
      <AdminRewardReview
        rows={rows}
        allowedActions={canManageFinance ? ["approve", "pay", "reject", "void"] : []}
      />
    </AdminShell>
  );
}
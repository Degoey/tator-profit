import type { Metadata } from "next";

import { AdminShell } from "@/components/admin/admin-shell";
import { AdminRebateSettings } from "@/components/payments/admin-rebate-settings";
import { canAdmin } from "@/lib/auth/admin-permissions";
import { requireAdminConsole } from "@/lib/auth/current-user";
import { isOwnerAccount } from "@/lib/config/owner";
import { listRebateConfig } from "@/lib/services/rebate-config-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Rabat rujukan" };

/**
 * Persentase rabat per generasi.
 *
 * Konfigurasinya boleh dibaca semua peran admin, tetapi hanya dapat diubah oleh
 * peran dengan `manageFinance`; formulirnya dirender hanya-baca bila tidak
 * berwenang, dan API-nya menolak aktor lain di server.
 */
export default async function AdminRebatePage() {
  const admin = await requireAdminConsole("/admin/rabat");
  const canEdit = canAdmin(admin.adminRole, "manageFinance");
  const rebateConfig = await listRebateConfig();

  return (
    <AdminShell
      active="/admin/rabat"
      title="Rabat rujukan"
      description="Persentase rabat rujukan per generasi. Angka-angka ini dipakai mesin komisi saat menghitung pembagian hasil, jadi setiap perubahan tercatat dengan aktor dan waktu. Imbalan mingguan anggota diatur di halaman Imbalan anggota."
      adminRole={admin.adminRole}
      username={admin.username}
      isOwner={isOwnerAccount(admin)}
    >
      <AdminRebateSettings
        canEdit={canEdit}
        fromDatabase={rebateConfig.fromDatabase}
        rows={rebateConfig.generations.map((row) => ({
          generation: row.generation,
          rate: row.rate,
          displayRate: row.displayRate,
          percent: row.percent,
          updatedAt: row.updatedAt,
          updatedBy: row.updatedBy,
        }))}
      />
    </AdminShell>
  );
}

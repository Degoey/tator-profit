import type { Metadata } from "next";

import { AdminShell } from "@/components/admin/admin-shell";
import { AdminCommissionReview } from "@/components/payments/admin-commission-review";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canAdmin } from "@/lib/auth/admin-permissions";
import { requireAdminConsole } from "@/lib/auth/current-user";
import { isOwnerAccount } from "@/lib/config/owner";
import {
  adminRequestAuditIndex,
  listCommissionQueueForConsole,
} from "@/lib/services/admin-console-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Komisi rujukan" };

/**
 * Komisi rujukan.
 *
 * Membaca antrean boleh untuk seluruh peran admin; menyelesaikan komisi
 * (mengkredit saldo tersedia anggota di buku besar) mengikuti `manageFinance`,
 * jadi tombolnya hanya muncul untuk SUPER_ADMIN/FINANCE.
 */
export default async function AdminCommissionPage() {
  const admin = await requireAdminConsole("/admin/komisi");
  const canManage = canAdmin(admin.adminRole, "manageFinance");
  const canReadAudit = canAdmin(admin.adminRole, "readAudit");
  const auditIndex = canReadAudit
    ? await adminRequestAuditIndex()
    : new Map<string, { id: string; action: string; actorUsername: string | null; createdAt: Date }[]>();
  const rows = await listCommissionQueueForConsole({ auditIndex });

  return (
    <AdminShell
      active="/admin/komisi"
      title="Komisi rujukan"
      description="100 baris komisi terbaru. Menyelesaikan komisi mengkredit saldo tersedia anggota di buku besar dalam satu transaksi yang sama dengan perubahan status; uang keluar dari platform tetap lewat penarikan manual."
      adminRole={admin.adminRole}
      username={admin.username}
      isOwner={isOwnerAccount(admin)}
    >
      <Card id="komisi">
        <CardHeader>
          <CardTitle>Antrean komisi</CardTitle>
          <CardDescription>
            {canManage
              ? "Anda dapat menyelesaikan komisi: saldo anggota bertambah dan status berubah dalam satu transaksi, dan anggota menerima notifikasi."
              : "Peran Anda hanya dapat membaca antrean komisi. Penyelesaian komisi adalah kewenangan Super Admin dan Keuangan."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AdminCommissionReview rows={rows} canManage={canManage} />
        </CardContent>
      </Card>
    </AdminShell>
  );
}

import type { Metadata } from "next";

import { AdminShell } from "@/components/admin/admin-shell";
import { AdminDepositReview } from "@/components/payments/admin-deposit-review";
import { DEPOSIT_REVIEW_ACTION_VALUES } from "@/components/payments/review-actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canAdmin, canReviewDepositAction } from "@/lib/auth/admin-permissions";
import { requireAdminConsole } from "@/lib/auth/current-user";
import { isOwnerAccount } from "@/lib/config/owner";
import {
  adminRequestAuditIndex,
  listDepositQueueForConsole,
} from "@/lib/services/admin-console-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tinjauan deposit" };

/**
 * Tinjauan deposit.
 *
 * Kapabilitas diputuskan di server: SUPER_ADMIN/FINANCE boleh menjalankan keempat
 * tindakan, COMPLIANCE hanya "sedang ditinjau"/"tandai", dan peran lain menerima
 * daftar tindakan kosong sehingga dialognya hanya-baca. Berkas bukti hanya
 * dimuat untuk peran dengan `readProof` (VIEWER tidak).
 */
export default async function AdminDepositPage() {
  const admin = await requireAdminConsole("/admin/deposit");
  const canReadProof = canAdmin(admin.adminRole, "readProof");
  const canReadAudit = canAdmin(admin.adminRole, "readAudit");
  const allowedActions = DEPOSIT_REVIEW_ACTION_VALUES.filter((action) =>
    canReviewDepositAction(admin.adminRole, action),
  );
  const auditIndex = canReadAudit
    ? await adminRequestAuditIndex()
    : new Map<string, { id: string; action: string; actorUsername: string | null; createdAt: Date }[]>();
  const rows = await listDepositQueueForConsole({ canReadProof, auditIndex });

  return (
    <AdminShell
      active="/admin/deposit"
      title="Tinjauan deposit"
      description="Setujui deposit untuk mengaktifkan keanggotaan dan mencatat dana program; menolak atau menandai tidak pernah menambah saldo. Setiap tindakan tercatat di jejak audit."
      adminRole={admin.adminRole}
      username={admin.username}
      isOwner={isOwnerAccount(admin)}
    >
      <Card id="deposit">
        <CardHeader>
          <CardTitle>Antrean deposit</CardTitle>
          <CardDescription>
            {allowedActions.length === 0
              ? "Peran Anda hanya dapat membaca antrean ini. Menyetujui atau menolak deposit adalah kewenangan Super Admin dan Keuangan."
              : allowedActions.length === DEPOSIT_REVIEW_ACTION_VALUES.length
                ? "Anda dapat menjalankan seluruh tindakan tinjauan: menandai sedang ditinjau, menyetujui, menolak, atau menandai deposit."
                : "Anda dapat memindahkan deposit ke sedang ditinjau atau menandainya; menyetujui dan menolak tetap kewenangan Super Admin dan Keuangan."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AdminDepositReview allowedActions={[...allowedActions]} rows={rows} />
        </CardContent>
      </Card>
    </AdminShell>
  );
}

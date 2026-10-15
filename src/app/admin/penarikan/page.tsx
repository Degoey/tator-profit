import type { Metadata } from "next";
import { Download } from "lucide-react";

import { AdminShell } from "@/components/admin/admin-shell";
import { AdminWithdrawalReview } from "@/components/payments/admin-withdrawal-review";
import { WITHDRAWAL_REVIEW_ACTION_VALUES } from "@/components/payments/review-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canAdmin } from "@/lib/auth/admin-permissions";
import { requireAdminConsole } from "@/lib/auth/current-user";
import { isOwnerAccount } from "@/lib/config/owner";
import {
  adminRequestAuditIndex,
  listWithdrawalQueueForConsole,
} from "@/lib/services/admin-console-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tinjauan penarikan" };

/**
 * Tinjauan penarikan.
 *
 * Dana sudah ditahan dari saldo tersedia saat permintaan diajukan; halaman ini
 * menjalankan sisanya (setujui → proses → selesai, atau tolak) lewat API lama
 * yang memakai layanan ledger, jadi tidak ada aturan saldo yang bercabang dua.
 */
export default async function AdminWithdrawalPage() {
  const admin = await requireAdminConsole("/admin/penarikan");
  const canReviewWithdrawal = canAdmin(admin.adminRole, "reviewWithdrawal");
  const canReadAudit = canAdmin(admin.adminRole, "readAudit");
  const auditIndex = canReadAudit
    ? await adminRequestAuditIndex()
    : new Map<string, { id: string; action: string; actorUsername: string | null; createdAt: Date }[]>();
  const rows = await listWithdrawalQueueForConsole({ auditIndex });

  return (
    <AdminShell
      active="/admin/penarikan"
      title="Tinjauan penarikan"
      description="Setujui, mulai proses transfer, tandai selesai, atau tolak permintaan penarikan. Pengguna menerima 90% dari nilai penarikan (biaya 10%), dan bukti transfer dapat dilampirkan saat menandai selesai."
      adminRole={admin.adminRole}
      username={admin.username}
      isOwner={isOwnerAccount(admin)}
    >
      <Card id="penarikan">
        <CardHeader>
          <CardTitle>Antrean penarikan</CardTitle>
          <CardDescription>
            {canReviewWithdrawal
              ? "Anda dapat menjalankan seluruh tindakan tinjauan penarikan, termasuk melampirkan bukti transfer saat menandai selesai."
              : "Peran Anda hanya dapat membaca antrean ini. Menyetujui dan memproses penarikan adalah kewenangan Super Admin dan Keuangan."}
          </CardDescription>
          <div className="mt-3">
            <Button asChild variant="outline" size="sm">
              <a href="/api/withdrawals/export?scope=admin">
                <Download aria-hidden />
                Ekspor rekap CSV
              </a>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <AdminWithdrawalReview
            allowedActions={canReviewWithdrawal ? [...WITHDRAWAL_REVIEW_ACTION_VALUES] : []}
            rows={rows}
          />
        </CardContent>
      </Card>
    </AdminShell>
  );
}

import type { Metadata } from "next";

import { AdminShell } from "@/components/admin/admin-shell";
import { AdminFraudQueue, type FraudCaseRow } from "@/components/payments/admin-fraud-queue";
import { PaymentKpis } from "@/components/payments/payment-shell";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canAdmin } from "@/lib/auth/admin-permissions";
import { requireAdminConsole } from "@/lib/auth/current-user";
import { FRAUD_STATUS_LABELS } from "@/lib/config/anti-fraud";
import { isOwnerAccount } from "@/lib/config/owner";
import { listFraudCases } from "@/lib/services/anti-fraud-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tinjauan anti-fraud" };

/**
 * Antrean anti-fraud.
 *
 * Membaca antrean mengikuti `readFraud` (SUPER_ADMIN, FINANCE, COMPLIANCE);
 * menutup kasus mengikuti `reviewFraud` (SUPER_ADMIN dan COMPLIANCE saja — FINANCE
 * boleh membaca untuk menilai risiko uang yang akan cair, tetapi tidak memutuskan).
 * Peran tanpa `readFraud` tidak memuat satu baris pun.
 */
export default async function AdminFraudPage() {
  const admin = await requireAdminConsole("/admin/fraud");
  const canReadFraud = canAdmin(admin.adminRole, "readFraud");
  const canDecide = canAdmin(admin.adminRole, "reviewFraud");

  const cases = canReadFraud ? await listFraudCases("ALL") : [];
  const rows: FraudCaseRow[] = cases.map((entry) => ({
    id: entry.id,
    status: entry.status as FraudCaseRow["status"],
    statusLabel: entry.statusLabel,
    signalLabels: entry.signalLabels,
    note: entry.note,
    reviewedAt: entry.reviewedAt,
    reviewerUsername: entry.reviewerUsername,
    createdAt: entry.createdAt,
    user: {
      name: entry.user.name,
      username: entry.user.username,
      email: entry.user.email,
    },
    relatedUsers: entry.relatedUsers.map((user) => ({ username: user.username })),
  }));

  const countOf = (status: string) => rows.filter((row) => row.status === status).length;

  return (
    <AdminShell
      active="/admin/fraud"
      title="Tinjauan anti-fraud"
      description="Antrean deteksi multi-akun dan penyalahgunaan rujukan. Setiap sinyal hanya penanda untuk diperiksa manusia; kasus ditutup dengan alasan tertulis dan tercatat di jejak audit."
      adminRole={admin.adminRole}
      username={admin.username}
      isOwner={isOwnerAccount(admin)}
    >
      {canReadFraud ? (
        <>
          <PaymentKpis
            label="Status kasus"
            columns={3}
            items={[
              {
                label: FRAUD_STATUS_LABELS.OPEN,
                value: String(countOf("OPEN")),
                tone: "gold",
                hint: "Sinyal terdeteksi saat pendaftaran",
              },
              {
                label: FRAUD_STATUS_LABELS.CLEARED,
                value: String(countOf("CLEARED")),
                hint: "Diperiksa dan dinyatakan wajar",
              },
              {
                label: FRAUD_STATUS_LABELS.CONFIRMED,
                value: String(countOf("CONFIRMED")),
                tone: "danger",
                hint: "Perlu tindak lanjut manual oleh admin",
              },
            ]}
          />

          <Card id="kasus">
            <CardHeader>
              <CardTitle>Antrean kasus</CardTitle>
              <CardDescription>
                {canDecide
                  ? "Anda dapat menutup kasus dengan alasan tertulis; keputusan tercatat di jejak audit."
                  : "Anda hanya dapat membaca antrean ini. Menutup kasus adalah kewenangan Super Admin dan Kepatuhan."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AdminFraudQueue rows={rows} canDecide={canDecide} />
            </CardContent>
          </Card>
        </>
      ) : (
        <Card id="kasus">
          <CardHeader>
            <CardTitle>Antrean kasus</CardTitle>
            <CardDescription>
              Antrean anti-fraud hanya tersedia untuk peran SUPER_ADMIN, FINANCE, dan COMPLIANCE.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Alert variant="warning" title="Akses terbatas">
              Peran Anda tidak diizinkan membaca antrean anti-fraud, dan halaman ini tidak memuat satu
              baris pun. Hubungi Super Admin bila antrean ini diperlukan untuk tugas Anda.
            </Alert>
          </CardContent>
        </Card>
      )}
    </AdminShell>
  );
}

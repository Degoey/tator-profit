import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";

import { AdminFraudQueue, type FraudCaseRow } from "@/components/payments/admin-fraud-queue";
import { PaymentKpis, PaymentShell } from "@/components/payments/payment-shell";
import { Badge } from "@/components/ui/badge";
import { canAdmin } from "@/lib/auth/admin-permissions";
import { requireAdminCapability } from "@/lib/auth/current-user";
import { FRAUD_STATUS_LABELS } from "@/lib/config/anti-fraud";
import { listFraudCases } from "@/lib/services/anti-fraud-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tinjauan anti-fraud" };

export default async function FraudReviewPage() {
  /** Reading the queue needs `readFraud`; FINANCE has it, SUPPORT and VIEWER do not. */
  const admin = await requireAdminCapability("readFraud");
  /** Only SUPER_ADMIN and COMPLIANCE may close a case (`reviewFraud`). */
  const canDecide = canAdmin(admin.adminRole, "reviewFraud");

  const cases = await listFraudCases("ALL");

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
    <PaymentShell
      active="/fraud-review"
      isAdmin
      showFraudReview
      title="Tinjauan anti-fraud"
      description="Antrean deteksi multi-akun dan penyalahgunaan rujukan. Setiap sinyal hanya penanda untuk diperiksa manusia; kasus ditutup dengan alasan tertulis dan tercatat di jejak audit."
    >
      <section className="flex flex-wrap items-center gap-2">
        <Badge variant={canDecide ? "default" : "muted"}>
          <ShieldCheck className="size-3.5" aria-hidden />
          {canDecide ? "Dapat menutup kasus" : "Hanya dapat membaca antrean"}
        </Badge>
        <Badge variant="muted">@{admin.username}</Badge>
      </section>

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

      <AdminFraudQueue rows={rows} canDecide={canDecide} />
    </PaymentShell>
  );
}

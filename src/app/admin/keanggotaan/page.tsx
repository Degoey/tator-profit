import type { Metadata } from "next";

import { AdminShell } from "@/components/admin/admin-shell";
import { AdminMembershipReview } from "@/components/payments/admin-membership-review";
import { canAdmin } from "@/lib/auth/admin-permissions";
import { requireAdminConsole } from "@/lib/auth/current-user";
import { isOwnerAccount } from "@/lib/config/owner";
import { adminRequestAuditIndex, listMembershipQueueForConsole } from "@/lib/services/admin-console-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Keanggotaan program" };

/**
 * Siklus keanggotaan program.
 *
 * Panel ini memutuskan perpindahan status keanggotaan — aktifkan setelah dana
 * diterima, tunda, lanjutkan, selesaikan, atau batalkan — dan mencatat imbalan
 * periode berjalan. Baris boleh dibaca semua peran admin, tetapi aksinya
 * memerlukan `manageFinance` (SUPER_ADMIN/FINANCE): tombolnya tidak dirender
 * untuk peran lain dan API-nya tetap menolak di server.
 */
export default async function AdminMembershipPage() {
  const admin = await requireAdminConsole("/admin/keanggotaan");
  const canManageFinance = canAdmin(admin.adminRole, "manageFinance");
  const rows = await listMembershipQueueForConsole({
    auditIndex: await adminRequestAuditIndex(),
  });

  return (
    <AdminShell
      active="/admin/keanggotaan"
      title="Keanggotaan program"
      description="Setiap keanggotaan memindahkan uang atau hak imbalan, jadi hanya dijalankan sebagai aksi eksplisit: mengaktifkan mencatat dana yang sudah diterima di luar platform, menangguhkan menghentikan hak imbalan, dan membatalkan mengembalikan dana sebagai entri penyesuaian. Semuanya tercatat di jejak audit."
      adminRole={admin.adminRole}
      username={admin.username}
      isOwner={isOwnerAccount(admin)}
    >
      <AdminMembershipReview
        rows={rows}
        allowedActions={canManageFinance ? ["activate", "generate", "suspend", "resume", "complete", "cancel"] : []}
      />
    </AdminShell>
  );
}
import type { Metadata } from "next";

import { AdminShell } from "@/components/admin/admin-shell";
import { AdminAuditTrail } from "@/components/payments/admin-audit-trail";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canAdmin } from "@/lib/auth/admin-permissions";
import { requireAdminConsole } from "@/lib/auth/current-user";
import { isOwnerAccount } from "@/lib/config/owner";
import { listAuditTrailForConsole } from "@/lib/services/admin-console-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Jejak audit" };

/**
 * Jejak audit.
 *
 * Halaman ini tetap dapat dibuka peran mana pun yang lolos penjagaan panel, tetapi
 * barisnya **tidak dimuat sama sekali** bila peran itu tidak memegang `readAudit`
 * (SUPPORT dan VIEWER): yang tampil hanya kartu "akses terbatas". Panel admin bukan
 * permukaan rahasia seperti Konsol Pemilik, jadi di sini akses terbatas dinyatakan
 * terbuka, bukan disembunyikan sebagai 404.
 */
export default async function AdminAuditPage() {
  const admin = await requireAdminConsole("/admin/audit");
  const canReadAudit = canAdmin(admin.adminRole, "readAudit");
  const rows = canReadAudit ? await listAuditTrailForConsole() : [];

  return (
    <AdminShell
      active="/admin/audit"
      title="Jejak audit"
      description="Catatan tindakan administrator: aktor, aksi, entitas, alamat IP, dan snapshot sebelum/sesudah. Barisnya hanya dimuat untuk peran yang berwenang membacanya."
      adminRole={admin.adminRole}
      username={admin.username}
      isOwner={isOwnerAccount(admin)}
    >
      <Card id="audit">
        <CardHeader>
          <CardTitle>50 catatan terbaru</CardTitle>
          <CardDescription>
            {canReadAudit
              ? "50 catatan audit terbaru dari database, terbaru lebih dahulu."
              : "Jejak audit hanya tersedia untuk peran SUPER_ADMIN, FINANCE, dan COMPLIANCE."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {canReadAudit ? (
            <AdminAuditTrail rows={rows} />
          ) : (
            <Alert variant="warning" title="Akses terbatas">
              Peran Anda tidak diizinkan membaca jejak audit, dan halaman ini tidak memuat satu baris
              pun. Hubungi Super Admin bila catatan ini diperlukan untuk tugas Anda.
            </Alert>
          )}
        </CardContent>
      </Card>
    </AdminShell>
  );
}

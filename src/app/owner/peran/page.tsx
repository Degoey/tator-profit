import type { Metadata } from "next";

import { OwnerRoleManager } from "@/components/owner/owner-role-manager";
import { OwnerShell } from "@/components/owner/owner-shell";
import { Alert } from "@/components/ui/alert";
import { requireOwnerPage } from "@/lib/auth/owner-guard";
import { listAdministrators } from "@/lib/services/admin-role-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Peran administrator" };

/**
 * Pengelola peran administrator — milik Konsol Pemilik.
 *
 * Sejak Panel Admin dibuat untuk admin peran biasa, kapabilitas `manageUsers`
 * hanya tinggal di sini: menaikkan peran seseorang adalah tindakan pemilik, dan
 * formulirnya memakai rute pemilik yang menuntut sesi terverifikasi sidik jari.
 */
export default async function OwnerRolesPage() {
  const owner = await requireOwnerPage("/owner/peran");
  const administrators = await listAdministrators();

  return (
    <OwnerShell
      active="/owner/peran"
      title="Peran administrator"
      description="Satu tempat untuk menentukan apa yang boleh dilakukan setiap akun administrator: kredit saldo hanya SUPER_ADMIN, antrean uang untuk SUPER_ADMIN dan Keuangan, kepatuhan untuk pemeriksa, dan hanya-baca untuk Dukungan serta Pengamat."
      ownerLabel={`@${owner.username}`}
    >
      <Alert variant="info" title="Tindakan pemilik">
        Halaman ini hanya dapat dibuka akun pemilik, dan setiap perubahan dikirim ke rute pemilik
        yang mewajibkan sesi sudah diverifikasi sidik jari. Administrator tanpa peran tidak memiliki
        kemampuan finansial apa pun.
      </Alert>

      <OwnerRoleManager
        administrators={administrators.map((row) => ({
          id: row.id,
          username: row.username,
          name: row.name,
          email: row.email,
          status: row.status,
          adminRole: row.adminRole,
          createdAt: row.createdAt,
        }))}
      />
    </OwnerShell>
  );
}

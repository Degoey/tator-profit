import { jsonError, jsonSuccess } from "@/lib/api";
import { requireOwnerApi } from "@/lib/auth/owner-guard";
import { ownerApiError, ownerRateLimit } from "@/lib/owner/api-errors";
import { assertSameOrigin } from "@/lib/request-origin";
import { getRequestMeta } from "@/lib/security";
import { AdminRoleError, assignAdminRole } from "@/lib/services/admin-role-service";
import { adminRoleAssignmentSchema, flattenZodError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pemberian / perubahan peran administrator dari Konsol Pemilik.
 *
 * Dulu formulir ini ada di halaman administrasi umum (`/admin`). Sejak Panel Admin
 * dibuat khusus untuk admin peran biasa, kapabilitas ini tinggal di sini — dan
 * sengaja memakai penjagaan pemilik (`requireOwnerApi`), bukan penjagaan admin
 * biasa: sesi ini wajib sudah lolos verifikasi sidik jari, sehingga kredensial
 * pemilik yang dicuri tanpa perangkatnya tidak cukup untuk menaikkan peran
 * seseorang menjadi SUPER_ADMIN.
 *
 * Aturan peran tetap dijalankan `assignAdminRole` (satu-satunya jalur perubahan),
 * jadi tidak ada aturan yang bercabang dua dan setiap perubahan tercatat di jejak
 * audit sebagai `admin.role_assigned`.
 */
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return jsonError("CROSS_ORIGIN", "Permintaan lintas situs ditolak.", 403);
  }

  try {
    const actor = await requireOwnerApi();
    const limited = ownerRateLimit("users-role", actor.id, 30, 60_000);
    if (limited) return limited;

    const parsed = adminRoleAssignmentSchema.safeParse(await request.json());
    if (!parsed.success) {
      return jsonError(
        "VALIDATION_ERROR",
        "Periksa kembali kolom peran.",
        422,
        flattenZodError(parsed.error),
      );
    }

    const result = await assignAdminRole({
      targetUserId: parsed.data.userId,
      role: parsed.data.role,
      actorUserId: actor.id,
      actorAdminRole: actor.adminRole,
      meta: await getRequestMeta(),
    });

    return jsonSuccess(result);
  } catch (error) {
    if (error instanceof AdminRoleError) {
      return jsonError(error.code, error.message, error.status);
    }
    return ownerApiError(error, "Peran administrator tidak dapat disimpan saat ini.");
  }
}

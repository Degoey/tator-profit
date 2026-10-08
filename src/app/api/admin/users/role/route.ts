import { jsonError, jsonSuccess, readJsonBody } from "@/lib/api";
import { getAdminActor } from "@/lib/auth/admin-guard";
import { pruneRateLimitBuckets, rateLimit } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/request-origin";
import { getRequestMeta } from "@/lib/security";
import {
  AdminRoleError,
  assignAdminRole,
  listAdministrators,
} from "@/lib/services/admin-role-service";
import { adminRoleAssignmentSchema, flattenZodError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Administrator list with the current admin role (SUPER_ADMIN only). */
export async function GET() {
  const actor = await getAdminActor();
  if (!actor || actor.adminRole !== "SUPER_ADMIN") {
    return jsonError("FORBIDDEN", "Hanya SUPER_ADMIN yang dapat melihat daftar peran.", 403);
  }

  return jsonSuccess({ administrators: await listAdministrators() });
}

/**
 * Grants, changes or clears an administrator role.
 * The capability itself is re-checked inside the service, so this endpoint can
 * never be used by a FINANCE/SUPPORT/COMPLIANCE/VIEWER account.
 */
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return jsonError("CROSS_ORIGIN", "Permintaan lintas situs ditolak.", 403);
  }

  const actor = await getAdminActor();
  if (!actor) {
    return jsonError("FORBIDDEN", "Akses administrator diperlukan.", 403);
  }

  pruneRateLimitBuckets();
  const limit = rateLimit(`admin-roles:${actor.id}`, 30, 60_000);
  if (!limit.allowed) {
    return jsonError("RATE_LIMITED", `Terlalu banyak permintaan. Coba lagi dalam ${limit.retryAfterSeconds} detik.`, 429);
  }

  const parsed = adminRoleAssignmentSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return jsonError("VALIDATION_ERROR", "Periksa kembali kolom permintaan.", 422, flattenZodError(parsed.error));
  }

  try {
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
    console.error("Admin role assignment failed", error);
    return jsonError("INTERNAL_ERROR", "Tidak dapat menyimpan peran administrator.", 500);
  }
}

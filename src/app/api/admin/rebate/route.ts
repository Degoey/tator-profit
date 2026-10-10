import { jsonError, jsonSuccess, readJsonBody } from "@/lib/api";
import { getAdminActor } from "@/lib/auth/admin-guard";
import { pruneRateLimitBuckets, rateLimit } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/request-origin";
import { getRequestMeta } from "@/lib/security";
import {
  RebateConfigError,
  listRebateConfig,
  updateRebateConfig,
} from "@/lib/services/rebate-config-service";
import { flattenZodError, rebateConfigUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Current rebate percentages (generations 1..5) for the admin settings screen. */
export async function GET() {
  const actor = await getAdminActor();
  if (!actor) {
    return jsonError("FORBIDDEN", "Akses administrator diperlukan.", 403);
  }

  return jsonSuccess(await listRebateConfig());
}

/**
 * Updates one or more rebate percentages. The capability (SUPER_ADMIN/FINANCE)
 * is re-checked inside the service, so this endpoint can never be used by an
 * administrator without the `manageFinance` permission.
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
  const limit = rateLimit(`admin-rebate:${actor.id}`, 30, 60_000);
  if (!limit.allowed) {
    return jsonError("RATE_LIMITED", `Terlalu banyak permintaan. Coba lagi dalam ${limit.retryAfterSeconds} detik.`, 429);
  }

  const parsed = rebateConfigUpdateSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return jsonError("VALIDATION_ERROR", "Periksa kembali persentase rabat.", 422, flattenZodError(parsed.error));
  }

  try {
    const result = await updateRebateConfig({
      updates: parsed.data.updates,
      actorUserId: actor.id,
      actorAdminRole: actor.adminRole,
      meta: await getRequestMeta(),
    });
    return jsonSuccess(result);
  } catch (error) {
    if (error instanceof RebateConfigError) {
      return jsonError(error.code, error.message, error.status);
    }
    console.error("Rebate config update failed", error);
    return jsonError("INTERNAL_ERROR", "Tidak dapat menyimpan persentase rabat.", 500);
  }
}

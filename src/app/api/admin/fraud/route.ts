import { jsonError, jsonSuccess, readJsonBody } from "@/lib/api";
import { getAdminActor } from "@/lib/auth/admin-guard";
import { pruneRateLimitBuckets, rateLimit } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/request-origin";
import { getRequestMeta } from "@/lib/security";
import { FraudReviewError, reviewFraudCase } from "@/lib/services/anti-fraud-service";
import { flattenZodError, fraudReviewSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Closes one anti-fraud case. The `reviewFraud` capability is re-checked inside
 * the service, so this endpoint can never be used by an administrator that is
 * not allowed to decide (FINANCE may read the queue but not close it).
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
  const limit = rateLimit(`admin-fraud:${actor.id}`, 60, 60_000);
  if (!limit.allowed) {
    return jsonError(
      "RATE_LIMITED",
      `Terlalu banyak permintaan. Coba lagi dalam ${limit.retryAfterSeconds} detik.`,
      429,
    );
  }

  const parsed = fraudReviewSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return jsonError(
      "VALIDATION_ERROR",
      "Periksa kembali keputusan tinjauan.",
      422,
      flattenZodError(parsed.error),
    );
  }

  try {
    const result = await reviewFraudCase({
      caseId: parsed.data.caseId,
      decision: parsed.data.decision,
      note: parsed.data.note,
      actorUserId: actor.id,
      actorAdminRole: actor.adminRole,
      meta: await getRequestMeta(),
    });
    return jsonSuccess(result);
  } catch (error) {
    if (error instanceof FraudReviewError) {
      return jsonError(error.code, error.message, error.status);
    }
    console.error("Fraud review failed", error);
    return jsonError("INTERNAL_ERROR", "Tidak dapat menyimpan keputusan tinjauan.", 500);
  }
}

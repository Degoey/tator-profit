import { jsonError, jsonSuccess } from "@/lib/api";
import { requireAdminPermission } from "@/lib/auth/admin-guard";
import { MAX_JSON_BYTES, ProofError, readBoundedJsonBody } from "@/lib/payment-proof";
import { adminWithdrawalActionSchema } from "@/lib/payment-validation";
import { pruneRateLimitBuckets, rateLimit } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/request-origin";
import { getRequestMeta } from "@/lib/security";
import { PaymentError, reviewWithdrawalRequest } from "@/lib/services/manual-payment-service";
import { flattenZodError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Administrator review of a manual withdrawal (UNDER_REVIEW, APPROVED,
 * PROCESSING, COMPLETED, REJECTED). Requires the `reviewWithdrawal` capability.
 */
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return jsonError("FORBIDDEN", "Permintaan lintas situs ditolak.", 403);
  }

  const actor = await requireAdminPermission("reviewWithdrawal");
  if (!actor) {
    return jsonError("FORBIDDEN", "Akses administrator diperlukan.", 403);
  }

  pruneRateLimitBuckets();
  const limit = rateLimit(`admin-withdrawals:${actor.id}`, 60, 60_000);
  if (!limit.allowed) {
    return jsonError(
      "RATE_LIMITED",
      `Terlalu banyak permintaan. Coba lagi dalam ${limit.retryAfterSeconds} detik.`,
      429,
    );
  }

  try {
    const body = await readBoundedJsonBody(request, MAX_JSON_BYTES);
    const parsed = adminWithdrawalActionSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        "VALIDATION_ERROR",
        "Periksa kembali kolom yang ditandai.",
        422,
        flattenZodError(parsed.error),
      );
    }

    const meta = await getRequestMeta();
    const result = await reviewWithdrawalRequest({
      withdrawalId: parsed.data.id,
      actorUserId: actor.id,
      actorAdminRole: actor.adminRole,
      action: parsed.data.action,
      reason: parsed.data.reason,
      meta,
    });

    return jsonSuccess(result);
  } catch (error) {
    if (error instanceof ProofError) {
      return jsonError(error.code, error.message, error.status);
    }
    if (error instanceof PaymentError) {
      return jsonError(error.code, error.message, error.status);
    }

    console.error("Peninjauan penarikan gagal", error);
    return jsonError("INTERNAL_ERROR", "Tidak dapat meninjau penarikan saat ini.", 500);
  }
}

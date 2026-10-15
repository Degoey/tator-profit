import { jsonError, jsonSuccess } from "@/lib/api";
import { canReviewDepositAction } from "@/lib/auth/admin-permissions";
import { requireOwnerApi } from "@/lib/auth/owner-guard";
import { ownerApiError, ownerRateLimit } from "@/lib/owner/api-errors";
import { MAX_JSON_BYTES, ProofError, readBoundedJsonBody } from "@/lib/payment-proof";
import { adminDepositActionSchema } from "@/lib/payment-validation";
import { assertSameOrigin } from "@/lib/request-origin";
import { getRequestMeta } from "@/lib/security";
import { PaymentError, reviewDepositRequest } from "@/lib/services/manual-payment-service";
import { flattenZodError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tinjauan setoran dari Konsol Pemilik.
 *
 * Rutenya terpisah dari `/api/admin/deposits` supaya penjagaan 2FA konsol pemilik
 * tidak dapat dilewati lewat rute administrator biasa, tetapi keputusan uangnya
 * tetap dijalankan layanan yang sama (`reviewDepositRequest`) — termasuk aturan
 * ledger, status terminal, dan jejak auditnya.
 */
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return jsonError("CROSS_ORIGIN", "Permintaan lintas situs ditolak.", 403);
  }

  try {
    const actor = await requireOwnerApi();
    const limited = ownerRateLimit("deposits", actor.id, 60, 60_000);
    if (limited) return limited;

    let body: unknown;
    try {
      body = await readBoundedJsonBody(request, MAX_JSON_BYTES);
    } catch (error) {
      if (error instanceof ProofError) return jsonError(error.code, error.message, error.status);
      throw error;
    }

    const parsed = adminDepositActionSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        "VALIDATION_ERROR",
        "Periksa kembali kolom yang ditandai.",
        422,
        flattenZodError(parsed.error),
      );
    }

    if (!canReviewDepositAction(actor.adminRole, parsed.data.action)) {
      return jsonError("FORBIDDEN", "Peran Anda tidak boleh melakukan aksi ini.", 403);
    }

    const result = await reviewDepositRequest({
      depositId: parsed.data.id,
      actorUserId: actor.id,
      actorAdminRole: actor.adminRole,
      action: parsed.data.action,
      reason: parsed.data.reason,
      meta: await getRequestMeta(),
    });

    return jsonSuccess(result);
  } catch (error) {
    if (error instanceof PaymentError) {
      return jsonError(error.code, error.message, error.status);
    }
    return ownerApiError(error, "Setoran tidak dapat ditinjau saat ini.");
  }
}

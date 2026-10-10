import { jsonError, jsonSuccess } from "@/lib/api";
import { requireAdminPermission } from "@/lib/auth/admin-guard";
import { deleteProofFile, MAX_JSON_BYTES, MAX_MULTIPART_BYTES, parseBoundedMultipart, ProofError, readBoundedJsonBody, readProofFromFormData, storeProofFile } from "@/lib/payment-proof";
import { adminWithdrawalActionSchema, withdrawalListQuerySchema } from "@/lib/payment-validation";
import { pruneRateLimitBuckets, rateLimit } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/request-origin";
import { getRequestMeta } from "@/lib/security";
import {
  PaymentError,
  listWithdrawalsForAdmin,
  reviewWithdrawalRequest,
} from "@/lib/services/manual-payment-service";
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

  // A transfer proof is optional: when a JSON body is sent the review runs
  // unchanged, otherwise the multipart body is bounded and parsed the same way
  // as a deposit and the validated file is passed to the service.
  let stored: Awaited<ReturnType<typeof storeProofFile>> | null = null;
  let actionInput: unknown = null;
  let formData: FormData | null = null;
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();

  try {
    if (contentType.includes("multipart/form-data")) {
      formData = await parseBoundedMultipart(request, MAX_MULTIPART_BYTES);
      actionInput = {
        id: formData.get("id"),
        action: formData.get("action"),
        reason: formData.get("reason") ?? undefined,
      };
    } else {
      actionInput = await readBoundedJsonBody(request, MAX_JSON_BYTES);
    }
  } catch (error) {
    if (error instanceof ProofError) {
      return jsonError(error.code, error.message, error.status);
    }
    console.error("Pembacaan permintaan peninjauan gagal", error);
    return jsonError("INTERNAL_ERROR", "Tidak dapat membaca permintaan peninjauan.", 500);
  }

  try {
    const parsed = adminWithdrawalActionSchema.safeParse(actionInput);
    if (!parsed.success) {
      return jsonError(
        "VALIDATION_ERROR",
        "Periksa kembali kolom yang ditandai.",
        422,
        flattenZodError(parsed.error),
      );
    }

    let proof: Awaited<ReturnType<typeof readProofFromFormData>> | null = null;
    if (formData) {
      proof = await readProofFromFormData(formData);
      stored = await storeProofFile({
        bytes: proof.bytes,
        kind: proof.kind,
        originalName: proof.originalName,
      });
    }

    const meta = await getRequestMeta();
    const result = await reviewWithdrawalRequest({
      withdrawalId: parsed.data.id,
      actorUserId: actor.id,
      actorAdminRole: actor.adminRole,
      action: parsed.data.action,
      reason: parsed.data.reason,
      proof: proof && stored
        ? {
            storageKey: stored.storagePath,
            fileName: stored.fileName,
            mimeType: stored.mimeType,
            size: stored.sizeBytes,
          }
        : undefined,
      meta,
    });

    return jsonSuccess(result);
  } catch (error) {
    if (stored) await deleteProofFile(stored.storagePath);

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

/**
 * Read-only withdrawal queue for administrators: supports `status`, `search`
 * and `take`, exactly like the `listWithdrawalsForAdmin` helper used by the
 * panel. Requires only the `read` capability.
 */
export async function GET(request: Request) {
  const actor = await requireAdminPermission("read");
  if (!actor) {
    return jsonError("FORBIDDEN", "Akses administrator diperlukan.", 403);
  }

  const url = new URL(request.url);
  const parsed = withdrawalListQuerySchema.safeParse({
    status: url.searchParams.get("status") ?? undefined,
    search: url.searchParams.get("search") ?? undefined,
    take: url.searchParams.get("take") ?? undefined,
  });
  if (!parsed.success) {
    return jsonError("VALIDATION_ERROR", "Parameter daftar tidak valid.", 422, flattenZodError(parsed.error));
  }

  try {
    const rows = await listWithdrawalsForAdmin({
      status: parsed.data.status,
      search: parsed.data.search,
      take: parsed.data.take ?? 100,
    });
    return jsonSuccess({ rows });
  } catch (error) {
    if (error instanceof PaymentError) {
      return jsonError(error.code, error.message, error.status);
    }
    console.error("Pembacaan antrean penarikan gagal", error);
    return jsonError("INTERNAL_ERROR", "Tidak dapat memuat antrean penarikan saat ini.", 500);
  }
}

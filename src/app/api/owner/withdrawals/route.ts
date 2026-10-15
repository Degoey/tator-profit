import { jsonError, jsonSuccess } from "@/lib/api";
import { requireOwnerApi, type OwnerActor } from "@/lib/auth/owner-guard";
import { ownerApiError, ownerRateLimit } from "@/lib/owner/api-errors";
import {
  deleteProofFile,
  MAX_JSON_BYTES,
  MAX_MULTIPART_BYTES,
  parseBoundedMultipart,
  ProofError,
  readBoundedJsonBody,
  readProofFromFormData,
  storeProofFile,
} from "@/lib/payment-proof";
import { adminWithdrawalActionSchema } from "@/lib/payment-validation";
import { assertSameOrigin } from "@/lib/request-origin";
import { getRequestMeta } from "@/lib/security";
import { PaymentError, reviewWithdrawalRequest } from "@/lib/services/manual-payment-service";
import { flattenZodError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tinjauan penarikan dari Konsol Pemilik (menunggu → ditinjau → disetujui →
 * diproses → selesai, atau ditolak). Sama seperti setoran: penjagaannya milik
 * konsol pemilik (termasuk 2FA), sedangkan keputusan uangnya tetap dijalankan
 * `reviewWithdrawalRequest` supaya pencadangan dana dan ledger tidak diduplikasi.
 *
 * Bukti transfer boleh dilampirkan sebagai multipart saat menandai selesai; bila
 * badan permintaan berupa JSON, peninjauan berjalan tanpa lampiran.
 */
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return jsonError("CROSS_ORIGIN", "Permintaan lintas situs ditolak.", 403);
  }

  let stored: Awaited<ReturnType<typeof storeProofFile>> | null = null;

  try {
    const actor: OwnerActor = await requireOwnerApi();
    const limited = ownerRateLimit("withdrawals", actor.id, 60, 60_000);
    if (limited) return limited;

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
      if (error instanceof ProofError) return jsonError(error.code, error.message, error.status);
      console.error("Pembacaan permintaan peninjauan pemilik gagal", error);
      return jsonError("INTERNAL_ERROR", "Tidak dapat membaca permintaan peninjauan.", 500);
    }

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

    const result = await reviewWithdrawalRequest({
      withdrawalId: parsed.data.id,
      actorUserId: actor.id,
      actorAdminRole: actor.adminRole,
      action: parsed.data.action,
      reason: parsed.data.reason,
      proof:
        proof && stored
          ? {
              storageKey: stored.storagePath,
              fileName: stored.fileName,
              mimeType: stored.mimeType,
              size: stored.sizeBytes,
            }
          : undefined,
      meta: await getRequestMeta(),
    });

    return jsonSuccess(result);
  } catch (error) {
    /** Berkas yang sudah tersimpan tetapi peninjauannya gagal tidak ditinggalkan. */
    if (stored) await deleteProofFile(stored.storagePath);

    if (error instanceof ProofError) return jsonError(error.code, error.message, error.status);
    if (error instanceof PaymentError) return jsonError(error.code, error.message, error.status);
    return ownerApiError(error, "Penarikan tidak dapat ditinjau saat ini.");
  }
}

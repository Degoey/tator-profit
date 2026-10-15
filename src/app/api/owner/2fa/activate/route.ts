import { jsonError, jsonSuccess } from "@/lib/api";
import { requireOwnerApi } from "@/lib/auth/owner-guard";
import { ownerApiError, ownerRateLimit } from "@/lib/owner/api-errors";
import { ownerActivateSchema } from "@/lib/owner/validation";
import { MAX_JSON_BYTES, ProofError, readBoundedJsonBody } from "@/lib/payment-proof";
import { assertSameOrigin } from "@/lib/request-origin";
import { getRequestMeta } from "@/lib/security";
import { activateOwnerTotp } from "@/lib/services/owner-2fa-service";
import { flattenZodError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Langkah 2 pendaftaran 2FA: mengonfirmasi satu kode dari autentikator.
 * Setelah berhasil, 2FA aktif dan kode pemulihan sekali-pakai dibuat — kode itu
 * dikembalikan hanya pada jawaban ini, jadi pemilik harus menyimpannya.
 */
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return jsonError("CROSS_ORIGIN", "Permintaan lintas situs ditolak.", 403);
  }

  try {
    const actor = await requireOwnerApi({ allowEnrollment: true });
    const limited = ownerRateLimit("2fa-activate", actor.id, 15, 60_000);
    if (limited) return limited;

    let body: unknown;
    try {
      body = await readBoundedJsonBody(request, MAX_JSON_BYTES);
    } catch (error) {
      if (error instanceof ProofError) return jsonError(error.code, error.message, error.status);
      throw error;
    }

    const parsed = ownerActivateSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        "VALIDATION_ERROR",
        "Periksa kembali kode yang dimasukkan.",
        422,
        flattenZodError(parsed.error),
      );
    }

    const result = await activateOwnerTotp({
      userId: actor.id,
      code: parsed.data.code,
      meta: await getRequestMeta(),
    });
    return jsonSuccess(result);
  } catch (error) {
    return ownerApiError(error, "2FA tidak dapat diaktifkan saat ini.");
  }
}

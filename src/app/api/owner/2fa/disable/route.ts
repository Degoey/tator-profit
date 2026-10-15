import { jsonError, jsonSuccess } from "@/lib/api";
import { requireOwnerApi } from "@/lib/auth/owner-guard";
import { ownerApiError, ownerRateLimit } from "@/lib/owner/api-errors";
import { ownerTotpCodeSchema } from "@/lib/owner/validation";
import { MAX_JSON_BYTES, ProofError, readBoundedJsonBody } from "@/lib/payment-proof";
import { assertSameOrigin } from "@/lib/request-origin";
import { getRequestMeta } from "@/lib/security";
import { disableOwnerTotp } from "@/lib/services/owner-2fa-service";
import { flattenZodError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mematikan 2FA pemilik. Hanya dari sesi yang sudah diverifikasi, dan tetap wajib
 * disertai kode yang sah. Seluruh sesi pemilik kehilangan status verifikasi
 * setelahnya, jadi mematikan 2FA tidak mewariskan akses ke sesi lama.
 */
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return jsonError("CROSS_ORIGIN", "Permintaan lintas situs ditolak.", 403);
  }

  try {
    const actor = await requireOwnerApi();
    const limited = ownerRateLimit("2fa-disable", actor.id, 5, 60_000);
    if (limited) return limited;

    let body: unknown;
    try {
      body = await readBoundedJsonBody(request, MAX_JSON_BYTES);
    } catch (error) {
      if (error instanceof ProofError) return jsonError(error.code, error.message, error.status);
      throw error;
    }

    const parsed = ownerTotpCodeSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        "VALIDATION_ERROR",
        "Periksa kembali kode yang dimasukkan.",
        422,
        flattenZodError(parsed.error),
      );
    }

    const result = await disableOwnerTotp({
      userId: actor.id,
      code: parsed.data.code,
      recoveryCode: parsed.data.recoveryCode,
      meta: await getRequestMeta(),
    });
    return jsonSuccess(result);
  } catch (error) {
    return ownerApiError(error, "2FA tidak dapat dimatikan saat ini.");
  }
}

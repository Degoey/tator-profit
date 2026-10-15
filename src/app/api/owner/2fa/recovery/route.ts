import { jsonError, jsonSuccess } from "@/lib/api";
import { requireOwnerApi } from "@/lib/auth/owner-guard";
import { ownerApiError, ownerRateLimit } from "@/lib/owner/api-errors";
import { ownerTotpCodeSchema } from "@/lib/owner/validation";
import { MAX_JSON_BYTES, ProofError, readBoundedJsonBody } from "@/lib/payment-proof";
import { assertSameOrigin } from "@/lib/request-origin";
import { getRequestMeta } from "@/lib/security";
import { regenerateOwnerRecoveryCodes } from "@/lib/services/owner-2fa-service";
import { flattenZodError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Membuat ulang kode pemulihan. Kode lama langsung tidak berlaku (hash-nya
 * ditimpa), dan kode baru hanya muncul pada jawaban ini.
 */
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return jsonError("CROSS_ORIGIN", "Permintaan lintas situs ditolak.", 403);
  }

  try {
    const actor = await requireOwnerApi();
    const limited = ownerRateLimit("2fa-recovery", actor.id, 5, 60_000);
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

    const result = await regenerateOwnerRecoveryCodes({
      userId: actor.id,
      code: parsed.data.code,
      recoveryCode: parsed.data.recoveryCode,
      meta: await getRequestMeta(),
    });
    return jsonSuccess(result);
  } catch (error) {
    return ownerApiError(error, "Kode pemulihan tidak dapat dibuat ulang saat ini.");
  }
}

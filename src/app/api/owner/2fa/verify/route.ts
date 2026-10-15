import { jsonError, jsonSuccess } from "@/lib/api";
import { requireOwnerApi } from "@/lib/auth/owner-guard";
import { ownerApiError, ownerRateLimit } from "@/lib/owner/api-errors";
import { ownerTotpCodeSchema } from "@/lib/owner/validation";
import { MAX_JSON_BYTES, ProofError, readBoundedJsonBody } from "@/lib/payment-proof";
import { assertSameOrigin } from "@/lib/request-origin";
import { getRequestMeta } from "@/lib/security";
import { verifyOwnerStepUp } from "@/lib/services/owner-2fa-service";
import { flattenZodError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Verifikasi sesi (step-up) dengan kode 2FA atau satu kode pemulihan.
 *
 * Berhasil berarti sesi ini ditandai `totpVerifiedAt` selama masa berlaku yang
 * diatur `OWNER_STEP_UP_MINUTES` (bawaan 12 jam). Sebelum itu, seluruh rute dan
 * halaman Konsol Pemilik menolak permintaan — jadi sesi yang dicuri tetap tidak
 * cukup untuk membuka konsol.
 */
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return jsonError("CROSS_ORIGIN", "Permintaan lintas situs ditolak.", 403);
  }

  try {
    const actor = await requireOwnerApi({ allowStepUp: true });
    const limited = ownerRateLimit("2fa-verify", actor.id, 10, 60_000);
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

    const result = await verifyOwnerStepUp({
      userId: actor.id,
      sessionId: actor.sessionId,
      code: parsed.data.code,
      recoveryCode: parsed.data.recoveryCode,
      meta: await getRequestMeta(),
    });
    return jsonSuccess(result);
  } catch (error) {
    return ownerApiError(error, "Verifikasi 2FA gagal.");
  }
}

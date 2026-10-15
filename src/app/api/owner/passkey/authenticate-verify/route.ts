import type { AuthenticationResponseJSON } from "@simplewebauthn/server";

import { jsonError, jsonSuccess } from "@/lib/api";
import { requireOwnerApi } from "@/lib/auth/owner-guard";
import { ownerApiError, ownerRateLimit } from "@/lib/owner/api-errors";
import { ownerPasskeyAuthenticateVerifySchema } from "@/lib/owner/validation";
import { ProofError, readBoundedJsonBody } from "@/lib/payment-proof";
import { assertSameOrigin } from "@/lib/request-origin";
import { getRequestMeta } from "@/lib/security";
import { completePasskeyAuthentication } from "@/lib/services/owner-passkey-service";
import { flattenZodError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PASSKEY_JSON_MAX_BYTES = 128 * 1024;

/**
 * Langkah 2 verifikasi sesi (step-up): memverifikasi tanda tangan passkey terhadap
 * tantangan dan origin yang disimpan server.
 *
 * Berhasil berarti sesi ini ditandai terverifikasi selama masa berlaku yang diatur
 * `OWNER_STEP_UP_MINUTES` (bawaan 12 jam). Sebelum itu, seluruh rute dan halaman
 * Konsol Pemilik menolak permintaan — jadi sesi yang dicuri tetap tidak cukup untuk
 * membuka konsol.
 */
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return jsonError("CROSS_ORIGIN", "Permintaan lintas situs ditolak.", 403);
  }

  try {
    const actor = await requireOwnerApi({ allowStepUp: true });
    const limited = ownerRateLimit("passkey-authenticate-verify", actor.id, 30, 60_000);
    if (limited) return limited;

    let body: unknown;
    try {
      body = await readBoundedJsonBody(request, PASSKEY_JSON_MAX_BYTES);
    } catch (error) {
      if (error instanceof ProofError) return jsonError(error.code, error.message, error.status);
      throw error;
    }

    const parsed = ownerPasskeyAuthenticateVerifySchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        "VALIDATION_ERROR",
        "Balasan verifikasi sidik jari tidak dapat dibaca.",
        422,
        flattenZodError(parsed.error),
      );
    }

    const result = await completePasskeyAuthentication({
      userId: actor.id,
      sessionId: actor.sessionId,
      response: parsed.data.response as unknown as AuthenticationResponseJSON,
      meta: await getRequestMeta(),
    });
    return jsonSuccess(result);
  } catch (error) {
    return ownerApiError(error, "Verifikasi sidik jari gagal.");
  }
}

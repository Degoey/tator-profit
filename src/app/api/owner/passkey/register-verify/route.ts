import type { RegistrationResponseJSON } from "@simplewebauthn/server";

import { jsonError, jsonSuccess } from "@/lib/api";
import { requireOwnerApi } from "@/lib/auth/owner-guard";
import { ownerApiError, ownerRateLimit } from "@/lib/owner/api-errors";
import { ownerPasskeyRegisterVerifySchema } from "@/lib/owner/validation";
import { ProofError, readBoundedJsonBody } from "@/lib/payment-proof";
import { assertSameOrigin } from "@/lib/request-origin";
import { getRequestMeta } from "@/lib/security";
import { completePasskeyRegistration } from "@/lib/services/owner-passkey-service";
import { flattenZodError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Balasan attestation bisa sedikit lebih besar dari muatan JSON biasa. */
const PASSKEY_JSON_MAX_BYTES = 128 * 1024;

/**
 * Langkah 2 pendaftaran passkey: memverifikasi balasan attestation dari peramban
 * terhadap tantangan dan origin yang disimpan server, lalu menyimpan kredensial
 * (kunci publik + penghitung). Kunci privat tidak pernah sampai ke server.
 */
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return jsonError("CROSS_ORIGIN", "Permintaan lintas situs ditolak.", 403);
  }

  try {
    const actor = await requireOwnerApi({ allowEnrollment: true });
    const limited = ownerRateLimit("passkey-register-verify", actor.id, 20, 60_000);
    if (limited) return limited;

    let body: unknown;
    try {
      body = await readBoundedJsonBody(request, PASSKEY_JSON_MAX_BYTES);
    } catch (error) {
      if (error instanceof ProofError) return jsonError(error.code, error.message, error.status);
      throw error;
    }

    const parsed = ownerPasskeyRegisterVerifySchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        "VALIDATION_ERROR",
        "Balasan pendaftaran sidik jari tidak dapat dibaca.",
        422,
        flattenZodError(parsed.error),
      );
    }

    const result = await completePasskeyRegistration({
      userId: actor.id,
      response: parsed.data.response as unknown as RegistrationResponseJSON,
      friendlyName: parsed.data.friendlyName,
      meta: await getRequestMeta(),
    });
    return jsonSuccess(result);
  } catch (error) {
    return ownerApiError(error, "Pendaftaran sidik jari tidak dapat diselesaikan saat ini.");
  }
}

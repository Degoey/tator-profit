import { jsonError, jsonSuccess } from "@/lib/api";
import { requireOwnerApi } from "@/lib/auth/owner-guard";
import { ownerApiError, ownerRateLimit } from "@/lib/owner/api-errors";
import { ownerPasskeyRemoveSchema } from "@/lib/owner/validation";
import { MAX_JSON_BYTES, ProofError, readBoundedJsonBody } from "@/lib/payment-proof";
import { assertSameOrigin } from "@/lib/request-origin";
import { getRequestMeta } from "@/lib/security";
import { removeOwnerPasskey } from "@/lib/services/owner-passkey-service";
import { flattenZodError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Menghapus satu kredensial passkey. Hanya dari sesi yang sudah diverifikasi
 * (passkey aktif dan sesi ini masih segar). Bila kredensial terakhir dihapus,
 * seluruh sesi pemilik kehilangan status verifikasi dan konsol kembali meminta
 * pendaftaran — jadi menghapus sidik jari tidak mewariskan akses ke sesi lama.
 */
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return jsonError("CROSS_ORIGIN", "Permintaan lintas situs ditolak.", 403);
  }

  try {
    const actor = await requireOwnerApi();
    const limited = ownerRateLimit("passkey-remove", actor.id, 10, 60_000);
    if (limited) return limited;

    let body: unknown;
    try {
      body = await readBoundedJsonBody(request, MAX_JSON_BYTES);
    } catch (error) {
      if (error instanceof ProofError) return jsonError(error.code, error.message, error.status);
      throw error;
    }

    const parsed = ownerPasskeyRemoveSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        "VALIDATION_ERROR",
        "Permintaan penghapusan sidik jari tidak dapat dibaca.",
        422,
        flattenZodError(parsed.error),
      );
    }

    const result = await removeOwnerPasskey({
      userId: actor.id,
      credentialId: parsed.data.credentialId,
      meta: await getRequestMeta(),
    });
    return jsonSuccess(result);
  } catch (error) {
    return ownerApiError(error, "Sidik jari tidak dapat dihapus saat ini.");
  }
}

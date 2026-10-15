import { jsonError, jsonSuccess } from "@/lib/api";
import { requireOwnerApi } from "@/lib/auth/owner-guard";
import { ownerApiError, ownerRateLimit } from "@/lib/owner/api-errors";
import { assertSameOrigin } from "@/lib/request-origin";
import { getRequestMeta } from "@/lib/security";
import { beginPasskeyAuthentication } from "@/lib/services/owner-passkey-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Langkah 1 verifikasi sesi (step-up): membuat opsi verifikasi WebAuthn
 * (`PublicKeyCredentialRequestOptions`) untuk kredensial yang sudah terdaftar dan
 * menyimpan tantangannya di server.
 */
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return jsonError("CROSS_ORIGIN", "Permintaan lintas situs ditolak.", 403);
  }

  try {
    const actor = await requireOwnerApi({ allowStepUp: true });
    const limited = ownerRateLimit("passkey-authenticate-options", actor.id, 30, 60_000);
    if (limited) return limited;

    const options = await beginPasskeyAuthentication({
      userId: actor.id,
      meta: await getRequestMeta(),
    });
    return jsonSuccess(options);
  } catch (error) {
    return ownerApiError(error, "Verifikasi sidik jari tidak dapat dimulai saat ini.");
  }
}

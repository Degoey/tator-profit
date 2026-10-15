import { jsonError, jsonSuccess } from "@/lib/api";
import { requireOwnerApi } from "@/lib/auth/owner-guard";
import { ownerApiError, ownerRateLimit } from "@/lib/owner/api-errors";
import { assertSameOrigin } from "@/lib/request-origin";
import { getRequestMeta } from "@/lib/security";
import { beginPasskeyRegistration } from "@/lib/services/owner-passkey-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Langkah 1 pendaftaran passkey: membuat opsi pendaftaran WebAuthn
 * (`PublicKeyCredentialCreationOptions`) dan menyimpan tantangannya di server.
 *
 * Peramban meneruskan opsi ini ke `navigator.credentials.create()`; langkah 2
 * (`/api/owner/passkey/register-verify`) memverifikasi balasan yang ditandatangani.
 * Tidak ada rahasia yang dibagikan ke klien — hanya tantangan acak sekali pakai.
 */
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return jsonError("CROSS_ORIGIN", "Permintaan lintas situs ditolak.", 403);
  }

  try {
    const actor = await requireOwnerApi({ allowEnrollment: true });
    const limited = ownerRateLimit("passkey-register-options", actor.id, 20, 60_000);
    if (limited) return limited;

    const options = await beginPasskeyRegistration({
      userId: actor.id,
      meta: await getRequestMeta(),
    });
    return jsonSuccess(options);
  } catch (error) {
    return ownerApiError(error, "Pendaftaran sidik jari tidak dapat dimulai saat ini.");
  }
}

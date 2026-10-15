import { jsonError, jsonSuccess } from "@/lib/api";
import { requireOwnerApi } from "@/lib/auth/owner-guard";
import { ownerApiError, ownerRateLimit } from "@/lib/owner/api-errors";
import { assertSameOrigin } from "@/lib/request-origin";
import { getRequestMeta } from "@/lib/security";
import { beginOwnerTotpEnrollment } from "@/lib/services/owner-2fa-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Langkah 1 pendaftaran 2FA pemilik: membuat rahasia TOTP baru.
 *
 * Rahasia dikembalikan **satu kali** untuk dipindai/diketik ke aplikasi
 * autentikator; di database hanya tersimpan versi terenkripsinya. 2FA belum
 * aktif sampai langkah 2 (`/api/owner/2fa/activate`) mengonfirmasi satu kode sah.
 */
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return jsonError("CROSS_ORIGIN", "Permintaan lintas situs ditolak.", 403);
  }

  try {
    const actor = await requireOwnerApi({ allowEnrollment: true });
    const limited = ownerRateLimit("2fa-setup", actor.id, 10, 60_000);
    if (limited) return limited;

    const result = await beginOwnerTotpEnrollment({
      userId: actor.id,
      meta: await getRequestMeta(),
    });
    return jsonSuccess(result);
  } catch (error) {
    return ownerApiError(error, "Pendaftaran 2FA tidak dapat dimulai saat ini.");
  }
}

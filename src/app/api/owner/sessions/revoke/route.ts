import { jsonError, jsonSuccess } from "@/lib/api";
import { requireOwnerApi } from "@/lib/auth/owner-guard";
import { ownerApiError, ownerRateLimit } from "@/lib/owner/api-errors";
import { ownerTotpCodeSchema } from "@/lib/owner/validation";
import { MAX_JSON_BYTES, ProofError, readBoundedJsonBody } from "@/lib/payment-proof";
import { prisma } from "@/lib/prisma";
import { assertSameOrigin } from "@/lib/request-origin";
import { getRequestMeta, recordAuditLog, recordSecurityEvent } from "@/lib/security";
import { verifyOwnerStepUp } from "@/lib/services/owner-2fa-service";
import { flattenZodError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mencabut seluruh sesi pemilik **kecuali sesi yang sedang dipakai**.
 *
 * Dipakai kalau pemilik merasa ada perangkat lain yang masih memegang sesi.
 * Wajib disertai kode 2FA yang sah, jadi tombol ini tidak bisa ditekan dari sesi
 * yang sudah dibajak tanpa kode.
 */
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return jsonError("CROSS_ORIGIN", "Permintaan lintas situs ditolak.", 403);
  }

  try {
    const actor = await requireOwnerApi();
    const limited = ownerRateLimit("sessions-revoke", actor.id, 5, 60_000);
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

    const meta = await getRequestMeta();
    /** Kode diverifikasi lebih dulu; hanya setelah sah sesi lain dicabut. */
    await verifyOwnerStepUp({
      userId: actor.id,
      sessionId: actor.sessionId,
      code: parsed.data.code,
      recoveryCode: parsed.data.recoveryCode,
      meta,
    });

    const result = await prisma.session.updateMany({
      where: { userId: actor.id, id: { not: actor.sessionId }, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await recordAuditLog({
      actorUserId: actor.id,
      action: "owner.sessions_revoked",
      entityType: "User",
      entityId: actor.id,
      after: { revokedCount: result.count },
      meta,
    });
    await recordSecurityEvent({
      userId: actor.id,
      type: "SESSION_REVOKED",
      severity: "WARNING",
      description: `Sesi lain Konsol Pemilik dicabut (${result.count})`,
      meta,
    });

    return jsonSuccess({ revokedCount: result.count });
  } catch (error) {
    return ownerApiError(error, "Sesi lain tidak dapat dicabut saat ini.");
  }
}

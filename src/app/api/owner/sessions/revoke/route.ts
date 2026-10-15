import { jsonError, jsonSuccess } from "@/lib/api";
import { requireOwnerApi } from "@/lib/auth/owner-guard";
import { ownerApiError, ownerRateLimit } from "@/lib/owner/api-errors";
import { prisma } from "@/lib/prisma";
import { assertSameOrigin } from "@/lib/request-origin";
import { getRequestMeta, recordAuditLog, recordSecurityEvent } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mencabut seluruh sesi pemilik **kecuali sesi yang sedang dipakai**.
 *
 * Dipakai kalau pemilik merasa ada perangkat lain yang masih memegang sesi. Tidak
 * perlu kode tambahan: rute ini hanya dapat dicapai dari sesi yang sudah lolos
 * verifikasi passkey (`requireOwnerApi` menuntut step-up yang masih segar), jadi
 * sesi yang sudah dibajak pun tidak bisa memanggilnya tanpa memegang sidik jari.
 */
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return jsonError("CROSS_ORIGIN", "Permintaan lintas situs ditolak.", 403);
  }

  try {
    const actor = await requireOwnerApi();
    const limited = ownerRateLimit("sessions-revoke", actor.id, 5, 60_000);
    if (limited) return limited;

    const meta = await getRequestMeta();

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

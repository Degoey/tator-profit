import { jsonError, jsonSuccess, readJsonBody } from "@/lib/api";
import { getActiveSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { pruneRateLimitBuckets, rateLimit } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/request-origin";
import { flattenZodError, notificationReadSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Marks one notification (or every unread notification) of the signed-in account
 * as read. The update is scoped by `session.userId`, so a caller can never touch
 * another user's notifications even with a forged id.
 */
export async function PATCH(request: Request) {
  if (!assertSameOrigin(request)) {
    return jsonError("CROSS_ORIGIN", "Permintaan lintas situs ditolak.", 403);
  }

  const session = await getActiveSession();
  if (!session) {
    return jsonError("UNAUTHENTICATED", "Silakan masuk untuk mengubah notifikasi.", 401);
  }

  pruneRateLimitBuckets();
  const limit = rateLimit(`notifications:${session.userId}`, 60, 60_000);
  if (!limit.allowed) {
    return jsonError(
      "RATE_LIMITED",
      `Terlalu banyak permintaan. Coba lagi dalam ${limit.retryAfterSeconds} detik.`,
      429,
    );
  }

  const parsed = notificationReadSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return jsonError(
      "VALIDATION_ERROR",
      "Periksa kembali permintaan Anda.",
      422,
      flattenZodError(parsed.error),
    );
  }

  const result = await prisma.notification.updateMany({
    where: {
      userId: session.userId,
      readAt: null,
      ...(parsed.data.id ? { id: parsed.data.id } : {}),
    },
    data: { readAt: new Date() },
  });

  const unread = await prisma.notification.count({
    where: { userId: session.userId, readAt: null },
  });

  return jsonSuccess({ updated: result.count, unread });
}

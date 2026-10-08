import { jsonError, jsonSuccess, readJsonBody } from "@/lib/api";
import { createSession } from "@/lib/auth/session";
import { pruneRateLimitBuckets, rateLimit } from "@/lib/rate-limit";
import { getRequestMeta, recordSecurityEvent } from "@/lib/security";
import { AuthError, authenticateUser } from "@/lib/services/auth-service";
import { flattenZodError, loginSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const meta = await getRequestMeta();

  pruneRateLimitBuckets();
  const limit = rateLimit(`login:${meta.ipAddress ?? "unknown"}`, 12, 5 * 60 * 1000);
  if (!limit.allowed) {
    await recordSecurityEvent({
      type: "RATE_LIMITED",
      severity: "WARNING",
      description: "Batas percobaan login terlampaui",
      meta,
    });
    return jsonError(
      "RATE_LIMITED",
      `Terlalu banyak percobaan masuk. Coba lagi dalam ${limit.retryAfterSeconds} detik.`,
      429,
    );
  }

  const body = await readJsonBody(request);
  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    return jsonError(
      "VALIDATION_ERROR",
      "Periksa kembali kolom yang ditandai.",
      422,
      flattenZodError(parsed.error),
    );
  }

  try {
    const user = await authenticateUser(parsed.data, meta);
    const session = await createSession(user.id, meta);

    await recordSecurityEvent({
      userId: user.id,
      type: "LOGIN_SUCCESS",
      severity: "INFO",
      description: "Masuk berhasil",
      metadata: { sessionId: session.sessionId },
      meta,
    });

    return jsonSuccess({
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
      },
      expiresAt: session.expiresAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return jsonError(error.code, error.message, error.status, error.fieldErrors);
    }
    console.error("Proses masuk gagal", error);
    return jsonError("INTERNAL_ERROR", "Tidak dapat masuk saat ini.", 500);
  }
}

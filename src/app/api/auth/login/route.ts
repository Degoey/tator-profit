import { jsonError, jsonSuccess, readJsonBody } from "@/lib/api";
import { assertSameOrigin } from "@/lib/request-origin";
import { createSession } from "@/lib/auth/session";
import { pruneRateLimitBuckets, rateLimit } from "@/lib/rate-limit";
import { getRequestMeta, recordSecurityEvent } from "@/lib/security";
import { AuthError, authenticateUser } from "@/lib/services/auth-service";
import { flattenZodError, loginSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return jsonError("CROSS_ORIGIN", "Permintaan lintas situs ditolak.", 403);
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

  /**
   * Second limiter keyed on the submitted identifier. It cannot be spoofed with a
   * header, so a caller that rotates the client address still cannot brute force a
   * single account, and the account itself is protected from credential stuffing.
   */
  const identifierKey = parsed.data.identifier.trim().toLowerCase().slice(0, 190);
  const identifierLimit = rateLimit(`login-id:${identifierKey}`, 10, 5 * 60 * 1000);
  if (!identifierLimit.allowed) {
    await recordSecurityEvent({
      type: "RATE_LIMITED",
      severity: "WARNING",
      description: "Batas percobaan login per akun terlampaui",
      meta,
    });
    return jsonError(
      "RATE_LIMITED",
      `Terlalu banyak percobaan masuk. Coba lagi dalam ${identifierLimit.retryAfterSeconds} detik.`,
      429,
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

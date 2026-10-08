import { jsonError, jsonSuccess, readJsonBody } from "@/lib/api";
import { createSession } from "@/lib/auth/session";
import { pruneRateLimitBuckets, rateLimit } from "@/lib/rate-limit";
import { getRequestMeta, recordSecurityEvent } from "@/lib/security";
import { AuthError, registerUser } from "@/lib/services/auth-service";
import { flattenZodError, registerSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const meta = await getRequestMeta();

  pruneRateLimitBuckets();
  const limit = rateLimit(`register:${meta.ipAddress ?? "unknown"}`, 10, 10 * 60 * 1000);
  if (!limit.allowed) {
    await recordSecurityEvent({
      type: "RATE_LIMITED",
      severity: "WARNING",
      description: "Batas percobaan pendaftaran terlampaui",
      meta,
    });
    return jsonError(
      "RATE_LIMITED",
      `Terlalu banyak percobaan pendaftaran. Coba lagi dalam ${limit.retryAfterSeconds} detik.`,
      429,
    );
  }

  const body = await readJsonBody(request);
  const parsed = registerSchema.safeParse(body);

  if (!parsed.success) {
    return jsonError(
      "VALIDATION_ERROR",
      "Periksa kembali kolom yang ditandai.",
      422,
      flattenZodError(parsed.error),
    );
  }

  try {
    const result = await registerUser(parsed.data, meta);
    await createSession(result.userId, meta);

    return jsonSuccess(
      {
        userId: result.userId,
        username: result.username,
        email: result.email,
        referralCode: result.referralCode,
        referredByUserId: result.referredByUserId,
      },
      201,
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return jsonError(error.code, error.message, error.status, error.fieldErrors);
    }
    console.error("Registration failed", error);
    return jsonError("INTERNAL_ERROR", "Tidak dapat membuat akun saat ini.", 500);
  }
}

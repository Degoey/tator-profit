import { jsonError, jsonSuccess, readJsonBody } from "@/lib/api";
import { assertSameOrigin } from "@/lib/request-origin";
import { pruneRateLimitBuckets, rateLimit } from "@/lib/rate-limit";
import { getRequestMeta, recordSecurityEvent } from "@/lib/security";
import { AuthError, resetPasswordWithToken } from "@/lib/services/auth-service";
import { flattenZodError, resetPasswordSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return jsonError("CROSS_ORIGIN", "Permintaan lintas situs ditolak.", 403);
  const meta = await getRequestMeta();

  pruneRateLimitBuckets();
  const limit = rateLimit(`reset:${meta.ipAddress ?? "unknown"}`, 10, 15 * 60 * 1000);
  if (!limit.allowed) {
    await recordSecurityEvent({
      type: "RATE_LIMITED",
      severity: "WARNING",
      description: "Batas konfirmasi reset kata sandi terlampaui",
      meta,
    });
    return jsonError(
      "RATE_LIMITED",
      `Terlalu banyak percobaan. Coba lagi dalam ${limit.retryAfterSeconds} detik.`,
      429,
    );
  }

  const body = await readJsonBody(request);
  const parsed = resetPasswordSchema.safeParse(body);

  if (!parsed.success) {
    return jsonError(
      "VALIDATION_ERROR",
      "Periksa kembali kolom yang ditandai.",
      422,
      flattenZodError(parsed.error),
    );
  }

  try {
    const result = await resetPasswordWithToken(parsed.data.token, parsed.data.password, meta);
    return jsonSuccess({ userId: result.userId, passwordChanged: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return jsonError(error.code, error.message, error.status, error.fieldErrors);
    }
    console.error("Atur ulang kata sandi gagal", error);
    return jsonError("INTERNAL_ERROR", "Tidak dapat mereset kata sandi saat ini.", 500);
  }
}

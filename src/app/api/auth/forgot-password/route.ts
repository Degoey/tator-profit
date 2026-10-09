import { jsonError, jsonSuccess, readJsonBody } from "@/lib/api";
import { assertSameOrigin } from "@/lib/request-origin";
import { pruneRateLimitBuckets, rateLimit } from "@/lib/rate-limit";
import { getRequestMeta, recordSecurityEvent } from "@/lib/security";
import { requestPasswordReset } from "@/lib/services/auth-service";
import { flattenZodError, forgotPasswordSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return jsonError("CROSS_ORIGIN", "Permintaan lintas situs ditolak.", 403);
  const meta = await getRequestMeta();

  pruneRateLimitBuckets();
  const limit = rateLimit(`forgot:${meta.ipAddress ?? "unknown"}`, 6, 15 * 60 * 1000);
  if (!limit.allowed) {
    await recordSecurityEvent({
      type: "RATE_LIMITED",
      severity: "WARNING",
      description: "Batas permintaan reset kata sandi terlampaui",
      meta,
    });
    return jsonError(
      "RATE_LIMITED",
      `Terlalu banyak permintaan reset. Coba lagi dalam ${limit.retryAfterSeconds} detik.`,
      429,
    );
  }

  const body = await readJsonBody(request);
  const parsed = forgotPasswordSchema.safeParse(body);

  if (!parsed.success) {
    return jsonError(
      "VALIDATION_ERROR",
      "Periksa kembali kolom yang ditandai.",
      422,
      flattenZodError(parsed.error),
    );
  }

  try {
    const result = await requestPasswordReset(parsed.data.email, meta);
    return jsonSuccess({
      requested: result.requested,
      // Present only when the local development switch is explicitly enabled.
      devToken: result.devToken,
      expiresAt: result.expiresAt?.toISOString(),
    });
  } catch (error) {
    console.error("Permintaan atur ulang kata sandi gagal", error);
    return jsonError("INTERNAL_ERROR", "Tidak dapat memproses permintaan saat ini.", 500);
  }
}

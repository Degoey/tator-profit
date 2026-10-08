import { jsonError, jsonSuccess, readJsonBody } from "@/lib/api";
import { getActiveSession } from "@/lib/auth/session";
import { pruneRateLimitBuckets, rateLimit } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/request-origin";
import { getRequestMeta } from "@/lib/security";
import { ProgramError, joinProgramTier } from "@/lib/services/program-service";
import { flattenZodError, joinProgramSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Records a program join for the signed-in user.
 *
 * No payment gateway is involved: the membership is stored as PENDING with a
 * PENDING ledger commitment, and an administrator confirms the funds received
 * outside the platform before the cycle and its reward periods start.
 */
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return jsonError("CROSS_ORIGIN", "Permintaan lintas situs ditolak.", 403);
  }

  const session = await getActiveSession();
  if (!session) {
    return jsonError("UNAUTHENTICATED", "Silakan masuk untuk gabung paket program.", 401);
  }

  const meta = await getRequestMeta();

  pruneRateLimitBuckets();
  const limit = rateLimit(`join:${session.userId}`, 10, 60 * 1000);
  if (!limit.allowed) {
    return jsonError(
      "RATE_LIMITED",
      `Terlalu banyak permintaan gabung. Coba lagi dalam ${limit.retryAfterSeconds} detik.`,
      429,
    );
  }

  const body = await readJsonBody(request);
  const parsed = joinProgramSchema.safeParse(body);

  if (!parsed.success) {
    return jsonError(
      "VALIDATION_ERROR",
      "Periksa kembali kolom yang ditandai.",
      422,
      flattenZodError(parsed.error),
    );
  }

  try {
    const result = await joinProgramTier(
      session.userId,
      parsed.data.tierId,
      meta,
      parsed.data.referralCode,
      parsed.data.cycleId,
    );

    return jsonSuccess(result, 201);
  } catch (error) {
    if (error instanceof ProgramError) {
      return jsonError(error.code, error.message, error.status);
    }
    console.error("Pencatatan gabung program gagal", error);
    return jsonError("INTERNAL_ERROR", "Tidak dapat mencatat gabung program saat ini.", 500);
  }
}

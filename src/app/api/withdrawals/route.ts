import { Prisma } from "@prisma/client";

import { jsonError, jsonSuccess } from "@/lib/api";
import { getActiveSession } from "@/lib/auth/session";
import { MAX_JSON_BYTES, ProofError, readBoundedJsonBody } from "@/lib/payment-proof";
import { withdrawalSchema } from "@/lib/payment-validation";
import { pruneRateLimitBuckets, rateLimit } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/request-origin";
import { getRequestMeta } from "@/lib/security";
import { PaymentError, createWithdrawalRequest } from "@/lib/services/manual-payment-service";
import { flattenZodError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Creates a manual withdrawal request for the signed-in member. The amount is
 * reserved by the backend service (AVAILABLE -> RESERVED) and only paid out
 * after an administrator processes and completes it.
 */
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return jsonError("FORBIDDEN", "Permintaan lintas situs ditolak.", 403);
  }

  const session = await getActiveSession();
  if (!session) {
    return jsonError("UNAUTHENTICATED", "Silakan masuk untuk mengajukan penarikan.", 401);
  }

  pruneRateLimitBuckets();
  const limit = rateLimit(`withdrawal:${session.userId}`, 10, 60_000);
  if (!limit.allowed) {
    return jsonError(
      "RATE_LIMITED",
      `Terlalu banyak permintaan penarikan. Coba lagi dalam ${limit.retryAfterSeconds} detik.`,
      429,
    );
  }

  try {
    const body = await readBoundedJsonBody(request, MAX_JSON_BYTES);
    const parsed = withdrawalSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        "VALIDATION_ERROR",
        "Periksa kembali kolom yang ditandai.",
        422,
        flattenZodError(parsed.error),
      );
    }

    const meta = await getRequestMeta();
    const result = await createWithdrawalRequest({
      userId: session.userId,
      amount: new Prisma.Decimal(parsed.data.amount),
      method: parsed.data.method,
      destination: parsed.data.destination,
      notes: parsed.data.notes,
      meta,
    });

    return jsonSuccess(result, 201);
  } catch (error) {
    if (error instanceof ProofError) {
      return jsonError(error.code, error.message, error.status);
    }
    if (error instanceof PaymentError) {
      return jsonError(error.code, error.message, error.status);
    }

    console.error("Pencatatan penarikan gagal", error);
    return jsonError("INTERNAL_ERROR", "Tidak dapat mencatat penarikan saat ini.", 500);
  }
}

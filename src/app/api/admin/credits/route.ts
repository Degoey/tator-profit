import { Prisma } from "@prisma/client";

import { jsonError, jsonSuccess } from "@/lib/api";
import { requireAdminPermission } from "@/lib/auth/admin-guard";
import { MAX_JSON_BYTES, ProofError, readBoundedJsonBody } from "@/lib/payment-proof";
import { pruneRateLimitBuckets, rateLimit } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/request-origin";
import { getRequestMeta } from "@/lib/security";
import { AdminCreditError, creditBalanceByAdmin } from "@/lib/services/admin-credit-service";
import { adminCreditSchema, flattenZodError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Explicit, confirmed administrator USDT credit; there is no signup bonus. */
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return jsonError("CROSS_ORIGIN", "Permintaan lintas situs ditolak.", 403);

  const actor = await requireAdminPermission("creditBalance");
  if (!actor) return jsonError("FORBIDDEN", "Akses SUPER_ADMIN diperlukan.", 403);

  pruneRateLimitBuckets();
  const limit = rateLimit(`admin-credits:${actor.id}`, 30, 60_000);
  if (!limit.allowed) {
    return jsonError("RATE_LIMITED", `Terlalu banyak permintaan. Coba lagi dalam ${limit.retryAfterSeconds} detik.`, 429);
  }

  let body: unknown;
  try {
    body = await readBoundedJsonBody(request, MAX_JSON_BYTES);
  } catch (error) {
    if (error instanceof ProofError) return jsonError(error.code, error.message, error.status);
    throw error;
  }

  const parsed = adminCreditSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("VALIDATION_ERROR", "Periksa kembali kolom kredit.", 422, flattenZodError(parsed.error));
  }

  try {
    const result = await creditBalanceByAdmin({
      userId: parsed.data.userId,
      actorUserId: actor.id,
      amount: new Prisma.Decimal(parsed.data.amount),
      reason: parsed.data.reason,
      reference: parsed.data.reference,
      meta: await getRequestMeta(),
    });
    return jsonSuccess(result, result.idempotent ? 200 : 201);
  } catch (error) {
    if (error instanceof AdminCreditError) return jsonError(error.code, error.message, error.status);
    console.error("Kredit saldo administrator gagal", error);
    return jsonError("INTERNAL_ERROR", "Kredit saldo tidak dapat diproses saat ini.", 500);
  }
}

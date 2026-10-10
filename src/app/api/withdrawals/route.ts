import { Prisma } from "@prisma/client";

import { jsonError, jsonSuccess } from "@/lib/api";
import { requireAdminPermission } from "@/lib/auth/admin-guard";
import { getActiveSession } from "@/lib/auth/session";
import { MAX_JSON_BYTES, ProofError, readBoundedJsonBody } from "@/lib/payment-proof";
import { withdrawalListQuerySchema, withdrawalSchema } from "@/lib/payment-validation";
import { pruneRateLimitBuckets, rateLimit } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/request-origin";
import { getRequestMeta } from "@/lib/security";
import {
  PaymentError,
  createWithdrawalRequest,
  listWithdrawalsForAdmin,
  listWithdrawalsForUser,
} from "@/lib/services/manual-payment-service";
import { flattenZodError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Withdrawal history for the signed-in principal.
 *
 * A member always sees only their own requests (`listWithdrawalsForUser`, which
 * scopes the query by `userId`). An administrator with the `read` capability may
 * pass `status` / `search` to read the full review queue, mirroring the filter
 * used by `POST /api/admin/withdrawals`. The route never trusts a `userId` from
 * the query string: identity always comes from the session.
 */
export async function GET(request: Request) {
  const session = await getActiveSession();
  if (!session) {
    return jsonError("UNAUTHENTICATED", "Silakan masuk untuk melihat riwayat penarikan.", 401);
  }

  pruneRateLimitBuckets();
  const limit = rateLimit(`withdrawal-list:${session.userId}`, 60, 60_000);
  if (!limit.allowed) {
    return jsonError(
      "RATE_LIMITED",
      `Terlalu banyak permintaan. Coba lagi dalam ${limit.retryAfterSeconds} detik.`,
      429,
    );
  }

  const url = new URL(request.url);
  const parsed = withdrawalListQuerySchema.safeParse({
    status: url.searchParams.get("status") ?? undefined,
    search: url.searchParams.get("search") ?? undefined,
    take: url.searchParams.get("take") ?? undefined,
  });
  if (!parsed.success) {
    return jsonError("VALIDATION_ERROR", "Parameter daftar tidak valid.", 422, flattenZodError(parsed.error));
  }

  try {
    const wantsAdminView = Boolean(parsed.data.status) || Boolean(parsed.data.search);
    if (wantsAdminView) {
      const actor = await requireAdminPermission("read");
      if (!actor) {
        return jsonError("FORBIDDEN", "Filter ini hanya tersedia untuk administrator.", 403);
      }
      const rows = await listWithdrawalsForAdmin({
        status: parsed.data.status,
        search: parsed.data.search,
        take: parsed.data.take ?? 50,
      });
      return jsonSuccess({ scope: "admin", rows });
    }

    const rows = await listWithdrawalsForUser(session.userId, parsed.data.take ?? 100);
    return jsonSuccess({ scope: "member", rows });
  } catch (error) {
    if (error instanceof PaymentError) {
      return jsonError(error.code, error.message, error.status);
    }
    console.error("Pembacaan riwayat penarikan gagal", error);
    return jsonError("INTERNAL_ERROR", "Tidak dapat memuat riwayat penarikan saat ini.", 500);
  }
}

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
      idempotencyKey: parsed.data.idempotencyKey ?? null,
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

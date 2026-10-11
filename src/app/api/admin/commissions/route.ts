import { Prisma } from "@prisma/client";

import { jsonError, jsonSuccess, readJsonBody } from "@/lib/api";
import { requireAdminPermission } from "@/lib/auth/admin-guard";
import { adminCommissionActionSchema, commissionListQuerySchema } from "@/lib/commission-validation";
import { pruneRateLimitBuckets, rateLimit } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/request-origin";
import { getRequestMeta } from "@/lib/security";
import { listCommissionsForAdmin } from "@/lib/services/admin-commission-service";
import { ReferralError, setReferralCommissionStatus } from "@/lib/services/referral-service";
import { flattenZodError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Referral commission settlement surface, administrator only.
 *
 * `GET` lists the queue for any administrator holding the `read` capability
 * (the same policy as the deposit and withdrawal queues), so a support or
 * compliance role can explain a payout to a member without being able to move
 * money. `POST` requires the `manageFinance` capability and delegates to
 * `setReferralCommissionStatus`, which enforces the state machine and reads the
 * administrator's role again inside the database transaction.
 *
 * "Pay" credits the beneficiary's spendable in-app balance; it is not a bank
 * transfer. A member withdraws through the manual withdrawal flow afterwards.
 */
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return jsonError("CROSS_ORIGIN", "Permintaan lintas situs ditolak.", 403);
  }

  const actor = await requireAdminPermission("manageFinance");
  if (!actor) {
    return jsonError(
      "FORBIDDEN",
      "Aksi komisi memerlukan peran administrator SUPER_ADMIN atau FINANCE.",
      403,
    );
  }

  pruneRateLimitBuckets();
  const limit = rateLimit(`admin-commissions:${actor.id}`, 120, 60_000);
  if (!limit.allowed) {
    return jsonError(
      "RATE_LIMITED",
      `Terlalu banyak permintaan. Coba lagi dalam ${limit.retryAfterSeconds} detik.`,
      429,
    );
  }

  const parsed = adminCommissionActionSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return jsonError(
      "VALIDATION_ERROR",
      "Periksa kembali kolom permintaan.",
      422,
      flattenZodError(parsed.error),
    );
  }

  const meta = await getRequestMeta();

  try {
    return jsonSuccess(
      await setReferralCommissionStatus({
        commissionId: parsed.data.commissionId,
        action: parsed.data.action,
        actorUserId: actor.id,
        reason: parsed.data.reason,
        meta,
      }),
    );
  } catch (error) {
    if (error instanceof ReferralError) {
      return jsonError(error.code, error.message, error.status);
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // P2002 = the payout ledger entry already exists for this commission;
      // P2034 = the serializable transaction lost a write conflict, so the
      // administrator simply retries against the fresh row.
      if (error.code === "P2002") {
        return jsonError("ALREADY_PAID", "Komisi ini sudah dibayar sebelumnya.", 409);
      }
      if (error.code === "P2034") {
        return jsonError(
          "WRITE_CONFLICT",
          "Komisi sedang diubah oleh permintaan lain. Muat ulang lalu coba lagi.",
          409,
        );
      }
    }
    console.error("Aksi komisi rujukan gagal", error);
    return jsonError("INTERNAL_ERROR", "Tidak dapat menyelesaikan aksi komisi saat ini.", 500);
  }
}

/**
 * Read-only commission queue for administrators: `status`, `search`, `take` and
 * `skip`. Requires only the `read` capability.
 */
export async function GET(request: Request) {
  const actor = await requireAdminPermission("read");
  if (!actor) {
    return jsonError("FORBIDDEN", "Akses administrator diperlukan.", 403);
  }

  const url = new URL(request.url);
  const parsed = commissionListQuerySchema.safeParse({
    status: url.searchParams.get("status") ?? undefined,
    search: url.searchParams.get("search") ?? undefined,
    take: url.searchParams.get("take") ?? undefined,
    skip: url.searchParams.get("skip") ?? undefined,
  });
  if (!parsed.success) {
    return jsonError("VALIDATION_ERROR", "Parameter daftar tidak valid.", 422, flattenZodError(parsed.error));
  }

  try {
    return jsonSuccess(await listCommissionsForAdmin(parsed.data));
  } catch (error) {
    console.error("Pembacaan antrean komisi gagal", error);
    return jsonError("INTERNAL_ERROR", "Tidak dapat memuat antrean komisi saat ini.", 500);
  }
}

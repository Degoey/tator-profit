import { Prisma } from "@prisma/client";

import { jsonError, jsonSuccess, readJsonBody } from "@/lib/api";
import { requireAdminPermission } from "@/lib/auth/admin-guard";
import { pruneRateLimitBuckets, rateLimit } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/request-origin";
import { getRequestMeta } from "@/lib/security";
import { LedgerError } from "@/lib/services/ledger-service";
import {
  RewardError,
  approveReward,
  generateWeeklyRewards,
  payReward,
  rejectReward,
  voidReward,
} from "@/lib/services/reward-service";
import { adminRewardActionSchema, flattenZodError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reward engine control surface, admin only.
 * A member calling a frontend API can never credit themselves: `generate` only
 * records PENDING rewards, `approve` reserves the approved amount, and `pay`
 * moves it to the spendable balance as a separate, explicit action.
 *
 * All actions touch the ledger, so they require the `manageFinance` capability
 * (SUPER_ADMIN or FINANCE); other admin roles are rejected server-side.
 */
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return jsonError("CROSS_ORIGIN", "Permintaan lintas situs ditolak.", 403);
  }

  const actor = await requireAdminPermission("manageFinance");
  if (!actor) {
    return jsonError(
      "FORBIDDEN",
      "Aksi keuangan memerlukan peran administrator SUPER_ADMIN atau FINANCE.",
      403,
    );
  }

  pruneRateLimitBuckets();
  const limit = rateLimit(`admin-rewards:${actor.id}`, 120, 60_000);
  if (!limit.allowed) {
    return jsonError("RATE_LIMITED", `Terlalu banyak permintaan. Coba lagi dalam ${limit.retryAfterSeconds} detik.`, 429);
  }

  const parsed = adminRewardActionSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return jsonError("VALIDATION_ERROR", "Periksa kembali kolom permintaan.", 422, flattenZodError(parsed.error));
  }

  const data = parsed.data;
  const meta = await getRequestMeta();

  try {
    switch (data.action) {
      case "generate":
        return jsonSuccess(await generateWeeklyRewards({
          actorUserId: actor.id,
          userProgramId: data.userProgramId,
          userId: data.userId,
          period: data.period,
          meta,
        }));
      case "approve":
        return jsonSuccess(await approveReward(data.rewardId!, actor.id, meta, data.reason));
      case "pay":
        return jsonSuccess(await payReward(data.rewardId!, actor.id, meta));
      case "reject":
        return jsonSuccess(await rejectReward(data.rewardId!, actor.id, data.reason!, meta));
      case "void":
        return jsonSuccess(await voidReward(data.rewardId!, actor.id, data.reason!, meta));
    }
  } catch (error) {
    if (error instanceof RewardError) {
      return jsonError(error.code, error.message, error.status);
    }
    if (error instanceof LedgerError) {
      return jsonError(error.code, error.message, 409);
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return jsonError("DUPLICATE_REWARD", "Periode reward ini sudah tercatat atau sudah dibayar.", 409);
    }
    console.error("Admin reward action failed", error);
    return jsonError("INTERNAL_ERROR", "Tidak dapat menyelesaikan aksi reward saat ini.", 500);
  }
}

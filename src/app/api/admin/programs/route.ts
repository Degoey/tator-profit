import { Prisma } from "@prisma/client";

import { jsonError, jsonSuccess, readJsonBody } from "@/lib/api";
import { requireAdminPermission } from "@/lib/auth/admin-guard";
import { pruneRateLimitBuckets, rateLimit } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/request-origin";
import { getRequestMeta } from "@/lib/security";
import { LedgerError } from "@/lib/services/ledger-service";
import {
  ProgramError,
  activateUserProgram,
  setUserProgramStatus,
  type MembershipAction,
} from "@/lib/services/program-service";
import { adminProgramActionSchema, flattenZodError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_ACTIONS: Record<"suspend" | "resume" | "complete" | "cancel", MembershipAction> = {
  suspend: "SUSPEND",
  resume: "RESUME",
  complete: "COMPLETE",
  cancel: "CANCEL",
};

/**
 * Admin membership actions.
 * `activate` records the funds received outside the platform and starts the
 * cycle; the other actions move the membership through its lifecycle.
 *
 * Every action here moves money or reward eligibility, so it requires the
 * `manageFinance` capability (SUPER_ADMIN or FINANCE). A plain `ADMIN` account
 * without an explicit admin role is denied.
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
  const limit = rateLimit(`admin-programs:${actor.id}`, 60, 60_000);
  if (!limit.allowed) {
    return jsonError("RATE_LIMITED", `Terlalu banyak permintaan. Coba lagi dalam ${limit.retryAfterSeconds} detik.`, 429);
  }

  const parsed = adminProgramActionSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return jsonError("VALIDATION_ERROR", "Periksa kembali kolom permintaan.", 422, flattenZodError(parsed.error));
  }

  const data = parsed.data;
  const meta = await getRequestMeta();

  try {
    if (data.action === "activate") {
      const result = await activateUserProgram({
        userProgramId: data.userProgramId,
        actorUserId: actor.id,
        confirmedAmount: data.confirmedAmount ? new Prisma.Decimal(data.confirmedAmount) : undefined,
        note: data.reason,
        meta,
      });
      return jsonSuccess(result);
    }

    const result = await setUserProgramStatus({
      userProgramId: data.userProgramId,
      action: STATUS_ACTIONS[data.action],
      actorUserId: actor.id,
      reason: data.reason,
      refundFunds: data.refundFunds,
      meta,
    });
    return jsonSuccess(result);
  } catch (error) {
    if (error instanceof ProgramError) {
      return jsonError(error.code, error.message, error.status);
    }
    if (error instanceof LedgerError) {
      return jsonError(error.code, error.message, 409);
    }
    console.error("Admin program action failed", error);
    return jsonError("INTERNAL_ERROR", "Tidak dapat menyelesaikan aksi saat ini.", 500);
  }
}

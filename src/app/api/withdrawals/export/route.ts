import { jsonError } from "@/lib/api";
import { requireAdminPermission } from "@/lib/auth/admin-guard";
import { getActiveSession } from "@/lib/auth/session";
import { buildWithdrawalCsv, csvResponseHeaders, type WithdrawalCsvRow } from "@/lib/payment-csv";
import { pruneRateLimitBuckets, rateLimit } from "@/lib/rate-limit";
import {
  PaymentError,
  listWithdrawalsForAdmin,
  listWithdrawalsForUser,
} from "@/lib/services/manual-payment-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Upper bound of rows in a single recap so the export stays memory bounded. */
const MAX_EXPORT_ROWS = 2000;

/**
 * CSV recap of withdrawals ("rekap penarikan").
 *
 * A member exports only their own history. An administrator with the `read`
 * capability receives the whole queue including the member identity. The rows
 * are rebuilt server side from the persisted model, so gross, fee and net always
 * reflect the stored amounts (legacy rows without a fee treat the gross as net,
 * exactly like the panels).
 */
export async function GET(request: Request) {
  const session = await getActiveSession();
  if (!session) {
    return jsonError("UNAUTHENTICATED", "Silakan masuk untuk mengunduh rekap penarikan.", 401);
  }

  pruneRateLimitBuckets();
  const limit = rateLimit(`withdrawal-export:${session.userId}`, 10, 60_000);
  if (!limit.allowed) {
    return jsonError(
      "RATE_LIMITED",
      `Terlalu banyak ekspor. Coba lagi dalam ${limit.retryAfterSeconds} detik.`,
      429,
    );
  }

  const requestedScope = new URL(request.url).searchParams.get("scope");
  const wantsAdminScope = requestedScope === "admin";

  try {
    let rows: WithdrawalCsvRow[];

    if (wantsAdminScope) {
      const actor = await requireAdminPermission("read");
      if (!actor) {
        return jsonError("FORBIDDEN", "Rekap seluruh antrean hanya untuk administrator.", 403);
      }
      const adminRows = await listWithdrawalsForAdmin({ take: MAX_EXPORT_ROWS });
      rows = adminRows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        amount: row.amount,
        fee: row.fee,
        netAmount: row.netAmount,
        currency: row.currency,
        method: row.method,
        destination: row.destination,
        status: row.status,
        username: row.username,
        email: row.userEmail,
      }));
    } else {
      const memberRows = await listWithdrawalsForUser(session.userId, MAX_EXPORT_ROWS);
      rows = memberRows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        amount: row.amount,
        fee: row.fee,
        netAmount: row.netAmount,
        currency: row.currency,
        method: row.method,
        destination: row.destination,
        status: row.status,
      }));
    }

    // Legacy safety net: a summary without the stored pair falls back to the
    // documented legacy rule (no retroactive fee, gross treated as net) so the
    // recap can never print an empty fee column.
    rows = rows.map((row) =>
      row.fee && row.netAmount
        ? row
        : { ...row, fee: row.fee || "0.00", netAmount: row.netAmount || row.amount },
    );

    const csv = buildWithdrawalCsv(rows);
    const fileName = `rekap-penarikan-${new Date().toISOString().slice(0, 10)}.csv`;

    return new Response(csv, { status: 200, headers: csvResponseHeaders(fileName) });
  } catch (error) {
    if (error instanceof PaymentError) {
      return jsonError(error.code, error.message, error.status);
    }
    console.error("Ekspor rekap penarikan gagal", error);
    return jsonError("INTERNAL_ERROR", "Tidak dapat membuat rekap penarikan saat ini.", 500);
  }
}

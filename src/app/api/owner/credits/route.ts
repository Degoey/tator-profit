import { Prisma } from "@prisma/client";

import { jsonError, jsonSuccess } from "@/lib/api";
import { requireOwnerApi } from "@/lib/auth/owner-guard";
import { ownerApiError, ownerRateLimit } from "@/lib/owner/api-errors";
import { MAX_JSON_BYTES, ProofError, readBoundedJsonBody } from "@/lib/payment-proof";
import { assertSameOrigin } from "@/lib/request-origin";
import { getRequestMeta } from "@/lib/security";
import { AdminCreditError, creditBalanceByAdmin } from "@/lib/services/admin-credit-service";
import { adminCreditSchema, flattenZodError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Kredit saldo dari Konsol Pemilik.
 *
 * Memakai layanan kredit administrator yang sudah ada, sehingga saldo tetap hanya
 * berubah lewat `postLedgerEntry`: satu entri ledger `ADMIN_CREDIT`, satu jejak
 * audit, satu notifikasi, semuanya dalam satu transaksi. Nomor referensi menjadi
 * kunci idempotensi, jadi menekan tombol dua kali tidak menggandakan kredit.
 */
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return jsonError("CROSS_ORIGIN", "Permintaan lintas situs ditolak.", 403);
  }

  try {
    const actor = await requireOwnerApi();
    const limited = ownerRateLimit("credits", actor.id, 30, 60_000);
    if (limited) return limited;

    let body: unknown;
    try {
      body = await readBoundedJsonBody(request, MAX_JSON_BYTES);
    } catch (error) {
      if (error instanceof ProofError) return jsonError(error.code, error.message, error.status);
      throw error;
    }

    const parsed = adminCreditSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        "VALIDATION_ERROR",
        "Periksa kembali kolom kredit.",
        422,
        flattenZodError(parsed.error),
      );
    }

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
    if (error instanceof AdminCreditError) {
      return jsonError(error.code, error.message, error.status);
    }
    return ownerApiError(error, "Kredit saldo tidak dapat diproses saat ini.");
  }
}

import { Prisma } from "@prisma/client";

import { commissionListQuerySchema } from "@/lib/commission-validation";
import { prisma } from "@/lib/prisma";

/**
 * Referral commission queue for the admin panel (G2).
 *
 * Read-only: the caller decides whether the signed-in administrator is allowed
 * to see it (`read`), while changing a commission goes through
 * `setReferralCommissionStatus`, which re-checks the `manageFinance` capability
 * inside its own transaction. Amounts are returned as fixed 2-decimal strings,
 * exactly like the member facing `listReferralCommissions`, so no `Decimal`
 * crosses into a React prop.
 */
export async function listCommissionsForAdmin(
  input: { status?: string; search?: string; take?: number; skip?: number } = {},
) {
  const query = commissionListQuerySchema.parse(input);
  const contains = { contains: query.search, mode: Prisma.QueryMode.insensitive };
  const where: Prisma.ReferralCommissionWhereInput = {
    status: query.status,
    // The uuid `id` column has no LIKE filter in Prisma, so free text search
    // covers the human readable columns only: reference, usernames, names.
    ...(query.search
      ? {
          OR: [
            { sourceReference: contains },
            { beneficiary: { username: contains } },
            { beneficiary: { name: contains } },
            { sourceUser: { username: contains } },
          ],
        }
      : {}),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.referralCommission.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.take,
      skip: query.skip,
      select: {
        id: true,
        level: true,
        status: true,
        rate: true,
        baseAmount: true,
        commissionAmount: true,
        currency: true,
        sourceReference: true,
        createdAt: true,
        approvedAt: true,
        paidAt: true,
        beneficiary: { select: { name: true, username: true } },
        sourceUser: { select: { username: true } },
        payoutTransaction: { select: { reference: true } },
      },
    }),
    // `total` counts every matching row, not just the page, so the panel can show
    // an honest queue depth while rendering a bounded list.
    prisma.referralCommission.count({ where }),
  ]);

  return {
    rows: rows.map((row) => ({
      id: row.id,
      level: row.level,
      status: row.status,
      rate: row.rate.toFixed(4),
      baseAmount: row.baseAmount.toFixed(2),
      commissionAmount: row.commissionAmount.toFixed(2),
      currency: row.currency,
      sourceReference: row.sourceReference,
      beneficiaryName: row.beneficiary.name,
      beneficiaryUsername: row.beneficiary.username,
      sourceUsername: row.sourceUser.username,
      createdAt: row.createdAt,
      approvedAt: row.approvedAt,
      paidAt: row.paidAt,
      payoutReference: row.payoutTransaction?.reference ?? null,
    })),
    total,
    take: query.take,
    skip: query.skip,
  };
}

export type AdminCommissionListRow = Awaited<ReturnType<typeof listCommissionsForAdmin>>["rows"][number];

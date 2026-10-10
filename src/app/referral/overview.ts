import { referralLevelLabel } from "@/lib/config/referral";
import { sumMoney } from "@/lib/money";
import { getRebateRates } from "@/lib/rebate-config";
import type { ReferralNetwork } from "@/lib/referral-network";
import {
  getReferralNetwork,
  getReferralNetworkMembers,
  listReferralCommissions,
} from "@/lib/services/referral-service";
import { referralCommissionStatusLabel } from "@/components/referral/commission-status";
import { statusLabel } from "@/lib/status-labels";

/**
 * Data loading for the referral page and its API.
 *
 * Only the signed-in account is ever used as the network root. Commission rows
 * are read through the shared referral service, which always filters by
 * `beneficiaryUserId`, so this module can never widen the scope of a query.
 */

const MAX_COMMISSION_ROWS = 200;

/** Label shown when a network member has no program membership at all. */
const NO_PROGRAM_LABEL = "Belum gabung program";

export interface ReferralLevelRow {
  level: number;
  label: string;
  /** Display rate, e.g. `10%`. */
  rate: string;
  /** Members recorded in the network tree at this generation. */
  members: number;
  commissionCount: number;
  /** Sum of commission amounts at this level, fixed to 2 decimals. */
  commissionTotal: string;
  currency: string;
}

export interface ReferralCommissionRow {
  id: string;
  level: number;
  /** Commission value (`commissionAmount`), fixed to 2 decimals. */
  amount: string;
  /** Configured level rate, 4 decimals. */
  rate: string;
  /** Source program value the commission was computed from, 2 decimals. */
  baseAmount: string;
  currency: string;
  status: string;
  statusLabel: string;
  sourceUsername: string;
  /** Reference of the posted ledger entry that triggered the commission. */
  sourceReference: string;
  createdAt: Date;
}

export interface ReferralTotals {
  pending: string;
  approved: string;
  paid: string;
  rejected: string;
  voided: string;
  currency: string;
  count: number;
}

export interface ReferralMemberRow {
  userId: string;
  username: string;
  /** Generation relative to the signed-in account (1..5). */
  level: number;
  /** When the member account was created. */
  joinedAt: Date;
  programName: string | null;
  programTierCode: string | null;
  programStatus: string | null;
  programStatusLabel: string;
  programJoinAmount: string | null;
  commissionCount: number;
  commissionPending: string;
  commissionApproved: string;
  commissionPaid: string;
  commissionTotal: string;
  currency: string;
}

export interface ReferralOverview {
  referralCode: string | null;
  network: ReferralNetwork;
  levels: ReferralLevelRow[];
  commissions: ReferralCommissionRow[];
  totals: ReferralTotals;
  /** One row per network member: account, level, join date, program, status, commission. */
  members: ReferralMemberRow[];
}

export interface ReferralOverviewInput {
  id: string;
  username: string;
  referralCode: string | null;
}

export async function loadReferralOverview(user: ReferralOverviewInput): Promise<ReferralOverview> {
  const [network, commissionRows, memberRows, rebateRates] = await Promise.all([
    getReferralNetwork({ id: user.id, username: user.username }),
    listReferralCommissions(user.id, MAX_COMMISSION_ROWS),
    getReferralNetworkMembers(user.id),
    // The live rebate configuration, so this page shows the percentages an
    // administrator actually saved instead of the compiled-in defaults.
    getRebateRates(),
  ]);

  const currency = commissionRows[0]?.currency ?? "USDT";

  const levels: ReferralLevelRow[] = rebateRates.map((entry) => {
    const rows = commissionRows.filter((row) => row.level === entry.generation);
    return {
      level: entry.generation,
      label: referralLevelLabel(entry.generation),
      rate: entry.displayRate,
      members: network.counts[entry.generation - 1] ?? 0,
      commissionCount: rows.length,
      commissionTotal: sumMoney(rows.map((row) => row.commissionAmount)).toFixed(2),
      currency,
    };
  });

  const sumForStatus = (status: string): string =>
    sumMoney(
      commissionRows.filter((row) => row.status === status).map((row) => row.commissionAmount),
    ).toFixed(2);

  return {
    referralCode: user.referralCode,
    network,
    levels,
    commissions: commissionRows.map((row) => ({
      id: row.id,
      level: row.level,
      amount: row.commissionAmount,
      rate: row.rate,
      baseAmount: row.baseAmount,
      currency: row.currency,
      status: row.status,
      statusLabel: referralCommissionStatusLabel(row.status),
      sourceUsername: row.sourceUsername,
      sourceReference: row.sourceReference,
      createdAt: row.createdAt,
    })),
    totals: {
      pending: sumForStatus("PENDING"),
      approved: sumForStatus("APPROVED"),
      paid: sumForStatus("PAID"),
      rejected: sumForStatus("REJECTED"),
      voided: sumForStatus("VOID"),
      currency,
      count: commissionRows.length,
    },
    members: memberRows.map((member) => ({
      userId: member.userId,
      username: member.username,
      level: member.level,
      joinedAt: member.joinedAt,
      programName: member.programName,
      programTierCode: member.programTierCode,
      programStatus: member.programStatus,
      programStatusLabel: member.programStatus
        ? statusLabel(member.programStatus)
        : NO_PROGRAM_LABEL,
      programJoinAmount: member.programJoinAmount,
      commissionCount: member.commission.count,
      commissionPending: member.commission.pending,
      commissionApproved: member.commission.approved,
      commissionPaid: member.commission.paid,
      commissionTotal: member.commission.total,
      currency: member.commission.currency,
    })),
  };
}

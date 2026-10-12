import { Prisma } from "@prisma/client";

import { assertMoney, toMoney } from "@/lib/services/trading-calculation";
import { lossHandlingLabel, type ProfitSharePolicyInput } from "@/lib/services/profit-share-config";

/**
 * Mesin alokasi hasil — murni, tanpa database.
 *
 * Aturan yang mengikat (lihat docs/profit-trading-module-audit-and-plan.md §5):
 *  1. Net hasil TIDAK otomatis menjadi hak anggota.
 *  2. Selama kebijakan bagi hasil belum disetujui pemilik, alokasi = 0 dan
 *     alasannya dilaporkan apa adanya — tidak ada persentase karangan.
 *  3. Periode rugi tidak pernah menghasilkan profit anggota otomatis.
 *  4. Invarian: Σ alokasi ≤ jumlah yang tersedia untuk dibagi.
 */

export interface DistributableInput {
  netPnl: Prisma.Decimal;
  policy: ProfitSharePolicyInput;
}

export interface DistributablePreview {
  managementFeeAmount: Prisma.Decimal;
  reserveAmount: Prisma.Decimal;
  distributableAmount: Prisma.Decimal;
  memberPoolAmount: Prisma.Decimal;
}

export interface DistributableResult {
  netPnl: Prisma.Decimal;
  isLoss: boolean;
  managementFeeAmount: Prisma.Decimal;
  reserveAmount: Prisma.Decimal;
  distributableAmount: Prisma.Decimal;
  memberPoolAmount: Prisma.Decimal;
  /** true bila hak anggota belum boleh dihitung (kebijakan/kerugian). */
  blocked: boolean;
  blockers: string[];
  /**
   * Angka yang akan muncul BILA kebijakan disetujui. Hanya terisi saat ketiga rasio
   * sudah ada; ini alat pratinjau admin, bukan dasar pembayaran.
   */
  preview: DistributablePreview | null;
  reason: string;
}

function buildPreview(netPnl: Prisma.Decimal, policy: ProfitSharePolicyInput): DistributablePreview | null {
  const { memberShareRate, reserveRate, managementFeeRate } = policy;
  if (!memberShareRate || !reserveRate || !managementFeeRate) return null;
  if (netPnl.isNegative()) return null;

  const managementFeeAmount = toMoney(netPnl.times(managementFeeRate));
  const reserveAmount = toMoney(netPnl.times(reserveRate));
  const distributableAmount = toMoney(netPnl.minus(managementFeeAmount).minus(reserveAmount));
  const memberPoolAmount = toMoney(distributableAmount.times(memberShareRate));

  // Rasio yang salah (cadangan + biaya > 100%) menghasilkan angka negatif; itu
  // bukan pratinjau yang boleh ditampilkan ke admin.
  if (distributableAmount.isNegative() || memberPoolAmount.isNegative()) return null;

  return { managementFeeAmount, reserveAmount, distributableAmount, memberPoolAmount };
}

/**
 * Menghitung berapa yang boleh dibagi dan berapa yang menjadi hak anggota.
 *
 * `blocked: true` berarti `memberPoolAmount` sengaja 0 dan alasan wajib
 * ditampilkan apa adanya (kebijakan belum disetujui atau periode rugi).
 */
export function computeDistributableAmount(input: DistributableInput): DistributableResult {
  const netPnl = assertMoney(input.netPnl, "Net Trading P&L");
  const { policy } = input;
  const blockers: string[] = [];
  const preview = buildPreview(netPnl, policy);

  if (netPnl.isNegative()) {
    blockers.push(
      `Periode trading mengalami kerugian neto ${netPnl.toFixed(2)}; tidak ada profit anggota untuk periode ini.`,
    );
    blockers.push(`Penanganan kerugian: ${lossHandlingLabel(policy.lossHandling)}.`);
  }

  if (policy.status !== "APPROVED") {
    blockers.push(
      `Kebijakan bagi hasil berstatus ${policy.status}; angka pembagian menunggu persetujuan pemilik.`,
    );
  } else if (
    policy.memberShareRate === null ||
    policy.reserveRate === null ||
    policy.managementFeeRate === null
  ) {
    blockers.push("Kebijakan bagi hasil disetujui tetapi angkanya belum lengkap.");
  } else if (policy.reserveRate.plus(policy.managementFeeRate).gt(1)) {
    blockers.push("Total cadangan dan biaya pengelolaan melebihi 100% dari net P&L.");
  }

  if (blockers.length > 0) {
    return {
      netPnl,
      isLoss: netPnl.isNegative(),
      managementFeeAmount: new Prisma.Decimal(0),
      reserveAmount: new Prisma.Decimal(0),
      distributableAmount: new Prisma.Decimal(0),
      memberPoolAmount: new Prisma.Decimal(0),
      blocked: true,
      blockers,
      preview,
      reason: blockers.join(" "),
    };
  }

  const managementFeeAmount = toMoney(netPnl.times(policy.managementFeeRate as Prisma.Decimal));
  const reserveAmount = toMoney(netPnl.times(policy.reserveRate as Prisma.Decimal));
  const distributableAmount = toMoney(netPnl.minus(managementFeeAmount).minus(reserveAmount));
  const memberPoolAmount = toMoney(distributableAmount.times(policy.memberShareRate as Prisma.Decimal));

  if (memberPoolAmount.gt(distributableAmount)) {
    throw new RangeError("Hak anggota tidak boleh melebihi jumlah yang tersedia untuk dibagi.");
  }

  return {
    netPnl,
    isLoss: false,
    managementFeeAmount,
    reserveAmount,
    distributableAmount,
    memberPoolAmount,
    blocked: false,
    blockers: [],
    preview,
    reason: "Kebijakan bagi hasil sudah disetujui pemilik; hak anggota dihitung dari net P&L.",
  };
}

export interface MemberShareBasis {
  memberId: string;
  /** Dasar pembagian (mis. jumlah modal anggota yang disetujui). */
  basis: Prisma.Decimal;
}

export interface MemberShareAllocation {
  memberId: string;
  basis: Prisma.Decimal;
  amount: Prisma.Decimal;
}

export interface MemberShareResult {
  allocations: MemberShareAllocation[];
  allocatedTotal: Prisma.Decimal;
  unallocated: Prisma.Decimal;
  reason: string | null;
}

/**
 * Membagi `memberPool` secara proporsional terhadap `basis` setiap anggota.
 *
 * Pembulatan memakai metode sisa terbesar sehingga jumlah seluruh hak anggota
 * **tepat sama** dengan `memberPool` (tidak ada satu sen pun yang hilang atau
 * tercipta). Anggota tanpa dasar pembagian menerima 0,00.
 */
export function allocateMemberShares(input: {
  memberPool: Prisma.Decimal;
  members: readonly MemberShareBasis[];
}): MemberShareResult {
  const memberPool = assertMoney(input.memberPool, "Jumlah yang dibagi ke anggota");
  if (memberPool.isNegative()) {
    throw new RangeError("Jumlah yang dibagi ke anggota tidak boleh negatif.");
  }

  const rows = input.members.map((member, index) => ({
    index,
    memberId: member.memberId,
    basis: assertMoney(member.basis, `Dasar pembagian ${member.memberId}`),
    amount: new Prisma.Decimal(0),
    remainder: new Prisma.Decimal(0),
  }));

  for (const row of rows) {
    if (row.basis.isNegative()) {
      throw new RangeError(`Dasar pembagian ${row.memberId} tidak boleh negatif.`);
    }
  }

  const totalBasis = rows.reduce(
    (sum, row) => sum.plus(row.basis),
    new Prisma.Decimal(0),
  );

  if (memberPool.isZero() || totalBasis.isZero()) {
    return {
      allocations: rows.map((row) => ({
        memberId: row.memberId,
        basis: row.basis,
        amount: new Prisma.Decimal(0),
      })),
      allocatedTotal: new Prisma.Decimal(0),
      unallocated: memberPool,
      reason: memberPool.isZero()
        ? "Tidak ada hasil yang dibagi pada periode ini."
        : "Tidak ada anggota dengan dasar pembagian di atas nol.",
    };
  }

  let assigned = new Prisma.Decimal(0);
  for (const row of rows) {
    const raw = memberPool.times(row.basis).div(totalBasis);
    const floor = raw.toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
    row.amount = floor;
    row.remainder = raw.minus(floor);
    assigned = assigned.plus(floor);
  }

  const cents = memberPool
    .minus(assigned)
    .times(100)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();

  const ordered = [...rows].sort((a, b) => {
    const byRemainder = b.remainder.comparedTo(a.remainder);
    if (byRemainder !== 0) return byRemainder;
    const byBasis = b.basis.comparedTo(a.basis);
    if (byBasis !== 0) return byBasis;
    return a.index - b.index;
  });

  for (let i = 0; i < cents; i += 1) {
    const target = ordered[i % ordered.length];
    if (!target) break;
    target.amount = target.amount.plus("0.01");
  }

  const allocations = [...rows]
    .sort((a, b) => a.index - b.index)
    .map((row) => ({
      memberId: row.memberId,
      basis: row.basis,
      amount: toMoney(row.amount),
    }));

  const allocatedTotal = allocations.reduce(
    (sum, item) => sum.plus(item.amount),
    new Prisma.Decimal(0),
  );

  if (allocatedTotal.gt(memberPool)) {
    throw new RangeError("Total hak anggota melebihi jumlah yang tersedia untuk dibagi.");
  }

  return {
    allocations,
    allocatedTotal: toMoney(allocatedTotal),
    unallocated: toMoney(memberPool.minus(allocatedTotal)),
    reason: null,
  };
}

/**
 * Invarian wajib sebelum hak anggota disimpan: total alokasi tidak boleh melebihi
 * jumlah yang dibagi. Dipakai service sebagai penjaga terakhir sebelum menulis.
 */
export function assertAllocationInvariant(
  memberPool: Prisma.Decimal,
  allocatedTotal: Prisma.Decimal,
): void {
  const pool = assertMoney(memberPool, "Jumlah yang dibagi ke anggota");
  const allocated = assertMoney(allocatedTotal, "Total hak anggota");
  if (allocated.gt(pool)) {
    throw new RangeError(
      `Total hak anggota ${allocated.toFixed(2)} melebihi jumlah yang dibagi ${pool.toFixed(2)}.`,
    );
  }
}


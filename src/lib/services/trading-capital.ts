import {
  Prisma,
  type CapitalContributionStatus,
  type CapitalMovementType,
  type CapitalOwnerType,
} from "@prisma/client";

import {
  CAPITAL_CONTRIBUTION_STATUSES,
  CAPITAL_MOVEMENT_TYPES,
  CAPITAL_OWNER_TYPES,
  CAPITAL_PROFIT_BASIS_NOTICE,
} from "@/lib/config/trading";
import { assertMoney, toMoney } from "@/lib/services/trading-calculation";

/**
 * Pencatatan sumber modal (Tahap 2) — murni, tanpa database.
 *
 * Aturan yang mengikat:
 *  1. Modal dicatat **per sumber** (perusahaan atau anggota) dan tidak pernah digabung
 *     dalam satu angka.
 *  2. Modal **tidak** menentukan hak profit dengan sendirinya. Dasar pembagian selalu
 *     berasal dari perjanjian bagi hasil yang sudah disetujui; berkas ini tidak pernah
 *     menghitung hak anggota dari modal.
 *  3. Arah nilai ditentukan `movementType`, bukan tanda angka: ALLOCATION dan
 *     WITHDRAWAL selalu positif, REVERSAL positif dan membatalkan pergerakan lain,
 *     sedangkan ADJUSTMENT boleh negatif sebagai saluran koreksi yang eksplisit.
 *  4. Riwayat bersifat append-only: pembatalan memakai baris REVERSAL yang menunjuk
 *     pergerakan asal, bukan pengubahan atau penghapusan baris lama.
 *  5. Invarian: modal terpakai per pencatatan tidak boleh negatif (tidak ada penarikan
 *     melebihi modal yang dicatat).
 */

export interface CapitalContributionInput {
  id: string;
  ownerType: CapitalOwnerType;
  memberUserId?: string | null;
  amount: Prisma.Decimal;
  status: CapitalContributionStatus;
  /** Nomor bukti/dokumen sumber; dipakai sebagai kunci anti-duplikat di database. */
  reference: string;
}

export interface CapitalMovementInput {
  id: string;
  contributionId: string;
  movementType: CapitalMovementType;
  amount: Prisma.Decimal;
  reason: string;
  reference: string;
  revertsMovementId?: string | null;
}

export interface CapitalValidationResult {
  valid: boolean;
  errors: string[];
}

/** Memeriksa satu pencatatan modal sebelum disimpan. */
export function validateCapitalContribution(
  input: CapitalContributionInput,
): CapitalValidationResult {
  const errors: string[] = [];

  if (!(CAPITAL_OWNER_TYPES as readonly string[]).includes(input.ownerType)) {
    errors.push(`Jenis pemilik modal "${input.ownerType}" tidak dikenal.`);
  }

  if (!(CAPITAL_CONTRIBUTION_STATUSES as readonly string[]).includes(input.status)) {
    errors.push(`Status pencatatan modal "${input.status}" tidak dikenal.`);
  }

  if (input.reference.trim().length === 0) {
    errors.push("Nomor bukti/dokumen sumber modal wajib diisi.");
  }

  try {
    const amount = assertMoney(input.amount, "Nominal modal");
    if (!amount.gt(0)) {
      errors.push("Nominal modal harus lebih besar dari nol.");
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  if (input.ownerType === "MEMBER" && !input.memberUserId) {
    errors.push("Modal anggota wajib menyertakan anggota pemiliknya.");
  }
  if (input.ownerType === "COMPANY" && input.memberUserId) {
    errors.push("Modal perusahaan tidak boleh dihubungkan ke akun anggota.");
  }

  return { valid: errors.length === 0, errors };
}

/** Memeriksa satu pergerakan modal sebelum disimpan. */
export function validateCapitalMovement(input: CapitalMovementInput): CapitalValidationResult {
  const errors: string[] = [];

  if (!(CAPITAL_MOVEMENT_TYPES as readonly string[]).includes(input.movementType)) {
    errors.push(`Jenis pergerakan modal "${input.movementType}" tidak dikenal.`);
  }

  if (input.reason.trim().length === 0) {
    errors.push("Alasan pergerakan modal wajib diisi supaya dapat diaudit.");
  }

  if (input.reference.trim().length === 0) {
    errors.push("Nomor bukti pergerakan modal wajib diisi.");
  }

  try {
    const amount = assertMoney(input.amount, "Nominal pergerakan modal");
    if (input.movementType === "ADJUSTMENT") {
      if (amount.isZero()) {
        errors.push("Penyesuaian modal tidak boleh bernilai nol.");
      }
    } else if (!amount.gt(0)) {
      errors.push(
        `Nominal ${input.movementType} harus lebih besar dari nol (arah nilai ditentukan jenis pergerakan).`,
      );
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  const reverts = input.revertsMovementId?.trim() ?? "";
  if (input.movementType === "REVERSAL" && reverts.length === 0) {
    errors.push("Pembatalan pergerakan wajib menunjuk pergerakan yang dibatalkan.");
  }
  if (input.movementType !== "REVERSAL" && reverts.length > 0) {
    errors.push("Hanya pergerakan REVERSAL yang boleh menunjuk pergerakan yang dibatalkan.");
  }

  return { valid: errors.length === 0, errors };
}
export interface CapitalContributionSummary {
  contributionId: string;
  ownerType: CapitalOwnerType;
  memberUserId: string | null;
  /** Nominal pencatatan asli. */
  recorded: Prisma.Decimal;
  /** Modal terpakai setelah pergerakan dan pembatalan. */
  allocated: Prisma.Decimal;
  status: CapitalContributionStatus;
  movementCount: number;
  /** true bila baris ini tidak dipakai perhitungan apa pun (mis. REJECTED). */
  excluded: boolean;
}

export interface CapitalSummary {
  contributions: CapitalContributionSummary[];
  companyTotal: Prisma.Decimal;
  memberTotal: Prisma.Decimal;
  total: Prisma.Decimal;
  byMember: Array<{ memberUserId: string; total: Prisma.Decimal }>;
  /** Pergerakan yang dibatalkan baris REVERSAL dan karena itu tidak dijumlahkan. */
  revertedMovementIds: string[];
  errors: string[];
}

export interface CapitalSummaryInput {
  contributions: readonly CapitalContributionInput[];
  movements: readonly CapitalMovementInput[];
}

/** Arah nilai ditentukan jenis pergerakan, bukan tanda angka. */
function signedMovement(movement: CapitalMovementInput): Prisma.Decimal {
  if (movement.movementType === "WITHDRAWAL") return toMoney(movement.amount.negated());
  if (movement.movementType === "ALLOCATION") return toMoney(movement.amount);
  if (movement.movementType === "ADJUSTMENT") return toMoney(movement.amount);
  return new Prisma.Decimal(0);
}

/**
 * Menghitung modal terpakai per pencatatan dan totalnya, terpisah antara modal
 * perusahaan dan modal anggota. Baris `REJECTED` tidak dihitung, dan pergerakan yang
 * sudah dibatalkan (REVERSAL) dikeluarkan dari penjumlahan — sehingga angka ini selalu
 * dapat direproduksi ulang dari riwayat.
 */
export function summarizeCapital(input: CapitalSummaryInput): CapitalSummary {
  const errors: string[] = [];
  const movementById = new Map(input.movements.map((movement) => [movement.id, movement]));
  const revertedMovementIds: string[] = [];

  for (const movement of input.movements) {
    const validation = validateCapitalMovement(movement);
    if (!validation.valid) {
      errors.push(`${movement.reference}: ${validation.errors.join(" ")}`);
    }
    if (movement.movementType !== "REVERSAL") continue;

    const targetId = movement.revertsMovementId ?? "";
    const target = movementById.get(targetId);
    if (!target) {
      errors.push(`Pembatalan ${movement.reference} menunjuk pergerakan yang tidak ada (${targetId}).`);
      continue;
    }
    if (target.movementType === "REVERSAL") {
      errors.push(`Pembatalan ${movement.reference} tidak boleh membatalkan pembatalan lain.`);
      continue;
    }
    if (revertedMovementIds.includes(targetId)) {
      errors.push(`Pergerakan ${targetId} sudah dibatalkan lebih dari sekali.`);
      continue;
    }
    revertedMovementIds.push(targetId);
  }

  const contributionIds = new Set(input.contributions.map((contribution) => contribution.id));
  for (const movement of input.movements) {
    if (!contributionIds.has(movement.contributionId)) {
      errors.push(`Pergerakan ${movement.reference} menunjuk pencatatan modal yang tidak ada.`);
    }
  }

  const summaries: CapitalContributionSummary[] = [];

  for (const contribution of input.contributions) {
    const validation = validateCapitalContribution(contribution);
    if (!validation.valid) {
      errors.push(`${contribution.reference}: ${validation.errors.join(" ")}`);
    }

    const rows = input.movements.filter((movement) => movement.contributionId === contribution.id);
    let allocated = toMoney(contribution.amount);

    for (const movement of rows) {
      if (movement.movementType === "REVERSAL") continue;
      if (revertedMovementIds.includes(movement.id)) continue;
      allocated = toMoney(allocated.plus(signedMovement(movement)));
    }

    if (allocated.isNegative()) {
      errors.push(
        `Modal terpakai ${contribution.reference} menjadi negatif (${allocated.toFixed(2)}); penarikan melebihi modal yang dicatat.`,
      );
    }

    summaries.push({
      contributionId: contribution.id,
      ownerType: contribution.ownerType,
      memberUserId: contribution.memberUserId ?? null,
      recorded: toMoney(contribution.amount),
      allocated,
      status: contribution.status,
      movementCount: rows.length,
      excluded: contribution.status === "REJECTED",
    });
  }

  const active = summaries.filter((row) => !row.excluded);
  const sum = (rows: readonly CapitalContributionSummary[]): Prisma.Decimal =>
    toMoney(rows.reduce((total, row) => total.plus(row.allocated), new Prisma.Decimal(0)));

  const companyTotal = sum(active.filter((row) => row.ownerType === "COMPANY"));
  const memberRows = active.filter((row) => row.ownerType === "MEMBER");
  const memberTotal = sum(memberRows);

  const byMemberMap = new Map<string, Prisma.Decimal>();
  for (const row of memberRows) {
    const key = row.memberUserId ?? "";
    byMemberMap.set(key, toMoney((byMemberMap.get(key) ?? new Prisma.Decimal(0)).plus(row.allocated)));
  }

  return {
    contributions: summaries,
    companyTotal,
    memberTotal,
    total: toMoney(companyTotal.plus(memberTotal)),
    byMember: [...byMemberMap.entries()].map(([memberUserId, total]) => ({ memberUserId, total })),
    revertedMovementIds,
    errors,
  };
}

/**
 * Penjaga terakhir sebelum angka modal dipakai: tidak boleh ada kesalahan pencatatan
 * dan modal terpakai tidak boleh negatif.
 */
export function assertCapitalInvariant(summary: CapitalSummary): void {
  if (summary.errors.length > 0) {
    throw new RangeError(`Pencatatan modal belum konsisten: ${summary.errors.join(" ")}`);
  }
  if (summary.total.isNegative()) {
    throw new RangeError("Total modal tidak boleh negatif.");
  }
  const expected = toMoney(summary.companyTotal.plus(summary.memberTotal));
  if (!summary.total.equals(expected)) {
    throw new RangeError("Total modal tidak sama dengan jumlah modal perusahaan dan anggota.");
  }
}

/** Teks tetap: modal tidak menentukan hak profit (lihat config/trading.ts). */
export function capitalProfitBasisNotice(): string {
  return CAPITAL_PROFIT_BASIS_NOTICE;
}

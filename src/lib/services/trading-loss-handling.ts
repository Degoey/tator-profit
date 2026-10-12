import { Prisma } from "@prisma/client";

import {
  LOSS_HANDLING_LABELS,
  LOSS_HANDLING_OPTIONS,
  validateProfitAgreement,
  type LossHandlingOption,
  type ProfitAgreementInput,
} from "@/lib/services/profit-share-config";
import { assertMoney } from "@/lib/services/trading-calculation";

/**
 * Penanganan kerugian trading (Tahap 5) — murni, tanpa database.
 *
 * Aturan yang mengikat:
 *  1. Kerugian aktual **dicatat terpisah** sebagai `lossAmount` (selalu positif),
 *     bukan disembunyikan di dalam angka profit.
 *  2. Ketentuan yang berlaku atas kerugian hanya boleh diambil dari **perjanjian
 *     yang sudah disetujui pemilik**. Bila perjanjian belum lengkap/disetujui,
 *     hasilnya `RULES_NOT_CONFIGURED`: kerugian tetap dicatat, tetapi tidak
 *     dipindahkan ke siapa pun.
 *  3. Kerugian **tidak pernah** dibebankan ke anggota: tidak ada pemotongan modal
 *     anggota, tidak ada utang anggota, dan pembagian hasil periode ini = 0.
 *     `memberLossCharged` dan `memberPrincipalReduction` karena itu selalu 0 dan
 *     dijaga oleh `assertNoMemberLossCharge`.
 */

export const LOSS_ASSESSMENT_STATUSES = [
  "NOT_APPLICABLE",
  "RULES_NOT_CONFIGURED",
  "RECORDED",
] as const;

export type LossAssessmentStatus = (typeof LOSS_ASSESSMENT_STATUSES)[number];

export const LOSS_ASSESSMENT_STATUS_LABELS: Record<LossAssessmentStatus, string> = {
  NOT_APPLICABLE: "Periode untung/impas",
  RULES_NOT_CONFIGURED: "Aturan penanganan kerugian belum tertulis",
  RECORDED: "Kerugian dicatat sesuai perjanjian",
};

export interface LossAssessmentInput {
  netPnl: Prisma.Decimal;
  agreement: ProfitAgreementInput | null;
}

export interface LossAssessment {
  isLoss: boolean;
  /** Selalu positif; 0 bila periode tidak merugi. */
  lossAmount: Prisma.Decimal;
  status: LossAssessmentStatus;
  statusLabel: string;
  /** Ketentuan perjanjian yang dipakai; null bila belum ada ketentuan tertulis. */
  appliedHandling: LossHandlingOption | null;
  /** Hanya terisi bila perjanjian yang disetujui mengatur carry-forward. */
  carriedForwardLossAmount: Prisma.Decimal;
  /** true bila perjanjian mengatur pembagian ditahan sampai periode berikutnya. */
  holdDistribution: boolean;
  /** true bila perjanjian menetapkan kerugian ditanggung perusahaan. */
  absorbedByCompany: boolean;
  /** Selalu 0. Tidak ada jalur kode yang boleh mengisi angka ini. */
  memberLossCharged: Prisma.Decimal;
  /** Selalu 0. Modal anggota tidak pernah dikurangi karena kerugian. */
  memberPrincipalReduction: Prisma.Decimal;
  note: string;
}

const ZERO = () => new Prisma.Decimal(0);

/** Nilai yang selalu nol; diekspor agar service memakai angka yang sama. */
export const NO_LOSS_CHARGE = "0.00";

export function assessLossPeriod(input: LossAssessmentInput): LossAssessment {
  const netPnl = assertMoney(input.netPnl, "Net Trading P&L");

  if (!netPnl.isNegative()) {
    return {
      isLoss: false,
      lossAmount: ZERO(),
      status: "NOT_APPLICABLE",
      statusLabel: LOSS_ASSESSMENT_STATUS_LABELS.NOT_APPLICABLE,
      appliedHandling: null,
      carriedForwardLossAmount: ZERO(),
      holdDistribution: false,
      absorbedByCompany: false,
      memberLossCharged: ZERO(),
      memberPrincipalReduction: ZERO(),
      note: "Periode ini tidak mengalami kerugian neto.",
    };
  }

  const lossAmount = netPnl.abs();
  const agreementValid =
    input.agreement !== null && validateProfitAgreement(input.agreement).valid;
  const handling =
    input.agreement?.lossHandling !== null &&
    input.agreement?.lossHandling !== undefined &&
    (LOSS_HANDLING_OPTIONS as readonly string[]).includes(input.agreement.lossHandling)
      ? (input.agreement.lossHandling as LossHandlingOption)
      : null;

  if (!agreementValid || handling === null) {
    return {
      isLoss: true,
      lossAmount,
      status: "RULES_NOT_CONFIGURED",
      statusLabel: LOSS_ASSESSMENT_STATUS_LABELS.RULES_NOT_CONFIGURED,
      appliedHandling: null,
      carriedForwardLossAmount: ZERO(),
      holdDistribution: false,
      absorbedByCompany: false,
      memberLossCharged: ZERO(),
      memberPrincipalReduction: ZERO(),
      note: `Kerugian ${lossAmount.toFixed(2)} dicatat apa adanya. Belum ada ketentuan tertulis yang disetujui, jadi kerugian tidak dibebankan ke anggota maupun ditarik dari modal anggota.`,
    };
  }

  return {
    isLoss: true,
    lossAmount,
    status: "RECORDED",
    statusLabel: LOSS_ASSESSMENT_STATUS_LABELS.RECORDED,
    appliedHandling: handling,
    carriedForwardLossAmount: handling === "CARRY_FORWARD" ? lossAmount : ZERO(),
    holdDistribution: handling === "HOLD",
    absorbedByCompany: handling === "ABSORB_BY_COMPANY",
    memberLossCharged: ZERO(),
    memberPrincipalReduction: ZERO(),
    note: `Kerugian ${lossAmount.toFixed(2)} ditangani menurut perjanjian: ${
      LOSS_HANDLING_LABELS[handling] ?? handling
    }. Tidak ada pembagian hasil dan tidak ada beban kerugian ke anggota pada periode ini.`,
  };
}

/**
 * Penjaga terakhir: modul ini tidak boleh menghasilkan pembebanan kerugian ke
 * anggota. Dipakai service sebelum menyimpan laporan.
 */
export function assertNoMemberLossCharge(result: LossAssessment): void {
  if (result.memberLossCharged.gt(0) || result.memberPrincipalReduction.gt(0)) {
    throw new RangeError(
      "Kerugian tidak boleh dibebankan ke anggota (tidak ada pemotongan modal atau utang anggota).",
    );
  }
}

/** Alasan kerugian belum bisa diselesaikan, atau null bila sudah sesuai aturan. */
export function lossHandlingGap(result: LossAssessment): string | null {
  if (!result.isLoss) return null;
  if (result.status === "RULES_NOT_CONFIGURED") {
    return "Ketentuan penanganan kerugian belum tertulis pada perjanjian yang disetujui.";
  }
  return null;
}

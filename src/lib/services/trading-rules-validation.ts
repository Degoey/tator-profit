import { Prisma, type TradingSourceType } from "@prisma/client";

import {
  LOSS_HANDLING_OPTIONS,
  validateProfitAgreement,
  type ProfitAgreementInput,
} from "@/lib/services/profit-share-config";
import { assertMoney } from "@/lib/services/trading-calculation";

/**
 * Gerbang "Validasi Aturan" (Tahap 4) — murni, tanpa database.
 *
 * Gerbang ini memeriksa laporan terhadap aturan yang **sudah tertulis dan disetujui**,
 * bukan terhadap angka yang dikarang sistem. Tiga hasil yang mungkin:
 *
 *  - `PASSED` — seluruh syarat data dan aturan terpenuhi.
 *  - `BLOCKED` — aturan tertulis ada, tetapi ada syarat yang belum lolos
 *    (rekonsiliasi belum bersih, catatan belum diverifikasi, periode tidak tercakup
 *    perjanjian, data DEMO ikut terbawa, dsb.).
 *  - `RULES_NOT_CONFIGURED` — aturan tertulis belum lengkap/belum disetujui, sehingga
 *    pembagian hasil belum boleh dihitung sama sekali (fail closed).
 *
 * Berkas ini tidak memuat satu pun persentase, nominal bagi hasil, atau rumus
 * pembagian. Ia hanya memutuskan boleh/tidak melangkah, beserta alasannya.
 */

export const RULES_VALIDATION_STATUSES = [
  "PASSED",
  "BLOCKED",
  "RULES_NOT_CONFIGURED",
] as const;

export type RulesValidationStatus = (typeof RULES_VALIDATION_STATUSES)[number];

export const RULES_VALIDATION_STATUS_LABELS: Record<RulesValidationStatus, string> = {
  PASSED: "Aturan terpenuhi",
  BLOCKED: "Diblokir",
  RULES_NOT_CONFIGURED: "Aturan belum tertulis",
};

export interface TradingRulesInput {
  /** `DEMO` tidak pernah boleh menjadi laporan profit aktual. */
  sourceType: TradingSourceType;
  /** true bila angka P&L periode ini sudah dikompilasi. */
  compiled: boolean;
  netPnl: Prisma.Decimal;
  /** Jumlah catatan ACTUAL terverifikasi pada periode ini. */
  verifiedRecordCount: number;
  /** Jumlah catatan ACTUAL yang belum diverifikasi. */
  unverifiedRecordCount: number;
  /** Jumlah catatan DEMO pada periode ini (hanya dilaporkan; tidak dihitung). */
  demoRecordCount: number;
  /** true bila masih ada baris rekonsiliasi UNRESOLVED. */
  hasUnresolvedReconciliation: boolean;
  /** Perjanjian bagi hasil yang dipakai; null bila belum ada sama sekali. */
  agreement: ProfitAgreementInput | null;
  periodStart: Date;
  periodEnd: Date;
}

export interface TradingRulesCheck {
  id: string;
  label: string;
  passed: boolean;
}

export interface TradingRulesResult {
  status: RulesValidationStatus;
  statusLabel: string;
  checks: TradingRulesCheck[];
  blockers: string[];
  agreementValid: boolean;
  agreementErrors: string[];
  lossDetected: boolean;
  lossAmount: Prisma.Decimal;
  note: string;
}

/**
 * Menjalankan seluruh pemeriksaan aturan. Urutan `checks` tetap supaya UI dapat
 * menampilkan daftar "sudah lolos / belum" tanpa menebak.
 */
export function evaluateTradingRules(input: TradingRulesInput): TradingRulesResult {
  const checks: TradingRulesCheck[] = [];
  const blockers: string[] = [];
  const lossDetected = input.netPnl.isNegative();
  const lossAmount = lossDetected ? input.netPnl.abs() : new Prisma.Decimal(0);

  let moneyError: string | null = null;
  try {
    assertMoney(input.netPnl, "Net Trading P&L");
  } catch (error) {
    moneyError = error instanceof Error ? error.message : String(error);
  }

  const agreementValidation = input.agreement ? validateProfitAgreement(input.agreement) : null;
  const agreementValid = agreementValidation?.valid === true;

  const add = (id: string, label: string, passed: boolean, blocker?: string): void => {
    checks.push({ id, label, passed });
    if (!passed && blocker) blockers.push(blocker);
  };

  add(
    "COMPILED",
    "Angka P&L periode sudah dikompilasi",
    input.compiled && moneyError === null,
    moneyError ?? "Laporan belum dikompilasi, jadi angka P&L periode ini belum tersedia.",
  );

  add(
    "RECONCILED",
    "Rekonsiliasi dengan angka sumber sudah bersih",
    !input.hasUnresolvedReconciliation,
    "Masih ada selisih rekonsiliasi yang belum diselesaikan.",
  );

  add(
    "VERIFIED_RECORDS",
    "Ada catatan trading ACTUAL yang sudah diverifikasi",
    input.verifiedRecordCount > 0,
    "Belum ada catatan trading ACTUAL yang diverifikasi pada periode ini.",
  );

  add(
    "NO_UNVERIFIED_RECORDS",
    "Tidak ada catatan yang masih belum diverifikasi",
    input.unverifiedRecordCount === 0,
    `Masih ada ${input.unverifiedRecordCount} catatan trading yang belum diverifikasi.`,
  );

  add(
    "ACTUAL_SOURCE_ONLY",
    "Data demo dipisahkan dari data aktual",
    input.sourceType === "ACTUAL",
    `Laporan bersumber ${input.sourceType}; data demo (${input.demoRecordCount} catatan) tidak boleh menjadi laporan profit aktual.`,
  );

  add(
    "AGREEMENT_COMPLETE",
    "Perjanjian bagi hasil tertulis lengkap dan disetujui para pihak",
    agreementValid,
    input.agreement
      ? `Perjanjian bagi hasil belum lengkap: ${agreementValidation?.errors.join(" ") ?? ""}`
      : "Belum ada perjanjian bagi hasil tertulis, jadi angka pembagian belum boleh dihitung (RULES_NOT_CONFIGURED).",
  );

  const agreementEffectiveTo = input.agreement?.effectiveTo ?? null;
  const coversPeriod =
    input.agreement !== null &&
    input.agreement.effectiveFrom !== null &&
    input.agreement.effectiveFrom <= input.periodEnd &&
    (agreementEffectiveTo === null || agreementEffectiveTo >= input.periodStart);

  add(
    "AGREEMENT_PERIOD",
    "Perjanjian berlaku untuk periode laporan ini",
    coversPeriod,
    "Perjanjian bagi hasil belum mencakup periode laporan ini (tanggal berlaku tidak cocok).",
  );

  const lossTermKnown =
    input.agreement !== null &&
    input.agreement.lossHandling !== null &&
    (LOSS_HANDLING_OPTIONS as readonly string[]).includes(input.agreement.lossHandling);

  add(
    "LOSS_TERM",
    "Ketentuan periode rugi tertulis (bila periode merugi)",
    !lossDetected || (agreementValid && lossTermKnown),
    lossDetected
      ? `Periode ini merugi ${lossAmount.toFixed(2)}; ketentuan penanganan kerugian belum tertulis/disetujui pada perjanjian.`
      : undefined,
  );

add(
    "BASIS_FROM_AGREEMENT",
    "Dasar pembagian diambil dari perjanjian, bukan dari kepemilikan modal",
    Boolean(input.agreement?.distributionMethod?.trim()) && Boolean(input.agreement?.pnlBasis?.trim()),
    "Dasar pembagian hasil belum tertulis pada perjanjian (metode perhitungan/dasar P&L belum diisi).",
  );

  let status: RulesValidationStatus;
  if (!agreementValid) {
    status = "RULES_NOT_CONFIGURED";
  } else if (checks.some((check) => !check.passed)) {
    status = "BLOCKED";
  } else {
    status = "PASSED";
  }

  const demoNote =
    input.demoRecordCount > 0
      ? ` ${input.demoRecordCount} catatan demo dikecualikan dari total aktual.`
      : "";
  const note =
    status === "PASSED"
      ? `Seluruh syarat aturan terpenuhi.${demoNote}`
      : `${RULES_VALIDATION_STATUS_LABELS[status]}. ${blockers.join(" ")}${demoNote}`;

  return {
    status,
    statusLabel: RULES_VALIDATION_STATUS_LABELS[status],
    checks,
    blockers,
    agreementValid,
    agreementErrors: agreementValidation?.errors ?? [],
    lossDetected,
    lossAmount,
    note: note.trim(),
  };
}

/** true bila laporan boleh naik dari `RULES_VALIDATION` ke `PENDING_APPROVAL`. */
export function canSubmitForApprovalAfterRules(result: TradingRulesResult): boolean {
  return result.status === "PASSED";
}

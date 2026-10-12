import { Prisma, type TradingReportStatus } from "@prisma/client";

import {
  TRADING_REPORT_STATUS_LABELS,
  TRADING_REPORT_STATUSES,
} from "@/lib/config/trading";
import type { RulesValidationStatus } from "@/lib/services/trading-rules-validation";

/**
 * Mesin status laporan profit — murni, tanpa database.
 *
 * Setiap transisi di bawah legal *sebagai struktur*; syarat datanya (rekonsiliasi
 * bersih, semua catatan terverifikasi, kebijakan disetujui) diperiksa terpisah oleh
 * `evaluatePublicationReadiness` dan oleh service di dalam transaksi.
 */

export class TradingReportTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TradingReportTransitionError";
  }
}

/** Transisi yang diizinkan untuk setiap status. */
export const TRADING_REPORT_TRANSITIONS: Record<TradingReportStatus, readonly TradingReportStatus[]> = {
  DRAFT: ["RECONCILIATION", "REJECTED"],
  RECONCILIATION: ["RULES_VALIDATION", "DRAFT", "REJECTED"],
  RULES_VALIDATION: ["PENDING_APPROVAL", "RECONCILIATION", "REJECTED"],
  PENDING_APPROVAL: ["APPROVED", "REJECTED"],
  APPROVED: ["PUBLISHED", "CORRECTED", "REJECTED"],
  PUBLISHED: ["PAYMENT_PROCESSING", "CORRECTED"],
  PAYMENT_PROCESSING: ["PAID", "CORRECTED"],
  PAID: ["CORRECTED"],
  REJECTED: [],
  CORRECTED: ["RECONCILIATION"],
};

/** Status akhir: tidak ada transisi keluar. */
const TERMINAL_STATUSES: readonly TradingReportStatus[] = ["REJECTED"];

/** Status yang wajib menyertakan alasan tertulis saat dimasuki. */
const REASON_REQUIRED: readonly TradingReportStatus[] = ["REJECTED", "CORRECTED"];

export function isTradingReportStatus(value: string): value is TradingReportStatus {
  return (TRADING_REPORT_STATUSES as readonly string[]).includes(value);
}

export function tradingReportStatusLabel(status: TradingReportStatus): string {
  return TRADING_REPORT_STATUS_LABELS[status] ?? status;
}

export function isTerminalTradingReportStatus(status: TradingReportStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function transitionRequiresReason(to: TradingReportStatus): boolean {
  return REASON_REQUIRED.includes(to);
}

export function canTransitionTradingReport(
  from: TradingReportStatus,
  to: TradingReportStatus,
): boolean {
  const allowed = TRADING_REPORT_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

/** Melempar `TradingReportTransitionError` bila transisi tidak diizinkan. */
export function assertTradingReportTransition(
  from: TradingReportStatus,
  to: TradingReportStatus,
): void {
  if (from === to) {
    throw new TradingReportTransitionError(
      `Laporan sudah berstatus ${tradingReportStatusLabel(from)}.`,
    );
  }
  if (!canTransitionTradingReport(from, to)) {
    throw new TradingReportTransitionError(
      `Transisi ${tradingReportStatusLabel(from)} ke ${tradingReportStatusLabel(to)} tidak diizinkan.`,
    );
  }
}

export interface PublicationReadinessInput {
  status: TradingReportStatus;
  /** true bila masih ada baris rekonsiliasi UNRESOLVED. */
  hasUnresolvedReconciliation: boolean;
  /** Jumlah catatan ACTUAL yang belum terverifikasi pada periode ini. */
  unverifiedRecordCount: number;
  /** true bila kebijakan bagi hasil sudah disetujui pemilik. */
  policyApproved: boolean;
  /** true bila laporan sudah punya angka P&L yang dikompilasi. */
  compiled: boolean;
  /**
   * Hasil gerbang Validasi Aturan (Tahap 4). `RULES_NOT_CONFIGURED` berarti aturan
   * tertulis belum ada, sehingga laporan tidak boleh melangkah lebih jauh; `BLOCKED`
   * berarti masih ada syarat data/aturan yang belum lolos.
   */
  rulesStatus?: RulesValidationStatus | null;
}

export interface PublicationReadiness {
  ready: boolean;
  blockers: string[];
}

/**
 * Syarat naik ke PENDING_APPROVAL. Mengembalikan daftar penghalang agar UI admin
 * dapat menjelaskan apa yang masih kurang — bukan sekadar menolak.
 */
export function evaluatePublicationReadiness(
  input: PublicationReadinessInput,
): PublicationReadiness {
  const blockers: string[] = [];

  if (input.status !== "RULES_VALIDATION") {
    blockers.push(
      `Laporan harus berstatus Validasi Aturan sebelum diajukan (saat ini ${tradingReportStatusLabel(input.status)}).`,
    );
  }
  if (input.rulesStatus === "RULES_NOT_CONFIGURED") {
    blockers.push(
      "Validasi aturan berhenti dengan alasan RULES_NOT_CONFIGURED: perjanjian bagi hasil tertulis belum lengkap/disetujui.",
    );
  } else if (input.rulesStatus === "BLOCKED") {
    blockers.push(
      "Validasi aturan belum lolos: selesaikan penghalang pada tahap Validasi Aturan sebelum mengajukan laporan.",
    );
  }
  if (!input.compiled) {
    blockers.push("Laporan belum dikompilasi, jadi angka P&L periode ini belum tersedia.");
  }
  if (input.hasUnresolvedReconciliation) {
    blockers.push("Masih ada selisih rekonsiliasi yang belum diselesaikan.");
  }
  if (input.unverifiedRecordCount > 0) {
    blockers.push(`Masih ada ${input.unverifiedRecordCount} catatan trading yang belum diverifikasi.`);
  }
  if (!input.policyApproved) {
    blockers.push("Kebijakan bagi hasil belum disetujui pemilik, jadi angka bagi hasil belum final.");
  }

  return { ready: blockers.length === 0, blockers };
}

/** Ringkasan P&L untuk ditampilkan pada kartu laporan (tanpa data sensitif). */
export interface ReportSummaryInput {
  realizedPnl: Prisma.Decimal;
  unrealizedPnl: Prisma.Decimal;
  tradingFees: Prisma.Decimal;
  otherCosts: Prisma.Decimal;
  netPnl: Prisma.Decimal;
  memberPoolAmount: Prisma.Decimal;
}

export interface ReportSummary {
  realizedPnl: string;
  unrealizedPnl: string;
  tradingFees: string;
  otherCosts: string;
  netPnl: string;
  memberPoolAmount: string;
  isLoss: boolean;
  /** Keterangan yang wajib muncul di UI anggota: unrealized bukan uang yang dibagi. */
  unrealizedNote: string;
}

export function buildReportSummary(input: ReportSummaryInput): ReportSummary {
  return {
    realizedPnl: input.realizedPnl.toFixed(2),
    unrealizedPnl: input.unrealizedPnl.toFixed(2),
    tradingFees: input.tradingFees.toFixed(2),
    otherCosts: input.otherCosts.toFixed(2),
    netPnl: input.netPnl.toFixed(2),
    memberPoolAmount: input.memberPoolAmount.toFixed(2),
    isLoss: input.netPnl.isNegative(),
    unrealizedNote:
      "Unrealized P&L belum direalisasikan sehingga tidak ikut dibagi pada periode ini.",
  };
}

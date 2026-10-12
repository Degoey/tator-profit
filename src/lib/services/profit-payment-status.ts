import type { ProfitPaymentStatus } from "@prisma/client";

import { PROFIT_PAYMENT_STATUS_LABELS } from "@/lib/config/trading";

/**
 * Mesin status pembayaran profit (Tahap 6) — murni, tanpa database.
 *
 * Pemetaan istilah: spesifikasi menyebut `PAID` dan `REVERSED`. Sistem sudah
 * memiliki kolom enum `ProfitPaymentStatus` dengan istilah yang setara dan dipakai
 * apa adanya tanpa mengubah nilai enum yang sudah ada:
 *   `PAID` → `COMPLETED` (hanya setelah bukti diverifikasi), `REVERSED` → `CANCELLED`.
 *
 * Aturan yang mengikat:
 *  - Tidak ada status "Dibayar" sebelum bukti pembayaran ada dan diverifikasi.
 *  - Pembayaran gagal (`FAILED`) boleh dicatat ulang (kembali ke `PENDING`).
 *  - Pembayaran berulang tidak boleh tercatat dua kali: kunci idempotensi dan
 *    pemeriksaan pembayaran aktif pada satu hak anggota menolaknya.
 */

export class ProfitPaymentTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfitPaymentTransitionError";
  }
}

export const PROFIT_PAYMENT_TRANSITIONS: Record<ProfitPaymentStatus, readonly ProfitPaymentStatus[]> = {
  PENDING: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["COMPLETED", "FAILED", "CANCELLED"],
  COMPLETED: [],
  FAILED: ["PENDING"],
  CANCELLED: [],
};

/** Status akhir pembayaran: tidak ada transisi keluar. */
export const FINAL_PROFIT_PAYMENT_STATUSES: readonly ProfitPaymentStatus[] = [
  "COMPLETED",
  "CANCELLED",
];

export function profitPaymentStatusLabel(status: ProfitPaymentStatus): string {
  return PROFIT_PAYMENT_STATUS_LABELS[status] ?? status;
}

export function isFinalProfitPaymentStatus(status: ProfitPaymentStatus): boolean {
  return FINAL_PROFIT_PAYMENT_STATUSES.includes(status);
}

export function canTransitionProfitPayment(
  from: ProfitPaymentStatus,
  to: ProfitPaymentStatus,
): boolean {
  const allowed = PROFIT_PAYMENT_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

export function assertProfitPaymentTransition(
  from: ProfitPaymentStatus,
  to: ProfitPaymentStatus,
): void {
  if (from === to) {
    throw new ProfitPaymentTransitionError(
      `Pembayaran sudah berstatus ${profitPaymentStatusLabel(from)}.`,
    );
  }
  if (!canTransitionProfitPayment(from, to)) {
    throw new ProfitPaymentTransitionError(
      `Transisi ${profitPaymentStatusLabel(from)} ke ${profitPaymentStatusLabel(to)} tidak diizinkan.`,
    );
  }
}

export interface PaymentCompletionInput {
  /** true bila berkas bukti pembayaran sudah tersimpan. */
  hasProof: boolean;
  verifiedByUserId?: string | null;
  verifiedAt?: Date | null;
}

export interface PaymentReadiness {
  ready: boolean;
  blockers: string[];
}

/** Syarat menandai pembayaran `COMPLETED` (spesifikasi: `PAID`). */
export function evaluatePaymentCompletion(input: PaymentCompletionInput): PaymentReadiness {
  const blockers: string[] = [];
  if (!input.hasProof) {
    blockers.push("Bukti pembayaran belum ada, jadi pembayaran belum boleh ditandai dibayar.");
  }
  if (!input.verifiedByUserId) {
    blockers.push("Pembayaran belum dicatat siapa yang memverifikasi.");
  }
  if (!input.verifiedAt) {
    blockers.push("Pembayaran belum mencantumkan waktu verifikasi.");
  }
  return { ready: blockers.length === 0, blockers };
}

/** Melempar bila bukti/verifikasi belum lengkap (dipakai service sebelum menyimpan). */
export function assertPaymentCompletionReady(input: PaymentCompletionInput): void {
  const readiness = evaluatePaymentCompletion(input);
  if (!readiness.ready) {
    throw new Error(readiness.blockers.join(" "));
  }
}

export interface ExistingPaymentLike {
  allocationId: string;
  status: ProfitPaymentStatus;
  idempotencyKey?: string | null;
}

export interface DuplicatePaymentCheck {
  duplicate: boolean;
  reason: string | null;
}

/**
 * Mencari pembayaran berulang untuk satu hak anggota.
 *
 * Dua pembayaran dianggap bentrok bila memakai kunci idempotensi yang sama, atau
 * bila sudah ada pembayaran aktif (bukan FAILED/CANCELLED) atas hak anggota itu.
 */
export function findDuplicatePayment(
  candidate: ExistingPaymentLike,
  existing: readonly ExistingPaymentLike[],
): DuplicatePaymentCheck {
  const key = candidate.idempotencyKey?.trim() ?? "";
  if (key.length > 0) {
    const sameKey = existing.find((row) => (row.idempotencyKey?.trim() ?? "") === key);
    if (sameKey) {
      return {
        duplicate: true,
        reason: `Pembayaran dengan kunci idempotensi ${key} sudah pernah dicatat.`,
      };
    }
  }

  const active = existing.find(
    (row) => row.allocationId === candidate.allocationId && !isFinalOrFailed(row.status),
  );
  if (active) {
    return {
      duplicate: true,
      reason: `Sudah ada pembayaran berjalan (${profitPaymentStatusLabel(active.status)}) untuk hak anggota ini.`,
    };
  }

  return { duplicate: false, reason: null };
}

function isFinalOrFailed(status: ProfitPaymentStatus): boolean {
  return status === "COMPLETED" || status === "CANCELLED" || status === "FAILED";
}

export function assertNoDuplicatePayment(
  candidate: ExistingPaymentLike,
  existing: readonly ExistingPaymentLike[],
): void {
  const check = findDuplicatePayment(candidate, existing);
  if (check.duplicate) {
    throw new Error(check.reason ?? "Pembayaran berulang ditolak.");
  }
}
import type {
  CapitalContributionStatus,
  CapitalMovementType,
  CapitalOwnerType,
  ProfitAllocationStatus,
  ProfitPaymentStatus,
  ProfitSharePolicyStatus,
  TradingRecordStatus,
  TradingReconciliationStatus,
  TradingReportStatus,
  TradingSourceType,
} from "@prisma/client";

/**
 * Konfigurasi pusat modul "Profit Mingguan Berbasis Hasil Trading Aktual".
 *
 * Berkas ini HANYA memuat konstanta struktur (daftar status, label, mata uang,
 * ambang batas). Angka bisnis yang menentukan pembagian hasil — persentase bagi
 * hasil, cadangan, biaya pengelolaan, dan penanganan kerugian — sengaja TIDAK ada
 * di sini: nilai itu menunggu persetujuan pemilik dan disimpan sebagai baris
 * `ProfitSharePolicy` berstatus `PENDING_APPROVAL` sampai disetujui.
 */

/** Mata uang pencatatan modul; mengikuti default buku besar yang sudah ada. */
export const TRADING_CURRENCY = "USDT";

/** Sumber data yang boleh dipakai. Hanya ACTUAL yang masuk laporan profit. */
export const TRADING_SOURCE_TYPES: readonly TradingSourceType[] = ["ACTUAL", "DEMO"] as const;

export const TRADING_SOURCE_TYPE_LABELS: Record<TradingSourceType, string> = {
  ACTUAL: "Aktual",
  DEMO: "Demo",
};

/** Status verifikasi satu catatan trading. */
export const TRADING_RECORD_STATUSES: readonly TradingRecordStatus[] = [
  "UNVERIFIED",
  "VERIFIED",
  "REJECTED",
] as const;

export const TRADING_RECORD_STATUS_LABELS: Record<TradingRecordStatus, string> = {
  UNVERIFIED: "Belum diverifikasi",
  VERIFIED: "Terverifikasi",
  REJECTED: "Ditolak",
};

/** Siklus hidup laporan, sesuai dokumen audit (§6) + gerbang validasi aturan. */
export const TRADING_REPORT_STATUSES: readonly TradingReportStatus[] = [
  "DRAFT",
  "RECONCILIATION",
  "RULES_VALIDATION",
  "PENDING_APPROVAL",
  "APPROVED",
  "PUBLISHED",
  "PAYMENT_PROCESSING",
  "PAID",
  "REJECTED",
  "CORRECTED",
] as const;

export const TRADING_REPORT_STATUS_LABELS: Record<TradingReportStatus, string> = {
  DRAFT: "Draf",
  RECONCILIATION: "Rekonsiliasi",
  RULES_VALIDATION: "Validasi aturan",
  PENDING_APPROVAL: "Menunggu persetujuan",
  APPROVED: "Disetujui",
  PUBLISHED: "Diterbitkan",
  PAYMENT_PROCESSING: "Pembayaran diproses",
  PAID: "Dibayar",
  REJECTED: "Ditolak",
  CORRECTED: "Dikoreksi",
};

/** Status hasil pencocokan angka internal dengan angka sumber. */
export const TRADING_RECONCILIATION_STATUSES: readonly TradingReconciliationStatus[] = [
  "PENDING",
  "MATCHED",
  "UNRESOLVED",
] as const;

export const TRADING_RECONCILIATION_STATUS_LABELS: Record<TradingReconciliationStatus, string> = {
  PENDING: "Menunggu pemeriksaan",
  MATCHED: "Cocok",
  UNRESOLVED: "Ada selisih belum selesai",
};

/** Status hak profit anggota. */
export const PROFIT_ALLOCATION_STATUSES: readonly ProfitAllocationStatus[] = [
  "PENDING",
  "APPROVED",
  "PAID",
  "REJECTED",
  "VOID",
] as const;

export const PROFIT_ALLOCATION_STATUS_LABELS: Record<ProfitAllocationStatus, string> = {
  PENDING: "Menunggu",
  APPROVED: "Disetujui",
  PAID: "Dibayar",
  REJECTED: "Ditolak",
  VOID: "Dibatalkan",
};

/** Status pembayaran profit (dicatat manual, bukan gateway otomatis). */
export const PROFIT_PAYMENT_STATUSES: readonly ProfitPaymentStatus[] = [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export const PROFIT_PAYMENT_STATUS_LABELS: Record<ProfitPaymentStatus, string> = {
  PENDING: "Menunggu",
  PROCESSING: "Sedang diproses",
  COMPLETED: "Selesai",
  FAILED: "Gagal",
  CANCELLED: "Dibatalkan",
};

/** Status kebijakan bagi hasil; hanya APPROVED yang boleh dipakai mesin alokasi. */
export const PROFIT_SHARE_POLICY_STATUSES: readonly ProfitSharePolicyStatus[] = [
  "PENDING_APPROVAL",
  "APPROVED",
  "REVOKED",
] as const;

export const PROFIT_SHARE_POLICY_STATUS_LABELS: Record<ProfitSharePolicyStatus, string> = {
  PENDING_APPROVAL: "Menunggu persetujuan pemilik",
  APPROVED: "Disetujui pemilik",
  REVOKED: "Dicabut",
};

/**
 * Prefiks referensi buku besar untuk hak profit anggota. Dipakai bersama oleh
 * service dan pengujian supaya referensi tidak pernah berubah diam-diam.
 */
export const PROFIT_SHARE_LEDGER_REFERENCE_PREFIX = "profit-share";

/**
 * Kunci idempotensi pembayaran profit yang diturunkan dari id hak anggota.
 * Dua permintaan identik menghasilkan kunci yang sama sehingga database
 * (unique index) menolak pembayaran kedua.
 */
export function profitPaymentIdempotencyKey(allocationId: string): string {
  return `profit-payment:${allocationId}`;
}

/** Referensi ledger idempoten untuk satu hak profit. */
export function profitShareLedgerReference(reportId: string, memberId: string): string {
  return `${PROFIT_SHARE_LEDGER_REFERENCE_PREFIX}:${reportId}:${memberId}`;
}

/** Ambang toleransi bawaan rekonsiliasi (tepat nol) sampai pemilik menetapkan lain. */
export const DEFAULT_RECONCILIATION_TOLERANCE = "0.00";

/** Satu minggu dalam milidetik; dipakai saat menghitung periode laporan. */
export const TRADING_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/* -------------------------------------------------------------------------- */
/* Tahap 2 — Sumber modal (konstanta struktur; tanpa satu pun angka bisnis)     */
/* -------------------------------------------------------------------------- */

export const CAPITAL_OWNER_TYPES: readonly CapitalOwnerType[] = ["COMPANY", "MEMBER"] as const;

export const CAPITAL_OWNER_TYPE_LABELS: Record<CapitalOwnerType, string> = {
  COMPANY: "Modal perusahaan",
  MEMBER: "Modal anggota",
};

export const CAPITAL_CONTRIBUTION_STATUSES: readonly CapitalContributionStatus[] = [
  "RECORDED",
  "VERIFIED",
  "REJECTED",
  "WITHDRAWN",
] as const;

export const CAPITAL_CONTRIBUTION_STATUS_LABELS: Record<CapitalContributionStatus, string> = {
  RECORDED: "Dicatat",
  VERIFIED: "Terverifikasi",
  REJECTED: "Ditolak",
  WITHDRAWN: "Sudah ditarik",
};

export const CAPITAL_MOVEMENT_TYPES: readonly CapitalMovementType[] = [
  "ALLOCATION",
  "WITHDRAWAL",
  "ADJUSTMENT",
  "REVERSAL",
] as const;

export const CAPITAL_MOVEMENT_TYPE_LABELS: Record<CapitalMovementType, string> = {
  ALLOCATION: "Penambahan modal",
  WITHDRAWAL: "Penarikan modal",
  ADJUSTMENT: "Penyesuaian modal",
  REVERSAL: "Pembatalan pergerakan",
};

/**
 * Kunci idempotensi pencatatan modal: jenis pemilik + nomor bukti sumber.
 * Bentuknya dipakai bersama oleh service dan uji murni supaya pencatatan ganda
 * tertolak sebelum menyentuh database.
 */
export function capitalContributionKey(ownerType: CapitalOwnerType, reference: string): string {
  return `${ownerType}:${reference.trim().toUpperCase()}`;
}

/**
 * Teks tetap yang wajib ditampilkan bersama angka modal: kepemilikan modal tidak
 * menentukan hak profit. Tidak ada angka pada teks ini.
 */
export const CAPITAL_PROFIT_BASIS_NOTICE =
  "Kepemilikan modal tidak menentukan hak profit dengan sendirinya; hak profit hanya dihitung dari perjanjian bagi hasil yang sudah disetujui pemilik.";

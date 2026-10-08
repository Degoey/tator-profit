/**
 * Indonesian display labels for the database enum values that appear in the UI.
 * The stored values stay unchanged (ACTIVE, PENDING, ...) so the database, API
 * responses and audit trail keep their stable, language independent codes.
 */
export const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Aktif",
  INACTIVE: "Nonaktif",
  ARCHIVED: "Diarsipkan",
  PENDING: "Menunggu",
  UNDER_REVIEW: "Sedang ditinjau",
  APPROVED: "Disetujui",
  FLAGGED: "Ditandai",
  PROCESSING: "Sedang diproses",
  PAID: "Dibayar",
  REJECTED: "Ditolak",
  VOID: "Dibatalkan",
  SUSPENDED: "Ditangguhkan",
  COMPLETED: "Selesai",
  CANCELLED: "Dibatalkan",
  POSTED: "Tercatat",
  NOT_RECORDED: "Belum dicatat",
};

/** Falls back to the raw code when no translation is known. */
export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}
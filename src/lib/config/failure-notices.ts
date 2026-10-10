/**
 * Notifikasi kegagalan jejak audit (Bagian 7/7, risiko terbuka nomor 2).
 *
 * `recordAuditLog` dan `recordSecurityEvent` sengaja **tidak** menggagalkan
 * permintaan pengguna ketika penulisan gagal: uang dan sesi sudah tersimpan di
 * dalam transaksinya sendiri. Sebelumnya kegagalan itu hanya ditelan dan hilang
 * di antara log lain. Modul ini menyediakan keterangan kegagalan yang stabil dan
 * dapat dicari, sehingga operator dapat memberi alert dan memasukkan kembali
 * catatan yang hilang.
 *
 * Tidak ada data sensitif di sini: tidak ada token, kata sandi, badan permintaan,
 * maupun snapshot sebelum/sesudah. Modul ini murni (tanpa Prisma, tanpa Next)
 * supaya dapat diuji dan dipakai ulang.
 */

/** Penanda stabil untuk pencarian/alert di log operator. */
export const AUDIT_LOG_FAILURE_MARKER = "[audit-log-failure]";
export const SECURITY_EVENT_FAILURE_MARKER = "[security-event-failure]";

/** Bagian dari `AuditLogInput` yang dibutuhkan keterangan kegagalan. */
export interface AuditLogFailureDetails {
  action: string;
  entityType: string;
  entityId?: string | null;
  actorUserId?: string | null;
}

/** Bagian dari `SecurityEventInput` yang dibutuhkan keterangan kegagalan. */
export interface SecurityEventFailureDetails {
  type: string;
  severity?: string | null;
  userId?: string | null;
}

/** Keterangan kegagalan entri audit: aksi, entitas, dan pelakunya. */
export function describeAuditLogFailure(input: AuditLogFailureDetails): string {
  const entity = input.entityId ? `${input.entityType}:${input.entityId}` : input.entityType;
  return [
    AUDIT_LOG_FAILURE_MARKER,
    `action=${input.action}`,
    `entity=${entity}`,
    `actor=${input.actorUserId ?? "system"}`,
  ].join(" ");
}

/** Keterangan kegagalan peristiwa keamanan: jenis, tingkat keparahan, dan pemiliknya. */
export function describeSecurityEventFailure(input: SecurityEventFailureDetails): string {
  return [
    SECURITY_EVENT_FAILURE_MARKER,
    `type=${input.type}`,
    `severity=${input.severity ?? "INFO"}`,
    `user=${input.userId ?? "anonymous"}`,
  ].join(" ");
}
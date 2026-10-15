import type { AdminRole } from "@prisma/client";

/**
 * Label Indonesia untuk setiap peran admin.
 *
 * Dipakai bersama oleh panel admin, Konsol Pemilik, dan pengelola peran supaya
 * satu peran tidak pernah tampil dengan dua nama berbeda di dua halaman.
 */
export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  SUPER_ADMIN: "Super Admin",
  FINANCE: "Keuangan",
  SUPPORT: "Dukungan",
  COMPLIANCE: "Kepatuhan",
  VIEWER: "Pengamat",
};

/** Label aman untuk peran yang mungkin `null` (admin tanpa peran eksplisit). */
export function adminRoleLabel(role: AdminRole | null | undefined): string {
  return role ? (ADMIN_ROLE_LABELS[role] ?? role) : "Tanpa peran";
}

import type { AdminRole } from "@prisma/client";

import { canAdmin, type AdminPermission } from "@/lib/auth/admin-permissions";

/**
 * Peta Panel Admin (peran biasa).
 *
 * Setiap halaman panel mewakili satu kapabilitas, dan kapabilitas itu ditulis
 * sekali di sini supaya navigasi, penjagaan halaman, dan pengujian membaca
 * kebijakan yang sama — bukan tiga daftar yang bisa saling menyimpang.
 *
 * Yang **tidak** ada di daftar ini adalah kapabilitas milik pemilik saja
 * (`creditBalance` dan `manageUsers`): menambah USDT dan mengubah peran admin
 * tetap di Konsol Pemilik, jadi kartunya tidak dirender di panel ini sama sekali.
 */
export type AdminConsolePath =
  | "/admin"
  | "/admin/deposit"
  | "/admin/penarikan"
  | "/admin/komisi"
  | "/admin/imbalan"
  | "/admin/audit"
  | "/admin/fraud";

export interface AdminConsoleLink {
  href: AdminConsolePath;
  label: string;
  /** Kapabilitas minimum untuk membuka halaman dan memuat datanya. */
  permission: AdminPermission;
  /** Ringkas satu baris, dipakai di dasbor panel. */
  summary: string;
}

export const ADMIN_CONSOLE_LINKS: readonly AdminConsoleLink[] = [
  {
    href: "/admin",
    label: "Ringkasan",
    permission: "read",
    summary: "Angka antrean dan nilai terkonfirmasi langsung dari database.",
  },
  {
    href: "/admin/deposit",
    label: "Deposit",
    permission: "read",
    summary: "Setujui, tandai, atau tolak setoran manual beserta buktinya.",
  },
  {
    href: "/admin/penarikan",
    label: "Penarikan",
    permission: "read",
    summary: "Jalankan antrean penarikan sampai selesai atau ditolak.",
  },
  {
    href: "/admin/komisi",
    label: "Komisi",
    permission: "read",
    summary: "Komisi rujukan: baca untuk semua peran, selesaikan bila berwenang.",
  },
  {
    href: "/admin/imbalan",
    label: "Imbalan",
    permission: "read",
    summary: "Persentase rebate per generasi; hanya dapat diubah bila berwenang.",
  },
  {
    href: "/admin/audit",
    label: "Jejak audit",
    permission: "readAudit",
    summary: "50 catatan audit terbaru: aktor, aksi, entitas, dan snapshot.",
  },
  {
    href: "/admin/fraud",
    label: "Anti-fraud",
    permission: "readFraud",
    summary: "Antrean sinyal multi-akun; menutup kasus perlu kewenangan tersendiri.",
  },
];

/** Halaman panel yang boleh dibuka oleh satu peran admin. */
export function adminConsoleLinksFor(role: AdminRole | null | undefined): AdminConsoleLink[] {
  return ADMIN_CONSOLE_LINKS.filter((link) => canAdmin(role, link.permission));
}

/** Semua jalur panel, untuk verifikasi dan pengujian. */
export const ADMIN_CONSOLE_PATHS: readonly AdminConsolePath[] = ADMIN_CONSOLE_LINKS.map(
  (link) => link.href,
);

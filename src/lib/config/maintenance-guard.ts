import { isProductionLikeEnvironment } from "./production-environment";
import type { EnvironmentVariables } from "./production-environment";

export type { EnvironmentVariables };

/**
 * Guard untuk skrip pemeliharaan yang menulis atau menghapus data (Bagian 2 dan 8).
 *
 * Skrip seperti `demo:reset` menghapus akun dan melewati proteksi ledger, sedangkan
 * `verify:*` membuat akun dengan kata sandi yang diketahui. Semua skrip itu harus
 * berhenti sendiri di lingkungan seperti produksi — produksi **dan** staging, lihat
 * `src/lib/config/production-environment.ts` — dan skrip yang menghapus data wajib
 * meminta konfirmasi eksplisit. Modul ini tidak menyentuh saldo dan tidak mengubah
 * satu pun aturan keuangan.
 */

/** Flag baris perintah yang menandakan operator sudah menyetujui tindakan. */
export const CONFIRM_FLAG = "--confirm";

/** Benar bila flag (default `--confirm`) muncul di daftar argumen. */
export function hasConfirmFlag(argv: readonly string[], flag: string = CONFIRM_FLAG): boolean {
  return argv.includes(flag);
}

/**
 * Menolak eksekusi di produksi atau staging: skrip pemeliharaan hanya untuk
 * pengembangan dan pengujian.
 */
export function assertNotProduction(env: EnvironmentVariables, action: string): void {
  if (isProductionLikeEnvironment(env)) {
    throw new Error(`${action} tidak boleh dijalankan di lingkungan produksi/staging.`);
  }
}

/** Menolak eksekusi tanpa persetujuan eksplisit dari operator. */
export function assertConfirmed(argv: readonly string[], instruction: string): void {
  if (!hasConfirmFlag(argv)) {
    throw new Error(`Konfirmasi wajib: ${instruction}`);
  }
}
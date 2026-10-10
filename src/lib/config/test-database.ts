/**
 * Pemisahan database pengujian (Bagian 2 dan 8).
 *
 * Suite `npm test` menulis data nyata: akun uji, entri ledger, baris audit, dan
 * tarif rabat global yang dipakai mesin perhitungan. Karena itu suite tidak boleh
 * berjalan di atas database aplikasi — apalagi database produksi. Modul ini hanya
 * menjaga pemisahan lingkungan: tidak ada perilaku keuangan yang diubah, tidak ada
 * saldo yang dipindahkan, dan tidak ada akun demo yang diubah menjadi akun nyata.
 */

import type { EnvironmentVariables } from "./maintenance-guard";

/** Variabel lingkungan yang wajib berisi database uji. */
export const TEST_DATABASE_URL_ENV = "TEST_DATABASE_URL";

/** Variabel lingkungan aplikasi (server, migrasi, seed). */
export const APP_DATABASE_URL_ENV = "DATABASE_URL";

/**
 * Diset oleh `scripts/run-tests.ts` sebelum suite dijalankan, berisi URL database
 * aplikasi. Keberadaannya menandakan bahwa proses uji ini sudah dialihkan ke
 * database uji, sehingga `DATABASE_URL` di dalamnya boleh sama dengan database uji.
 */
export const ORIGINAL_APP_DATABASE_URL_ENV = "TATORPROFIT_APP_DATABASE_URL";

export class TestDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestDatabaseError";
  }
}

/** Bagian URL yang menentukan "database yang sama" untuk keperluan isolasi. */
export interface DatabaseTarget {
  host: string;
  port: string;
  database: string;
  schema: string;
}

/**
 * Memuat `.env` bila kedua variabel database belum ada, supaya skrip yang tidak
 * mengimpor Prisma Client tetap melihat konfigurasi yang sama seperti aplikasi.
 */
export function loadDatabaseEnvFile(env: EnvironmentVariables = process.env): void {
  if (env[APP_DATABASE_URL_ENV] && env[TEST_DATABASE_URL_ENV]) return;
  try {
    process.loadEnvFile(".env");
  } catch {
    // `.env` tidak wajib ada: variabel lingkungan bisa diisi langsung oleh operator.
  }
}

/** Mengubah URL PostgreSQL menjadi bagian yang dibandingkan; `null` bila bukan URL. */
export function parseDatabaseTarget(url: string): DatabaseTarget | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") return null;

  const database = parsed.pathname.replace(/^\/+/, "");
  if (!database) return null;

  return {
    host: parsed.hostname.toLowerCase(),
    port: parsed.port || "5432",
    database: database.toLowerCase(),
    schema: (parsed.searchParams.get("schema") ?? "public").toLowerCase(),
  };
}

/** Keterangan aman (tanpa kata sandi) untuk pesan kesalahan dan log. */
export function describeDatabaseTarget(url: string): string {
  const target = parseDatabaseTarget(url);
  if (!target) return "(URL database tidak dikenal)";
  return `${target.host}:${target.port}/${target.database} (skema ${target.schema})`;
}

export function isSameDatabaseTarget(a: DatabaseTarget, b: DatabaseTarget): boolean {
  return (
    a.host === b.host && a.port === b.port && a.database === b.database && a.schema === b.schema
  );
}

/**
 * Mengembalikan URL database uji dan menolak konfigurasi yang bisa menyentuh
 * database aplikasi. Dipakai proses uji maupun runner `npm test`.
 */
export function resolveTestDatabaseUrl(env: EnvironmentVariables = process.env): string {
  loadDatabaseEnvFile(env);

  if (env.NODE_ENV === "production") {
    throw new TestDatabaseError("Pengujian tidak boleh dijalankan di lingkungan produksi.");
  }

  const testUrl = (env[TEST_DATABASE_URL_ENV] ?? "").trim();
  if (!testUrl) {
    throw new TestDatabaseError(
      `Variabel lingkungan ${TEST_DATABASE_URL_ENV} wajib diisi sebelum pengujian, misalnya ` +
        `${TEST_DATABASE_URL_ENV}="postgresql://tatorprofit:tatorprofit@localhost:5432/tatorprofit_test?schema=public". ` +
        "Jalankan `npm run db:test:setup` untuk menyiapkan database uji terpisah.",
    );
  }

  const target = parseDatabaseTarget(testUrl);
  if (!target) {
    throw new TestDatabaseError(
      `Nilai ${TEST_DATABASE_URL_ENV} bukan URL PostgreSQL yang valid: ${testUrl}`,
    );
  }

  if (!target.database.includes("test")) {
    throw new TestDatabaseError(
      `Nama database uji "${target.database}" harus memuat kata "test" agar tidak tertukar dengan ` +
        "database aplikasi. Contoh: tatorprofit_test.",
    );
  }

  const appUrl = (env[ORIGINAL_APP_DATABASE_URL_ENV] ?? env[APP_DATABASE_URL_ENV] ?? "").trim();
  const appTarget = appUrl ? parseDatabaseTarget(appUrl) : null;
  if (appTarget && isSameDatabaseTarget(appTarget, target)) {
    throw new TestDatabaseError(
      `Database uji ${describeDatabaseTarget(testUrl)} sama dengan database aplikasi. ` +
        "Pengujian menulis akun, ledger dan tarif rabat, jadi wajib memakai database terpisah.",
    );
  }

  return testUrl;
}

/**
 * Memastikan proses uji berjalan di dalam kotak pasir runner: seluruh klien Prisma
 * (termasuk singleton aplikasi) harus sudah menunjuk ke database uji. Tanpa ini,
 * menjalankan `tsx --test` langsung akan menulis ke database aplikasi.
 */
export function assertSandboxedTestProcess(env: EnvironmentVariables = process.env): void {
  loadDatabaseEnvFile(env);

  if (env.NODE_ENV === "production") {
    throw new TestDatabaseError("Pengujian tidak boleh dijalankan di lingkungan produksi.");
  }

  const testUrl = (env[TEST_DATABASE_URL_ENV] ?? "").trim();
  const effectiveUrl = (env[APP_DATABASE_URL_ENV] ?? "").trim();
  const originalAppUrl = (env[ORIGINAL_APP_DATABASE_URL_ENV] ?? "").trim();

  if (!testUrl || !effectiveUrl || !originalAppUrl) {
    throw new TestDatabaseError(
      "Proses pengujian ini tidak memakai database uji terpisah. Jalankan pengujian lewat " +
        "`npm test` (scripts/run-tests.ts); runner itulah yang mengalihkan DATABASE_URL ke " +
        `${TEST_DATABASE_URL_ENV} sebelum berkas uji dimuat.`,
    );
  }

  if (effectiveUrl !== testUrl) {
    throw new TestDatabaseError(
      `DATABASE_URL (${describeDatabaseTarget(effectiveUrl)}) tidak sama dengan ` +
        `${TEST_DATABASE_URL_ENV} (${describeDatabaseTarget(testUrl)}). Jalankan ulang lewat ` +
        "`npm test`.",
    );
  }
}
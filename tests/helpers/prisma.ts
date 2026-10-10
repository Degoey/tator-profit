import { PrismaClient } from "@prisma/client";

import {
  assertSandboxedTestProcess,
  resolveTestDatabaseUrl,
} from "../../src/lib/config/test-database";

/**
 * Klien Prisma resmi untuk suite pengujian (Bagian 2 dan 8).
 *
 * Mengimpor `@prisma/client` memuat `.env` — perilaku yang sama seperti
 * `prisma/seed.ts` — sehingga pemeriksaan di bawah membaca konfigurasi yang sama
 * dengan aplikasi. Dua penjaga dijalankan sebelum satu baris pun ditulis:
 *  - `resolveTestDatabaseUrl` menolak konfigurasi yang menunjuk database aplikasi,
 *  - `assertSandboxedTestProcess` menolak proses uji yang tidak dijalankan lewat
 *    `npm test` (runner mengalihkan `DATABASE_URL` ke database uji lebih dulu).
 */
assertSandboxedTestProcess();

export const TEST_DATABASE_URL: string = resolveTestDatabaseUrl();

/** Satu-satunya cara suite membuat klien: selalu menunjuk database uji. */
export function createTestPrismaClient(): PrismaClient {
  return new PrismaClient({ datasourceUrl: TEST_DATABASE_URL });
}
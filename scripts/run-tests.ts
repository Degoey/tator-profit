import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  APP_DATABASE_URL_ENV,
  ORIGINAL_APP_DATABASE_URL_ENV,
  describeDatabaseTarget,
  loadDatabaseEnvFile,
  resolveTestDatabaseUrl,
} from "../src/lib/config/test-database";

/**
 * Runner pengujian (Bagian 2 dan 8).
 *
 * Aplikasi memakai satu singleton Prisma (`src/lib/prisma.ts`), jadi mengalihkan
 * suite ke database uji harus terjadi sebelum proses uji dimulai — bukan di dalam
 * berkas uji. Runner ini memeriksa `TEST_DATABASE_URL`, menolak database aplikasi
 * dan menolak `NODE_ENV=production`, lalu menjalankan `node --test` lewat tsx
 * dengan `DATABASE_URL` dialihkan ke database uji. Hasilnya: seluruh klien Prisma,
 * termasuk singleton aplikasi, hanya bisa melihat database uji.
 *
 * Usage:
 *   npm test                        -> seluruh suite (tests/*.test.ts)
 *   npm test -- tests/foo.test.ts   -> hanya berkas yang disebutkan
 */
const DEFAULT_PATTERNS = ["tests/*.test.ts"];

function resolveTsxCli(): string {
  const cli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  if (!existsSync(cli)) {
    throw new Error("tsx tidak ditemukan di node_modules. Jalankan `npm ci` lebih dulu.");
  }
  return cli;
}

function main(): void {
  loadDatabaseEnvFile();

  const testUrl = resolveTestDatabaseUrl(process.env);
  const appUrl = (
    process.env[ORIGINAL_APP_DATABASE_URL_ENV] ??
    process.env[APP_DATABASE_URL_ENV] ??
    ""
  ).trim();
  const patterns = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));

  console.log(`Database uji     : ${describeDatabaseTarget(testUrl)}`);
  console.log(`Database aplikasi: ${describeDatabaseTarget(appUrl)} (tidak disentuh)`);

  const result = spawnSync(
    process.execPath,
    [
      resolveTsxCli(),
      "--test",
      "--test-concurrency=1",
      ...(patterns.length > 0 ? patterns : DEFAULT_PATTERNS),
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_ENV: "test",
        [APP_DATABASE_URL_ENV]: testUrl,
        [ORIGINAL_APP_DATABASE_URL_ENV]: appUrl,
      },
    },
  );

  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

try {
  main();
} catch (error) {
  console.error("Pengujian dibatalkan:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
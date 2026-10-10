import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { assertNotProduction } from "../src/lib/config/maintenance-guard";
import {
  APP_DATABASE_URL_ENV,
  describeDatabaseTarget,
  loadDatabaseEnvFile,
  resolveTestDatabaseUrl,
} from "../src/lib/config/test-database";

/**
 * Menyiapkan database uji terpisah: menjalankan migrasi resmi (`prisma migrate
 * deploy`) dan seed konfigurasi program pada database uji saja (Bagian 2 dan 8).
 *
 * Database uji harus sudah dibuat oleh operator (mis. `createdb tatorprofit_test`)
 * dan disebut di `TEST_DATABASE_URL`. Skrip ini tidak pernah menghapus, mereset,
 * atau memigrasi database aplikasi: `DATABASE_URL` untuk proses anak diganti
 * dengan `TEST_DATABASE_URL` yang diwajibkan berbeda.
 *
 * Usage: npm run db:test:setup
 */
function resolveCli(relativePath: string, hint: string): string {
  const cli = path.join(process.cwd(), ...relativePath.split("/"));
  if (!existsSync(cli)) throw new Error(`${hint} tidak ditemukan. Jalankan \`npm ci\` lebih dulu.`);
  return cli;
}

function run(label: string, script: string, args: string[], env: NodeJS.ProcessEnv): void {
  console.log(`\n> ${label}`);
  const result = spawnSync(process.execPath, [script, ...args], { stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} gagal (kode ${result.status ?? "?"}).`);
}

function main(): void {
  loadDatabaseEnvFile();
  assertNotProduction(process.env, "Penyiapan database uji");

  const testUrl = resolveTestDatabaseUrl(process.env);
  const env: NodeJS.ProcessEnv = { ...process.env, [APP_DATABASE_URL_ENV]: testUrl };

  console.log(`Menyiapkan database uji ${describeDatabaseTarget(testUrl)}.`);

  run(
    "prisma migrate deploy",
    resolveCli("node_modules/prisma/build/index.js", "Prisma CLI"),
    ["migrate", "deploy"],
    env,
  );
  run(
    "prisma seed (konfigurasi program)",
    resolveCli("node_modules/tsx/dist/cli.mjs", "tsx"),
    ["prisma/seed.ts"],
    env,
  );

  console.log(`\nDatabase uji siap: ${describeDatabaseTarget(testUrl)}`);
}

try {
  main();
} catch (error) {
  console.error(
    "Penyiapan database uji gagal:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
}
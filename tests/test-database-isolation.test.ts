import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  APP_DATABASE_URL_ENV,
  ORIGINAL_APP_DATABASE_URL_ENV,
  TEST_DATABASE_URL_ENV,
  TestDatabaseError,
  assertSandboxedTestProcess,
  describeDatabaseTarget,
  isSameDatabaseTarget,
  parseDatabaseTarget,
  resolveTestDatabaseUrl,
} from "../src/lib/config/test-database";
import {
  assertConfirmed,
  assertNotProduction,
  hasConfirmFlag,
} from "../src/lib/config/maintenance-guard";

/**
 * Pemisahan database pengujian (Bagian 2 dan 8): validasi murni konfigurasi
 * lingkungan, penjaga proses uji, dan guard skrip pemeliharaan.
 *
 * Berkas ini tidak menyentuh PostgreSQL sama sekali — pemeriksaan sumber hanya
 * membaca berkas di repositori.
 */
const ROOT = process.cwd();

const APP_URL = "postgresql://tatorprofit:tatorprofit@localhost:5432/tatorprofit?schema=public";
const TEST_URL =
  "postgresql://tatorprofit:tatorprofit@localhost:5432/tatorprofit_test?schema=public";

/** Env tiruan: hanya berisi kunci yang diuji, tanpa variabel proses nyata. */
function envOf(values: Record<string, string | undefined>) {
  return { ...values };
}

function readProjectFile(...segments: string[]): string {
  return readFileSync(path.join(ROOT, ...segments), "utf8");
}

describe("pembacaan URL database", () => {
  it("membaca host, port, nama database dan schema", () => {
    assert.deepEqual(parseDatabaseTarget(TEST_URL), {
      host: "localhost",
      port: "5432",
      database: "tatorprofit_test",
      schema: "public",
    });
  });

  it("memakai port 5432 dan schema public sebagai nilai bawaan", () => {
    assert.deepEqual(parseDatabaseTarget("postgres://user:pw@db.internal/tatorprofit_test"), {
      host: "db.internal",
      port: "5432",
      database: "tatorprofit_test",
      schema: "public",
    });
  });

  it("menolak URL yang bukan PostgreSQL, tanpa nama database, atau bukan URL", () => {
    assert.equal(parseDatabaseTarget("mysql://user:pw@localhost:3306/tatorprofit"), null);
    assert.equal(parseDatabaseTarget("postgresql://user:pw@localhost:5432/"), null);
    assert.equal(parseDatabaseTarget("bukan-url"), null);
  });

  it("mengabaikan perbedaan huruf besar/kecil saat membandingkan", () => {
    const a = parseDatabaseTarget(
      "postgresql://u:p@LOCALHOST:5432/TatorProfit_Test?schema=PUBLIC",
    );
    const b = parseDatabaseTarget(TEST_URL);
    assert.ok(a && b);
    assert.equal(isSameDatabaseTarget(a, b), true);
  });

  it("membedakan host, port, nama database dan schema", () => {
    const base = parseDatabaseTarget(TEST_URL);
    assert.ok(base);
    for (const other of [
      "postgresql://u:p@127.0.0.1:5432/tatorprofit_test?schema=public",
      "postgresql://u:p@localhost:5433/tatorprofit_test?schema=public",
      "postgresql://u:p@localhost:5432/tatorprofit_test2?schema=public",
      "postgresql://u:p@localhost:5432/tatorprofit_test?schema=shadow",
    ]) {
      const target = parseDatabaseTarget(other);
      assert.ok(target);
      assert.equal(isSameDatabaseTarget(base, target), false, other);
    }
  });

  it("tidak pernah menampilkan kata sandi pada keterangan target", () => {
    assert.equal(describeDatabaseTarget(TEST_URL), "localhost:5432/tatorprofit_test (skema public)");
    assert.equal(describeDatabaseTarget("bukan-url"), "(URL database tidak dikenal)");
  });
});

describe("penjaga database uji", () => {
  it("menerima database uji yang terpisah dari database aplikasi", () => {
    const url = resolveTestDatabaseUrl(
      envOf({ [TEST_DATABASE_URL_ENV]: TEST_URL, [APP_DATABASE_URL_ENV]: APP_URL }),
    );

    assert.equal(url, TEST_URL);
  });

  it("menolak konfigurasi tanpa TEST_DATABASE_URL", () => {
    assert.throws(
      () => resolveTestDatabaseUrl(envOf({ [APP_DATABASE_URL_ENV]: APP_URL })),
      (error: unknown) =>
        error instanceof TestDatabaseError && error.message.includes(TEST_DATABASE_URL_ENV),
    );
  });

  it("menolak pengujian di lingkungan produksi", () => {
    assert.throws(
      () =>
        resolveTestDatabaseUrl(
          envOf({
            NODE_ENV: "production",
            [TEST_DATABASE_URL_ENV]: TEST_URL,
            [APP_DATABASE_URL_ENV]: APP_URL,
          }),
        ),
      /produksi/,
    );
  });

  it("menolak database uji yang sama dengan database aplikasi", () => {
    // Kasus paling mungkin: operator menyalin DATABASE_URL ke TEST_DATABASE_URL.
    assert.throws(
      () =>
        resolveTestDatabaseUrl(
          envOf({ [TEST_DATABASE_URL_ENV]: TEST_URL, [APP_DATABASE_URL_ENV]: TEST_URL }),
        ),
      /sama dengan database aplikasi/,
    );

    // Database aplikasi yang kebetulan bernama `tatorprofit` tetap ditolak,
    // lewat aturan nama database.
    assert.throws(
      () =>
        resolveTestDatabaseUrl(
          envOf({ [TEST_DATABASE_URL_ENV]: APP_URL, [APP_DATABASE_URL_ENV]: APP_URL }),
        ),
      TestDatabaseError,
    );
  });

  it("menolak database aplikasi walau schema-nya berbeda", () => {
    // Ganti schema tidak memindahkan data ke database lain: nama database tetap
    // `tatorprofit`, jadi ini bukan database uji.
    assert.throws(
      () =>
        resolveTestDatabaseUrl(
          envOf({
            [TEST_DATABASE_URL_ENV]: "postgresql://u:p@localhost:5432/tatorprofit?schema=test",
            [APP_DATABASE_URL_ENV]: APP_URL,
          }),
        ),
      /nama database uji/i,
    );
  });

  it("menolak nama database yang tidak memuat kata test", () => {
    assert.throws(
      () =>
        resolveTestDatabaseUrl(
          envOf({
            [TEST_DATABASE_URL_ENV]: "postgresql://u:p@localhost:5432/tatorprofit_dev?schema=public",
            [APP_DATABASE_URL_ENV]: APP_URL,
          }),
        ),
      /harus memuat kata "test"/,
    );
  });

  it("menolak URL database uji yang bukan PostgreSQL", () => {
    assert.throws(
      () =>
        resolveTestDatabaseUrl(
          envOf({ [TEST_DATABASE_URL_ENV]: "sqlite:./test.db", [APP_DATABASE_URL_ENV]: APP_URL }),
        ),
      /bukan URL PostgreSQL/,
    );
  });

  it("menerima proses uji yang sudah dialihkan runner", () => {
    assert.doesNotThrow(() =>
      assertSandboxedTestProcess(
        envOf({
          NODE_ENV: "test",
          [TEST_DATABASE_URL_ENV]: TEST_URL,
          [APP_DATABASE_URL_ENV]: TEST_URL,
          [ORIGINAL_APP_DATABASE_URL_ENV]: APP_URL,
        }),
      ),
    );
  });

  it("menolak proses uji yang dijalankan langsung tanpa runner", () => {
    assert.throws(
      () =>
        assertSandboxedTestProcess(
          envOf({ [TEST_DATABASE_URL_ENV]: TEST_URL, [APP_DATABASE_URL_ENV]: APP_URL }),
        ),
      /Jalankan pengujian lewat/,
    );
  });

  it("menolak proses uji yang DATABASE_URL-nya belum dialihkan", () => {
    assert.throws(
      () =>
        assertSandboxedTestProcess(
          envOf({
            [TEST_DATABASE_URL_ENV]: TEST_URL,
            [APP_DATABASE_URL_ENV]: APP_URL,
            [ORIGINAL_APP_DATABASE_URL_ENV]: APP_URL,
          }),
        ),
      /Jalankan ulang lewat/,
    );
  });
});

describe("guard skrip pemeliharaan", () => {
  it("menolak eksekusi di produksi", () => {
    assert.throws(() => assertNotProduction({ NODE_ENV: "production" }, "Skrip uji"), /produksi/);
    assert.doesNotThrow(() => assertNotProduction({ NODE_ENV: "development" }, "Skrip uji"));
    assert.doesNotThrow(() => assertNotProduction({}, "Skrip uji"));
  });

  it("mewajibkan --confirm", () => {
    assert.equal(hasConfirmFlag(["--confirm"]), true);
    assert.equal(hasConfirmFlag(["demo_member"]), false);
    assert.throws(() => assertConfirmed([], "tambahkan --confirm."), /--confirm/);
    assert.doesNotThrow(() => assertConfirmed(["--confirm"], "tambahkan --confirm."));
  });
});

describe("runner dan skrip terpasang pada jalur yang aman", () => {
  it("menjadikan scripts/run-tests.ts sebagai skrip npm test", () => {
    const pkg = JSON.parse(readProjectFile("package.json")) as { scripts: Record<string, string> };

    assert.equal(pkg.scripts.test, "tsx scripts/run-tests.ts");
    assert.equal(pkg.scripts["db:test:setup"], "tsx scripts/prepare-test-database.ts");
  });

  it("mengalihkan DATABASE_URL ke database uji sebelum suite dimuat", () => {
    const source = readProjectFile("scripts", "run-tests.ts");

    assert.match(source, /resolveTestDatabaseUrl/);
    assert.match(source, /\[APP_DATABASE_URL_ENV\]: testUrl/);
    assert.match(source, /\[ORIGINAL_APP_DATABASE_URL_ENV\]: appUrl/);
    assert.match(source, /"--test"/);
  });

  it("memaksa setiap berkas uji memakai klien database uji", () => {
    const helper = readProjectFile("tests", "helpers", "prisma.ts");
    assert.match(helper, /assertSandboxedTestProcess\(\)/);
    assert.match(helper, /createTestPrismaClient/);

    const testFiles = readdirSync(path.join(ROOT, "tests")).filter((name) =>
      name.endsWith(".test.ts"),
    );
    assert.ok(testFiles.length > 0);

    // Dirakit dari potongan teks supaya pemeriksaan ini tidak menemukan polanya
    // di dalam berkas ini sendiri.
    const forbidden = ["new", "PrismaClient("].join(" ");
    const factoryCall = ["createTestPrismaClient", "()"].join("");

    for (const file of testFiles) {
      const source = readProjectFile("tests", file);
      assert.equal(
        source.includes(forbidden),
        false,
        `${file} membuat klien Prisma sendiri; pakai ${factoryCall}`,
      );
      if (source.includes(factoryCall)) {
        assert.match(source, /from "\.\/helpers\/prisma"/, file);
      }
    }
  });

  it("mewajibkan konfirmasi demo:reset dan menolak produksi di skrip pemeliharaan", () => {
    const demoReset = readProjectFile("scripts", "demo-reset.ts");
    assert.match(demoReset, /assertNotProduction/);
    assert.match(demoReset, /assertConfirmed/);

    for (const script of [
      "demo-local.ts",
      "verify-e2e.ts",
      "verify-payments.ts",
      "verify-routes.ts",
      "prepare-test-database.ts",
    ]) {
      assert.match(readProjectFile("scripts", script), /assertNotProduction/, script);
    }
  });

  it("mendokumentasikan pemisahan database pengujian", () => {
    const docs = readProjectFile("docs", "test-database-isolation.md");
    assert.match(docs, /TEST_DATABASE_URL/);
    assert.match(docs, /npm run db:test:setup/);

    assert.match(readProjectFile(".env.example"), /TEST_DATABASE_URL/);
    assert.match(
      readProjectFile("docs", "security-audit-and-production-readiness.md"),
      /test-database-isolation\.md/,
    );
  });
});
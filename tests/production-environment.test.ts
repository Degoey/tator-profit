import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  AUDIT_LOG_FAILURE_MARKER,
  SECURITY_EVENT_FAILURE_MARKER,
  describeAuditLogFailure,
  describeSecurityEventFailure,
} from "../src/lib/config/failure-notices";
import { assertNotProduction } from "../src/lib/config/maintenance-guard";
import {
  DEVELOPMENT_TOKEN_SECRET,
  MIN_TOKEN_SECRET_LENGTH,
  TokenSecretError,
  isProductionLikeEnvironment,
  resolveTokenSecret,
} from "../src/lib/config/production-environment";

/**
 * Bagian 8: aturan lingkungan "seperti produksi" (produksi dan staging diperlakukan
 * sama) serta notifikasi kegagalan jejak audit yang dapat ditelusuri.
 *
 * Berkas ini murni konfigurasi: tidak menyentuh PostgreSQL dan tidak memuat modul yang
 * butuh konteks permintaan Next (mis. `src/lib/security.ts`).
 */
const ROOT = process.cwd();

const LONG_SECRET = "s".repeat(MIN_TOKEN_SECRET_LENGTH);
const SHORT_SECRET = "s".repeat(MIN_TOKEN_SECRET_LENGTH - 1);

function readProjectFile(...segments: string[]): string {
  return readFileSync(path.join(ROOT, ...segments), "utf8");
}

describe("aturan lingkungan seperti produksi", () => {
  it("memperlakukan produksi dan staging dengan ketat", () => {
    assert.equal(isProductionLikeEnvironment({ NODE_ENV: "production" }), true);
    assert.equal(isProductionLikeEnvironment({ NODE_ENV: "staging" }), true);
    assert.equal(isProductionLikeEnvironment({ NODE_ENV: "  Staging  " }), true);
  });

  it("tidak mengetatkan pengembangan, pengujian, dan lingkungan tak dikenal", () => {
    for (const env of ["development", "test", "preview", "", undefined]) {
      assert.equal(isProductionLikeEnvironment({ NODE_ENV: env }), false, String(env));
    }
    assert.equal(isProductionLikeEnvironment({}), false);
  });
});

describe("secret token sesi", () => {
  it("memakai secret pengembangan di luar lingkungan seperti produksi", () => {
    assert.equal(resolveTokenSecret({ NODE_ENV: "development" }), DEVELOPMENT_TOKEN_SECRET);
    assert.equal(resolveTokenSecret({ NODE_ENV: "test" }), DEVELOPMENT_TOKEN_SECRET);
    assert.equal(resolveTokenSecret({}), DEVELOPMENT_TOKEN_SECRET);
  });

  it("menolak produksi dan staging tanpa AUTH_TOKEN_SECRET", () => {
    for (const nodeEnv of ["production", "staging"]) {
      assert.throws(
        () => resolveTokenSecret({ NODE_ENV: nodeEnv }),
        TokenSecretError,
        `${nodeEnv} harus menolak secret kosong`,
      );
      assert.throws(() => resolveTokenSecret({ NODE_ENV: nodeEnv }), /wajib diisi/);
    }
  });

  it("menolak secret yang lebih pendek dari 32 karakter", () => {
    for (const nodeEnv of ["production", "staging"]) {
      assert.throws(
        () => resolveTokenSecret({ NODE_ENV: nodeEnv, AUTH_TOKEN_SECRET: SHORT_SECRET }),
        TokenSecretError,
      );
      assert.throws(
        () => resolveTokenSecret({ NODE_ENV: nodeEnv, AUTH_TOKEN_SECRET: SHORT_SECRET }),
        /minimal 32 karakter/,
      );
    }
  });

  it("menerima secret yang cukup panjang dan memangkas spasi", () => {
    assert.equal(
      resolveTokenSecret({ NODE_ENV: "production", AUTH_TOKEN_SECRET: LONG_SECRET }),
      LONG_SECRET,
    );
    assert.equal(
      resolveTokenSecret({ NODE_ENV: "Staging", AUTH_TOKEN_SECRET: `  ${LONG_SECRET}  ` }),
      LONG_SECRET,
    );
  });
});

describe("guard skrip pemeliharaan", () => {
  it("menolak staging sama seperti produksi", () => {
    assert.throws(() => assertNotProduction({ NODE_ENV: "staging" }, "Skrip uji"), /produksi/);
    assert.throws(() => assertNotProduction({ NODE_ENV: "production" }, "Skrip uji"), /produksi/);
    assert.doesNotThrow(() => assertNotProduction({ NODE_ENV: "development" }, "Skrip uji"));
    assert.doesNotThrow(() => assertNotProduction({}, "Skrip uji"));
  });
});
describe("notifikasi kegagalan jejak audit", () => {
  it("menyebut aksi, entitas, dan pelaku entri audit", () => {
    const notice = describeAuditLogFailure({
      action: "ADMIN_MANUAL_CREDIT",
      entityType: "Transaction",
      entityId: "tx_123",
      actorUserId: "usr_123",
    });

    assert.ok(notice.startsWith(AUDIT_LOG_FAILURE_MARKER));
    assert.match(notice, /action=ADMIN_MANUAL_CREDIT/);
    assert.match(notice, /entity=Transaction:tx_123/);
    assert.match(notice, /actor=usr_123/);
  });

  it("memakai nilai bawaan saat entitas tanpa id dan tanpa pelaku", () => {
    const notice = describeAuditLogFailure({ action: "PROFILE_UPDATE", entityType: "User" });

    assert.match(notice, /entity=User actor=system$/);
    assert.equal(notice.includes("undefined"), false);
    assert.equal(notice.includes("null"), false);
  });

  it("menyebut jenis, tingkat keparahan, dan pemilik peristiwa keamanan", () => {
    const anonymous = describeSecurityEventFailure({ type: "LOGIN_FAILED" });
    assert.ok(anonymous.startsWith(SECURITY_EVENT_FAILURE_MARKER));
    assert.match(anonymous, /type=LOGIN_FAILED/);
    assert.match(anonymous, /severity=INFO/);
    assert.match(anonymous, /user=anonymous/);

    const known = describeSecurityEventFailure({
      type: "PASSWORD_RESET",
      severity: "WARN",
      userId: "usr_123",
    });
    assert.match(known, /severity=WARN/);
    assert.match(known, /user=usr_123/);
  });

  it("tidak pernah memuat data sensitif", () => {
    const notices = [
      describeAuditLogFailure({ action: "A", entityType: "User", entityId: "u" }),
      describeSecurityEventFailure({ type: "T", userId: "u" }),
    ];

    for (const notice of notices) {
      assert.equal(/token|password|secret|authorization/i.test(notice), false, notice);
    }
  });
});

describe("aturan terpusat benar-benar dipakai", () => {
  it("token sesi memakai resolveTokenSecret, bukan cek NODE_ENV sendiri", () => {
    const source = readProjectFile("src", "lib", "auth", "tokens.ts");

    assert.match(source, /resolveTokenSecret\(\)/);
    assert.equal(source.includes('NODE_ENV === "production"'), false);
    // Dirakit dari potongan teks supaya pemeriksaan ini tidak menemukan dirinya sendiri.
    const legacyFallback = ["tatorprofit-development-only", "secret"].join("-");
    assert.equal(source.includes(legacyFallback), false, "secret pengembangan ada di modul config");
  });

  it("cookie sesi ditandai Secure di seluruh lingkungan seperti produksi", () => {
    const source = readProjectFile("src", "lib", "auth", "session.ts");

    assert.match(source, /isProductionLikeEnvironment\(process\.env\)/);
    assert.equal(source.includes('NODE_ENV === "production"'), false);
  });

  it("kegagalan jejak audit memakai notifikasi terstruktur", () => {
    const source = readProjectFile("src", "lib", "security.ts");

    assert.match(source, /describeAuditLogFailure\(input\)/);
    assert.match(source, /describeSecurityEventFailure\(input\)/);
  });

  it("mendokumentasikan aturan ini untuk operator", () => {
    const audit = readProjectFile("docs", "security-audit-and-production-readiness.md");
    assert.match(audit, /production-environment\.ts/);
    assert.match(audit, /\[audit-log-failure\]/);

    assert.match(readProjectFile("docs", "test-database-isolation.md"), /staging/);
    assert.match(readProjectFile(".env.example"), /production and staging/);
  });
});
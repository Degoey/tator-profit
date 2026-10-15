/**
 * Penjaga Panel Admin (peran biasa).
 *
 * Pengujian ini mengunci sifat yang membuat panel berbeda dari Konsol Pemilik:
 * satu halaman per kapabilitas, navigasi yang mengikuti peran, kapabilitas milik
 * pemilik **tidak** ada di sini, dan setiap halaman tetap memutuskan sendiri di
 * server apa yang boleh dimuat.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { canAdmin } from "../src/lib/auth/admin-permissions";
import {
  ADMIN_CONSOLE_LINKS,
  ADMIN_CONSOLE_PATHS,
  adminConsoleLinksFor,
  type AdminConsolePath,
} from "../src/lib/config/admin-console";

const ROOT = process.cwd();

function readProjectFile(...segments: string[]): string {
  return readFileSync(path.join(ROOT, ...segments), "utf8");
}

function pageFileFor(href: AdminConsolePath): string {
  return path.join(ROOT, "src", "app", ...href.replace(/^\//, "").split("/"), "page.tsx");
}

function sourceOf(href: AdminConsolePath): string {
  return readFileSync(pageFileFor(href), "utf8");
}

describe("Panel Admin: navigasi mengikuti peran", () => {
  it("setiap halaman panel benar-benar ada sebagai berkas halaman", () => {
    for (const href of ADMIN_CONSOLE_PATHS) {
      assert.ok(existsSync(pageFileFor(href)), `${href} tidak punya berkas halaman`);
    }
  });

  it("SUPER_ADMIN dan FINANCE membuka seluruh halaman panel", () => {
    for (const role of ["SUPER_ADMIN", "FINANCE"] as const) {
      assert.deepEqual(
        adminConsoleLinksFor(role).map((link) => link.href),
        [...ADMIN_CONSOLE_PATHS],
        `${role} harus membuka semua halaman panel`,
      );
    }
  });

  it("SUPPORT dan VIEWER tidak ditawari jejak audit maupun anti-fraud", () => {
    for (const role of ["SUPPORT", "VIEWER"] as const) {
      const paths = adminConsoleLinksFor(role).map((link) => link.href);

      assert.equal(paths.includes("/admin/audit"), false, `${role} tidak boleh melihat audit`);
      assert.equal(paths.includes("/admin/fraud"), false, `${role} tidak boleh melihat fraud`);
      assert.equal(paths.includes("/admin/deposit"), true, `${role} boleh membaca deposit`);
      assert.equal(paths.includes("/admin/penarikan"), true, `${role} boleh membaca penarikan`);
    }
  });

  it("COMPLIANCE membuka antrean tetapi tanpa kapabilitas uang", () => {
    const paths = adminConsoleLinksFor("COMPLIANCE").map((link) => link.href);

    assert.equal(paths.includes("/admin/audit"), true, "COMPLIANCE membaca jejak audit");
    assert.equal(paths.includes("/admin/fraud"), true, "COMPLIANCE meninjau anti-fraud");
    assert.equal(canAdmin("COMPLIANCE", "reviewDeposit"), false);
    assert.equal(canAdmin("COMPLIANCE", "reviewWithdrawal"), false);
    assert.equal(canAdmin("COMPLIANCE", "manageFinance"), false);
  });

  it("admin tanpa peran tidak mendapat satu halaman pun", () => {
    assert.deepEqual(adminConsoleLinksFor(null), []);
    assert.deepEqual(adminConsoleLinksFor(undefined), []);
  });
});

describe("Panel Admin: kapabilitas pemilik tidak ikut pindah", () => {
  it("tidak ada halaman kredit saldo atau pengelola peran di panel", () => {
    for (const link of ADMIN_CONSOLE_LINKS) {
      assert.notEqual(link.permission, "creditBalance");
      assert.notEqual(link.permission, "manageUsers");
    }

    for (const href of ADMIN_CONSOLE_PATHS) {
      assert.equal(
        /kredit|credit|peran|role/i.test(href),
        false,
        `${href} seharusnya tidak ada di panel peran biasa`,
      );
    }
  });

  it("halaman panel tidak merender formulir kredit maupun pengelola peran", () => {
    const sources = [
      ...ADMIN_CONSOLE_PATHS.map((href) => sourceOf(href)),
      readProjectFile("src", "components", "admin", "admin-shell.tsx"),
    ];

    for (const source of sources) {
      assert.equal(source.includes("AdminCreditForm"), false, "kredit saldo tetap milik pemilik");
      assert.equal(source.includes("AdminRoleManager"), false, "peran admin tetap milik pemilik");
    }
  });

  it("akun pemilik diarahkan ke Konsol Pemilik untuk dua tindakan itu", () => {
    const shell = readProjectFile("src", "components", "admin", "admin-shell.tsx");

    assert.ok(shell.includes('href="/owner"'), "panel harus menunjuk Konsol Pemilik");
    assert.ok(shell.includes("Menambah saldo USDT dan mengubah peran admin"));
  });
});

describe("Panel Admin: penjagaan di server", () => {
  it("layout menolak tamu, akun non-admin, dan admin tanpa peran", () => {
    const layout = readProjectFile("src", "app", "admin", "layout.tsx");

    assert.ok(layout.includes('redirect("/login?next=%2Fadmin")'), "tamu harus diarahkan masuk");
    assert.ok(
      layout.includes('user.role !== "ADMIN" || !user.adminRole'),
      "admin tanpa peran harus ditolak (fail closed)",
    );
    assert.ok(layout.includes('redirect("/dashboard?error=forbidden")'));
  });

  it("setiap halaman memakai penjagaan dasar panel, bukan penjagaan peran tertentu", () => {
    for (const href of ADMIN_CONSOLE_PATHS) {
      const source = sourceOf(href);

      assert.ok(
        source.includes("requireAdminConsole"),
        `${href} harus memakai requireAdminConsole`,
      );
      assert.equal(
        source.includes("requireOwnerPage"),
        false,
        `${href} tidak boleh memakai penjagaan Konsol Pemilik`,
      );
    }
  });

  it("halaman audit dan anti-fraud tidak memuat baris untuk peran tanpa kapabilitas", () => {
    assert.ok(
      sourceOf("/admin/audit").includes("canReadAudit ? await listAuditTrailForConsole() : []"),
      "baris audit harus hanya dimuat bila berwenang",
    );
    assert.ok(
      sourceOf("/admin/fraud").includes('canReadFraud ? await listFraudCases("ALL") : []'),
      "baris anti-fraud harus hanya dimuat bila berwenang",
    );
  });

  it("halaman deposit tidak mengirim berkas bukti ke peran tanpa readProof", () => {
    const page = sourceOf("/admin/deposit");
    const service = readProjectFile("src", "lib", "services", "admin-console-service.ts");

    assert.ok(page.includes('canAdmin(admin.adminRole, "readProof")'));
    assert.ok(service.includes("proofFileName: options.canReadProof ? row.proofFileName : null"));
  });

  it("tindakan uang tetap lewat API lama, bukan layanan baru", () => {
    // Halaman panel tidak boleh menyentuh layanan ledger langsung: uang hanya
    // bergerak lewat /api/admin/* yang sudah memakai layanan transaksi.
    for (const href of ADMIN_CONSOLE_PATHS) {
      const source = sourceOf(href);

      for (const forbidden of ["postLedgerEntry", "creditBalanceByAdmin", "prisma.$transaction"]) {
        assert.equal(source.includes(forbidden), false, `${href} tidak boleh memakai ${forbidden}`);
      }
    }
  });
});

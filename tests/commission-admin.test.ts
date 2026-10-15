/**
 * Permukaan admin untuk menyelesaikan komisi rujukan (G2).
 *
 * Dua lapis diuji tanpa database karena keduanya murni:
 *
 *  1. `src/lib/commission-actions.ts` — transisi status yang boleh dijalankan
 *     pada setiap status baris komisi (PENDING -> APPROVED -> PAID, plus
 *     REJECTED / VOID) beserta kewajiban alasan;
 *  2. `src/lib/commission-validation.ts` — badan permintaan dan parameter daftar
 *     yang diterima `POST`/`GET /api/admin/commissions`.
 *
 * Sisi datanya (antrean, pemisahan wewenang, saldo bertambah tepat sekali) diuji
 * terhadap PostgreSQL di `tests/referral-engine.test.ts`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  COMMISSION_ACTION_LABELS,
  COMMISSION_ACTIONS,
  commissionActionRequiresReason,
  commissionActionsForStatus,
} from "../src/lib/commission-actions";
import {
  adminCommissionActionSchema,
  commissionListQuerySchema,
} from "../src/lib/commission-validation";

/** `npm test` selalu berjalan dari akar repositori. */
const ROOT = process.cwd();

function readProjectFile(...segments: string[]): string {
  return readFileSync(path.join(ROOT, ...segments), "utf8");
}

describe("tindakan komisi rujukan", () => {
  it("membatasi transisi pada status baris komisi", () => {
    assert.deepEqual(commissionActionsForStatus("PENDING"), ["APPROVE", "REJECT", "VOID"]);
    assert.deepEqual(commissionActionsForStatus("APPROVED"), ["PAY", "REJECT", "VOID"]);
  });

  it("tidak menawarkan aksi apa pun pada status akhir", () => {
    for (const status of ["PAID", "REJECTED", "VOID", "STATUS_BARU"]) {
      assert.deepEqual(commissionActionsForStatus(status), [], `status=${status}`);
    }
  });

  it("mewajibkan alasan hanya untuk penolakan dan pembatalan", () => {
    assert.equal(commissionActionRequiresReason("REJECT"), true);
    assert.equal(commissionActionRequiresReason("VOID"), true);
    assert.equal(commissionActionRequiresReason("APPROVE"), false);
    assert.equal(commissionActionRequiresReason("PAY"), false);
  });

  it("memberi setiap tindakan label berbahasa Indonesia", () => {
    for (const action of COMMISSION_ACTIONS) {
      assert.ok(COMMISSION_ACTION_LABELS[action]?.length > 0, `action=${action}`);
    }
  });
});

describe("validasi badan permintaan aksi komisi", () => {
  it("menerima persetujuan tanpa alasan dan memangkas spasi pada alasan", () => {
    const approve = adminCommissionActionSchema.safeParse({
      commissionId: "6b1e0000-0000-4000-8000-000000000001",
      action: "APPROVE",
    });
    assert.equal(approve.success, true);

    const rejected = adminCommissionActionSchema.safeParse({
      commissionId: "6b1e0000-0000-4000-8000-000000000001",
      action: "REJECT",
      reason: "  bukti transaksi sumber tidak sah  ",
    });
    assert.equal(rejected.success, true);
    assert.equal(rejected.data?.reason, "bukti transaksi sumber tidak sah");
  });

  it("menolak penolakan/pembatalan tanpa alasan yang cukup", () => {
    for (const action of ["REJECT", "VOID"] as const) {
      const missing = adminCommissionActionSchema.safeParse({
        commissionId: "6b1e0000-0000-4000-8000-000000000001",
        action,
      });
      assert.equal(missing.success, false, `action=${action}`);
      assert.equal(missing.error?.issues[0]?.path[0], "reason", `action=${action}`);

      const tooShort = adminCommissionActionSchema.safeParse({
        commissionId: "6b1e0000-0000-4000-8000-000000000001",
        action,
        reason: "ab",
      });
      assert.equal(tooShort.success, false, `action=${action}`);
    }
  });

  it("menolak tindakan yang tidak dikenal dan kolom tambahan", () => {
    assert.equal(
      adminCommissionActionSchema.safeParse({ commissionId: "abc", action: "DELETE" }).success,
      false,
    );
    assert.equal(
      adminCommissionActionSchema.safeParse({ commissionId: "", action: "PAY" }).success,
      false,
      "identitas komisi wajib diisi",
    );
    assert.equal(
      adminCommissionActionSchema.safeParse({
        commissionId: "6b1e0000-0000-4000-8000-000000000001",
        action: "PAY",
        status: "PAID",
      }).success,
      false,
      "status tidak boleh ditentukan klien; server yang memutuskan",
    );
  });
});

describe("parameter daftar komisi admin", () => {
  it("memberi nilai bawaan take dan skip", () => {
    const parsed = commissionListQuerySchema.parse({});
    assert.equal(parsed.take, 100);
    assert.equal(parsed.skip, 0);
    assert.equal(parsed.status, undefined);
  });

  it("mengubah string kueri menjadi angka dan memangkas kata kunci", () => {
    const parsed = commissionListQuerySchema.parse({
      take: "25",
      skip: "50",
      status: "APPROVED",
      search: "  g1  ",
    });
    assert.equal(parsed.take, 25);
    assert.equal(parsed.skip, 50);
    assert.equal(parsed.status, "APPROVED");
    assert.equal(parsed.search, "g1");
  });

  it("menolak status, batas, dan kata kunci yang tidak sah", () => {
    assert.equal(commissionListQuerySchema.safeParse({ status: "SUCCESS" }).success, false);
    assert.equal(commissionListQuerySchema.safeParse({ take: "0" }).success, false);
    assert.equal(commissionListQuerySchema.safeParse({ take: "500" }).success, false);
    assert.equal(commissionListQuerySchema.safeParse({ skip: "-1" }).success, false);
    assert.equal(commissionListQuerySchema.safeParse({ search: "x".repeat(101) }).success, false);
  });
});

describe("batas wewenang permukaan komisi admin", () => {
  const routeSource = readProjectFile("src", "app", "api", "admin", "commissions", "route.ts");
  const serviceSource = readProjectFile("src", "lib", "services", "referral-service.ts");
  /**
   * Sejak Panel Admin dipecah menjadi satu halaman per kapabilitas, antrean komisi
   * dirender di `/admin/komisi` dan kuerinya tinggal di modul layanan panel.
   */
  const pageSource = readProjectFile("src", "app", "admin", "komisi", "page.tsx");
  const consoleServiceSource = readProjectFile("src", "lib", "services", "admin-console-service.ts");

  it("membaca antrean dengan kemampuan read dan mengubahnya dengan manageFinance", () => {
    assert.ok(routeSource.includes('requireAdminPermission("read")'), "GET memakai kemampuan read");
    assert.ok(
      routeSource.includes('requireAdminPermission("manageFinance")'),
      "POST memerlukan SUPER_ADMIN atau FINANCE",
    );
    assert.ok(
      routeSource.includes("assertSameOrigin(request)"),
      "tindakan keuangan menolak permintaan lintas situs",
    );
  });

  it("memeriksa ulang peran administrator di dalam service, bukan hanya di rute", () => {
    assert.ok(
      serviceSource.includes('canAdmin(actor.adminRole, "manageFinance")'),
      "service memakai matriks kemampuan yang sama dengan rute admin lain",
    );
  });

  it("menyematkan antrean komisi ke panel admin untuk peran apa pun", () => {
    assert.ok(pageSource.includes("<AdminCommissionReview"), "panel komisi dirender di /admin/komisi");
    assert.ok(
      consoleServiceSource.includes("listCommissionsForAdmin({ take: 100 })"),
      "antrean dimuat server-side, bukan dari klien",
    );
  });

  it("memasukkan ReferralCommission ke jejak audit yang dimuat panel", () => {
    assert.ok(
      consoleServiceSource.includes('"ReferralCommission"'),
      "riwayat audit setiap baris komisi ikut dimuat",
    );
  });
});

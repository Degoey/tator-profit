import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ADMIN_ROLE_PERMISSIONS,
  adminPermissionsOf,
  canAdmin,
  canReviewDepositAction,
  type AdminPermission,
} from "../src/lib/auth/admin-permissions";
import { assertSameOrigin } from "../src/lib/request-origin";

const ALL_ROLES = ["SUPER_ADMIN", "FINANCE", "SUPPORT", "COMPLIANCE", "VIEWER"] as const;

describe("canAdmin", () => {
  it("menolak akun tanpa peran admin yang ditetapkan (fail closed)", () => {
    for (const role of [null, undefined]) {
      for (const permission of ["read", "readProof", "reviewDeposit", "reviewWithdrawal", "manageFinance"] as AdminPermission[]) {
        assert.equal(canAdmin(role, permission), false, `role=${String(role)} permission=${permission}`);
      }
    }
  });

  it("mengizinkan semua peran admin membaca antrean dan membatasi bukti privat", () => {
    for (const role of ALL_ROLES) {
      assert.equal(canAdmin(role, "read"), true, `role=${role}`);
    }

    // Bukti pembayaran adalah data privat: peran peninjau boleh membukanya,
    // VIEWER hanya-baca tidak.
    for (const role of ["SUPER_ADMIN", "FINANCE", "SUPPORT", "COMPLIANCE"] as const) {
      assert.equal(canAdmin(role, "readProof"), true, `role=${role}`);
    }
    assert.equal(canAdmin("VIEWER", "readProof"), false);
  });

  it("hanya SUPER_ADMIN dan FINANCE yang boleh memindahkan uang", () => {
    const allowed = ALL_ROLES.filter((role) =>
      canAdmin(role, "reviewDeposit") && canAdmin(role, "reviewWithdrawal") && canAdmin(role, "manageFinance"),
    );

    assert.deepEqual([...allowed].sort(), ["FINANCE", "SUPER_ADMIN"]);
  });

  it("tidak memberikan kemampuan meninjau kepada SUPPORT dan VIEWER", () => {
    for (const role of ["SUPPORT", "VIEWER"] as const) {
      assert.equal(canAdmin(role, "reviewDeposit"), false, `role=${role}`);
      assert.equal(canAdmin(role, "reviewWithdrawal"), false, `role=${role}`);
      assert.equal(canAdmin(role, "manageFinance"), false, `role=${role}`);
    }
  });
});

describe("matriks izin admin eksplisit", () => {
  it("memberi setiap peran daftar izin yang eksplisit tanpa duplikat", () => {
    for (const role of ALL_ROLES) {
      const permissions = ADMIN_ROLE_PERMISSIONS[role];
      assert.ok(permissions.length > 0, `role=${role}`);
      assert.equal(new Set(permissions).size, permissions.length, `duplikat pada ${role}`);
    }
  });

  it("hanya SUPER_ADMIN dan FINANCE yang boleh memberi kredit saldo", () => {
    const allowed = ALL_ROLES.filter((role) => canAdmin(role, "creditBalance"));

    assert.deepEqual([...allowed].sort(), ["FINANCE", "SUPER_ADMIN"]);
  });

  it("membatasi jejak audit pada SUPER_ADMIN, FINANCE, dan COMPLIANCE", () => {
    const allowed = ALL_ROLES.filter((role) => canAdmin(role, "readAudit"));

    assert.deepEqual([...allowed].sort(), ["COMPLIANCE", "FINANCE", "SUPER_ADMIN"]);
  });

  it("membatasi perubahan peran administrator pada SUPER_ADMIN", () => {
    const allowed = ALL_ROLES.filter((role) => canAdmin(role, "manageUsers"));

    assert.deepEqual([...allowed], ["SUPER_ADMIN"]);
  });

  it("menjaga VIEWER tetap hanya-baca", () => {
    // VIEWER hanya boleh membaca; hak baca laporan trading yang sudah terbit
    // diberikan agar laporan dapat ditinjau tanpa kemampuan mengubah apa pun.
    assert.deepEqual([...adminPermissionsOf("VIEWER")], ["read", "readTrading"]);
    for (const permission of [
      "readAudit",
      "reviewDeposit",
      "reviewWithdrawal",
      "manageFinance",
      "creditBalance",
      "manageUsers",
    ] as AdminPermission[]) {
      assert.equal(canAdmin("VIEWER", permission), false, `permission=${permission}`);
    }
  });

  it("tidak memberi SUPPORT dan COMPLIANCE kemampuan memindahkan uang", () => {
    for (const role of ["SUPPORT", "COMPLIANCE"] as const) {
      assert.equal(canAdmin(role, "creditBalance"), false, `role=${role}`);
      assert.equal(canAdmin(role, "manageFinance"), false, `role=${role}`);
    }
  });

  it("memberi peran kosong daftar izin kosong (fail closed)", () => {
    for (const role of [null, undefined]) {
      assert.deepEqual([...adminPermissionsOf(role)], []);
    }
  });
});

describe("canReviewDepositAction", () => {
  it("membatasi COMPLIANCE pada peninjauan dan penandaan saja", () => {
    assert.equal(canReviewDepositAction("COMPLIANCE", "UNDER_REVIEW"), true);
    assert.equal(canReviewDepositAction("COMPLIANCE", "FLAGGED"), true);
    assert.equal(canReviewDepositAction("COMPLIANCE", "APPROVED"), false);
    assert.equal(canReviewDepositAction("COMPLIANCE", "REJECTED"), false);
  });

  it("memberi SUPER_ADMIN dan FINANCE seluruh aksi setoran", () => {
    for (const role of ["SUPER_ADMIN", "FINANCE"] as const) {
      for (const action of ["UNDER_REVIEW", "APPROVED", "REJECTED", "FLAGGED"]) {
        assert.equal(canReviewDepositAction(role, action), true, `role=${role} action=${action}`);
      }
    }
  });

  it("menolak SUPPORT, VIEWER dan peran kosong untuk semua aksi setoran", () => {
    for (const role of ["SUPPORT", "VIEWER", null] as const) {
      for (const action of ["UNDER_REVIEW", "APPROVED", "REJECTED", "FLAGGED"]) {
        assert.equal(canReviewDepositAction(role, action), false, `role=${String(role)} action=${action}`);
      }
    }
  });
});

describe("assertSameOrigin", () => {
  it("menerima permintaan dari origin yang sama", () => {
    const request = new Request("http://localhost:3000/api/deposits", {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
    });

    assert.equal(assertSameOrigin(request), true);
  });

  it("menolak permintaan tanpa header Origin", () => {
    const request = new Request("http://localhost:3000/api/deposits", { method: "POST" });

    assert.equal(assertSameOrigin(request), false);
  });

  it("menolak origin lain dan origin yang tidak dapat dibaca", () => {
    const crossSite = new Request("http://localhost:3000/api/deposits", {
      method: "POST",
      headers: { origin: "https://penyerang.example" },
    });
    const malformed = new Request("http://localhost:3000/api/deposits", {
      method: "POST",
      headers: { origin: "bukan-url" },
    });

    assert.equal(assertSameOrigin(crossSite), false);
    assert.equal(assertSameOrigin(malformed), false);
  });

  it("membandingkan skema, host dan port, bukan hanya host", () => {
    const differentPort = new Request("http://localhost:3000/api/deposits", {
      method: "POST",
      headers: { origin: "http://localhost:4000" },
    });
    const differentScheme = new Request("http://localhost:3000/api/deposits", {
      method: "POST",
      headers: { origin: "https://localhost:3000" },
    });

    assert.equal(assertSameOrigin(differentPort), false);
    assert.equal(assertSameOrigin(differentScheme), false);
  });

  /**
   * The dev server reports `request.url` as localhost even when the browser
   * reached it through the machine's LAN address (phone or emulator WebView).
   * The Host header carries the authority the client actually addressed.
   */
  it("menerima origin yang cocok dengan header Host saat request.url dinormalkan ke localhost", () => {
    const request = new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { origin: "http://10.0.2.2:3000", host: "10.0.2.2:3000" },
    });

    assert.equal(assertSameOrigin(request), true);
  });

  it("tetap menolak origin yang tidak cocok dengan header Host", () => {
    const crossSite = new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { origin: "https://penyerang.example", host: "10.0.2.2:3000" },
    });
    const wrongPort = new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { origin: "http://10.0.2.2:4000", host: "10.0.2.2:3000" },
    });

    assert.equal(assertSameOrigin(crossSite), false);
    assert.equal(assertSameOrigin(wrongPort), false);
  });

  it("menghormati X-Forwarded-Proto saat berada di belakang reverse proxy TLS", () => {
    const request = new Request("http://app.tatorprofit.id/api/auth/login", {
      method: "POST",
      headers: {
        origin: "https://app.tatorprofit.id",
        host: "app.tatorprofit.id",
        "x-forwarded-proto": "https",
      },
    });

    assert.equal(assertSameOrigin(request), true);
  });

  it("kembali ke origin dari request.url bila header Host tidak ada", () => {
    const request = new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
    });

    assert.equal(assertSameOrigin(request), true);
  });
});

describe("kapabilitas modul Profit Trading", () => {
  const TRADING_WRITE = [
    "manageTrading",
    "approveTradingReport",
    "recordProfitPayment",
  ] as AdminPermission[];

  it("membuka pembacaan laporan trading untuk semua peran admin", () => {
    for (const role of ALL_ROLES) {
      assert.equal(canAdmin(role, "readTrading"), true, `role=${role}`);
    }
  });

  it("membatasi pencatatan, persetujuan, dan pembayaran pada SUPER_ADMIN dan FINANCE", () => {
    for (const permission of TRADING_WRITE) {
      const allowed = ALL_ROLES.filter((role) => canAdmin(role, permission));
      assert.deepEqual([...allowed].sort(), ["FINANCE", "SUPER_ADMIN"], `permission=${permission}`);
    }
  });

  it("membatasi jejak audit trading pada SUPER_ADMIN, FINANCE, dan COMPLIANCE", () => {
    const allowed = ALL_ROLES.filter((role) => canAdmin(role, "readTradingAudit"));

    assert.deepEqual([...allowed].sort(), ["COMPLIANCE", "FINANCE", "SUPER_ADMIN"]);
  });

  it("menjaga SUPPORT dan VIEWER tidak dapat mengubah apa pun di modul trading", () => {
    for (const role of ["SUPPORT", "VIEWER"] as const) {
      for (const permission of TRADING_WRITE) {
        assert.equal(canAdmin(role, permission), false, `role=${role} permission=${permission}`);
      }
      assert.equal(canAdmin(role, "readTradingAudit"), false, `role=${role}`);
    }
  });

  it("menolak akun tanpa peran admin untuk seluruh kapabilitas trading", () => {
    for (const role of [null, undefined]) {
      for (const permission of [
        "readTrading",
        ...TRADING_WRITE,
        "readTradingAudit",
      ] as AdminPermission[]) {
        assert.equal(canAdmin(role, permission), false);
      }
    }
  });
});

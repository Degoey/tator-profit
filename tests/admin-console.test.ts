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

  it("komponen kredit dan pengelola peran lama sudah tidak ada lagi di panel", () => {
    // Monolit lama menyimpan kedua formulir itu di `src/components/payments/`;
    // keduanya sudah digantikan Konsol Pemilik, jadi berkasnya tidak boleh kembali.
    for (const orphan of [
      ["src", "components", "payments", "admin-credit-form.tsx"],
      ["src", "components", "payments", "admin-role-manager.tsx"],
    ]) {
      assert.equal(existsSync(path.join(ROOT, ...orphan)), false, `${orphan.join("/")} harus dihapus`);
    }
  });

  it("pengelola peran administrator tinggal di Konsol Pemilik, lewat rute pemilik", () => {
    const page = readProjectFile("src", "app", "owner", "peran", "page.tsx");
    const route = readProjectFile("src", "app", "api", "owner", "users", "role", "route.ts");
    const shell = readProjectFile("src", "components", "owner", "owner-shell.tsx");

    assert.ok(page.includes("requireOwnerPage"), "halaman peran memakai penjagaan pemilik");
    assert.ok(page.includes("OwnerRoleManager"));
    assert.ok(page.includes("listAdministrators"));
    assert.ok(shell.includes('"/owner/peran"'), "navigasi pemilik harus menautkan halaman peran");

    // Faktor kedua tidak boleh bisa dilewati lewat rute admin lama.
    assert.ok(route.includes("requireOwnerApi"), "rute peran memakai penjagaan pemilik");
    assert.ok(route.includes("assignAdminRole"), "aturan peran tetap di satu layanan");
    assert.ok(route.includes("assertSameOrigin(request)"));
    assert.equal(route.includes("getAdminActor"), false, "rute pemilik tidak memakai penjagaan admin biasa");
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

describe("Panel Admin: kelengkapan siklus anggota", () => {
  it("halaman keanggotaan hanya memberi tindakan kepada peran berkapabilitas uang", () => {
    const page = sourceOf("/admin/keanggotaan");

    assert.ok(page.includes('canAdmin(admin.adminRole, "manageFinance")'));
    assert.ok(page.includes("listMembershipQueueForConsole"));
    for (const action of ["activate", "generate", "suspend", "resume", "complete", "cancel"]) {
      assert.ok(page.includes(`"${action}"`), `aksi ${action} tidak ditawarkan di halaman`);
    }
    assert.ok(
      page.includes(': []'),
      "peran tanpa manageFinance harus menerima daftar aksi kosong (hanya baca)",
    );
  });

  it("halaman imbalan memisahkan catat, setujui, dan bayar", () => {
    const page = sourceOf("/admin/imbalan");
    const component = readProjectFile(
      "src",
      "components",
      "payments",
      "admin-reward-review.tsx",
    );

    assert.ok(page.includes('canAdmin(admin.adminRole, "manageFinance")'));
    assert.ok(page.includes("listRewardQueueForConsole"));
    for (const action of ["approve", "pay", "reject", "void"]) {
      assert.ok(page.includes(`"${action}"`), `aksi imbalan ${action} tidak ditawarkan`);
    }

    // "Bayar" hanya muncul setelah baris APPROVED, sehingga saldo tidak pernah
    // berpindah langsung dari imbalan yang baru dicatat.
    assert.ok(
      component.includes('value: "pay"') && component.includes('allowedFrom: ["APPROVED"]'),
      "aksi bayar harus dibatasi pada baris yang sudah disetujui",
    );
    assert.ok(
      component.includes('value: "approve"') && component.includes('allowedFrom: ["PENDING"]'),
      "aksi setujui hanya untuk baris yang masih menunggu",
    );
  });

  it("direktori anggota hanya membaca dan tidak menawarkan kredit saldo", () => {
    const page = sourceOf("/admin/anggota");
    const component = readProjectFile(
      "src",
      "components",
      "payments",
      "admin-member-directory.tsx",
    );

    assert.ok(page.includes("listMemberDirectoryForConsole"));
    assert.equal(component.includes("fetch("), false, "direktori tidak boleh mengirim aksi");
    assert.equal(page.includes("creditBalance"), false, "kredit saldo tetap milik pemilik");
  });

  it("istilah Imbalan dipakai untuk imbalan anggota, rabat untuk komisi rujukan", () => {
    const labels = new Map(ADMIN_CONSOLE_LINKS.map((link) => [link.href, link.label]));

    assert.equal(labels.get("/admin/imbalan"), "Imbalan anggota");
    assert.equal(labels.get("/admin/rabat"), "Rabat rujukan");
    assert.ok(
      sourceOf("/admin/rabat").includes("Persentase rabat"),
      "halaman rabat harus tetap memuat pengaturan persentase",
    );
  });

  it("setiap halaman baru memakai penjagaan panel dan kapabilitasnya sendiri", () => {
    const membership = sourceOf("/admin/keanggotaan");
    const rewards = sourceOf("/admin/imbalan");
    const directory = sourceOf("/admin/anggota");

    for (const [href, source] of [
      ["/admin/keanggotaan", membership],
      ["/admin/imbalan", rewards],
      ["/admin/anggota", directory],
    ] as const) {
      assert.ok(source.includes("requireAdminConsole"), `${href} harus memakai penjagaan panel`);
      assert.equal(
        source.includes("requireOwnerPage"),
        false,
        `${href} bukan halaman pemilik`,
      );
    }

    // Direktori boleh dibaca semua peran, jadi tidak boleh bergantung pada
    // kapabilitas uang apa pun untuk memuat baris.
    assert.equal(directory.includes("manageFinance"), false, "direktori tidak butuh kapabilitas uang");
  });
});

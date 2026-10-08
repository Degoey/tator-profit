import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  ReferralCommissionRow,
  ReferralLevelRow,
  ReferralMemberRow,
  ReferralTotals,
} from "../src/app/referral/overview";
import { inspectReferralQuery, referralQueryRejectionMessage } from "../src/app/api/referral/guard";
import { ReferralCodeCard, buildReferralLink } from "../src/components/referral/referral-code-card";
import { ReferralCommissionTable } from "../src/components/referral/referral-commission-table";
import { ReferralMemberTable } from "../src/components/referral/referral-member-table";
import { ReferralSummary } from "../src/components/referral/referral-summary";
import { ReferralTree } from "../src/components/referral/referral-tree";
import type { NetworkNode, ReferralNetwork } from "../src/lib/referral-network";

/** React SSR inserts `<!-- -->` between adjacent text nodes; strip it before matching copy. */
function render(element: ReactElement): string {
  return renderToStaticMarkup(element).replace(/<!--[\s\S]*?-->/g, "");
}

function node(id: string, level: number, children: NetworkNode[] = []): NetworkNode {
  return { id, username: id, level, children };
}

const deepChain = node("pusat", 0, [
  node("gen1", 1, [node("gen2", 2, [node("gen3", 3, [node("gen4", 4, [node("gen5", 5)])])])]),
]);

const network: ReferralNetwork = {
  root: deepChain,
  counts: [1, 1, 1, 1, 1],
  total: 5,
  truncated: false,
};

const levels = [
  { level: 1, rate: "10%" },
  { level: 2, rate: "2%" },
  { level: 3, rate: "1%" },
  { level: 4, rate: "1%" },
  { level: 5, rate: "1%" },
];

const levelRows: ReferralLevelRow[] = [
  { level: 1, label: "Rujukan langsung", rate: "10%", members: 1, commissionCount: 2, commissionTotal: "12.50", currency: "USDT" },
  { level: 2, label: "Tingkat 2", rate: "2%", members: 1, commissionCount: 0, commissionTotal: "0.00", currency: "USDT" },
  { level: 3, label: "Tingkat 3", rate: "1%", members: 1, commissionCount: 0, commissionTotal: "0.00", currency: "USDT" },
  { level: 4, label: "Tingkat 4", rate: "1%", members: 1, commissionCount: 0, commissionTotal: "0.00", currency: "USDT" },
  { level: 5, label: "Tingkat 5", rate: "1%", members: 1, commissionCount: 0, commissionTotal: "0.00", currency: "USDT" },
];

const totals: ReferralTotals = {
  pending: "1.00",
  approved: "0.50",
  paid: "12.50",
  rejected: "0.25",
  voided: "0.00",
  currency: "USDT",
  count: 4,
};

const commissions: ReferralCommissionRow[] = [
  { id: "c1", level: 1, amount: "10.00", rate: "0.1000", baseAmount: "100.00", currency: "USDT", status: "PAID", statusLabel: "Dibayar", sourceUsername: "gen1", sourceReference: "program:u1:funds", createdAt: new Date("2026-01-05T00:00:00.000Z") },
  { id: "c2", level: 2, amount: "1.00", rate: "0.0200", baseAmount: "50.00", currency: "USDT", status: "PENDING", statusLabel: "Menunggu", sourceUsername: "gen2", sourceReference: "program:u2:funds", createdAt: new Date("2026-01-06T00:00:00.000Z") },
  { id: "c3", level: 3, amount: "0.50", rate: "0.0100", baseAmount: "50.00", currency: "USDT", status: "APPROVED", statusLabel: "Disetujui", sourceUsername: "gen3", sourceReference: "program:u3:funds", createdAt: new Date("2026-01-07T00:00:00.000Z") },
  { id: "c4", level: 4, amount: "0.25", rate: "0.0100", baseAmount: "25.00", currency: "USDT", status: "REJECTED", statusLabel: "Ditolak", sourceUsername: "gen4", sourceReference: "program:u4:funds", createdAt: new Date("2026-01-08T00:00:00.000Z") },
];

const memberRows: ReferralMemberRow[] = [
  {
    userId: "gen1",
    username: "gen1",
    level: 1,
    joinedAt: new Date("2026-01-02T00:00:00.000Z"),
    programName: "Program Uji",
    programTierCode: "USDT-100",
    programStatus: "ACTIVE",
    programStatusLabel: "Aktif",
    programJoinAmount: "100.00",
    commissionCount: 2,
    commissionPending: "1.00",
    commissionApproved: "0.50",
    commissionPaid: "10.00",
    commissionTotal: "11.50",
    currency: "USDT",
  },
  {
    userId: "gen2",
    username: "gen2",
    level: 2,
    joinedAt: new Date("2026-01-03T00:00:00.000Z"),
    programName: null,
    programTierCode: null,
    programStatus: null,
    programStatusLabel: "Belum gabung program",
    programJoinAmount: null,
    commissionCount: 0,
    commissionPending: "0.00",
    commissionApproved: "0.00",
    commissionPaid: "0.00",
    commissionTotal: "0.00",
    currency: "USDT",
  },
];


describe("penjaga parameter API rujukan", () => {
  it("menerima kueri tanpa parameter apa pun", () => {
    assert.equal(inspectReferralQuery(new URLSearchParams("")), null);
  });

  it("menolak parameter yang mencoba memilih akar jaringan lain", () => {
    for (const param of [
      "root",
      "rootId",
      "rootUserId",
      "userId",
      "user",
      "referrerId",
      "referredUserId",
      "parentId",
      "sponsorId",
      "username",
      "referralCode",
      "code",
      "id",
    ]) {
      const result = inspectReferralQuery(new URLSearchParams(`?${param}=orang-lain`));
      assert.deepEqual(result, { param, kind: "root" }, `parameter ${param} harus ditolak`);
    }
  });

  it("menolak parameter root tanpa memandang besar-kecil huruf", () => {
    assert.deepEqual(inspectReferralQuery(new URLSearchParams("?ROOT=orang-lain")), {
      param: "ROOT",
      kind: "root",
    });
  });

  it("menolak parameter yang tidak dikenal, bukan mengabaikannya diam-diam", () => {
    assert.deepEqual(inspectReferralQuery(new URLSearchParams("?limit=10")), {
      param: "limit",
      kind: "unknown",
    });
  });

  it("menolak parameter root meskipun nilainya kosong", () => {
    assert.deepEqual(inspectReferralQuery(new URLSearchParams("?root=")), {
      param: "root",
      kind: "root",
    });
  });

  it("menyusun pesan penolakan dalam bahasa Indonesia", () => {
    const root = inspectReferralQuery(new URLSearchParams("?userId=abc"));
    const unknown = inspectReferralQuery(new URLSearchParams("?limit=5"));

    assert.ok(root && referralQueryRejectionMessage(root).includes("userId"));
    assert.ok(root && referralQueryRejectionMessage(root).includes("akun yang sedang masuk"));
    assert.ok(unknown && referralQueryRejectionMessage(unknown).includes("tidak dikenal"));
  });
});

describe("kartu kode rujukan (render server)", () => {
  it("menampilkan kode dan tautan lengkap pada render pertama", () => {
    const html = render(
      createElement(ReferralCodeCard, {
        referralCode: "ALICE-1A2B",
        origin: "https://tatorprofit.test",
      }),
    );

    assert.ok(html.includes('value="ALICE-1A2B"'));
    assert.ok(html.includes('value="https://tatorprofit.test/register?ref=ALICE-1A2B"'));
    assert.ok(html.includes("Kode rujukan Anda"));
    assert.ok(html.includes("Salin kode"));
    assert.ok(html.includes("Salin tautan"));
    assert.ok(html.includes("Bagikan"));
  });

  it("menonaktifkan penyalinan saat kode belum tersedia", () => {
    const html = render(createElement(ReferralCodeCard, { referralCode: null, origin: "" }));

    assert.ok(html.includes("disabled"));
    assert.ok(html.includes("Kode rujukan belum tersedia"));
  });

  it("menormalkan garis miring berlebih pada origin tautan", () => {
    assert.equal(
      buildReferralLink("https://tatorprofit.test/", "AB-1"),
      "https://tatorprofit.test/register?ref=AB-1",
    );
    assert.equal(buildReferralLink("", "AB-1"), "/register?ref=AB-1");
    assert.equal(buildReferralLink("https://tatorprofit.test", ""), "");
  });
});

describe("pohon jaringan rujukan (render server)", () => {
  it("menampilkan lima generasi lengkap", () => {
    const html = render(createElement(ReferralTree, { network, levels }));

    for (const level of [1, 2, 3, 4, 5]) {
      assert.ok(html.includes(`Generasi ${level}`), `generasi ${level} harus tampil`);
    }
    assert.ok(html.includes("Anda (pusat)"));
    assert.ok(html.includes("@gen5"));
    assert.ok(html.includes("5 anggota ditampilkan"));
  });

  it("menyediakan tata letak desktop mendatar dan daftar seluler yang dapat dibuka", () => {
    const html = render(createElement(ReferralTree, { network, levels }));

    assert.ok(html.includes('aria-label="Pohon jaringan (tampilan desktop)"'));
    assert.ok(html.includes('aria-label="Pohon jaringan (tampilan seluler)"'));
    assert.ok(html.includes("hidden overflow-x-auto"));
    assert.ok(html.includes("lg:hidden"));
    assert.ok(html.includes("<details"), "cabang seluler harus memakai <details> yang dapat dibuka");
    assert.ok(html.includes("Ringkasan per generasi"));
    assert.ok(html.includes("1 rujukan langsung"));
  });

  it("menandai jaringan yang dipotong batas tampilan", () => {
    const truncated: ReferralNetwork = { ...network, truncated: true };
    const html = render(createElement(ReferralTree, { network: truncated, levels }));

    assert.ok(html.includes("batas tampilan 500 anggota"));
  });

  it("menampilkan keadaan kosong tanpa menyembunyikan akun pusat", () => {
    const empty: ReferralNetwork = {
      root: node("pusat", 0),
      counts: [0, 0, 0, 0, 0],
      total: 0,
      truncated: false,
    };
    const html = render(createElement(ReferralTree, { network: empty, levels }));

    assert.ok(html.includes("Belum ada rujukan"));
    assert.ok(html.includes("@pusat"));
    assert.ok(html.includes("0 anggota"));
  });
});

describe("ringkasan dan tabel komisi rujukan (render server)", () => {
  it("meringkas lima tingkat beserta tarif dan total komisi", () => {
    const html = render(
      createElement(ReferralSummary, {
        directReferrals: 1,
        totalNetwork: 5,
        levels: levelRows,
        totals,
        truncated: false,
      }),
    );

    assert.ok(html.includes("Ringkasan per tingkat"));
    assert.ok(html.includes("Tingkat 1"));
    assert.ok(html.includes("Tingkat 5"));
    assert.ok(html.includes("10%"));
    assert.ok(html.includes("12,50 USDT"));
    assert.ok(html.includes("Komisi dibayar"));
    assert.ok(html.includes("Komisi menunggu"));
    assert.ok(html.includes("Disetujui: 0,50 USDT"));
    assert.ok(html.includes("Ditolak: 0,25 USDT"));
    assert.ok(html.includes("Rujukan langsung"));
    assert.ok(html.includes("Ringkasan anggota dan komisi rujukan"));
  });

  it("menampilkan baris komisi dengan label status bahasa Indonesia", () => {
    const html = render(createElement(ReferralCommissionTable, { commissions }));

    assert.ok(html.includes("Tabel komisi rujukan"));
    assert.ok(html.includes("@gen1"));
    assert.ok(html.includes("Dibayar"));
    assert.ok(html.includes("Menunggu"));
    assert.ok(html.includes("Disetujui"));
    assert.ok(html.includes("Ditolak"));
    assert.ok(html.includes("10,00 USDT"));
    assert.ok(html.includes(">10%<"));
    assert.ok(html.includes('dateTime="2026-01-05T00:00:00.000Z"'));
  });

  it("menampilkan keadaan kosong saat belum ada komisi", () => {
    const html = render(createElement(ReferralCommissionTable, { commissions: [] }));

    assert.ok(html.includes("Belum ada komisi rujukan tercatat"));
    assert.ok(!html.includes("<table"));
  });
});

describe("tabel anggota jaringan (render server)", () => {
  it("menampilkan akun, generasi, tanggal gabung, program, status, dan komisi", () => {
    const html = render(createElement(ReferralMemberTable, { members: memberRows, levels }));

    assert.ok(html.includes("Tabel anggota jaringan"));
    assert.ok(html.includes("@gen1"));
    assert.ok(html.includes("@gen2"));
    assert.ok(html.includes("Generasi 1"));
    assert.ok(html.includes("Generasi 2"));
    assert.ok(html.includes("Tanggal gabung"));
    assert.ok(html.includes("Program Uji (USDT-100)"));
    assert.ok(html.includes("100,00 USDT"));
    assert.ok(html.includes("Aktif"));
    assert.ok(html.includes("11,50 USDT"));
    assert.ok(html.includes("2 baris · menunggu 1,00 USDT"));
    assert.ok(html.includes("Belum gabung program"));
    assert.ok(html.includes("Belum ada komisi"));
  });

  it("menampilkan tarif generasi yang dikonfigurasi pada setiap baris", () => {
    const html = render(createElement(ReferralMemberTable, { members: memberRows, levels }));

    assert.ok(html.includes(">10%<"));
    assert.ok(html.includes(">2%<"));
  });

  it("menyediakan tabel desktop dan daftar seluler yang dapat dibuka", () => {
    const html = render(createElement(ReferralMemberTable, { members: memberRows, levels }));

    assert.ok(html.includes("hidden overflow-x-auto lg:block"));
    assert.ok(html.includes("lg:hidden"));
    assert.ok(html.includes('aria-label="Tabel anggota jaringan (tampilan seluler)"'));
    assert.ok(html.includes("<details"), "rincian seluler harus memakai <details> yang dapat dibuka");
    assert.ok(html.includes('dateTime="2026-01-02T00:00:00.000Z"'));
  });

  it("menampilkan keadaan kosong saat jaringan masih kosong", () => {
    const html = render(createElement(ReferralMemberTable, { members: [], levels }));

    assert.ok(html.includes("Belum ada anggota jaringan"));
    assert.ok(!html.includes("<table"));
    assert.ok(!html.includes("<details"));
  });
});



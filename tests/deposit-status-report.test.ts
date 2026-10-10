/**
 * Status deposit di dasbor, laporan pembayaran profit, dan notifikasi yang
 * bertaut aksi.
 *
 * Tiga hal diuji di sini karena satu alur yang sama: admin menyetujui deposit →
 * notifikasi bertaut aksi dibuat → member melihatnya di halaman /deposit dan di
 * kotak masuk, sementara dasbor meringkas deposit serta pembayaran imbalannya.
 *
 * Aturan yang dijaga:
 *  - hanya tautan di dalam situs yang boleh dirender dari metadata notifikasi,
 *    supaya baris data yang rusak tidak bisa menjadi navigasi ke luar situs;
 *  - ringkasan deposit dihitung dari tabel `DepositRequest` (bukan dari angka
 *    contoh), dan bernilai nol untuk member yang belum pernah mengajukan;
 *  - banner persetujuan hanya muncul selama notifikasi pengumumannya belum
 *    dibaca, sehingga bisa ditutup dan tidak menempel selamanya.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { Prisma, PrismaClient } from "@prisma/client";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { RewardPaymentReport } from "../src/components/dashboard/reward-payment-report";
import { getMemberDepositSummary } from "../src/lib/services/manual-payment-service";
import {
  getUnreadDepositApprovalNotice,
  notificationHref,
} from "../src/lib/services/notification-service";

/** `npm test` selalu berjalan dari akar repositori. */
const ROOT = process.cwd();

function readProjectFile(...segments: string[]): string {
  return readFileSync(path.join(ROOT, ...segments), "utf8");
}

/** Casting helper: metadata notifikasi adalah JSON bebas dari database. */
function json(value: unknown): Prisma.JsonValue {
  return value as Prisma.JsonValue;
}

const prisma = new PrismaClient();
let userId = "";

before(async () => {
  const stamp = `${Date.now()}`.slice(-7);
  const user = await prisma.user.create({
    data: {
      name: "Uji Status Deposit",
      username: `depstatus_${stamp}`,
      email: `depstatus_${stamp}@example.com`,
      phone: `+6287${stamp}1`,
      passwordHash: "b2b$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ012345",
    },
    select: { id: true },
  });
  userId = user.id;
});

after(async () => {
  if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  await prisma.$disconnect();
});

describe("tautan aksi notifikasi", () => {
  it("hanya menerima tautan di dalam situs", () => {
    assert.equal(notificationHref(json({ href: "/deposit" })), "/deposit");
    assert.equal(
      notificationHref(json({ href: "/deposit#riwayat-deposit" })),
      "/deposit#riwayat-deposit",
    );

    // Tanpa metadata, tanpa href, atau nilai bukan teks: tidak ada tautan.
    assert.equal(notificationHref(null), null);
    assert.equal(notificationHref(undefined), null);
    assert.equal(notificationHref(json({})), null);
    assert.equal(notificationHref(json({ href: "" })), null);
    assert.equal(notificationHref(json({ href: 42 })), null);
    assert.equal(notificationHref(json(["href"])), null);

    // Tautan ke luar situs dan skema berbahaya selalu ditolak.
    assert.equal(notificationHref(json({ href: "https://jahat.example" })), null);
    assert.equal(notificationHref(json({ href: "//jahat.example" })), null);
    assert.equal(notificationHref(json({ href: "javascript:alert(1)" })), null);
    assert.equal(notificationHref(json({ href: "deposit" })), null);
  });
});

describe("ringkasan deposit member di dasbor", () => {
  it("member tanpa pengajuan mendapat nilai nol, bukan angka contoh", async () => {
    const summary = await getMemberDepositSummary(userId);

    assert.equal(summary.awaitingCount, 0);
    assert.equal(summary.awaitingAmount, "0.00");
    assert.equal(summary.approvedCount, 0);
    assert.equal(summary.approvedAmount, "0.00");
    assert.equal(summary.latestStatus, null);
    assert.equal(summary.latestReviewedAt, null);
    assert.equal(summary.currency, "USDT");
  });
});

describe("pemberitahuan deposit yang bertaut aksi", () => {
  it("menemukan pengumuman deposit disetujui yang belum dibaca", async () => {
    assert.equal(await getUnreadDepositApprovalNotice(userId), null);

    const approval = await prisma.notification.create({
      data: {
        userId,
        type: "PROGRAM",
        title: "Deposit disetujui",
        body: "Deposit disetujui.",
        metadata: {
          depositId: "11111111-1111-1111-1111-111111111111",
          status: "APPROVED",
          amount: "100.00",
          currency: "USDT",
          href: "/deposit",
        },
      },
      select: { id: true },
    });

    // Notifikasi yang lebih baru tanpa status persetujuan tidak boleh menutupi
    // pengumuman deposit yang masih belum dibaca.
    await prisma.notification.create({
      data: {
        userId,
        type: "PROGRAM",
        title: "Gabung tercatat",
        body: "Gabungan Anda menunggu konfirmasi dana.",
        metadata: { status: "PENDING", href: "/deposit" },
      },
    });

    const notice = await getUnreadDepositApprovalNotice(userId);
    assert.ok(notice, "pengumuman deposit disetujui harus ditemukan");
    assert.equal(notice.notificationId, approval.id);
    assert.equal(notice.depositId, "11111111-1111-1111-1111-111111111111");
    assert.equal(notice.amount, "100.00");
    assert.equal(notice.currency, "USDT");
    assert.equal(notice.href, "/deposit");

    // Setelah ditandai dibaca, banner tidak muncul lagi.
    await prisma.notification.update({
      where: { id: approval.id },
      data: { readAt: new Date() },
    });
    assert.equal(await getUnreadDepositApprovalNotice(userId), null);
  });
});

describe("laporan pembayaran profit (render server)", () => {
  const rows = [
    {
      id: "row-paid",
      period: 3,
      cycleNumber: 1,
      tierCode: "USDT-100",
      rate: "0.2000",
      amount: "110.00",
      currency: "USDT",
      status: "PAID",
      statusLabel: "Dibayar",
      paidAt: new Date("2026-10-10T00:00:00.000Z"),
    },
    {
      id: "row-pending",
      period: 4,
      cycleNumber: 1,
      tierCode: "USDT-100",
      rate: "0.2000",
      amount: "110.00",
      currency: "USDT",
      status: "PENDING",
      statusLabel: "Menunggu",
      paidAt: null,
    },
  ];

  it("menampilkan periode, tarif, nominal, status, dan tanggal pembayaran", () => {
    const html = renderToStaticMarkup(createElement(RewardPaymentReport, { rows })).replace(
      /<!--[\s\S]*?-->/g,
      "",
    );

    assert.ok(html.includes("Laporan Pembayaran Profit"));
    assert.ok(html.includes("Periode"));
    assert.ok(html.includes("Tarif"));
    assert.ok(html.includes("Nominal"));
    assert.ok(html.includes("Minggu 3"));
    assert.ok(html.includes("Minggu 4"));
    assert.ok(html.includes("20%"), "tarif ditampilkan sebagai persentase");
    assert.ok(html.includes("110,00 USDT"), "nominal ditampilkan dalam USDT");
    assert.ok(html.includes("10 Okt 2026"), "tanggal pembayaran memakai waktu UTC");
    assert.ok(html.includes("—"), "periode yang belum dibayar tidak menampilkan tanggal");
    assert.ok(html.includes("/rewards"), "sertakan tautan ke halaman imbalan");
  });

  it("menjelaskan keadaan kosong tanpa mengarang angka", () => {
    const html = renderToStaticMarkup(createElement(RewardPaymentReport, { rows: [] })).replace(
      /<!--[\s\S]*?-->/g,
      "",
    );

    assert.ok(html.includes("Belum ada periode imbalan tercatat"));
    assert.equal(html.includes("USDT"), false, "jangan menampilkan nominal saat belum ada data");
  });
});

describe("pemasangan di halaman member", () => {
  it("notifikasi status menulis tautan tujuan yang valid", () => {
    const paymentSource = readProjectFile("src", "lib", "services", "manual-payment-service.ts");

    assert.ok(paymentSource.includes('href: "/deposit"'), "notifikasi deposit menautkan /deposit");
    assert.ok(
      paymentSource.includes('href: "/withdrawal"'),
      "notifikasi penarikan menautkan /withdrawal",
    );
  });

  it("kotak masuk merender tombol Lihat detail untuk notifikasi bertaut", () => {
    const listSource = readProjectFile(
      "src",
      "components",
      "notifications",
      "notification-list.tsx",
    );
    const inboxSource = readProjectFile("src", "app", "notifications", "page.tsx");

    assert.ok(listSource.includes("Lihat detail"));
    assert.ok(listSource.includes("keepalive"), "tautan menandai notifikasi terbaca saat dibuka");
    assert.ok(inboxSource.includes("notificationHref("), "kotak masuk harus memvalidasi tautan");
  });

  it("halaman deposit memasang banner persetujuan dan jangkar riwayat", () => {
    const depositPage = readProjectFile("src", "app", "deposit", "page.tsx");

    assert.ok(depositPage.includes("<DepositApprovalNotice"));
    assert.ok(depositPage.includes("getUnreadDepositApprovalNotice(user.id)"));
    assert.ok(depositPage.includes('id="riwayat-deposit"'), "banner menautkan ke riwayat deposit");
  });

  it("dasbor menampilkan saldo deposit, deposit menunggu, dan laporan profit", () => {
    const dashboardSource = readProjectFile("src", "app", "dashboard", "page.tsx");

    assert.ok(dashboardSource.includes('label="Saldo deposit"'));
    assert.ok(dashboardSource.includes('label="Deposit menunggu konfirmasi"'));
    assert.ok(dashboardSource.includes("<RewardPaymentReport rows={rewardReportRows} />"));
    assert.ok(dashboardSource.includes("getMemberDepositSummary(user.id)"));
  });
});

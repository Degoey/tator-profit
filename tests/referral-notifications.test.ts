/**
 * Member diberi tahu saat komisi rujukannya tercatat dan saat komisinya
 * dituntaskan (dibayar / ditolak / dibatalkan).
 *
 * Dua lapis diuji di sini karena satu alur yang sama:
 *
 *  1. teks dan metadata yang disusun `src/lib/referral-notifications.ts` —
 *     murni, tanpa database — termasuk tautan `/referral` yang harus lolos
 *     `notificationHref`, penjaga yang sama yang dipakai halaman /notifications
 *     sebelum merender tautan apa pun;
 *  2. bahwa `referral-service` menulis baris `Notification` bertipe REFERRAL di
 *     dalam transaksi yang sama dengan perubahannya: satu saat komisi dicatat,
 *     satu saat komisi dituntaskan, tanpa pesan untuk APPROVE (uang belum
 *     berpindah), dan tanpa jalur lain yang bisa menulis tipe REFERRAL.
 *
 * Sisi datanya (komisi benar-benar tercatat dan benar-benar dibayar) diuji di
 * `tests/referral-engine.test.ts` terhadap PostgreSQL, karena skenario lima
 * generasi sudah tersedia lengkap di sana.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { Prisma } from "@prisma/client";

import {
  REFERRAL_NOTIFICATION_HREF,
  referralCommissionRecordedNotification,
  referralCommissionSettledNotification,
} from "../src/lib/referral-notifications";
import { notificationHref } from "../src/lib/services/notification-service";

/** `npm test` selalu berjalan dari akar repositori. */
const ROOT = process.cwd();

function readProjectFile(...segments: string[]): string {
  return readFileSync(path.join(ROOT, ...segments), "utf8");
}

/** Casting helper: metadata notifikasi adalah JSON bebas dari database. */
function json(value: unknown): Prisma.JsonValue {
  return value as Prisma.JsonValue;
}

const recorded = {
  commissionId: "11111111-1111-1111-1111-111111111111",
  level: 2,
  amount: "2.00",
  currency: "USDT",
  sourceUserId: "22222222-2222-2222-2222-222222222222",
  sourceReference: "program:33333333-3333-3333-3333-333333333333:funds",
};

const settled = {
  commissionId: recorded.commissionId,
  level: 2,
  amount: "2.00",
  currency: "USDT",
  sourceUserId: recorded.sourceUserId,
};

describe("notifikasi komisi tercatat", () => {
  it("menyebut tingkat, nominal, dan status menunggu", () => {
    const notice = referralCommissionRecordedNotification(recorded);

    assert.equal(notice.title, "Komisi rujukan tercatat: tingkat 2");
    assert.ok(notice.body.includes("Komisi rujukan tingkat 2 sebesar USDT 2.00"));
    assert.ok(notice.body.includes("menunggu"), "status ditampilkan dalam bahasa Indonesia");
    assert.ok(
      notice.body.includes("saldo tersedia"),
      "member diberi tahu uang baru masuk setelah dibayar",
    );
  });

  it("menyimpan metadata yang cukup untuk menelusuri komisi asalnya", () => {
    const { metadata } = referralCommissionRecordedNotification(recorded);

    assert.equal(metadata.commissionId, recorded.commissionId);
    assert.equal(metadata.level, "2");
    assert.equal(metadata.amount, "2.00");
    assert.equal(metadata.currency, "USDT");
    assert.equal(metadata.status, "PENDING");
    assert.equal(metadata.sourceUserId, recorded.sourceUserId);
    assert.equal(metadata.sourceReference, recorded.sourceReference);
    assert.equal(metadata.payoutReference, null);
    assert.equal(metadata.reason, null);
    assert.equal(notificationHref(json(metadata)), REFERRAL_NOTIFICATION_HREF);
  });

  it("menerima referensi sumber yang kosong tanpa menulis undefined", () => {
    const { metadata } = referralCommissionRecordedNotification({
      ...recorded,
      sourceReference: null,
    });

    assert.equal(metadata.sourceReference, null);
    assert.ok(
      Object.values(metadata).every((value) => value === null || typeof value === "string"),
      "metadata hanya berisi teks atau null, bukan undefined atau angka",
    );
  });
});

describe("notifikasi komisi dituntaskan", () => {
  it("mengumumkan pembayaran dan tautannya kembali ke halaman rujukan", () => {
    const notice = referralCommissionSettledNotification({
      ...settled,
      action: "PAY",
      status: "PAID",
      payoutReference: `referral-commission:${recorded.commissionId}:payout`,
    });

    assert.equal(notice.title, "Komisi rujukan dibayar: tingkat 2");
    assert.ok(notice.body.includes("Komisi rujukan tingkat 2 sebesar USDT 2.00"));
    assert.ok(notice.body.includes("sudah dibayar dan masuk ke saldo tersedia Anda"));
    assert.equal(notice.metadata.status, "PAID");
    assert.equal(
      notice.metadata.payoutReference,
      `referral-commission:${recorded.commissionId}:payout`,
    );
    assert.equal(notice.metadata.reason, null);
    assert.equal(notificationHref(json(notice.metadata)), REFERRAL_NOTIFICATION_HREF);
  });

  it("menyertakan alasan wajib saat komisi ditolak atau dibatalkan", () => {
    const rejected = referralCommissionSettledNotification({
      ...settled,
      action: "REJECT",
      status: "REJECTED",
      reason: "  Data program tidak sesuai  ",
    });
    assert.equal(rejected.title, "Komisi rujukan ditolak: tingkat 2");
    assert.ok(rejected.body.includes("ditolak. Alasan: Data program tidak sesuai"));
    assert.equal(rejected.metadata.status, "REJECTED");
    assert.equal(rejected.metadata.reason, "Data program tidak sesuai");
    assert.equal(rejected.metadata.payoutReference, null);

    const voided = referralCommissionSettledNotification({
      ...settled,
      action: "VOID",
      status: "VOID",
      reason: "Transaksi sumber dibatalkan",
    });
    assert.equal(voided.title, "Komisi rujukan dibatalkan: tingkat 2");
    assert.ok(voided.body.includes("dibatalkan. Alasan: Transaksi sumber dibatalkan"));
    assert.equal(voided.metadata.status, "VOID");

    // Alasan kosong tidak boleh menghasilkan kalimat menggantung.
    const blank = referralCommissionSettledNotification({
      ...settled,
      action: "VOID",
      status: "VOID",
      reason: "   ",
    });
    assert.ok(blank.body.endsWith("Alasan: tidak disebutkan"));
    assert.equal(blank.metadata.reason, "tidak disebutkan");
  });
});

describe("penyambungan notifikasi di mesin komisi rujukan", () => {
  const serviceSource = readProjectFile("src", "lib", "services", "referral-service.ts");
  const moduleSource = readProjectFile("src", "lib", "referral-notifications.ts");

  it("menulis notifikasi tepat dua kali: saat dicatat dan saat dituntaskan", () => {
    assert.equal(
      serviceSource.split('type: "REFERRAL"').length - 1,
      2,
      "hanya dua tempat boleh menulis notifikasi REFERRAL",
    );
    assert.equal(
      serviceSource.split("referralCommissionRecordedNotification(").length - 1,
      1,
      "notifikasi komisi tercatat disusun satu kali",
    );
    assert.equal(
      serviceSource.split("referralCommissionSettledNotification(").length - 1,
      1,
      "notifikasi komisi dituntaskan disusun satu kali",
    );
  });

  it("memakai klien transaksi yang sama dengan perubahan statusnya", () => {
    assert.ok(
      serviceSource.includes("await client.notification.create({"),
      "pencatatan komisi memakai klien transaksi pemanggil",
    );
    assert.ok(
      serviceSource.includes("await tx.notification.create({"),
      "penuntasan komisi memakai transaksi status yang sama",
    );
  });

  it("tidak mengirim pesan untuk APPROVE karena uang belum berpindah", () => {
    assert.ok(serviceSource.includes('if (input.action !== "APPROVE")'));
  });

  it("modul teks tetap murni: tidak menyentuh database", () => {
    assert.ok(!moduleSource.includes("prisma"));
    assert.ok(!moduleSource.includes("notification.create"));
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@prisma/client";

import {
  REFERRAL_COMMISSION_STATUSES,
  REFERRAL_DEPTH,
  REFERRAL_ELIGIBLE_EVENT,
  calculateCommission,
  isValidReferralLevel,
  normalizeReferralCode,
  referralRateForLevel,
} from "../src/lib/config/referral";
import {
  ReferralError,
  calculateReferralCommission,
  evaluateReferralEventEligibility,
  selectCommissionBeneficiaries,
} from "../src/lib/services/referral-service";
import { formatMoney, formatRate, multiplyByRate, roundMoney, sumMoney } from "../src/lib/money";

describe("konfigurasi komisi rujukan", () => {
  it("memiliki lima tingkat", () => {
    assert.equal(REFERRAL_DEPTH, 5);
    assert.equal(isValidReferralLevel(1), true);
    assert.equal(isValidReferralLevel(5), true);
    assert.equal(isValidReferralLevel(6), false);
    assert.equal(isValidReferralLevel(0), false);
  });

  it("menerapkan 10% / 2% / 1% / 1% / 1% dengan aritmetika desimal", () => {
    const base = new Prisma.Decimal("10");

    assert.equal(calculateCommission(base, 1)?.toFixed(2), "1.00");
    assert.equal(calculateCommission(base, 2)?.toFixed(2), "0.20");
    assert.equal(calculateCommission(base, 3)?.toFixed(2), "0.10");
    assert.equal(calculateCommission(base, 4)?.toFixed(2), "0.10");
    assert.equal(calculateCommission(base, 5)?.toFixed(2), "0.10");
    assert.equal(calculateCommission(base, 6), null);
  });

  it("tidak pernah kehilangan sen pada nilai lebih besar", () => {
    const base = new Prisma.Decimal("3000");

    assert.equal(calculateCommission(base, 1)?.toFixed(2), "300.00");
    assert.equal(calculateCommission(base, 2)?.toFixed(2), "60.00");
  });

  it("menormalkan kode rujukan untuk pencarian", () => {
    assert.equal(normalizeReferralCode("  alice-1a2b "), "ALICE-1A2B");
  });
});

describe("pembantu uang", () => {
  it("membulatkan setengah ke atas hingga dua desimal", () => {
    assert.equal(roundMoney("0.005").toFixed(2), "0.01");
    assert.equal(roundMoney("10").toFixed(2), "10.00");
  });

  it("mengalikan dengan tarif tanpa pergeseran titik mengambang", () => {
    assert.equal(multiplyByRate("10", "0.1").toFixed(2), "1.00");
    assert.equal(multiplyByRate("3000", "0.1").toFixed(2), "300.00");
    assert.equal(multiplyByRate("10000", "0.1").toFixed(2), "1000.00");
  });

  it("menjumlahkan nilai uang secara persis", () => {
    assert.equal(sumMoney(["0.1", "0.2"]).toFixed(2), "0.30");
  });

  it("memformat uang dan tarif untuk tampilan", () => {
    // Indonesian formatting with an explicit USDT suffix: no currency symbol ever.
    assert.equal(formatMoney("1000"), "1.000,00 USDT");
    assert.equal(formatMoney("1000", "USDT"), "1.000,00 USDT");
    assert.equal(formatRate("0.1"), "10%");
    assert.equal(formatRate("1.2"), "120%");
  });
});


describe("peristiwa sumber komisi rujukan", () => {
  const eligibleEvent = {
    type: "PROGRAM_JOIN" as const,
    status: "POSTED" as const,
    bucket: "PROGRAM_FUNDS",
    userProgramId: "membership-1",
    membershipStatus: "ACTIVE" as const,
    fundsConfirmedAt: new Date("2026-01-01T00:00:00.000Z"),
    programStatus: "ACTIVE" as const,
  };

  it("menerima hanya transaksi dana program yang tercatat dan sudah dikonfirmasi", () => {
    const result = evaluateReferralEventEligibility(eligibleEvent);

    assert.equal(result.eligible, true);
    assert.ok(result.reason.includes("memenuhi syarat"));
  });

  it("menolak pendaftaran dan setiap peristiwa di luar konfigurasi", () => {
    for (const type of ["REFERRAL_REWARD", "REWARD", "WITHDRAWAL", "ADJUSTMENT"] as const) {
      const result = evaluateReferralEventEligibility({ ...eligibleEvent, type });
      assert.equal(result.eligible, false, `${type} tidak boleh menghasilkan komisi`);
    }
  });

  it("menolak transaksi yang belum tercatat di buku besar", () => {
    for (const status of ["PENDING", "REVERSED"] as const) {
      const result = evaluateReferralEventEligibility({ ...eligibleEvent, status });
      assert.equal(result.eligible, false, `status ${status} tidak boleh menghasilkan komisi`);
    }
  });

  it("menolak transaksi yang tidak memindahkan keranjang dana program", () => {
    for (const bucket of ["AVAILABLE", "PENDING", "NONE"]) {
      const result = evaluateReferralEventEligibility({ ...eligibleEvent, bucket });
      assert.equal(result.eligible, false, `keranjang ${bucket} tidak boleh menghasilkan komisi`);
    }
  });

  it("menolak keanggotaan yang belum aktif atau dananya belum dikonfirmasi", () => {
    const pending = evaluateReferralEventEligibility({
      ...eligibleEvent,
      membershipStatus: "PENDING",
      fundsConfirmedAt: null,
    });
    const noFunds = evaluateReferralEventEligibility({ ...eligibleEvent, fundsConfirmedAt: null });
    const noMembership = evaluateReferralEventEligibility({ ...eligibleEvent, userProgramId: null });

    assert.equal(pending.eligible, false);
    assert.equal(noFunds.eligible, false);
    assert.equal(noMembership.eligible, false);
  });

  it("menolak program yang tidak aktif", () => {
    for (const programStatus of ["INACTIVE", "ARCHIVED"] as const) {
      const result = evaluateReferralEventEligibility({ ...eligibleEvent, programStatus });
      assert.equal(result.eligible, false);
    }
  });

  it("mengonfigurasi tepat satu jenis transaksi, status, dan keranjang", () => {
    assert.deepEqual([...REFERRAL_ELIGIBLE_EVENT.transactionTypes], ["PROGRAM_JOIN"]);
    assert.equal(REFERRAL_ELIGIBLE_EVENT.requiredStatus, "POSTED");
    assert.equal(REFERRAL_ELIGIBLE_EVENT.requiredBucket, "PROGRAM_FUNDS");
    assert.equal(REFERRAL_ELIGIBLE_EVENT.requiresMembership, true);
    assert.equal(REFERRAL_ELIGIBLE_EVENT.requiresConfirmedFunds, true);
    assert.equal(REFERRAL_ELIGIBLE_EVENT.requiresActiveProgram, true);
  });
});

describe("pemilihan penerima komisi rujukan", () => {
  it("membayar lima generasi upline secara berurutan", () => {
    const upline = [
      { userId: "l4", level: 1 },
      { userId: "l3", level: 2 },
      { userId: "l2", level: 3 },
      { userId: "l1", level: 4 },
      { userId: "root", level: 5 },
    ];
    const { eligible, skipped } = selectCommissionBeneficiaries("l5", upline);

    assert.deepEqual(eligible, upline);
    assert.deepEqual(skipped, []);
  });

  it("tidak pernah membayar akun sumber sendiri", () => {
    const { eligible, skipped } = selectCommissionBeneficiaries("l5", [
      { userId: "l5", level: 1 },
      { userId: "l4", level: 2 },
    ]);

    assert.deepEqual(eligible, [{ userId: "l4", level: 2 }]);
    assert.deepEqual(skipped, [{ userId: "l5", level: 1, reason: "SELF" }]);
  });

  it("membuang tingkat di luar satu sampai lima", () => {
    const { eligible, skipped } = selectCommissionBeneficiaries("l5", [
      { userId: "root", level: 6 },
      { userId: "l4", level: 0 },
    ]);

    assert.deepEqual(eligible, []);
    assert.deepEqual(
      skipped.map((entry) => entry.reason),
      ["OUT_OF_RANGE", "OUT_OF_RANGE"],
    );
  });

  it("membuang penerima ganda sehingga satu akun hanya dibayar sekali", () => {
    const { eligible, skipped } = selectCommissionBeneficiaries("l5", [
      { userId: "root", level: 1 },
      { userId: "root", level: 3 },
    ]);

    assert.deepEqual(eligible, [{ userId: "root", level: 1 }]);
    assert.deepEqual(skipped, [{ userId: "root", level: 3, reason: "DUPLICATE" }]);
  });
});

describe("perhitungan komisi rujukan lima tingkat", () => {
  it("memakai tarif 10% / 2% / 1% / 1% / 1% dari nilai program", () => {
    const base = "100.00";
    const amounts = [1, 2, 3, 4, 5].map((level) =>
      calculateReferralCommission({ level, baseAmount: base }).commissionAmount.toFixed(2),
    );

    assert.deepEqual(amounts, ["10.00", "2.00", "1.00", "1.00", "1.00"]);
  });

  it("mengembalikan tarif dan nilai dasar sebagai desimal tersimpan", () => {
    const breakdown = calculateReferralCommission({ level: 2, baseAmount: "100.00" });

    assert.equal(breakdown.rate.toFixed(4), "0.0200");
    assert.equal(breakdown.baseAmount.toFixed(2), "100.00");
    assert.equal(breakdown.currency, "USDT");
  });

  it("membulatkan setengah ke atas tanpa kehilangan sen", () => {
    assert.equal(
      calculateReferralCommission({ level: 1, baseAmount: "0.05" }).commissionAmount.toFixed(2),
      "0.01",
    );
    assert.equal(
      calculateReferralCommission({ level: 1, baseAmount: "3000.00" }).commissionAmount.toFixed(2),
      "300.00",
    );
    assert.equal(
      calculateReferralCommission({ level: 2, baseAmount: "3000.00" }).commissionAmount.toFixed(2),
      "60.00",
    );
  });

  it("menolak tingkat di luar konfigurasi", () => {
    assert.throws(() => calculateReferralCommission({ level: 0, baseAmount: "10" }), ReferralError);
    assert.throws(() => calculateReferralCommission({ level: 6, baseAmount: "10" }), ReferralError);
  });

  it("menolak nilai dasar nol, negatif, dan lebih dari dua desimal", () => {
    assert.throws(() => calculateReferralCommission({ level: 1, baseAmount: "0" }), ReferralError);
    assert.throws(() => calculateReferralCommission({ level: 1, baseAmount: "-1" }), ReferralError);
    assert.throws(
      () => calculateReferralCommission({ level: 1, baseAmount: "1.005" }),
      ReferralError,
    );
    assert.throws(
      () => calculateReferralCommission({ level: 1, baseAmount: "bukan-angka" }),
      ReferralError,
    );
  });
});

describe("siklus hidup status komisi rujukan", () => {
  it("memakai lima status yang sama dengan mesin imbalan", () => {
    assert.deepEqual([...REFERRAL_COMMISSION_STATUSES], [
      "PENDING",
      "APPROVED",
      "PAID",
      "REJECTED",
      "VOID",
    ]);
  });

  it("tidak menyediakan tarif untuk tingkat di luar konfigurasi", () => {
    assert.equal(referralRateForLevel(0), null);
    assert.equal(referralRateForLevel(6), null);
    assert.equal(referralRateForLevel(1)?.toFixed(4), "0.1000");
    assert.equal(referralRateForLevel(5)?.toFixed(4), "0.0100");
  });
});

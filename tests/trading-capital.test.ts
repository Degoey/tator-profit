import assert from "node:assert/strict";
import { test } from "node:test";

import { Prisma } from "@prisma/client";

import {
  CAPITAL_PROFIT_BASIS_NOTICE,
  capitalContributionKey,
} from "../src/lib/config/trading";
import {
  assertCapitalInvariant,
  capitalProfitBasisNotice,
  summarizeCapital,
  validateCapitalContribution,
  validateCapitalMovement,
  type CapitalContributionInput,
  type CapitalMovementInput,
} from "../src/lib/services/trading-capital";

const dec = (value: string) => new Prisma.Decimal(value);

const contribution = (
  overrides: Partial<CapitalContributionInput> = {},
): CapitalContributionInput => ({
  id: "c1",
  ownerType: "COMPANY",
  memberUserId: null,
  amount: dec("1000.00"),
  status: "RECORDED",
  reference: "MODAL/2026/01",
  ...overrides,
});

const movement = (overrides: Partial<CapitalMovementInput> = {}): CapitalMovementInput => ({
  id: "m1",
  contributionId: "c1",
  movementType: "WITHDRAWAL",
  amount: dec("100.00"),
  reason: "Penarikan modal sesuai permintaan pemilik",
  reference: "MODAL/2026/01/KELUAR",
  ...overrides,
});

test("pencatatan modal diperiksa: pemilik, nominal, dan nomor bukti", () => {
  assert.equal(validateCapitalContribution(contribution()).valid, true);

  const memberWithoutOwner = validateCapitalContribution(
    contribution({ ownerType: "MEMBER", memberUserId: null }),
  );
  assert.equal(memberWithoutOwner.valid, false);
  assert.match(memberWithoutOwner.errors.join(" "), /wajib menyertakan anggota/i);

  const companyWithOwner = validateCapitalContribution(
    contribution({ ownerType: "COMPANY", memberUserId: "user-1" }),
  );
  assert.equal(companyWithOwner.valid, false);
  assert.match(companyWithOwner.errors.join(" "), /tidak boleh dihubungkan/i);

  const zero = validateCapitalContribution(contribution({ amount: dec("0.00") }));
  assert.equal(zero.valid, false);
  assert.match(zero.errors.join(" "), /lebih besar dari nol/i);

  const tooPrecise = validateCapitalContribution(contribution({ amount: dec("10.001") }));
  assert.equal(tooPrecise.valid, false);
  assert.match(tooPrecise.errors.join(" "), /dua desimal/i);

  const noReference = validateCapitalContribution(contribution({ reference: "  " }));
  assert.equal(noReference.valid, false);
  assert.match(noReference.errors.join(" "), /nomor bukti/i);
});

test("pergerakan modal mengikuti arah nilai menurut jenisnya", () => {
  assert.equal(validateCapitalMovement(movement()).valid, true);
  assert.equal(
    validateCapitalMovement(movement({ movementType: "ADJUSTMENT", amount: dec("-25.00") })).valid,
    true,
  );

  const zeroAllocation = validateCapitalMovement(
    movement({ movementType: "ALLOCATION", amount: dec("0.00") }),
  );
  assert.equal(zeroAllocation.valid, false);
  assert.match(zeroAllocation.errors.join(" "), /lebih besar dari nol/i);

  const zeroAdjustment = validateCapitalMovement(
    movement({ movementType: "ADJUSTMENT", amount: dec("0.00") }),
  );
  assert.equal(zeroAdjustment.valid, false);
  assert.match(zeroAdjustment.errors.join(" "), /tidak boleh bernilai nol/i);

  const reversalWithoutTarget = validateCapitalMovement(
    movement({ movementType: "REVERSAL", revertsMovementId: null }),
  );
  assert.equal(reversalWithoutTarget.valid, false);
  assert.match(reversalWithoutTarget.errors.join(" "), /wajib menunjuk pergerakan/i);

  const allocationWithTarget = validateCapitalMovement(movement({ revertsMovementId: "m0" }));
  assert.equal(allocationWithTarget.valid, false);
  assert.match(allocationWithTarget.errors.join(" "), /Hanya pergerakan REVERSAL/i);

  const noReason = validateCapitalMovement(movement({ reason: " " }));
  assert.equal(noReason.valid, false);
  assert.match(noReason.errors.join(" "), /alasan/i);
});

test("ringkasan memisahkan modal perusahaan dan modal anggota", () => {
  const contributions: CapitalContributionInput[] = [
    contribution({ id: "c1", ownerType: "COMPANY", amount: dec("1000.00") }),
    contribution({
      id: "c2",
      ownerType: "MEMBER",
      memberUserId: "user-a",
      amount: dec("500.00"),
      reference: "MODAL/2026/02",
    }),
    contribution({
      id: "c3",
      ownerType: "MEMBER",
      memberUserId: "user-a",
      amount: dec("100.00"),
      reference: "MODAL/2026/03",
    }),
    contribution({
      id: "c4",
      ownerType: "MEMBER",
      memberUserId: "user-b",
      amount: dec("200.00"),
      status: "REJECTED",
      reference: "MODAL/2026/04",
    }),
  ];

  const movements: CapitalMovementInput[] = [
    movement({ id: "m1", contributionId: "c1", movementType: "WITHDRAWAL", amount: dec("100.00") }),
    movement({ id: "m2", contributionId: "c2", movementType: "ALLOCATION", amount: dec("50.00") }),
    movement({ id: "m3", contributionId: "c2", movementType: "ADJUSTMENT", amount: dec("-25.00") }),
    movement({
      id: "m4",
      contributionId: "c2",
      movementType: "REVERSAL",
      amount: dec("50.00"),
      revertsMovementId: "m2",
      reference: "MODAL/2026/02/BATAL",
    }),
  ];

  const summary = summarizeCapital({ contributions, movements });

  assert.deepEqual(summary.errors, []);
  assert.equal(summary.companyTotal.toFixed(2), "900.00");
  assert.equal(summary.memberTotal.toFixed(2), "575.00");
  assert.equal(summary.total.toFixed(2), "1475.00");
  assert.deepEqual(summary.revertedMovementIds, ["m2"]);
  assert.deepEqual(
    summary.byMember.map((row) => `${row.memberUserId}=${row.total.toFixed(2)}`),
    ["user-a=575.00"],
  );

  const rejected = summary.contributions.find((row) => row.contributionId === "c4");
  assert.equal(rejected?.excluded, true);

  assert.doesNotThrow(() => assertCapitalInvariant(summary));
});

test("penarikan melebihi modal yang dicatat dilaporkan dan ditolak", () => {
  const summary = summarizeCapital({
    contributions: [contribution({ amount: dec("100.00") })],
    movements: [movement({ movementType: "WITHDRAWAL", amount: dec("150.00") })],
  });

  assert.equal(summary.contributions[0]?.allocated.toFixed(2), "-50.00");
  assert.match(summary.errors.join(" "), /menjadi negatif/i);
  assert.throws(() => assertCapitalInvariant(summary), RangeError);
});

test("pembatalan ganda dan rujukan yang salah ditolak", () => {
  const unknownTarget = summarizeCapital({
    contributions: [contribution()],
    movements: [movement({ id: "m9", movementType: "REVERSAL", revertsMovementId: "tidak-ada" })],
  });
  assert.match(unknownTarget.errors.join(" "), /pergerakan yang tidak ada/i);

  const doubleReversal = summarizeCapital({
    contributions: [contribution()],
    movements: [
      movement({ id: "m1", movementType: "ALLOCATION", amount: dec("10.00") }),
      movement({ id: "m2", movementType: "REVERSAL", revertsMovementId: "m1" }),
      movement({
        id: "m3",
        movementType: "REVERSAL",
        revertsMovementId: "m1",
        reference: "MODAL/2026/01/BATAL-2",
      }),
    ],
  });
  assert.match(doubleReversal.errors.join(" "), /sudah dibatalkan lebih dari sekali/i);

  const orphan = summarizeCapital({
    contributions: [contribution()],
    movements: [movement({ contributionId: "c-tidak-ada" })],
  });
  assert.match(orphan.errors.join(" "), /pencatatan modal yang tidak ada/i);
});

test("kepemilikan modal tidak pernah menjadi dasar hak profit", () => {
  const notice = capitalProfitBasisNotice();
  assert.equal(notice, CAPITAL_PROFIT_BASIS_NOTICE);
  assert.match(notice, /tidak menentukan hak profit/i);
  // Teks ini tidak memuat angka apa pun.
  assert.equal(/\d/.test(notice), false);

  assert.equal(capitalContributionKey("MEMBER", " bc-1 "), "MEMBER:BC-1");
  assert.equal(capitalContributionKey("COMPANY", "modal/2026/01"), "COMPANY:MODAL/2026/01");
});
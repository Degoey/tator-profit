import assert from "node:assert/strict";
import { test } from "node:test";

import { Prisma } from "@prisma/client";

import {
  allocateMemberShares,
  assertAllocationInvariant,
  computeDistributableAmount,
} from "../src/lib/services/profit-allocation";
import {
  PENDING_APPROVAL_POLICY,
  validateProfitSharePolicy,
  type ProfitSharePolicyInput,
} from "../src/lib/services/profit-share-config";

const dec = (value: string) => new Prisma.Decimal(value);

const approvedPolicy: ProfitSharePolicyInput = {
  status: "APPROVED",
  memberShareRate: dec("0.5000"),
  reserveRate: dec("0.0500"),
  managementFeeRate: dec("0.1000"),
  lossHandling: "CARRY_FORWARD",
  approvedByUserId: "11111111-1111-1111-1111-111111111111",
  approvedAt: new Date("2026-01-05T00:00:00.000Z"),
};

test("kebijakan yang belum disetujui memblokir pembagian hasil", () => {
  const result = computeDistributableAmount({
    netPnl: dec("1000.00"),
    policy: PENDING_APPROVAL_POLICY,
  });

  assert.equal(result.blocked, true);
  assert.equal(result.memberPoolAmount.toFixed(2), "0.00");
  assert.equal(result.distributableAmount.toFixed(2), "0.00");
  assert.equal(result.preview, null);
  assert.match(result.reason, /menunggu persetujuan/i);
});

test("kebijakan disetujui menghitung biaya pengelolaan, cadangan, dan hak anggota", () => {
  const result = computeDistributableAmount({
    netPnl: dec("1000.00"),
    policy: approvedPolicy,
  });

  assert.equal(result.blocked, false);
  assert.equal(result.isLoss, false);
  assert.equal(result.managementFeeAmount.toFixed(2), "100.00");
  assert.equal(result.reserveAmount.toFixed(2), "50.00");
  assert.equal(result.distributableAmount.toFixed(2), "850.00");
  assert.equal(result.memberPoolAmount.toFixed(2), "425.00");
  assert.equal(result.blockers.length, 0);
  assert.match(result.reason, /disetujui pemilik/i);
});

test("periode rugi tidak menghasilkan hak anggota dan menjelaskan penanganannya", () => {
  const result = computeDistributableAmount({
    netPnl: dec("-200.00"),
    policy: approvedPolicy,
  });

  assert.equal(result.isLoss, true);
  assert.equal(result.blocked, true);
  assert.equal(result.memberPoolAmount.toFixed(2), "0.00");
  assert.match(result.reason, /kerugian neto/i);
  assert.match(result.reason, /Bawa kerugian ke periode berikutnya/i);
  assert.equal(result.preview, null);
});

test("kebijakan dengan cadangan dan biaya melebihi 100% ditolak", () => {
  const result = computeDistributableAmount({
    netPnl: dec("100.00"),
    policy: { ...approvedPolicy, reserveRate: dec("0.9000"), managementFeeRate: dec("0.2000") },
  });

  assert.equal(result.blocked, true);
  assert.equal(result.memberPoolAmount.toFixed(2), "0.00");
  assert.match(result.reason, /melebihi 100%/i);
});

test("validasi kebijakan wajib lengkap sebelum berstatus disetujui", () => {
  assert.equal(validateProfitSharePolicy(PENDING_APPROVAL_POLICY).valid, false);

  const incomplete: ProfitSharePolicyInput = { ...approvedPolicy, lossHandling: null };
  const incompleteResult = validateProfitSharePolicy(incomplete);
  assert.equal(incompleteResult.valid, false);
  assert.match(incompleteResult.errors.join(" "), /periode rugi belum ditetapkan/i);

  assert.equal(validateProfitSharePolicy(approvedPolicy).valid, true);

  const badRate = validateProfitSharePolicy({ ...approvedPolicy, memberShareRate: dec("1.5000") });
  assert.equal(badRate.valid, false);
  assert.match(badRate.errors.join(" "), /antara 0 dan 1/);
});

test("pembagian proporsional tepat sama dengan jumlah yang dibagi", () => {
  const result = allocateMemberShares({
    memberPool: dec("100.00"),
    members: [
      { memberId: "A", basis: dec("50.00") },
      { memberId: "B", basis: dec("30.00") },
      { memberId: "C", basis: dec("20.00") },
    ],
  });

  assert.deepEqual(
    result.allocations.map((item) => [item.memberId, item.amount.toFixed(2)]),
    [
      ["A", "50.00"],
      ["B", "30.00"],
      ["C", "20.00"],
    ],
  );
  assert.equal(result.allocatedTotal.toFixed(2), "100.00");
  assert.equal(result.unallocated.toFixed(2), "0.00");
  assert.equal(result.reason, null);
});

test("pembulatan sisa terbesar tidak kehilangan atau menciptakan sen", () => {
  const even = allocateMemberShares({
    memberPool: dec("100.00"),
    members: [
      { memberId: "A", basis: dec("10.00") },
      { memberId: "B", basis: dec("10.00") },
      { memberId: "C", basis: dec("10.00") },
    ],
  });
  assert.deepEqual(
    even.allocations.map((item) => item.amount.toFixed(2)),
    ["33.34", "33.33", "33.33"],
  );
  assert.equal(even.allocatedTotal.toFixed(2), "100.00");
  assert.equal(even.unallocated.toFixed(2), "0.00");

  const tiny = allocateMemberShares({
    memberPool: dec("0.05"),
    members: [
      { memberId: "A", basis: dec("1.00") },
      { memberId: "B", basis: dec("1.00") },
    ],
  });
  assert.deepEqual(
    tiny.allocations.map((item) => item.amount.toFixed(2)),
    ["0.03", "0.02"],
  );
  assert.equal(tiny.allocatedTotal.toFixed(2), "0.05");
});

test("anggota tanpa dasar pembagian menerima nol dan sisanya dilaporkan", () => {
  const result = allocateMemberShares({
    memberPool: dec("100.00"),
    members: [
      { memberId: "A", basis: dec("100.00") },
      { memberId: "B", basis: dec("0.00") },
    ],
  });

  assert.deepEqual(
    result.allocations.map((item) => [item.memberId, item.amount.toFixed(2)]),
    [
      ["A", "100.00"],
      ["B", "0.00"],
    ],
  );
  assert.equal(result.unallocated.toFixed(2), "0.00");

  const noBasis = allocateMemberShares({
    memberPool: dec("100.00"),
    members: [
      { memberId: "A", basis: dec("0.00") },
      { memberId: "B", basis: dec("0.00") },
    ],
  });
  assert.equal(noBasis.allocatedTotal.toFixed(2), "0.00");
  assert.equal(noBasis.unallocated.toFixed(2), "100.00");
  assert.match(noBasis.reason ?? "", /dasar pembagian di atas nol/i);
});

test("tidak ada hasil untuk dibagi berarti seluruh hak anggota nol", () => {
  const result = allocateMemberShares({
    memberPool: dec("0.00"),
    members: [{ memberId: "A", basis: dec("10.00") }],
  });

  assert.equal(result.allocations[0]?.amount.toFixed(2), "0.00");
  assert.equal(result.unallocated.toFixed(2), "0.00");
  assert.match(result.reason ?? "", /Tidak ada hasil yang dibagi/i);
});

test("invarian alokasi menolak jumlah yang melebihi hak yang tersedia", () => {
  assert.doesNotThrow(() => assertAllocationInvariant(dec("100.00"), dec("100.00")));
  assert.throws(() => assertAllocationInvariant(dec("100.00"), dec("100.01")), RangeError);
  assert.throws(
    () =>
      allocateMemberShares({
        memberPool: dec("-1.00"),
        members: [{ memberId: "A", basis: dec("10.00") }],
      }),
    RangeError,
  );
  // Nilai dengan lebih dari dua desimal (bukan sekadar nol di belakang koma)
  // ditolak, bukan dibulatkan diam-diam.
  assert.throws(
    () =>
      allocateMemberShares({
        memberPool: dec("10.001"),
        members: [{ memberId: "A", basis: dec("10.00") }],
      }),
    RangeError,
  );
  assert.throws(
    () =>
      allocateMemberShares({
        memberPool: dec("10.00"),
        members: [{ memberId: "A", basis: dec("1.234") }],
      }),
    RangeError,
  );
});
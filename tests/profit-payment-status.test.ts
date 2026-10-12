import assert from "node:assert/strict";
import { test } from "node:test";

import { PROFIT_PAYMENT_STATUSES, profitPaymentIdempotencyKey } from "../src/lib/config/trading";
import {
  FINAL_PROFIT_PAYMENT_STATUSES,
  PROFIT_PAYMENT_TRANSITIONS,
  ProfitPaymentTransitionError,
  assertNoDuplicatePayment,
  assertPaymentCompletionReady,
  assertProfitPaymentTransition,
  canTransitionProfitPayment,
  evaluatePaymentCompletion,
  findDuplicatePayment,
  isFinalProfitPaymentStatus,
  profitPaymentStatusLabel,
} from "../src/lib/services/profit-payment-status";

test("setiap status pembayaran punya transisi dan label yang jelas", () => {
  for (const status of PROFIT_PAYMENT_STATUSES) {
    assert.ok(Array.isArray(PROFIT_PAYMENT_TRANSITIONS[status]), status);
    assert.ok(profitPaymentStatusLabel(status).length > 0, status);
  }
  assert.equal(PROFIT_PAYMENT_TRANSITIONS.COMPLETED.length, 0);
  assert.equal(PROFIT_PAYMENT_TRANSITIONS.CANCELLED.length, 0);
  assert.deepEqual([...FINAL_PROFIT_PAYMENT_STATUSES], ["COMPLETED", "CANCELLED"]);
  assert.equal(isFinalProfitPaymentStatus("COMPLETED"), true);
  assert.equal(isFinalProfitPaymentStatus("PENDING"), false);
  assert.equal(isFinalProfitPaymentStatus("FAILED"), false);
});

test("pembayaran harus melewati proses sebelum boleh dinyatakan dibayar", () => {
  assert.equal(canTransitionProfitPayment("PENDING", "PROCESSING"), true);
  assert.equal(canTransitionProfitPayment("PROCESSING", "COMPLETED"), true);
  assert.equal(canTransitionProfitPayment("PROCESSING", "FAILED"), true);
  assert.equal(canTransitionProfitPayment("FAILED", "PENDING"), true);
  assert.equal(canTransitionProfitPayment("PENDING", "CANCELLED"), true);

  // Tidak boleh melompat langsung ke "dibayar" atau "gagal" dari menunggu.
  assert.equal(canTransitionProfitPayment("PENDING", "COMPLETED"), false);
  assert.equal(canTransitionProfitPayment("PENDING", "FAILED"), false);
  assert.equal(canTransitionProfitPayment("COMPLETED", "PENDING"), false);
  assert.equal(canTransitionProfitPayment("CANCELLED", "PROCESSING"), false);

  assert.doesNotThrow(() => assertProfitPaymentTransition("PENDING", "PROCESSING"));
  assert.throws(
    () => assertProfitPaymentTransition("PENDING", "COMPLETED"),
    ProfitPaymentTransitionError,
  );
  assert.throws(
    () => assertProfitPaymentTransition("COMPLETED", "COMPLETED"),
    ProfitPaymentTransitionError,
  );
});

test("status dibayar hanya setelah bukti pembayaran ada dan diverifikasi", () => {
  const none = evaluatePaymentCompletion({
    hasProof: false,
    verifiedByUserId: null,
    verifiedAt: null,
  });
  assert.equal(none.ready, false);
  assert.equal(none.blockers.length, 3);
  assert.throws(() => assertPaymentCompletionReady({ hasProof: false }));

  const noVerifier = evaluatePaymentCompletion({
    hasProof: true,
    verifiedByUserId: null,
    verifiedAt: new Date("2026-10-20T05:00:00.000Z"),
  });
  assert.equal(noVerifier.ready, false);
  assert.match(noVerifier.blockers.join(" "), /siapa yang memverifikasi/i);

  const ready = evaluatePaymentCompletion({
    hasProof: true,
    verifiedByUserId: "admin-2",
    verifiedAt: new Date("2026-10-20T05:00:00.000Z"),
  });
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.blockers, []);
  assert.doesNotThrow(() =>
    assertPaymentCompletionReady({
      hasProof: true,
      verifiedByUserId: "admin-2",
      verifiedAt: new Date("2026-10-20T05:00:00.000Z"),
    }),
  );
});

test("pembayaran berulang ditolak lewat kunci idempotensi atau pembayaran aktif", () => {
  const key = profitPaymentIdempotencyKey("alloc-1");
  assert.equal(key, "profit-payment:alloc-1");

  const candidate = { allocationId: "alloc-1", status: "PENDING" as const, idempotencyKey: key };

  const sameKey = findDuplicatePayment(candidate, [
    { allocationId: "alloc-1", status: "COMPLETED", idempotencyKey: key },
  ]);
  assert.equal(sameKey.duplicate, true);
  assert.match(sameKey.reason ?? "", /kunci idempotensi/i);

  const active = findDuplicatePayment(
    { allocationId: "alloc-1", status: "PENDING", idempotencyKey: null },
    [
      { allocationId: "alloc-2", status: "COMPLETED", idempotencyKey: "lain" },
      { allocationId: "alloc-1", status: "PROCESSING", idempotencyKey: "lain-2" },
    ],
  );
  assert.equal(active.duplicate, true);
  assert.match(active.reason ?? "", /pembayaran berjalan/i);

  assert.throws(
    () => assertNoDuplicatePayment(candidate, [{ allocationId: "alloc-1", status: "PROCESSING" }]),
    /pembayaran berjalan/i,
  );

  // Pembayaran yang gagal/dibatalkan boleh dicatat ulang, dan hak anggota lain bebas.
  const retry = findDuplicatePayment(
    { allocationId: "alloc-1", status: "PENDING", idempotencyKey: null },
    [
      { allocationId: "alloc-1", status: "FAILED", idempotencyKey: "gagal-1" },
      { allocationId: "alloc-1", status: "CANCELLED", idempotencyKey: "batal-1" },
    ],
  );
  assert.equal(retry.duplicate, false);
  assert.equal(retry.reason, null);
  assert.doesNotThrow(() =>
    assertNoDuplicatePayment(
      { allocationId: "alloc-3", status: "PENDING", idempotencyKey: null },
      [{ allocationId: "alloc-1", status: "COMPLETED" }],
    ),
  );
});
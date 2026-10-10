import assert from "node:assert/strict";
import { test } from "node:test";

import { Prisma } from "@prisma/client";

import {
  WITHDRAWAL_FEE_RATE,
  calculateWithdrawalFee,
  withdrawalAmounts,
} from "../src/lib/withdrawal-fee";

/**
 * Unit tests for the shared withdrawal fee (10%). These run without a database
 * and never touch a real balance.
 */

test("biaya penarikan 10% untuk 100 USDT", () => {
  const result = calculateWithdrawalFee("100");
  assert.equal(result.amount.toFixed(2), "100.00");
  assert.equal(result.fee.toFixed(2), "10.00");
  assert.equal(result.netAmount.toFixed(2), "90.00");
});

test("biaya penarikan 10% untuk 500 USDT", () => {
  const result = calculateWithdrawalFee("500");
  assert.equal(result.fee.toFixed(2), "50.00");
  assert.equal(result.netAmount.toFixed(2), "450.00");
});

test("biaya penarikan 10% untuk 1.000 USDT", () => {
  const result = calculateWithdrawalFee(new Prisma.Decimal("1000.00"));
  assert.equal(result.fee.toFixed(2), "100.00");
  assert.equal(result.netAmount.toFixed(2), "900.00");
});

test("tarif biaya terpusat bernilai 10%", () => {
  assert.equal(WITHDRAWAL_FEE_RATE, "0.10");
  assert.equal(new Prisma.Decimal(WITHDRAWAL_FEE_RATE).times(100).toFixed(2), "10.00");
});

test("bruto = biaya + netto selalu terjaga", () => {
  for (const gross of ["0.01", "12.34", "99.99", "123.45", "9999999.99"]) {
    const result = calculateWithdrawalFee(gross);
    assert.equal(
      result.fee.plus(result.netAmount).toFixed(2),
      new Prisma.Decimal(gross).toFixed(2),
      `bruto ${gross} harus sama dengan biaya + netto`,
    );
  }
});

test("nominal nol, negatif, atau lebih dari dua desimal ditolak", () => {
  for (const value of ["0", "0.00", "-1", "-0.01", "1.234"]) {
    assert.throws(() => calculateWithdrawalFee(value), RangeError);
  }
});

test("baris lama tanpa biaya memakai bruto sebagai netto", () => {
  const legacy = withdrawalAmounts({
    amount: new Prisma.Decimal("100.00"),
    fee: null,
    netAmount: null,
  });
  assert.equal(legacy.fee, "0.00");
  assert.equal(legacy.netAmount, "100.00");
});

test("baris baru mengembalikan biaya dan netto tersimpan", () => {
  const stored = withdrawalAmounts({
    amount: new Prisma.Decimal("500.00"),
    fee: new Prisma.Decimal("50.00"),
    netAmount: new Prisma.Decimal("450.00"),
  });
  assert.equal(stored.fee, "50.00");
  assert.equal(stored.netAmount, "450.00");
});

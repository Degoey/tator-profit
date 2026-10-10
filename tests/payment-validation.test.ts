import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEPOSIT_ACTIONS,
  WITHDRAWAL_ACTIONS,
  adminDepositActionSchema,
  adminWithdrawalActionSchema,
  depositFieldsSchema,
  paymentAmountSchema,
  withdrawalSchema,
} from "../src/lib/payment-validation";

const USER_PROGRAM_ID = "ca3e42d0-33d4-496a-95e2-4030c24e1a83";

describe("paymentAmountSchema", () => {
  it("menerima nilai desimal sebagai string", () => {
    for (const amount of ["1", "500.00", "0.01", "9999999999999999.99"]) {
      const result = paymentAmountSchema.safeParse(amount);
      assert.equal(result.success, true, `amount=${amount}`);
    }
  });

  it("menolak nilai nol, negatif, dan lebih dari dua desimal", () => {
    for (const amount of ["0", "0.00", "-5", "1.234", "abc", "1e3", " 5.5.5 "]) {
      const result = paymentAmountSchema.safeParse(amount);
      assert.equal(result.success, false, `amount=${amount}`);
    }
  });

  it("tidak pernah mengubah nilai uang menjadi angka JS", () => {
    const result = paymentAmountSchema.safeParse("500.00");
    assert.equal(result.success, true);
    assert.equal(typeof result.data, "string");
    assert.equal(result.data, "500.00");
  });
});

describe("depositFieldsSchema", () => {
  const valid = {
    userProgramId: USER_PROGRAM_ID,
    amount: "500.00",
    paymentMethod: "BANK_TRANSFER",
  };

  it("menerima muatan setoran yang valid tanpa referensi", () => {
    const result = depositFieldsSchema.safeParse(valid);
    assert.equal(result.success, true);
    assert.equal(result.data?.paymentReference, undefined);
  });

  it("menolak metode pembayaran yang tidak dikenal", () => {
    const result = depositFieldsSchema.safeParse({ ...valid, paymentMethod: "GIFT_CARD" });
    assert.equal(result.success, false);
    assert.ok(result.error?.issues.some((issue) => issue.path[0] === "paymentMethod"));
  });

  it("menolak id keanggotaan yang bukan uuid", () => {
    const result = depositFieldsSchema.safeParse({ ...valid, userProgramId: "USDT-10" });
    assert.equal(result.success, false);
    assert.equal(result.error?.issues[0]?.path[0], "userProgramId");
  });

  it("menolak referensi pembayaran yang terlalu panjang", () => {
    const result = depositFieldsSchema.safeParse({ ...valid, paymentReference: "x".repeat(201) });
    assert.equal(result.success, false);
    assert.ok(result.error?.issues.some((issue) => issue.path[0] === "paymentReference"));
  });
});

describe("withdrawalSchema", () => {
  const valid = {
    amount: "120.50",
    method: "EWALLET",
    destination: "081234567890",
  };

  it("menerima muatan penarikan yang valid tanpa catatan", () => {
    const result = withdrawalSchema.safeParse(valid);
    assert.equal(result.success, true);
    assert.equal(result.data?.notes, undefined);
  });

  it("menolak tujuan kosong dan metode yang salah", () => {
    const noDestination = withdrawalSchema.safeParse({ ...valid, destination: "   " });
    assert.equal(noDestination.success, false);

    const badMethod = withdrawalSchema.safeParse({ ...valid, method: "CASH" });
    assert.equal(badMethod.success, false);
    assert.ok(badMethod.error?.issues.some((issue) => issue.path[0] === "method"));
  });

  it("menolak catatan yang melebihi batas", () => {
    const result = withdrawalSchema.safeParse({ ...valid, notes: "x".repeat(501) });
    assert.equal(result.success, false);
    assert.ok(result.error?.issues.some((issue) => issue.path[0] === "notes"));
  });

  it("mengabaikan biaya/netto yang dikirim browser (server yang menghitung)", () => {
    const result = withdrawalSchema.safeParse({
      ...valid,
      fee: "0.01",
      netAmount: "999999.00",
    });
    assert.equal(result.success, true);
    // The schema strips the injected money fields: only the gross survives.
    assert.equal("fee" in (result.data ?? {}), false);
    assert.equal("netAmount" in (result.data ?? {}), false);
    assert.equal(result.data?.amount, "120.50");
  });

  it("menerima kunci idempotensi berbentuk UUID dan menolak yang tidak valid", () => {
    const withKey = withdrawalSchema.safeParse({
      ...valid,
      idempotencyKey: "123e4567-e89b-12d3-a456-426614174000",
    });
    assert.equal(withKey.success, true);
    assert.equal(withKey.data?.idempotencyKey, "123e4567-e89b-12d3-a456-426614174000");

    const badKey = withdrawalSchema.safeParse({ ...valid, idempotencyKey: "not-a-uuid" });
    assert.equal(badKey.success, false);
    assert.ok(badKey.error?.issues.some((issue) => issue.path[0] === "idempotencyKey"));
  });
});

describe("adminDepositActionSchema", () => {
  it("menerima setiap aksi setoran yang diizinkan", () => {
    for (const action of DEPOSIT_ACTIONS) {
      const result = adminDepositActionSchema.safeParse({ id: USER_PROGRAM_ID, action });
      assert.equal(result.success, true, `action=${action}`);
    }
  });

  it("menolak aksi penarikan pada skema setoran", () => {
    const result = adminDepositActionSchema.safeParse({ id: USER_PROGRAM_ID, action: "PROCESSING" });
    assert.equal(result.success, false);
    assert.ok(result.error?.issues.some((issue) => issue.path[0] === "action"));
  });

  it("menolak id yang bukan uuid", () => {
    const result = adminDepositActionSchema.safeParse({ id: "1", action: "APPROVED" });
    assert.equal(result.success, false);
    assert.ok(result.error?.issues.some((issue) => issue.path[0] === "id"));
  });
});

describe("adminWithdrawalActionSchema", () => {
  it("menerima setiap aksi penarikan yang diizinkan", () => {
    for (const action of WITHDRAWAL_ACTIONS) {
      const result = adminWithdrawalActionSchema.safeParse({ id: USER_PROGRAM_ID, action });
      assert.equal(result.success, true, `action=${action}`);
    }
  });

  it("menolak aksi setoran pada skema penarikan", () => {
    const result = adminWithdrawalActionSchema.safeParse({ id: USER_PROGRAM_ID, action: "FLAGGED" });
    assert.equal(result.success, false);
    assert.ok(result.error?.issues.some((issue) => issue.path[0] === "action"));
  });

  it("menerima alasan opsional yang dibatasi panjangnya", () => {
    const tooLong = adminWithdrawalActionSchema.safeParse({
      id: USER_PROGRAM_ID,
      action: "REJECTED",
      reason: "x".repeat(501),
    });
    assert.equal(tooLong.success, false);

    const ok = adminWithdrawalActionSchema.safeParse({
      id: USER_PROGRAM_ID,
      action: "REJECTED",
      reason: "Rekening tujuan tidak valid.",
    });
    assert.equal(ok.success, true);
  });
});

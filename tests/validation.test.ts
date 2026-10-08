import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { adminCreditSchema, joinProgramSchema, registerSchema } from "../src/lib/validation";

const validRegistration = {
  name: "Budi Santoso",
  username: "Budi_01",
  email: "Budi@Example.COM",
  phone: "+628123456789",
  password: "Tator12345",
  acceptTerms: true,
};

describe("registerSchema", () => {
  it("menerima muatan tanpa kode rujukan", () => {
    const result = registerSchema.safeParse(validRegistration);

    assert.equal(result.success, true);
    assert.equal(result.data?.referralCode, undefined);
  });

  it("memperlakukan kode rujukan kosong atau berisi spasi sebagai tidak ada", () => {
    for (const referralCode of ["", "   "]) {
      const result = registerSchema.safeParse({ ...validRegistration, referralCode });

      assert.equal(result.success, true, `referralCode=${JSON.stringify(referralCode)}`);
      assert.equal(result.data?.referralCode, undefined);
    }
  });

  it("menormalkan kode rujukan yang dikirim menjadi huruf besar", () => {
    const result = registerSchema.safeParse({ ...validRegistration, referralCode: " alice-1a2b " });

    assert.equal(result.success, true);
    assert.equal(result.data?.referralCode, "ALICE-1A2B");
  });

  it("menolak kode rujukan yang formatnya salah", () => {
    const result = registerSchema.safeParse({ ...validRegistration, referralCode: "ab" });

    assert.equal(result.success, false);
    assert.equal(result.error?.issues[0]?.path[0], "referralCode");
  });

  it("menormalkan nama pengguna dan surel menjadi huruf kecil", () => {
    const result = registerSchema.safeParse(validRegistration);

    assert.equal(result.success, true);
    assert.equal(result.data?.username, "budi_01");
    assert.equal(result.data?.email, "budi@example.com");
  });

  it("menolak kata sandi lemah, nomor telepon salah, dan persetujuan yang hilang", () => {
    const weakPassword = registerSchema.safeParse({ ...validRegistration, password: "onlyletters" });
    assert.equal(weakPassword.success, false);
    assert.ok(weakPassword.error?.issues.some((issue) => issue.path[0] === "password"));

    const badPhone = registerSchema.safeParse({ ...validRegistration, phone: "123" });
    assert.equal(badPhone.success, false);
    assert.ok(badPhone.error?.issues.some((issue) => issue.path[0] === "phone"));

    const noConsent = registerSchema.safeParse({ ...validRegistration, acceptTerms: false });
    assert.equal(noConsent.success, false);
    assert.ok(noConsent.error?.issues.some((issue) => issue.path[0] === "acceptTerms"));
  });

  it("menolak konfirmasi kata sandi yang tidak cocok", () => {
    const result = registerSchema.safeParse({
      ...validRegistration,
      confirmPassword: "Different123",
    });

    assert.equal(result.success, false);
    assert.ok(result.error?.issues.some((issue) => issue.path[0] === "confirmPassword"));
  });
});

describe("joinProgramSchema", () => {
  it("menerima id paket tanpa kode rujukan", () => {
    const result = joinProgramSchema.safeParse({
      tierId: "ca3e42d0-33d4-496a-95e2-4030c24e1a83",
    });

    assert.equal(result.success, true);
    assert.equal(result.data?.referralCode, undefined);
  });

  it("menolak id paket yang bukan uuid", () => {
    // "USDT-10" adalah kode paket, bukan id; permintaan seperti ini harus ditolak.
    const result = joinProgramSchema.safeParse({ tierId: "USDT-10" });

    assert.equal(result.success, false);
    assert.equal(result.error?.issues[0]?.path[0], "tierId");
  });
});

const validCredit = {
  userId: "ca3e42d0-33d4-496a-95e2-4030c24e1a83",
  amount: "100.00",
  reason: "Saldo awal sesuai keputusan tim keuangan",
  reference: "ADM-20261011-0001",
};

describe("adminCreditSchema", () => {
  it("menerima kredit admin yang lengkap", () => {
    const result = adminCreditSchema.safeParse(validCredit);

    assert.equal(result.success, true);
    assert.equal(result.data?.amount, "100.00");
    assert.equal(result.data?.reference, "ADM-20261011-0001");
  });

  it("menolak jumlah nol, negatif, atau lebih dari dua desimal", () => {
    for (const amount of ["0", "0.00", "-5.00", "10.001", "1e3"]) {
      const result = adminCreditSchema.safeParse({ ...validCredit, amount });
      assert.equal(result.success, false, `amount=${amount}`);
      assert.ok(result.error?.issues.some((issue) => issue.path[0] === "amount"), `amount=${amount}`);
    }
  });

  it("mewajibkan akun penerima berupa User ID yang valid", () => {
    const result = adminCreditSchema.safeParse({ ...validCredit, userId: "demo_member" });

    assert.equal(result.success, false);
    assert.equal(result.error?.issues[0]?.path[0], "userId");
  });

  it("mewajibkan alasan yang bermakna", () => {
    for (const reason of ["", "  ", "ab"]) {
      const result = adminCreditSchema.safeParse({ ...validCredit, reason });
      assert.equal(result.success, false, `reason=${JSON.stringify(reason)}`);
      assert.ok(result.error?.issues.some((issue) => issue.path[0] === "reason"));
    }
  });

  it("menolak nomor referensi yang tidak aman atau terlalu pendek", () => {
    for (const reference of ["", "ab", "ADM 2026", "ADM/2026", "ADM#1", "a".repeat(65)]) {
      const result = adminCreditSchema.safeParse({ ...validCredit, reference });
      assert.equal(result.success, false, `reference=${JSON.stringify(reference)}`);
      assert.ok(result.error?.issues.some((issue) => issue.path[0] === "reference"));
    }
  });

  it("menerima referensi dengan titik dua dan tanda hubung", () => {
    const result = adminCreditSchema.safeParse({ ...validCredit, reference: "FIN:2026-0001" });

    assert.equal(result.success, true);
  });
});

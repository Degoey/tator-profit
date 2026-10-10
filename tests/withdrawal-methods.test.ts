/**
 * Guards the withdrawal method labels and the destination guidance.
 *
 * The payout settles on the same BEP-20 (BNB Smart Chain) network as the
 * deposit wallet. A lingering TRC20/TRON label, or a destination field that
 * asks for a bank account while the selected method is crypto, would tell a
 * member to move USDT on the wrong network, where the transfer is lost. The
 * assertions below pin the label, the untouched `CRYPTO` value codes and the
 * per-method copy wiring.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  DEPOSIT_METHODS,
  WITHDRAWAL_METHODS,
  optionLabel,
  withdrawalDestinationGuidance,
} from "../src/components/payments/options";
import { PAYMENT_METHODS } from "../src/lib/payment-validation";

/** `npm test` always runs from the repository root. */
const ROOT = process.cwd();

const withdrawalFormSource = readFileSync(
  path.join(ROOT, "src", "components", "payments", "withdrawal-form.tsx"),
  "utf8",
);

describe("metode penarikan", () => {
  it("memakai BEP-20 dan tidak pernah TRC20/TRON", () => {
    const crypto = WITHDRAWAL_METHODS.find((option) => option.value === "CRYPTO");
    assert.ok(crypto, "metode kripto harus terdaftar");
    assert.match(crypto.label, /BEP-20/, "metode penarikan kripto harus BEP-20");
    assert.equal(/TRC-?20|TRON/i.test(crypto.label), false, "metode penarikan jangan TRC20");

    // Deposit dan penarikan memakai jaringan yang sama: labelnya harus seragam.
    const depositCrypto = DEPOSIT_METHODS.find((option) => option.value === "CRYPTO");
    assert.ok(depositCrypto, "metode deposit kripto harus terdaftar");
    assert.equal(crypto.label, depositCrypto.label, "label kripto deposit dan penarikan identik");
  });

  it("mempertahankan kode nilai yang diterima API", () => {
    assert.deepEqual(
      WITHDRAWAL_METHODS.map((option) => option.value),
      [...PAYMENT_METHODS],
      "nilai metode harus tetap sama dengan enum validasi server",
    );
    assert.equal(optionLabel(WITHDRAWAL_METHODS, "CRYPTO"), "Kripto (USDT BEP-20)");
    // Kode tak dikenal tetap ditampilkan apa adanya, bukan undefined.
    assert.equal(optionLabel(WITHDRAWAL_METHODS, "LEGACY_TOKEN"), "LEGACY_TOKEN");
  });

  it("meminta alamat BEP-20 saat metode kripto dan melarang TRC20/TRON", () => {
    const crypto = withdrawalDestinationGuidance("CRYPTO");
    assert.match(crypto.hint, /BEP-20/, "sebut jaringan BEP-20");
    assert.match(crypto.hint, /0x/, "jelaskan format alamat 0x");
    assert.match(crypto.hint, /TRC20/, "peringatkan jangan pakai alamat TRC20/TRON");
    assert.equal(
      /TRC-?20|TRON/i.test(crypto.placeholder),
      false,
      "placeholder kripto tidak boleh menyebut TRC20/TRON",
    );
    assert.equal(
      /rekening|e-wallet/i.test(crypto.placeholder),
      false,
      "placeholder kripto tidak boleh menyuruh isi nomor rekening",
    );

    // Bank dan e-wallet tetap memakai copy lama.
    const bank = withdrawalDestinationGuidance("BANK_TRANSFER");
    assert.match(bank.hint, /rekening atau alamat e-wallet/);
    assert.equal(bank.hint, withdrawalDestinationGuidance("EWALLET").hint);
    assert.equal(bank.placeholder, "Bank BCA · 1234567890 · Nama Pemilik");
  });

  it("menyambungkan panduan tujuan ke form penarikan", () => {
    assert.ok(
      withdrawalFormSource.includes("withdrawalDestinationGuidance"),
      "form penarikan harus memakai panduan tujuan",
    );
    assert.ok(withdrawalFormSource.includes("hint={destinationGuidance.hint}"));
    assert.ok(withdrawalFormSource.includes("placeholder={destinationGuidance.placeholder}"));
    assert.ok(
      withdrawalFormSource.includes("WITHDRAWAL_METHODS.map"),
      "dropdown metode harus berasal dari satu sumber opsi",
    );
  });
});

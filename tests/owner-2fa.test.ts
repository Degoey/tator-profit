import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isOwnerAccount, ownerStepUpMs } from "../src/lib/config/owner";
import {
  consumeRecoveryCode,
  formatRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCodes,
  normalizeRecoveryCode,
  recoveryHashesFromJson,
} from "../src/lib/owner/recovery-codes";
import {
  decryptOwnerSecret,
  encryptOwnerSecret,
  OwnerSecretError,
} from "../src/lib/owner/secret-box";
import {
  base32Decode,
  base32Encode,
  formatTotpSecret,
  generateTotpSecret,
  otpauthUri,
  totpCode,
  verifyTotpCode,
} from "../src/lib/owner/totp";

/**
 * Pengujian 2FA Konsol Pemilik tanpa database.
 *
 * Vektor TOTP diambil dari RFC 6238 (Lampiran B, SHA-1) sehingga kebenaran
 * perhitungan tidak bergantung pada aplikasi autentikator mana pun: kunci
 * `12345678901234567890` pada detik-detik uji harus menghasilkan kode yang sama
 * dengan yang tercatat di RFC.
 */
const RFC_SECRET_ASCII = "12345678901234567890";
const RFC_SECRET_BASE32 = base32Encode(Buffer.from(RFC_SECRET_ASCII, "utf8"));

describe("TOTP (RFC 6238)", () => {
  it("menghitung kode yang sama dengan vektor RFC 6238", () => {
    const vectors: [number, string][] = [
      [59, "287082"],
      [1111111109, "081804"],
      [1111111111, "050471"],
      [1234567890, "005924"],
      [2000000000, "279037"],
      [20000000000, "353130"],
    ];

    for (const [seconds, expected] of vectors) {
      const counter = Math.floor(seconds / 30);
      assert.equal(totpCode(RFC_SECRET_BASE32, counter), expected, `detik ${seconds}`);
    }
  });

  it("bolak-balik base32 tetap sama dan menerima spasi/huruf kecil", () => {
    const bytes = Buffer.from("rahasia-2fa-pemilik", "utf8");
    const encoded = base32Encode(bytes);
    assert.deepEqual(base32Decode(encoded), bytes);
    assert.deepEqual(base32Decode(encoded.toLowerCase()), bytes);
    assert.deepEqual(base32Decode(formatTotpSecret(encoded)), bytes);
  });

  it("membuat rahasia base32 sepanjang 32 karakter", () => {
    const secret = generateTotpSecret();
    assert.equal(secret.length, 32);
    assert.match(secret, /^[A-Z2-7]{32}$/);
    assert.notEqual(secret, generateTotpSecret());
  });

  it("menerima kode pada jendela toleransi dan menolak kode lain", () => {
    const secret = generateTotpSecret();
    const at = 1_700_000_000_000;
    const current = totpCode(secret, Math.floor(at / 1000 / 30));

    assert.deepEqual(verifyTotpCode(secret, current, { atMs: at }), {
      counter: Math.floor(at / 1000 / 30),
    });

    /** Satu langkah ke belakang masih diterima (geseran jam perangkat). */
    const previous = totpCode(secret, Math.floor(at / 1000 / 30) - 1);
    assert.ok(verifyTotpCode(secret, previous, { atMs: at }));

    /** Dua langkah ke belakang sudah di luar jendela. */
    const tooOld = totpCode(secret, Math.floor(at / 1000 / 30) - 2);
    assert.equal(verifyTotpCode(secret, tooOld, { atMs: at }), null);

    assert.equal(verifyTotpCode(secret, "000000", { atMs: at, window: 0 }), null);
    assert.equal(verifyTotpCode(secret, "12345", { atMs: at }), null);
  });

  it("menolak pemakaian ulang kode yang sama (anti replay)", () => {
    const secret = generateTotpSecret();
    const at = 1_700_000_000_000;
    const counter = Math.floor(at / 1000 / 30);
    const code = totpCode(secret, counter);

    const first = verifyTotpCode(secret, code, { atMs: at });
    assert.ok(first);
    assert.equal(verifyTotpCode(secret, code, { atMs: at, lastUsedCounter: first.counter }), null);
  });

  it("menyusun URI otpauth yang dapat dipakai autentikator", () => {
    const uri = otpauthUri({
      secret: RFC_SECRET_BASE32,
      account: "pemilik@example.com",
      issuer: "Tatorprofit Pemilik",
    });
    assert.ok(uri.startsWith("otpauth://totp/"));
    assert.ok(uri.includes(`secret=${RFC_SECRET_BASE32}`));
    assert.ok(uri.includes("algorithm=SHA1"));
    assert.ok(uri.includes("digits=6"));
    assert.ok(uri.includes("period=30"));
    assert.ok(uri.includes(encodeURIComponent("Tatorprofit Pemilik:pemilik@example.com")));
  });
});

describe("Kotak rahasia pemilik (AES-256-GCM)", () => {
  const env = { OWNER_2FA_KEY: "a".repeat(64) } ;

  it("bolak-balik enkripsi mengembalikan rahasia asli", () => {
    const secret = generateTotpSecret();
    const payload = encryptOwnerSecret(secret, env);
    assert.notEqual(payload, secret);
    assert.ok(payload.startsWith("v1."));
    assert.equal(decryptOwnerSecret(payload, env), secret);
  });

  it("menghasilkan ciphertext berbeda untuk rahasia yang sama (IV acak)", () => {
    const first = encryptOwnerSecret("SAMA", env);
    const second = encryptOwnerSecret("SAMA", env);
    assert.notEqual(first, second);
  });

  it("menolak kunci yang salah dan kunci yang belum diisi", () => {
    const payload = encryptOwnerSecret("RAHASIA", env);
    const wrongKey = { OWNER_2FA_KEY: "b".repeat(64) } ;
    assert.throws(() => decryptOwnerSecret(payload, wrongKey), OwnerSecretError);
    assert.throws(() => encryptOwnerSecret("RAHASIA", {} ), (error: unknown) => {
      assert.ok(error instanceof OwnerSecretError);
      assert.equal(error.code, "OWNER_2FA_KEY_MISSING");
      return true;
    });
    assert.throws(() => encryptOwnerSecret("RAHASIA", { OWNER_2FA_KEY: "pendek" } ));
  });
});

describe("Kode pemulihan", () => {
  it("membuat sepuluh kode unik dalam format XXXX-XXXX-XXXX", () => {
    const codes = generateRecoveryCodes();
    assert.equal(codes.length, 10);
    assert.equal(new Set(codes).size, 10);
    for (const code of codes) assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it("memakai satu kode tepat sekali", () => {
    const [first, second] = generateRecoveryCodes(3);
    assert.ok(first && second);
    const hashes = hashRecoveryCodes([first, second]);

    const used = consumeRecoveryCode(hashes, first);
    assert.equal(used.matched, true);
    assert.equal(used.remaining.length, 1);

    /** Kode yang sama tidak berlaku lagi setelah terpakai. */
    assert.equal(consumeRecoveryCode(used.remaining, first).matched, false);
    /** Kode lain masih berlaku, termasuk saat ditulis tanpa tanda hubung. */
    assert.equal(consumeRecoveryCode(used.remaining, normalizeRecoveryCode(second)).matched, true);
    assert.equal(consumeRecoveryCode(used.remaining, "ZZZZ-ZZZZ-ZZZZ").matched, false);
    assert.equal(consumeRecoveryCode(used.remaining, "pendek").matched, false);
  });

  it("menormalkan bentuk kode dan menyaring daftar hash dari JSON", () => {
    assert.equal(normalizeRecoveryCode(" abcd-efgh "), "ABCDEFGH");
    assert.equal(formatRecoveryCode("abcdefghjkmn"), "ABCD-EFGH-JKMN");
    assert.deepEqual(recoveryHashesFromJson(["x".repeat(64), "bukan-hash", 7]), ["x".repeat(64)]);
    assert.deepEqual(recoveryHashesFromJson(null), []);
  });
});

describe("Konfigurasi akun pemilik", () => {
  const env = { OWNER_EMAIL: "Pemilik@Example.com" } ;

  it("hanya mengenali ADMIN + SUPER_ADMIN dengan surel yang sama", () => {
    assert.equal(
      isOwnerAccount({ email: "pemilik@example.com", role: "ADMIN", adminRole: "SUPER_ADMIN" }, env),
      true,
    );
    /** Surel sama tetapi peran admin berbeda: bukan pemilik. */
    assert.equal(
      isOwnerAccount({ email: "pemilik@example.com", role: "ADMIN", adminRole: "FINANCE" }, env),
      false,
    );
    /** Peran benar tetapi surel berbeda: bukan pemilik. */
    assert.equal(
      isOwnerAccount({ email: "lain@example.com", role: "ADMIN", adminRole: "SUPER_ADMIN" }, env),
      false,
    );
    assert.equal(isOwnerAccount({ email: "pemilik@example.com", role: "USER", adminRole: null }, env), false);
  });

  it("mati total bila OWNER_EMAIL belum diisi", () => {
    assert.equal(
      isOwnerAccount(
        { email: "pemilik@example.com", role: "ADMIN", adminRole: "SUPER_ADMIN" },
        {} ,
      ),
      false,
    );
  });

  it("membatasi masa berlaku verifikasi 2FA ke rentang yang wajar", () => {
    assert.equal(ownerStepUpMs({} ), 12 * 60 * 60 * 1000);
    assert.equal(ownerStepUpMs({ OWNER_STEP_UP_MINUTES: "60" } ), 60 * 60 * 1000);
    assert.equal(ownerStepUpMs({ OWNER_STEP_UP_MINUTES: "1" } ), 5 * 60 * 1000);
    assert.equal(
      ownerStepUpMs({ OWNER_STEP_UP_MINUTES: "99999" } ),
      24 * 60 * 60 * 1000,
    );
    assert.equal(ownerStepUpMs({ OWNER_STEP_UP_MINUTES: "abc" } ), 12 * 60 * 60 * 1000);
  });
});

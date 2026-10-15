import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ownerStepUpIsFresh } from "../src/lib/auth/owner-guard";
import {
  DEFAULT_OWNER_WEBAUTHN_ORIGIN,
  DEFAULT_OWNER_WEBAUTHN_RP_ID,
  DEFAULT_OWNER_WEBAUTHN_RP_NAME,
  isOwnerAccount,
  isOwnerConsoleConfigured,
  ownerEmailFromEnv,
  ownerStepUpMs,
  ownerWebAuthnOrigin,
  ownerWebAuthnRpId,
  ownerWebAuthnRpName,
} from "../src/lib/config/owner";

/**
 * Pengujian Konsol Pemilik tanpa peramban.
 *
 * 2FA TOTP sudah diganti passkey WebAuthn. Upacara pendaftaran/verifikasi WebAuthn
 * hanya dapat dijalankan peramban sungguhan (kunci privat tidak pernah meninggalkan
 * perangkat), jadi yang diuji di sini adalah bagian yang murni dan deterministik:
 * konfigurasi akun pemilik, konfigurasi WebAuthn, dan aturan masa berlaku step-up
 * per sesi (`ownerStepUpIsFresh`) yang dipakai penjaga konsol.
 */

describe("Konfigurasi akun pemilik", () => {
  const env = { OWNER_EMAIL: "Pemilik@Example.com" };

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
    assert.equal(
      isOwnerAccount({ email: "pemilik@example.com", role: "USER", adminRole: null }, env),
      false,
    );
  });

  it("mati total bila OWNER_EMAIL belum diisi", () => {
    assert.equal(
      isOwnerAccount({ email: "pemilik@example.com", role: "ADMIN", adminRole: "SUPER_ADMIN" }, {}),
      false,
    );
    assert.equal(isOwnerConsoleConfigured({}), false);
    assert.equal(isOwnerConsoleConfigured(env), true);
    assert.equal(ownerEmailFromEnv(env), "pemilik@example.com");
    assert.equal(ownerEmailFromEnv({ OWNER_EMAIL: "   " }), null);
  });

  it("membatasi masa berlaku verifikasi sidik jari ke rentang yang wajar", () => {
    assert.equal(ownerStepUpMs({}), 12 * 60 * 60 * 1000);
    assert.equal(ownerStepUpMs({ OWNER_STEP_UP_MINUTES: "60" }), 60 * 60 * 1000);
    assert.equal(ownerStepUpMs({ OWNER_STEP_UP_MINUTES: "1" }), 5 * 60 * 1000);
    assert.equal(ownerStepUpMs({ OWNER_STEP_UP_MINUTES: "99999" }), 24 * 60 * 60 * 1000);
    assert.equal(ownerStepUpMs({ OWNER_STEP_UP_MINUTES: "abc" }), 12 * 60 * 60 * 1000);
  });
});

describe("Konfigurasi WebAuthn (passkey)", () => {
  it("memakai domain dan origin produksi sebagai bawaan", () => {
    assert.equal(ownerWebAuthnRpId({}), DEFAULT_OWNER_WEBAUTHN_RP_ID);
    assert.equal(ownerWebAuthnRpName({}), DEFAULT_OWNER_WEBAUTHN_RP_NAME);
    assert.equal(ownerWebAuthnOrigin({}), DEFAULT_OWNER_WEBAUTHN_ORIGIN);
    assert.equal(DEFAULT_OWNER_WEBAUTHN_RP_ID, "app.tatorprofitbos.my.id");
    assert.equal(DEFAULT_OWNER_WEBAUTHN_ORIGIN, "https://app.tatorprofitbos.my.id");
  });

  it("menghormati nilai lingkungan dan mengabaikan nilai kosong", () => {
    const env = {
      OWNER_WEBAUTHN_RP_ID: "contoh.test",
      OWNER_WEBAUTHN_RP_NAME: "Tatorprofit Uji",
      OWNER_WEBAUTHN_ORIGIN: "https://contoh.test/",
    };
    assert.equal(ownerWebAuthnRpId(env), "contoh.test");
    assert.equal(ownerWebAuthnRpName(env), "Tatorprofit Uji");
    /** Garis miring di ujung dirapikan supaya cocok dengan `origin` peramban. */
    assert.equal(ownerWebAuthnOrigin(env), "https://contoh.test");

    assert.equal(ownerWebAuthnRpId({ OWNER_WEBAUTHN_RP_ID: "   " }), DEFAULT_OWNER_WEBAUTHN_RP_ID);
    assert.equal(ownerWebAuthnRpName({ OWNER_WEBAUTHN_RP_NAME: "" }), DEFAULT_OWNER_WEBAUTHN_RP_NAME);
    assert.equal(ownerWebAuthnOrigin({ OWNER_WEBAUTHN_ORIGIN: "  " }), DEFAULT_OWNER_WEBAUTHN_ORIGIN);
  });
});

describe("Aturan step-up per sesi", () => {
  const now = Date.parse("2026-10-18T12:00:00.000Z");

  it("sesi tanpa verifikasi tidak pernah dianggap segar", () => {
    assert.equal(ownerStepUpIsFresh(null, {}, now), false);
  });

  it("verifikasi di dalam masa berlaku dianggap segar", () => {
    const verifiedAt = new Date(now - 60 * 60 * 1000);
    assert.equal(ownerStepUpIsFresh(verifiedAt, {}, now), true);
    assert.equal(ownerStepUpIsFresh(verifiedAt, { OWNER_STEP_UP_MINUTES: "120" }, now), true);
  });

  it("verifikasi yang sudah lewat masa berlaku ditolak", () => {
    const stale = new Date(now - 13 * 60 * 60 * 1000);
    assert.equal(ownerStepUpIsFresh(stale, {}, now), false);
    /** Masa berlaku yang lebih pendek membuat verifikasi lama cepat kedaluwarsa. */
    assert.equal(ownerStepUpIsFresh(new Date(now - 6 * 60 * 1000), { OWNER_STEP_UP_MINUTES: "5" }, now), false);
  });
});

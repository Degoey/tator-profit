/**
 * Guards the "Bank/E-Wallet" dropdown used by the sign-up form and the profile
 * editor.
 *
 * The catalogue lives in `src/lib/config/bank-options.ts` and is shared by the
 * form (grouped `<optgroup>` rendering) and the server enum (`registerSchema`).
 * These assertions pin the required list, the grouping, and the form wiring so a
 * future edit cannot silently drop an option or bypass the required check.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  BANK_OPTION_GROUPS,
  BANK_OPTIONS,
  BANK_VALUES,
  bankLabel,
} from "../src/lib/config/bank-options";

const ROOT = process.cwd();
const formSource = readFileSync(
  path.join(ROOT, "src/components/auth/register-form.tsx"),
  "utf8",
);
const profileFormSource = readFileSync(
  path.join(ROOT, "src/components/profile/profile-form.tsx"),
  "utf8",
);

describe("katalog Bank/E-Wallet", () => {
  it("mengelompokkan Bank BUMN, Bank Swasta, dan E-Wallet sesuai urutan", () => {
    assert.deepEqual(
      BANK_OPTION_GROUPS.map((group) => group.label),
      ["Bank BUMN", "Bank Swasta", "E-Wallet"],
    );
  });

  it("memuat seluruh bank dan e-wallet yang diminta", () => {
    assert.deepEqual(
      BANK_OPTION_GROUPS.map((group) => group.options.map((option) => option.label)),
      [
        ["Bank Mandiri", "BRI", "BNI", "BTN", "BSI"],
        ["BCA"],
        ["DANA", "GoPay", "ShopeePay", "OVO", "LinkAja"],
      ],
    );
  });

  it("menyimpan kode stabil yang unik dan bisa dipetakan kembali ke label", () => {
    assert.equal(BANK_VALUES.length, 11);
    assert.equal(new Set(BANK_VALUES).size, BANK_VALUES.length, "kode harus unik");
    assert.deepEqual(
      BANK_OPTIONS.map((option) => option.value),
      [...BANK_VALUES],
      "urutan datar harus sama dengan tuple nilai",
    );
    assert.equal(bankLabel("DANA"), "DANA");
    assert.equal(bankLabel("SHOPEEPAY"), "ShopeePay");
    assert.equal(bankLabel(null), "");
  });
});

describe("dropdown Bank/E-Wallet pada formulir pendaftaran", () => {
  it("memakai label, placeholder, dan atribut wajib yang diminta", () => {
    assert.ok(formSource.includes('label="Bank/E-Wallet"'), "label field");
    assert.ok(
      formSource.includes("Pilih Bank/E-Wallet"),
      "placeholder default harus 'Pilih Bank/E-Wallet'",
    );
    assert.ok(formSource.includes('name="bank"'), "nama field harus 'bank'");
    assert.ok(
      new RegExp('<select\\s+id="bank"[\\s\\S]*?required').test(formSource),
      "select bank harus required",
    );
  });

  it("merender opsi sebagai optgroup dari katalog bersama", () => {
    assert.ok(
      formSource.includes('import { BANK_OPTION_GROUPS } from "@/lib/config/bank-options";'),
      "form harus memakai katalog bersama",
    );
    assert.ok(formSource.includes("<optgroup"), "opsi harus dikelompokkan");
    assert.ok(formSource.includes("BANK_OPTION_GROUPS.map"), "kelompok di-render dari katalog");
  });

  it("menampilkan pesan wajib saat belum dipilih", () => {
    assert.ok(
      formSource.includes('"Silakan pilih Bank/E-Wallet"'),
      "pesan validasi harus sama dengan skema server",
    );
  });
});

describe("dropdown Bank/E-Wallet pada editor profil", () => {
  it("memakai katalog bersama dan field bernama 'bank'", () => {
    assert.ok(
      profileFormSource.includes('import { BANK_OPTION_GROUPS } from "@/lib/config/bank-options";'),
      "editor profil harus memakai katalog bersama",
    );
    assert.ok(profileFormSource.includes('id="profile-bank"'), "id isian harus profile-bank");
    assert.ok(profileFormSource.includes('name="bank"'), "nama field harus 'bank'");
    assert.ok(profileFormSource.includes("BANK_OPTION_GROUPS.map"), "kelompok di-render dari katalog");
    assert.ok(profileFormSource.includes("<optgroup"), "opsi harus dikelompokkan");
  });

  it("mengirim 'bank' hanya saat terisi", () => {
    assert.ok(
      profileFormSource.includes("...(values.bank ? { bank: values.bank } : {})"),
      "nilai kosong tidak boleh dikirim agar skema server tidak menolak",
    );
  });
});

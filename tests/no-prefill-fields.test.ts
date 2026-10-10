/**
 * The "no browser pre-fill" rule is app-wide, not only for sign-up: every field
 * that asks for the person's own data — profile editor, withdrawal destination,
 * password-reset e-mail — must refuse the browser's autofill profile, otherwise
 * a name nobody typed in this account shows up on screen (the bug report was the
 * visitor's own name appearing in "Nama lengkap").
 *
 * `autoComplete="off"` is ignored on personal fields, so `NoPrefillInput` keeps
 * the control read-only until it is touched. These assertions pin which fields
 * are guarded, and that a value coming from the server is still displayed.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { NoPrefillInput } from "../src/components/auth/no-prefill-input";

const ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

const GUARD_IMPORT = 'import { NoPrefillInput } from "@/components/auth/no-prefill-input";';

const profileSource = read("src/components/profile/profile-form.tsx");
const forgotPasswordSource = read("src/components/auth/forgot-password-form.tsx");
const withdrawalSource = read("src/components/payments/withdrawal-form.tsx");

describe("isian data pribadi menolak pre-fill browser", () => {
  it("editor profil memakai NoPrefillInput untuk nama, telepon, negara, dan kota", () => {
    assert.ok(profileSource.includes(GUARD_IMPORT), "editor profil harus mengimpor NoPrefillInput");

    for (const field of ["profile-name", "profile-phone", "profile-country", "profile-city"]) {
      assert.ok(
        new RegExp(`<NoPrefillInput\\s+id="${field}"`).test(profileSource),
        `isian ${field} harus memakai NoPrefillInput`,
      );
    }

    assert.equal(
      [...profileSource.matchAll(/<Input\s/g)].length,
      2,
      "hanya zona waktu dan bio yang boleh memakai Input biasa",
    );
  });

  it("permintaan atur ulang kata sandi tidak menerima pre-fill surel", () => {
    assert.ok(forgotPasswordSource.includes(GUARD_IMPORT), "form surel harus mengimpor NoPrefillInput");
    assert.ok(
      /<NoPrefillInput\s+id="email"/.test(forgotPasswordSource),
      "isian surel harus memakai NoPrefillInput",
    );
    assert.equal(
      forgotPasswordSource.includes("<Input"),
      false,
      "tidak boleh ada isian Input biasa yang bisa diisi ulang browser",
    );
  });

  it("tujuan penarikan tidak menerima pre-fill nama pemilik rekening", () => {
    assert.ok(withdrawalSource.includes(GUARD_IMPORT), "form penarikan harus mengimpor NoPrefillInput");
    assert.ok(
      /<NoPrefillInput\s+id="withdrawal-destination"[\s\S]{0,200}autoComplete="off"/.test(withdrawalSource),
      "tujuan penarikan harus memakai NoPrefillInput dengan autoComplete=off",
    );
  });

  it("nilai yang sudah tersimpan tetap tampil meski isian terkunci", () => {
    const html = renderToStaticMarkup(
      createElement(NoPrefillInput, {
        id: "profile-name",
        name: "name",
        value: "Demo Member",
        onChange: () => {},
      }),
    );

    assert.match(html, /readonly/i, "isian harus terkunci saat halaman dibuka");
    assert.match(html, /value="Demo Member"/, "nilai dari server tidak boleh dikosongkan");
  });
});

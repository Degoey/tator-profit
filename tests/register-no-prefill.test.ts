/**
 * Guards that the sign-up form never opens with the browser's saved profile
 * already typed in — the bug report was "Nama lengkap" showing the visitor's own
 * name before they touched anything.
 *
 * `autoComplete="off"` is not enough: Chrome and Edge ignore it for personal
 * fields and autofill every writable control on load. `NoPrefillInput` keeps the
 * field read-only until the visitor interacts with it, which is what these
 * assertions pin — together with the empty initial form state.
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

const formSource = read("src/components/auth/register-form.tsx");
const componentSource = read("src/components/auth/no-prefill-input.tsx");

describe("formulir pendaftaran tanpa pre-fill browser", () => {
  it("merender isian dalam keadaan read-only saat halaman dibuka", () => {
    const html = renderToStaticMarkup(
      createElement(NoPrefillInput, { id: "name", name: "name", defaultValue: "" }),
    );

    assert.match(html, /readonly/i, "isian harus read-only sebelum disentuh");
  });

  it("membuka kunci hanya saat pengunjung memfokuskan isian", () => {
    assert.ok(componentSource.includes('"use client"'), "harus komponen klien");
    assert.ok(
      componentSource.includes("useState(true)"),
      "kunci harus aktif pada render pertama",
    );
    assert.ok(componentSource.includes("onFocus"), "pembukaan lewat event fokus");
    assert.ok(componentSource.includes("setLocked(false)"), "fokus melepas kunci");
  });

  it("memakai NoPrefillInput untuk nama, nama pengguna, surel, dan telepon", () => {
    assert.ok(
      formSource.includes('import { NoPrefillInput } from "@/components/auth/no-prefill-input";'),
      "form register harus mengimpor NoPrefillInput",
    );

    for (const field of ["name", "username", "email", "phone"]) {
      assert.ok(
        new RegExp(`<NoPrefillInput\\s+id="${field}"`).test(formSource),
        `isian ${field} harus memakai NoPrefillInput`,
      );
    }

    assert.equal(
      [...formSource.matchAll(/<Input\s/g)].length,
      3,
      "hanya kata sandi, konfirmasi, dan kode referral yang boleh memakai Input biasa",
    );
  });

  it("tidak menanam nama atau nilai awal apa pun di formulir", () => {
    assert.ok(formSource.includes('name: ""'), "state nama harus mulai kosong");
    assert.equal(
      formSource.includes("defaultValue"),
      false,
      "isian tidak boleh diberi nilai awal",
    );
    assert.equal(
      /<Input[\s\S]{0,200}value=\{\s*"/.test(formSource),
      false,
      "tidak boleh ada value teks yang ditulis mati",
    );
  });
});
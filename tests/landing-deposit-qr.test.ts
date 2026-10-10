/**
 * Guards the public deposit section on the landing page (`/#deposit`).
 *
 * The landing page is the only surface where a guest sees the wallet address
 * before creating an account, so a careless edit there either hides the QR from
 * visitors or advertises the wrong network and sends a real transfer into a
 * chain nobody controls. These assertions pin the wiring, the network wording
 * and the fact that the address itself lives in exactly one module.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { DEPOSIT_WALLET_ADDRESS } from "../src/lib/config/deposit-wallet";

/** `npm test` always runs from the repository root. */
const ROOT = process.cwd();

function readProjectFile(...segments: string[]): string {
  return readFileSync(path.join(ROOT, ...segments), "utf8");
}

const landingPageSource = readProjectFile("src", "app", "page.tsx");
const sectionSource = readProjectFile("src", "components", "landing", "deposit-section.tsx");
const headerSource = readProjectFile("src", "components", "site-header.tsx");
const footerSource = readProjectFile("src", "components", "site-footer.tsx");

describe("bagian setor dana di halaman depan", () => {
  it("merender blok QR deposit yang sama dengan halaman /deposit", () => {
    assert.ok(
      sectionSource.includes('from "@/components/payments/deposit-address-qr"'),
      "section harus memakai blok QR bersama, bukan menggambar QR sendiri",
    );

    const occurrences = [...sectionSource.matchAll(/<DepositAddressQr \/>/g)];
    assert.equal(occurrences.length, 1, "blok QR dirender tepat sekali");

    // Satu sumber kebenaran: alamat dompet tidak boleh disalin ke komponen landing.
    assert.equal(
      sectionSource.includes(DEPOSIT_WALLET_ADDRESS),
      false,
      "alamat dompet hanya boleh ada di src/lib/config/deposit-wallet.ts",
    );
  });

  it("tetap komponen server dan menyebut jaringan BEP-20", () => {
    assert.equal(
      sectionSource.includes('"use client"'),
      false,
      "section landing tidak perlu menjadi komponen klien",
    );
    assert.ok(sectionSource.includes("BEP-20"), "jaringan deposit harus disebut BEP-20");
    assert.ok(/BNB Smart Chain/i.test(sectionSource), "sebut BNB Smart Chain");
  });

  it("tidak pernah menulis alamat TRON berbasis T", () => {
    // Alamat TRON (`T…`, base58) menandakan label jaringan tertukar: USDT yang
    // dikirim ke sana hilang. Blok QR memakai alamat EVM `0x…`.
    const tronAddress = /\bT[1-9A-HJ-NP-Za-km-z]{33}\b/;
    assert.equal(tronAddress.test(sectionSource), false, "jangan menulis alamat TRON");
  });

  it("menautkan tamu ke halaman setor dana setelah masuk dan ke pendaftaran", () => {
    assert.ok(
      sectionSource.includes('`/login?next=${encodeURIComponent("/deposit")}`'),
      "tombol masuk harus mengarah ke /deposit lewat parameter next yang di-encode",
    );
    assert.ok(sectionSource.includes('href="/register"'), "sertakan tautan pendaftaran");
  });

  it("dipasang di halaman depan antara ketentuan program dan penarikan", () => {
    assert.ok(
      landingPageSource.includes('from "@/components/landing/deposit-section"'),
      "halaman depan harus mengimpor DepositSection",
    );

    const sectionIndex = landingPageSource.indexOf("<DepositSection />");
    assert.ok(sectionIndex > -1, "DepositSection harus dirender");

    const programIndex = landingPageSource.indexOf('id="program"');
    const withdrawalIndex = landingPageSource.indexOf("<WithdrawalSection />");
    const referralIndex = landingPageSource.indexOf("<ReferralSection");

    assert.ok(programIndex > -1 && sectionIndex > programIndex, "setelah bagian ketentuan program");
    assert.ok(withdrawalIndex > sectionIndex, "sebelum bagian penarikan");
    assert.ok(referralIndex > sectionIndex, "sebelum bagian rujukan");
  });

  it("dapat ditemukan dari navigasi pengunjung dan footer", () => {
    assert.ok(
      headerSource.includes('{ href: "/#deposit", label: "Setor Dana" }'),
      "navigasi pengunjung harus menautkan ke /#deposit",
    );
    assert.ok(footerSource.includes('href="/#deposit"'), "footer harus menautkan ke /#deposit");
  });
});

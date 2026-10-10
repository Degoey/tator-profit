/**
 * Guards the "Barcode Indodax" QR block on the deposit (payment) page.
 *
 * The wallet address is money-safety data: a truncated, lower-cased or re-typed
 * value sends a member's transfer to a wallet nobody controls. The assertions
 * below pin the format, the asset locations and the wiring into the deposit
 * form, so a careless edit fails here instead of on a real transfer.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DepositAddressQr } from "../src/components/payments/deposit-address-qr";
import { DEPOSIT_METHODS } from "../src/components/payments/options";
import {
  DEPOSIT_WALLET_ADDRESS,
  DEPOSIT_WALLET_NETWORK,
  DEPOSIT_WALLET_QR_DISK_PATH,
  DEPOSIT_WALLET_QR_SOURCES,
  EVM_ADDRESS_PATTERN,
} from "../src/lib/config/deposit-wallet";

/** `npm test` always runs from the repository root. */
const ROOT = process.cwd();

function readProjectFile(...segments: string[]): string {
  return readFileSync(path.join(ROOT, ...segments), "utf8");
}

/** React SSR inserts `<!-- -->` between adjacent text nodes; strip it before matching copy. */
function renderBlock(): string {
  return renderToStaticMarkup(createElement(DepositAddressQr)).replace(/<!--[\s\S]*?-->/g, "");
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const depositFormSource = readProjectFile("src", "components", "payments", "deposit-form.tsx");
const componentSource = readProjectFile(
  "src",
  "components",
  "payments",
  "deposit-address-qr.tsx",
);

describe("alamat dompet deposit", () => {
  it("berupa alamat EVM 0x yang lengkap", () => {
    assert.match(DEPOSIT_WALLET_ADDRESS, EVM_ADDRESS_PATTERN);
    assert.equal(DEPOSIT_WALLET_ADDRESS.length, 42, "0x diikuti 40 digit heksadesimal");
    assert.equal(DEPOSIT_WALLET_ADDRESS, DEPOSIT_WALLET_ADDRESS.trim(), "tanpa spasi");
    // Kepekaan huruf besar/kecil adalah checksum EIP-55: jangan pernah di-lowercase.
    assert.notEqual(
      DEPOSIT_WALLET_ADDRESS.toLowerCase(),
      DEPOSIT_WALLET_ADDRESS,
      "huruf checksum tidak boleh diratakan",
    );
  });

  it("memakai jaringan BEP-20 dan tidak pernah TRON/TRC20", () => {
    assert.ok(DEPOSIT_WALLET_NETWORK.includes("BEP-20"), "jaringan deposit harus BEP-20");
    assert.ok(/BNB Smart Chain/i.test(DEPOSIT_WALLET_NETWORK), "sebut BNB Smart Chain");
    assert.equal(
      /TRC-?20|TRON/i.test(DEPOSIT_WALLET_NETWORK),
      false,
      "label jaringan tidak boleh TRC20",
    );
    // Alamat 0x tidak berlaku di TRON, jadi peringatan "jangan TRC20" wajib tetap ada.
    assert.ok(componentSource.includes("TRC20"), "peringatan jaringan harus ada");

    const cryptoMethod = DEPOSIT_METHODS.find((option) => option.value === "CRYPTO");
    assert.ok(cryptoMethod, "metode kripto harus terdaftar");
    assert.match(cryptoMethod.label, /BEP-20/, "metode deposit kripto harus BEP-20");
    assert.equal(/TRC-?20|TRON/i.test(cryptoMethod.label), false, "metode deposit jangan TRC20");
  });

  it("menyebutkan lokasi berkas yang cocok dengan URL pertama", () => {
    assert.deepEqual(
      [...DEPOSIT_WALLET_QR_SOURCES],
      ["/barcode-indodax.png", "/images/barcode-indodax.png", "/assets/barcode-indodax.png"],
    );
    assert.equal(DEPOSIT_WALLET_QR_DISK_PATH, `public${DEPOSIT_WALLET_QR_SOURCES[0]}`);
  });

  it("memuat berkas QR sebagai PNG asli", (t) => {
    const assetPath = path.join(ROOT, DEPOSIT_WALLET_QR_DISK_PATH);

    if (!existsSync(assetPath)) {
      // Belum ada di checkout ini: halaman tetap menampilkan alamat dan petunjuk
      // penempatan, bukan ikon rusak.
      t.skip(`${DEPOSIT_WALLET_QR_DISK_PATH} belum ada`);
      return;
    }

    const bytes = readFileSync(assetPath);
    assert.deepEqual(
      [...bytes.subarray(0, 8)],
      PNG_SIGNATURE,
      `${DEPOSIT_WALLET_QR_DISK_PATH} harus PNG, bukan berkas lain yang di-rename`,
    );
    assert.equal(bytes.subarray(12, 16).toString("ascii"), "IHDR");
  });
});

describe("pemasangan blok QR di halaman pembayaran", () => {
  it("dirender tepat di bawah pemilihan metode pembayaran", () => {
    assert.ok(
      depositFormSource.includes('from "@/components/payments/deposit-address-qr"'),
      "form deposit harus mengimpor blok QR",
    );

    // Dua tempat: kartu "belum ada keanggotaan menunggu" dan di dalam form.
    const occurrences = [...depositFormSource.matchAll(/<DepositAddressQr \/>/g)].map(
      (match) => match.index ?? -1,
    );
    assert.equal(occurrences.length, 2, "QR harus tampil di kartu kosong dan di dalam form");

    const [emptyStateQrIndex = -1, qrIndex = -1] = occurrences;
    const emptyStateIndex = depositFormSource.indexOf("Belum ada keanggotaan menunggu");
    assert.ok(
      emptyStateIndex > -1 && emptyStateQrIndex > emptyStateIndex,
      "QR ikut tampil saat belum ada keanggotaan menunggu",
    );

    const methodIndex = depositFormSource.indexOf('id="deposit-method"');
    const proofIndex = depositFormSource.indexOf('label="Bukti transfer (wajib)"');
    const submitIndex = depositFormSource.indexOf("Kirim deposit");

    assert.ok(qrIndex > -1, "blok QR harus dirender");
    assert.ok(methodIndex > -1 && qrIndex > methodIndex, "QR setelah metode pembayaran");
    assert.ok(proofIndex > qrIndex, "QR sebelum unggahan bukti");
    assert.ok(submitIndex > qrIndex, "QR sebelum tombol kirim");
  });

  it("memakai class unik dan tidak menyentuh CSS global", () => {
    assert.ok(componentSource.includes('className="barcode-indodax-container"'));
    assert.equal(
      readProjectFile("src", "app", "globals.css").includes("barcode-indodax"),
      false,
      "gaya blok QR tidak boleh masuk globals.css",
    );
  });

  it("membatasi ukuran QR 200px, responsif, dan menampilkan alamat di bawahnya", () => {
    const html = renderBlock();

    assert.ok(html.includes('src="/barcode-indodax.png"'));
    assert.ok(html.includes("barcode-indodax-container"));
    assert.ok(html.includes("max-width:200px"), "lebar QR dibatasi 200px");
    assert.ok(html.includes("width:100%"), "QR mengikuti lebar kontainer");
    assert.ok(html.includes("height:auto"), "tinggi mengikuti rasio asli");
    assert.ok(html.includes(DEPOSIT_WALLET_ADDRESS), "alamat teks tampil untuk verifikasi");
    assert.match(html, /alt="[^"]*QR code[^"]*"/, "alt harus menjelaskan QR");
  });
});

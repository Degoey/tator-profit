import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CustomerServiceCard } from "../src/components/support/customer-service-card";
import { WhatsAppCustomerServiceButton } from "../src/components/support/whatsapp-cs-button";
import {
  WHATSAPP_CS_NUMBER_ENV,
  buildCustomerServiceMessage,
  buildWhatsAppLink,
  getCustomerServiceConfig,
  isValidWhatsAppNumber,
  normalizeWhatsAppNumber,
} from "../src/lib/config/support";

/** React SSR inserts `<!-- -->` between adjacent text nodes; strip it before matching copy. */
function render(element: ReactElement): string {
  return renderToStaticMarkup(element).replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * Format example used by the tests only: this is not, and must never become, the real
 * customer service number.
 */
const FIXTURE_NUMBER = "6281234567890";
const FIXTURE_LOCAL_NUMBER = "081234567890";

describe("normalisasi nomor WhatsApp Customer Service", () => {
  it("menerima nomor internasional beserta spasi dan tanda pemisah", () => {
    assert.equal(normalizeWhatsAppNumber(FIXTURE_NUMBER), FIXTURE_NUMBER);
    assert.equal(normalizeWhatsAppNumber("+62 812-3456-7890"), FIXTURE_NUMBER);
    assert.equal(normalizeWhatsAppNumber(" 6281234567890 "), FIXTURE_NUMBER);
  });

  it("mengubah nomor lokal Indonesia 08xx menjadi 62xx", () => {
    assert.equal(normalizeWhatsAppNumber(FIXTURE_LOCAL_NUMBER), FIXTURE_NUMBER);
    assert.equal(normalizeWhatsAppNumber("0812-3456-7890"), FIXTURE_NUMBER);
  });

  it("menolak nilai kosong, berhuruf, terlalu pendek, atau salah awalan", () => {
    const rejected = [
      null,
      undefined,
      "",
      "   ",
      "abc",
      "62xxxxxxxxxx",
      "62812",
      "0",
      "1234",
      "6208123456",
    ];

    for (const raw of rejected) {
      assert.equal(normalizeWhatsAppNumber(raw), null, `normalize raw=${JSON.stringify(raw)}`);
      assert.equal(isValidWhatsAppNumber(raw), false, `valid raw=${JSON.stringify(raw)}`);
    }
  });
});

describe("pesan awal WhatsApp", () => {
  it("memuat nama aplikasi, kategori bantuan, dan nama pengguna", () => {
    const message = buildCustomerServiceMessage({
      topic: "Penarikan dana",
      username: "demo_member",
    });

    assert.ok(message.includes("Halo Customer Service Tatorprofit, saya membutuhkan bantuan."));
    assert.ok(message.includes("Aplikasi: Tatorprofit"));
    assert.ok(message.includes("Kategori bantuan: Penarikan dana"));
    assert.ok(message.includes("Nama pengguna: demo_member"));
  });

  it("memakai kategori bawaan dan melewati nama pengguna yang kosong", () => {
    const message = buildCustomerServiceMessage({ username: "   " });

    assert.ok(message.includes("Kategori bantuan: Bantuan umum"));
    assert.equal(message.includes("Nama pengguna"), false);
  });

  it("tidak pernah memuat kata sandi, OTP, atau token", () => {
    const message = buildCustomerServiceMessage({
      topic: "Akun & keamanan",
      username: "demo_member",
    }).toLowerCase();

    for (const secret of ["kata sandi", "password", "otp", "token", "pin"]) {
      assert.equal(message.includes(secret), false, `pesan tidak boleh memuat "${secret}"`);
    }
  });
});

describe("tautan WhatsApp", () => {
  it("membentuk tautan wa.me resmi dengan pesan ter-URL-encode", () => {
    const message = buildCustomerServiceMessage({
      topic: "Setoran dana",
      username: "demo_member",
    });
    const link = buildWhatsAppLink(FIXTURE_NUMBER, message);

    assert.ok(link);
    assert.ok(link.startsWith(`https://wa.me/${FIXTURE_NUMBER}?text=`));
    assert.equal(link.includes(" "), false, "spasi harus di-encode");
    assert.ok(link.includes("%20"), "spasi harus menjadi %20");
    assert.ok(link.includes("%0A"), "baris baru harus menjadi %0A");
    assert.ok(link.includes("%2C"), "koma harus menjadi %2C");
    assert.equal(decodeURIComponent(link.slice(link.indexOf("?text=") + "?text=".length)), message);
  });

  it("menerima karakter Bahasa Indonesia tanpa merusak tautan", () => {
    const message = buildCustomerServiceMessage({ topic: "Imbalan & target" });
    const link = buildWhatsAppLink(FIXTURE_LOCAL_NUMBER, message);

    assert.ok(link);
    assert.ok(link.includes("%26"), "ampersan harus menjadi %26");
    assert.equal(decodeURIComponent(link.slice(link.indexOf("?text=") + "?text=".length)), message);
  });

  it("tidak membentuk tautan tanpa nomor yang valid", () => {
    for (const number of [null, undefined, "", "62xxxxxxxxxx", "0812", "0"]) {
      assert.equal(buildWhatsAppLink(number, "Halo"), null, `number=${JSON.stringify(number)}`);
    }
  });
});

describe("konfigurasi Customer Service", () => {
  it("membaca nomor dari variabel lingkungan publik", () => {
    const previous = process.env.NEXT_PUBLIC_WHATSAPP_CS_NUMBER;
    process.env.NEXT_PUBLIC_WHATSAPP_CS_NUMBER = "0812-3456-7890";

    try {
      const config = getCustomerServiceConfig({ topic: "Setoran dana", nodeEnv: "development" });

      assert.equal(config.configured, true);
      assert.equal(config.number, FIXTURE_NUMBER);
      assert.ok(config.link?.startsWith(`https://wa.me/${FIXTURE_NUMBER}?text=`));
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_WHATSAPP_CS_NUMBER;
      else process.env.NEXT_PUBLIC_WHATSAPP_CS_NUMBER = previous;
    }
  });

  it("memberi petunjuk konfigurasi pada pengembangan saat nomor belum diisi", () => {
    const config = getCustomerServiceConfig({ rawNumber: null, nodeEnv: "development" });

    assert.equal(config.configured, false);
    assert.equal(config.number, null);
    assert.equal(config.link, null);
    assert.equal(config.fallback, "notice");
  });

  it("menyembunyikan tombol pada produksi saat nomor belum valid", () => {
    for (const rawNumber of [null, "62xxxxxxxxxx", "0812"]) {
      const config = getCustomerServiceConfig({ rawNumber, nodeEnv: "production" });

      assert.equal(config.configured, false, `rawNumber=${JSON.stringify(rawNumber)}`);
      assert.equal(config.fallback, "hidden");
    }
  });
});

describe("tombol Customer Service (render server)", () => {
  const href = buildWhatsAppLink(
    FIXTURE_NUMBER,
    buildCustomerServiceMessage({ topic: "Setoran dana" }),
  );

  it("membentuk tautan aman yang dibuka di tab baru", () => {
    const html = render(
      createElement(WhatsAppCustomerServiceButton, {
        href,
        location: "beranda",
        size: "lg",
        variant: "outline",
      }),
    );

    assert.ok(html.includes(`href="https://wa.me/${FIXTURE_NUMBER}?text=`));
    assert.ok(html.includes('target="_blank"'));
    assert.ok(html.includes('rel="noopener noreferrer"'));
    assert.ok(
      html.includes(
        'aria-label="Hubungi Customer Service Tatorprofit melalui WhatsApp (membuka tab baru)"',
      ),
    );
    assert.ok(html.includes("Hubungi Customer Service"));
    assert.ok(html.includes('data-customer-service="beranda"'));
    assert.ok(html.includes("<svg"), "ikon WhatsApp harus dirender");
  });

  it("tidak merender apa pun pada produksi saat nomor belum dikonfigurasi", () => {
    const html = render(
      createElement(WhatsAppCustomerServiceButton, {
        href: null,
        location: "dasbor",
        fallback: "hidden",
      }),
    );

    assert.equal(html, "");
  });

  it("menampilkan petunjuk konfigurasi tanpa tautan rusak pada pengembangan", () => {
    const html = render(
      createElement(WhatsAppCustomerServiceButton, {
        href: null,
        location: "dasbor",
        fallback: "notice",
      }),
    );

    assert.ok(html.includes(WHATSAPP_CS_NUMBER_ENV));
    assert.ok(html.includes("62xxxxxxxxxx"));
    assert.equal(html.includes("wa.me"), false, "tidak boleh ada tautan WhatsApp");
    assert.equal(html.includes("<a "), false, "tidak boleh ada tautan kosong");
  });
});

describe("kartu Customer Service (render server)", () => {
  it("menjelaskan kanal WhatsApp dan menautkan percakapan", () => {
    const href = buildWhatsAppLink(
      FIXTURE_NUMBER,
      buildCustomerServiceMessage({ topic: "Akun & keamanan" }),
    );
    const html = render(createElement(CustomerServiceCard, { href, location: "profil" }));

    assert.ok(html.includes("Bantuan &amp; Customer Service"));
    assert.ok(html.includes("Hubungi Customer Service"));
    assert.ok(html.includes(`href="https://wa.me/${FIXTURE_NUMBER}?text=`));
    assert.ok(html.includes("Tidak ada tiket, live chat, atau"));
    assert.ok(html.includes("Bantuan umum"));
    assert.ok(html.includes('data-customer-service="profil"'));
  });

  it("tidak menyediakan formulir tiket atau kolom pesan internal", () => {
    const html = render(createElement(CustomerServiceCard, { href: null, fallback: "notice" }));

    assert.equal(html.includes("<form"), false);
    assert.equal(html.includes("<textarea"), false);
    assert.equal(html.includes("<input"), false);
    assert.equal(html.includes("wa.me"), false);
    assert.ok(html.includes(WHATSAPP_CS_NUMBER_ENV));
  });
});

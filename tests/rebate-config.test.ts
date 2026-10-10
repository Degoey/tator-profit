import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { Prisma, PrismaClient } from "@prisma/client";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { loadReferralOverview } from "../src/app/referral/overview";
import { RebateRates } from "../src/components/dashboard/rebate-rates";
import { referralLevelLabel } from "../src/lib/config/referral";
import { REBATE_GENERATIONS, clearRebateConfigCache, getRebateRates, parseRebateRate } from "../src/lib/rebate-config";
import { previewReferralCommissions } from "../src/lib/services/program-service";
import { calculateReferralCommission } from "../src/lib/services/referral-service";
import {
  RebateConfigError,
  listRebateConfig,
  normalizeRebateUpdates,
  updateRebateConfig,
} from "../src/lib/services/rebate-config-service";

/**
 * Konfigurasi rabat lima generasi: validasi murni, penyimpanan database dengan
 * audit, integrasi mesin perhitungan, dan render tabel member.
 */
const prisma = new PrismaClient();
const meta = { ipAddress: "198.18.8.9", userAgent: "node-test" };
const DEFAULT_RATES = ["0.1000", "0.0200", "0.0100", "0.0100", "0.0100"];

/** `npm test` selalu berjalan dari akar repositori. */
const ROOT = process.cwd();

function readProjectFile(...segments: string[]): string {
  return readFileSync(path.join(ROOT, ...segments), "utf8");
}

let adminId = "";
let adminUsername = "";

async function resetRates(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (let generation = 1; generation <= REBATE_GENERATIONS; generation += 1) {
      await tx.rebateConfig.upsert({
        where: { generation },
        update: { rate: new Prisma.Decimal(DEFAULT_RATES[generation - 1] ?? "0.0100"), updatedBy: null },
        create: { generation, rate: new Prisma.Decimal(DEFAULT_RATES[generation - 1] ?? "0.0100") },
      });
    }
  });
  clearRebateConfigCache();
}

before(async () => {
  const stamp = `${Date.now()}`.slice(-7);
  const admin = await prisma.user.create({
    data: {
      name: "Uji Rabat",
      username: `rabat_${stamp}`,
      email: `rabat_${stamp}@example.com`,
      phone: `+6289${stamp}2`,
      passwordHash: "$2b$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ012345",
      role: "ADMIN",
      adminRole: "SUPER_ADMIN",
    },
    select: { id: true, username: true },
  });
  adminId = admin.id;
  adminUsername = admin.username;
  await resetRates();
});

after(async () => {
  await resetRates();
  if (adminId) {
    await prisma.auditLog.deleteMany({ where: { actorUserId: adminId } });
    await prisma.user.delete({ where: { id: adminId } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

describe("konfigurasi rabat lima generasi", () => {
  it("menyediakan tepat lima generasi dengan nilai default 10/2/1/1/1", async () => {
    const rates = await getRebateRates({ forceRefresh: true });

    assert.equal(rates.length, 5);
    assert.deepEqual(rates.map((row) => row.generation), [1, 2, 3, 4, 5]);
    assert.deepEqual(rates.map((row) => row.rate.toFixed(4)), DEFAULT_RATES);
    assert.deepEqual(rates.map((row) => row.displayRate), ["10%", "2%", "1%", "1%", "1%"]);
  });

  it("tidak pernah menyediakan generasi 6 atau lebih", async () => {
    const view = await listRebateConfig();

    assert.deepEqual(view.generations.map((row) => row.generation), [1, 2, 3, 4, 5]);
  });
});

describe("validasi konfigurasi rabat (murni)", () => {
  it("menolak generasi 6, 0 dan nilai non-bulat", () => {
    assert.throws(() => normalizeRebateUpdates([{ generation: 6, rate: "0.01" }]), RebateConfigError);
    assert.throws(() => normalizeRebateUpdates([{ generation: 0, rate: "0.01" }]), RebateConfigError);
    assert.throws(() => normalizeRebateUpdates([{ generation: 1.5, rate: "0.01" }]), RebateConfigError);
  });

  it("menolak payload kosong dan generasi ganda", () => {
    assert.throws(() => normalizeRebateUpdates([]), RebateConfigError);
    assert.throws(
      () =>
        normalizeRebateUpdates([
          { generation: 1, rate: "0.1" },
          { generation: 1, rate: "0.2" },
        ]),
      RebateConfigError,
    );
  });

  it("menerima generasi 1..5 dengan tarif antara 0 dan 1", () => {
    const rows = normalizeRebateUpdates([
      { generation: 1, rate: "0.1" },
      { generation: 2, rate: "0.02" },
      { generation: 3, rate: "0" },
      { generation: 4, rate: "0.01" },
      { generation: 5, rate: "1" },
    ]);

    assert.equal(rows.length, 5);
    assert.equal(rows[4]?.rate.toFixed(4), "1.0000");
  });

  it("menolak tarif di luar 0..1 dan lebih dari empat desimal", () => {
    assert.throws(() => parseRebateRate("1.5"));
    assert.throws(() => parseRebateRate("0.12345"));
  });
});

describe("mesin perhitungan memakai satu konfigurasi rabat", () => {
  it("menghitung komisi dengan tarif override dari konfigurasi bersama", () => {
    const breakdown = calculateReferralCommission({ level: 1, baseAmount: "100", rate: "0.05" });

    assert.equal(breakdown.rate.toFixed(4), "0.0500");
    assert.equal(breakdown.commissionAmount.toFixed(2), "5.00");
  });

  it("mempertahankan tarif bawaan ketika tidak ada override", () => {
    const breakdown = calculateReferralCommission({ level: 2, baseAmount: "100" });

    assert.equal(breakdown.rate.toFixed(4), "0.0200");
    assert.equal(breakdown.commissionAmount.toFixed(2), "2.00");
  });

  it("menolak tarif override yang tidak valid", () => {
    assert.throws(() => calculateReferralCommission({ level: 1, baseAmount: "100", rate: "2" }));
  });
});

describe("pengaturan rabat admin (database)", () => {
  it("menyimpan perubahan, mencatat audit, dan membagikan nilai baru", async () => {
    await updateRebateConfig({
      updates: [{ generation: 1, rate: "0.15" }],
      actorUserId: adminId,
      actorAdminRole: "SUPER_ADMIN",
      meta,
    });

    const rates = await getRebateRates();
    assert.equal(rates.find((row) => row.generation === 1)?.rate.toFixed(4), "0.1500");
    assert.equal(rates.find((row) => row.generation === 1)?.displayRate, "15%");

    const audit = await prisma.auditLog.findFirst({
      where: { actorUserId: adminId, action: "rebate.config.updated" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(audit, "perubahan rabat harus tercatat pada jejak audit");
    const after = audit?.after as { generation: number; rate: string }[] | null;
    assert.equal(after?.find((row) => row.generation === 1)?.rate, "0.1500");
  });

  it("menolak aktor tanpa izin manageFinance", async () => {
    await assert.rejects(
      () =>
        updateRebateConfig({
          updates: [{ generation: 1, rate: "0.2" }],
          actorUserId: adminId,
          actorAdminRole: "SUPPORT",
          meta,
        }),
      (error: unknown) => error instanceof RebateConfigError && error.code === "FORBIDDEN",
    );
  });

  it("menolak generasi 6 melalui layanan", async () => {
    await assert.rejects(
      () =>
        updateRebateConfig({
          updates: [{ generation: 6, rate: "0.01" }],
          actorUserId: adminId,
          actorAdminRole: "SUPER_ADMIN",
          meta,
        }),
      RebateConfigError,
    );
  });

  it("mengembalikan generasi 1 ke 10%", async () => {
    await updateRebateConfig({
      updates: [{ generation: 1, rate: "0.1" }],
      actorUserId: adminId,
      actorAdminRole: "SUPER_ADMIN",
      meta,
    });

    const rates = await getRebateRates();
    assert.equal(rates[0]?.rate.toFixed(4), "0.1000");
  });
});

describe("tampilan Persentase Komisi Rabat (render server)", () => {
  it("menampilkan lima generasi, kolom, dan keterangan bukan jaminan", () => {
    const html = renderToStaticMarkup(
      createElement(RebateRates, {
        rows: [
          { generation: 1, rate: "10%" },
          { generation: 2, rate: "2%" },
          { generation: 3, rate: "1%" },
          { generation: 4, rate: "1%" },
          { generation: 5, rate: "1%" },
        ],
      }),
    ).replace(/<!--[\s\S]*?-->/g, "");

    assert.ok(html.includes("Persentase Komisi Rabat"));
    assert.ok(html.includes("Generasi jaringan"));
    assert.ok(html.includes("Persentase rabat"));
    for (const generation of [1, 2, 3, 4, 5]) {
      assert.ok(html.includes(`Generasi ${generation}`), `generasi ${generation}`);
    }
    assert.ok(!html.includes("Generasi 6"));
    assert.ok(html.includes("bukan jaminan nominal penghasilan"));
  });
});

describe("permukaan rabat mengikuti konfigurasi admin", () => {
  it("halaman rujukan menampilkan persentase tersimpan, bukan nilai bawaan", async () => {
    await updateRebateConfig({
      updates: [{ generation: 2, rate: "0.075" }],
      actorUserId: adminId,
      actorAdminRole: "SUPER_ADMIN",
      meta,
    });

    const overview = await loadReferralOverview({
      id: adminId,
      username: adminUsername,
      referralCode: null,
    });

    assert.deepEqual(
      overview.levels.map((row) => row.level),
      [1, 2, 3, 4, 5],
    );
    assert.deepEqual(
      overview.levels.map((row) => row.rate),
      ["10%", "7,5%", "1%", "1%", "1%"],
    );
    assert.equal(overview.levels[1]?.label, referralLevelLabel(2));

    await resetRates();

    const restored = await loadReferralOverview({
      id: adminId,
      username: adminUsername,
      referralCode: null,
    });
    assert.deepEqual(
      restored.levels.map((row) => row.rate),
      ["10%", "2%", "1%", "1%", "1%"],
    );
  });

  it("ilustrasi halaman depan memakai tarif tersimpan saat konfigurasi diberikan", async () => {
    await updateRebateConfig({
      updates: [{ generation: 1, rate: "0.08" }],
      actorUserId: adminId,
      actorAdminRole: "SUPER_ADMIN",
      meta,
    });

    const live = previewReferralCommissions(new Prisma.Decimal(100), await getRebateRates());
    assert.equal(live[0]?.rate, "0.0800");
    assert.equal(live[0]?.amount, "8.00");

    // Tanpa konfigurasi tersimpan, fungsi tetap memakai konfigurasi statis bersama.
    const fallback = previewReferralCommissions(new Prisma.Decimal(100));
    assert.equal(fallback[0]?.rate, "0.1000");
    assert.equal(fallback[0]?.amount, "10.00");

    await resetRates();
  });

  it("halaman rujukan dan halaman depan membaca konfigurasi dari database", () => {
    const overviewSource = readProjectFile("src", "app", "referral", "overview.ts");
    const landingSource = readProjectFile("src", "app", "page.tsx");

    assert.ok(
      overviewSource.includes("getRebateRates()"),
      "halaman rujukan harus membaca konfigurasi rabat",
    );
    assert.equal(
      overviewSource.includes("REFERRAL_LEVEL_RATES"),
      false,
      "halaman rujukan tidak boleh memakai tarif statis langsung",
    );
    assert.ok(
      landingSource.includes("getRebateRates()"),
      "halaman depan harus membaca konfigurasi rabat",
    );
    assert.ok(
      landingSource.includes("previewReferralCommissions(referralBase, rebateRates)"),
      "ilustrasi halaman depan harus memakai tarif tersimpan",
    );
  });
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { Prisma } from "@prisma/client";

import {
  AGREEMENT_SNAPSHOT_VERSION,
  PENDING_APPROVAL_POLICY,
  buildPolicySnapshot,
  describeAgreementGaps,
  validateProfitAgreement,
  type ProfitAgreementInput,
} from "../src/lib/services/profit-share-config";

const dec = (value: string) => new Prisma.Decimal(value);

const AGREED_AT = new Date("2026-10-15T02:00:00.000Z");
const EFFECTIVE_FROM = new Date("2026-10-16T00:00:00.000Z");

/**
 * Perjanjian lengkap. Angka di sini HANYA contoh pengujian: kode modul tetap tidak
 * memuat persentase bawaan apa pun.
 */
const base: ProfitAgreementInput = {
  status: "APPROVED",
  memberShareRate: dec("0.5000"),
  reserveRate: dec("0.1000"),
  managementFeeRate: dec("0.0500"),
  lossHandling: "CARRY_FORWARD",
  approvedByUserId: "admin-1",
  approvedAt: AGREED_AT,
  agreementNumber: "PJ/2026/001",
  agreementVersion: "1.0",
  distributionMethod: "Bagi hasil proporsional modal anggota",
  pnlBasis: "Net P&L realisasi transaksi terverifikasi",
  costTreatment: "Biaya trading dan biaya lain dikurangkan sebelum pembagian",
  periodDefinition: "Minggu Senin 00:00 UTC sampai Minggu 23:59 UTC",
  correctionTerms: "Koreksi diterbitkan sebagai laporan versi baru",
  disputeTerms: "Sengketa diselesaikan musyawarah lalu mediasi",
  agreementDocumentKey: "agreements/pj-2026-001.pdf",
  effectiveFrom: EFFECTIVE_FROM,
  parties: [
    {
      partyName: "Pemilik Modal",
      partyRole: "PEMILIK",
      agreedAt: AGREED_AT,
      evidenceStorageKey: "agreements/ttd-pemilik.png",
    },
    { partyName: "Trader Utama", partyRole: "TRADER", agreedAt: AGREED_AT },
  ],
};

const agreement = (overrides: Partial<ProfitAgreementInput> = {}): ProfitAgreementInput => ({
  ...base,
  ...overrides,
});

test("perjanjian lengkap dinyatakan sah dan ringkasannya positif", () => {
  const result = validateProfitAgreement(base);
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
  assert.ok(describeAgreementGaps(base).includes("lengkap"));
});

test("perjanjian tanpa persetujuan pemilik tetap gagal-tertutup", () => {
  const pending = agreement({
    status: "PENDING_APPROVAL",
    approvedByUserId: null,
    approvedAt: null,
    memberShareRate: null,
  });
  const result = validateProfitAgreement(pending);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((message) => message.includes("PENDING_APPROVAL")));

  // Kebijakan bawaan modul memang tidak memuat satu angka pun.
  assert.equal(PENDING_APPROVAL_POLICY.status, "PENDING_APPROVAL");
  assert.equal(PENDING_APPROVAL_POLICY.memberShareRate, null);
  assert.equal(PENDING_APPROVAL_POLICY.reserveRate, null);
  assert.equal(PENDING_APPROVAL_POLICY.managementFeeRate, null);
  assert.equal(PENDING_APPROVAL_POLICY.lossHandling, null);
});

test("istilah perjanjian yang kosong dilaporkan satu per satu", () => {
  const result = validateProfitAgreement(
    agreement({ distributionMethod: "   ", disputeTerms: null }),
  );
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("Metode perhitungan pembagian belum diisi."));
  assert.ok(result.errors.includes("Ketentuan sengketa belum diisi."));
  // Istilah yang terisi tidak dilaporkan.
  assert.ok(!result.errors.some((message) => message.includes("Dasar perhitungan")));
});

test("dokumen perjanjian, tanggal berlaku, dan urutan tanggal diperiksa", () => {
  const noDocument = validateProfitAgreement(agreement({ agreementDocumentKey: null }));
  assert.equal(noDocument.valid, false);
  assert.ok(noDocument.errors.includes("Dokumen perjanjian belum diisi."));

  const noEffectiveFrom = validateProfitAgreement(agreement({ effectiveFrom: null }));
  assert.equal(noEffectiveFrom.valid, false);
  assert.ok(noEffectiveFrom.errors.includes("Tanggal mulai berlaku belum diisi."));

  const reversed = validateProfitAgreement(
    agreement({ effectiveTo: new Date("2026-10-01T00:00:00.000Z") }),
  );
  assert.equal(reversed.valid, false);
  assert.ok(reversed.errors.some((message) => message.includes("setelah tanggal mulai berlaku")));
});

test("pihak yang menyetujui wajib lengkap dengan waktu persetujuan", () => {
  const noParties = validateProfitAgreement(agreement({ parties: [] }));
  assert.equal(noParties.valid, false);
  assert.ok(noParties.errors.some((message) => message.includes("belum mencantumkan pihak")));

  const noAgreedAt = validateProfitAgreement(
    agreement({ parties: [{ partyName: "Pemilik Modal", partyRole: "PEMILIK" }] }),
  );
  assert.equal(noAgreedAt.valid, false);
  assert.ok(noAgreedAt.errors.some((message) => message.includes('"Pemilik Modal"')));

  const noRole = validateProfitAgreement(
    agreement({ parties: [{ partyName: "Pemilik Modal", partyRole: "   ", agreedAt: AGREED_AT }] }),
  );
  assert.equal(noRole.valid, false);
  assert.ok(noRole.errors.some((message) => message.includes("Peran pihak")));
});

test("angka kebijakan tetap diperiksa seperti sebelumnya", () => {
  const noRate = validateProfitAgreement(agreement({ memberShareRate: null }));
  assert.equal(noRate.valid, false);
  assert.ok(noRate.errors.some((message) => message.includes("Persentase bagi hasil anggota")));

  const rateAboveOne = validateProfitAgreement(agreement({ reserveRate: dec("1.5000") }));
  assert.equal(rateAboveOne.valid, false);
  assert.ok(rateAboveOne.errors.some((message) => message.includes("Cadangan wajib")));

  const tooFine = validateProfitAgreement(agreement({ memberShareRate: dec("0.12345") }));
  assert.equal(tooFine.valid, false);
  assert.ok(tooFine.errors.some((message) => message.includes("empat desimal")));

  const noLossHandling = validateProfitAgreement(agreement({ lossHandling: null }));
  assert.equal(noLossHandling.valid, false);
  assert.ok(noLossHandling.errors.some((message) => message.includes("periode rugi")));
});

test("snapshot menyimpan salinan versi perjanjian dan aman disimpan sebagai JSON", () => {
  const capturedAt = new Date("2026-10-16T12:00:00.000Z");
  const snapshot = buildPolicySnapshot(base, capturedAt);

  assert.equal(snapshot.snapshotVersion, AGREEMENT_SNAPSHOT_VERSION);
  assert.equal(snapshot.capturedAt, "2026-10-16T12:00:00.000Z");
  assert.equal(snapshot.agreementNumber, "PJ/2026/001");
  assert.equal(snapshot.agreementVersion, "1.0");
  assert.equal(snapshot.status, "APPROVED");
  assert.equal(snapshot.rates.memberShareRate, "0.5000");
  assert.equal(snapshot.rates.reserveRate, "0.1000");
  assert.equal(snapshot.rates.managementFeeRate, "0.0500");
  assert.equal(snapshot.lossHandling, "CARRY_FORWARD");
  assert.equal(snapshot.effectiveFrom, EFFECTIVE_FROM.toISOString());
  assert.equal(snapshot.effectiveTo, null);
  assert.equal(snapshot.hasAgreementDocument, true);
  assert.equal(snapshot.parties.length, 2);
  assert.equal(snapshot.parties[0]?.partyName, "Pemilik Modal");
  assert.equal(snapshot.parties[0]?.agreedAt, AGREED_AT.toISOString());
  assert.equal(snapshot.parties[0]?.hasEvidence, true);
  assert.equal(snapshot.parties[1]?.hasEvidence, false);
  assert.equal(snapshot.validation.valid, true);

  const json = JSON.stringify(snapshot);
  assert.deepEqual(JSON.parse(json), snapshot);
  // Kunci berkas dokumen/bukti adalah rahasia: tidak boleh ikut tersimpan.
  assert.ok(!json.includes("agreements/"));
});

test("snapshot tidak berubah ketika perjanjian memakai nilai baru", () => {
  const draft: ProfitAgreementInput = { ...base, parties: [...base.parties] };
  const snapshot = buildPolicySnapshot(draft, AGREED_AT);

  const revision: ProfitAgreementInput = {
    ...draft,
    agreementVersion: "2.0",
    distributionMethod: "Metode pembagian versi baru",
  };

  assert.equal(snapshot.agreementVersion, "1.0");
  assert.equal(snapshot.terms.distributionMethod, base.distributionMethod);
  assert.equal(revision.agreementVersion, "2.0");
  assert.equal(snapshot.validation.valid, true);

  draft.distributionMethod = "diubah setelah snapshot dibuat";
  assert.equal(snapshot.terms.distributionMethod, base.distributionMethod);
});

test("snapshot perjanjian yang belum lengkap menyimpan daftar kekurangan", () => {
  const pending: ProfitAgreementInput = {
    ...base,
    status: "PENDING_APPROVAL",
    memberShareRate: null,
    reserveRate: null,
    managementFeeRate: null,
    lossHandling: null,
    approvedByUserId: null,
    approvedAt: null,
    agreementNumber: null,
    agreementVersion: null,
    distributionMethod: null,
    pnlBasis: null,
    costTreatment: null,
    periodDefinition: null,
    correctionTerms: null,
    disputeTerms: null,
    agreementDocumentKey: null,
    effectiveFrom: null,
    parties: [],
  };

  const snapshot = buildPolicySnapshot(pending, AGREED_AT);
  assert.equal(snapshot.status, "PENDING_APPROVAL");
  assert.equal(snapshot.rates.memberShareRate, null);
  assert.equal(snapshot.rates.reserveRate, null);
  assert.equal(snapshot.hasAgreementDocument, false);
  assert.equal(snapshot.effectiveFrom, null);
  assert.equal(snapshot.validation.valid, false);
  assert.ok(snapshot.validation.errors.length > 0);
});
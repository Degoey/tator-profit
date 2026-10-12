import assert from "node:assert/strict";
import { test } from "node:test";

import { Prisma } from "@prisma/client";

import {
  RULES_VALIDATION_STATUS_LABELS,
  RULES_VALIDATION_STATUSES,
  canSubmitForApprovalAfterRules,
  evaluateTradingRules,
  type TradingRulesInput,
} from "../src/lib/services/trading-rules-validation";
import type { ProfitAgreementInput } from "../src/lib/services/profit-share-config";

const dec = (value: string) => new Prisma.Decimal(value);

const AGREED_AT = new Date("2026-10-15T02:00:00.000Z");
const EFFECTIVE_FROM = new Date("2026-10-16T00:00:00.000Z");
const PERIOD_START = new Date("2026-10-19T00:00:00.000Z");
const PERIOD_END = new Date("2026-10-26T00:00:00.000Z");

/**
 * Perjanjian lengkap. Angka di sini HANYA contoh pengujian: kode modul tetap tidak
 * memuat persentase bawaan apa pun.
 */
const approvedAgreement: ProfitAgreementInput = {
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
  parties: [{ partyName: "Pemilik Modal", partyRole: "PEMILIK", agreedAt: AGREED_AT }],
};

const agreement = (overrides: Partial<ProfitAgreementInput> = {}): ProfitAgreementInput => ({
  ...approvedAgreement,
  ...overrides,
});

const rulesInput = (overrides: Partial<TradingRulesInput> = {}): TradingRulesInput => ({
  sourceType: "ACTUAL",
  compiled: true,
  netPnl: dec("100.00"),
  verifiedRecordCount: 3,
  unverifiedRecordCount: 0,
  demoRecordCount: 0,
  hasUnresolvedReconciliation: false,
  agreement: approvedAgreement,
  periodStart: PERIOD_START,
  periodEnd: PERIOD_END,
  ...overrides,
});

test("data siap dan perjanjian lengkap menghasilkan PASSED", () => {
  const result = evaluateTradingRules(rulesInput());

  assert.equal(result.status, "PASSED");
  assert.equal(result.statusLabel, RULES_VALIDATION_STATUS_LABELS.PASSED);
  assert.equal(result.checks.every((check) => check.passed), true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.agreementValid, true);
  assert.equal(result.lossDetected, false);
  assert.equal(result.lossAmount.toFixed(2), "0.00");
  assert.equal(canSubmitForApprovalAfterRules(result), true);
  assert.match(result.note, /terpenuhi/i);
});

test("tanpa perjanjian tertulis hasilnya RULES_NOT_CONFIGURED (fail closed)", () => {
  const result = evaluateTradingRules(rulesInput({ agreement: null }));

  assert.equal(result.status, "RULES_NOT_CONFIGURED");
  assert.equal(canSubmitForApprovalAfterRules(result), false);
  assert.match(result.blockers.join(" "), /belum ada perjanjian bagi hasil tertulis/i);
  assert.equal(result.agreementValid, false);
});

test("perjanjian yang belum disetujui pemilik tetap RULES_NOT_CONFIGURED", () => {
  const pending = agreement({
    status: "PENDING_APPROVAL",
    approvedByUserId: null,
    approvedAt: null,
    memberShareRate: null,
    reserveRate: null,
    managementFeeRate: null,
    lossHandling: null,
  });
  const result = evaluateTradingRules(rulesInput({ agreement: pending }));

  assert.equal(result.status, "RULES_NOT_CONFIGURED");
  assert.equal(result.agreementValid, false);
  assert.ok(result.agreementErrors.length > 0);
  assert.ok(RULES_VALIDATION_STATUSES.includes(result.status));
});

test("data yang belum siap memblokir walau perjanjian sudah lengkap", () => {
  const result = evaluateTradingRules(
    rulesInput({ unverifiedRecordCount: 2, hasUnresolvedReconciliation: true, compiled: false }),
  );

  assert.equal(result.status, "BLOCKED");
  assert.match(result.blockers.join(" "), /selisih rekonsiliasi/i);
  assert.match(result.blockers.join(" "), /2 catatan trading yang belum diverifikasi/i);
  assert.match(result.blockers.join(" "), /belum dikompilasi/i);
  assert.equal(canSubmitForApprovalAfterRules(result), false);
});

test("laporan bersumber data DEMO tidak pernah menjadi laporan aktual", () => {
  const result = evaluateTradingRules(rulesInput({ sourceType: "DEMO" }));

  assert.equal(result.status, "BLOCKED");
  assert.match(result.blockers.join(" "), /data demo/i);
  assert.equal(result.checks.find((check) => check.id === "ACTUAL_SOURCE_ONLY")?.passed, false);
});

test("perjanjian yang belum mencakup periode laporan ditolak", () => {
  const future = agreement({ effectiveFrom: new Date("2026-11-01T00:00:00.000Z") });
  const futureResult = evaluateTradingRules(rulesInput({ agreement: future }));
  assert.equal(futureResult.status, "BLOCKED");
  assert.match(futureResult.blockers.join(" "), /mencakup periode laporan/i);

  const expired = agreement({ effectiveTo: new Date("2026-10-18T00:00:00.000Z") });
  const expiredResult = evaluateTradingRules(rulesInput({ agreement: expired }));
  assert.equal(expiredResult.status, "BLOCKED");
  assert.match(expiredResult.blockers.join(" "), /mencakup periode laporan/i);
});

test("periode rugi dicatat dan butuh ketentuan tertulis", () => {
  const covered = evaluateTradingRules(rulesInput({ netPnl: dec("-85.00") }));
  assert.equal(covered.status, "PASSED");
  assert.equal(covered.lossDetected, true);
  assert.equal(covered.lossAmount.toFixed(2), "85.00");
  assert.equal(covered.checks.find((check) => check.id === "LOSS_TERM")?.passed, true);

  const noTerm = evaluateTradingRules(
    rulesInput({ netPnl: dec("-85.00"), agreement: agreement({ lossHandling: null }) }),
  );
  assert.equal(noTerm.status, "RULES_NOT_CONFIGURED");
  assert.equal(noTerm.lossDetected, true);
  assert.equal(noTerm.lossAmount.toFixed(2), "85.00");
});

test("nominal dengan presisi lebih dari dua desimal ditolak sebagai tidak valid", () => {
  const result = evaluateTradingRules(rulesInput({ netPnl: dec("10.001") }));

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.checks.find((check) => check.id === "COMPILED")?.passed, false);
  assert.match(result.blockers.join(" "), /dua desimal/i);
});

test("catatan demo dilaporkan sebagai pengecualian tanpa mengubah status", () => {
  const result = evaluateTradingRules(rulesInput({ demoRecordCount: 2 }));

  assert.equal(result.status, "PASSED");
  assert.match(result.note, /2 catatan demo dikecualikan/i);
});

test("dasar pembagian wajib berasal dari perjanjian, bukan dari modal", () => {
  const noBasis = evaluateTradingRules(
    rulesInput({ agreement: agreement({ distributionMethod: "   " }) }),
  );

  // Tanpa metode perhitungan tertulis, perjanjiannya sendiri tidak sah.
  assert.equal(noBasis.status, "RULES_NOT_CONFIGURED");
  assert.equal(noBasis.checks.find((check) => check.id === "BASIS_FROM_AGREEMENT")?.passed, false);
});
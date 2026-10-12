import assert from "node:assert/strict";
import { test } from "node:test";

import { Prisma } from "@prisma/client";

import {
  LOSS_ASSESSMENT_STATUS_LABELS,
  NO_LOSS_CHARGE,
  assessLossPeriod,
  assertNoMemberLossCharge,
  lossHandlingGap,
  type LossAssessment,
} from "../src/lib/services/trading-loss-handling";
import type { ProfitAgreementInput } from "../src/lib/services/profit-share-config";

const dec = (value: string) => new Prisma.Decimal(value);

const AGREED_AT = new Date("2026-10-15T02:00:00.000Z");

/** Perjanjian lengkap; angka di sini hanya contoh pengujian. */
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
  effectiveFrom: new Date("2026-10-16T00:00:00.000Z"),
  parties: [{ partyName: "Pemilik Modal", partyRole: "PEMILIK", agreedAt: AGREED_AT }],
};

const agreement = (overrides: Partial<ProfitAgreementInput> = {}): ProfitAgreementInput => ({
  ...approvedAgreement,
  ...overrides,
});

test("periode untung atau impas: tidak ada kerugian untuk dicatat", () => {
  for (const netPnl of ["100.00", "0.00"]) {
    const result = assessLossPeriod({ netPnl: dec(netPnl), agreement: approvedAgreement });
    assert.equal(result.isLoss, false);
    assert.equal(result.status, "NOT_APPLICABLE");
    assert.equal(result.statusLabel, LOSS_ASSESSMENT_STATUS_LABELS.NOT_APPLICABLE);
    assert.equal(result.lossAmount.toFixed(2), "0.00");
    assert.equal(result.carriedForwardLossAmount.toFixed(2), "0.00");
    assert.equal(result.memberLossCharged.toFixed(2), NO_LOSS_CHARGE);
    assert.equal(lossHandlingGap(result), null);
  }
});

test("kerugian tanpa perjanjian tertulis dicatat apa adanya, tanpa beban ke anggota", () => {
  const result = assessLossPeriod({ netPnl: dec("-85.00"), agreement: null });

  assert.equal(result.isLoss, true);
  assert.equal(result.status, "RULES_NOT_CONFIGURED");
  assert.equal(result.lossAmount.toFixed(2), "85.00");
  assert.equal(result.appliedHandling, null);
  assert.equal(result.carriedForwardLossAmount.toFixed(2), "0.00");
  assert.equal(result.memberLossCharged.toFixed(2), "0.00");
  assert.equal(result.memberPrincipalReduction.toFixed(2), "0.00");
  assert.match(result.note, /tidak dibebankan ke anggota/i);
  assert.match(result.note, /modal anggota/i);
  assert.ok(lossHandlingGap(result));

  // Utang anggota atau pengurangan modal tidak pernah muncul di objek hasil.
  assert.equal("memberDebt" in result, false);
  assert.doesNotThrow(() => assertNoMemberLossCharge(result));
});

test("kerugian ditangani menurut ketentuan perjanjian yang disetujui", () => {
  const carry = assessLossPeriod({
    netPnl: dec("-85.00"),
    agreement: agreement({ lossHandling: "CARRY_FORWARD" }),
  });
  assert.equal(carry.status, "RECORDED");
  assert.equal(carry.appliedHandling, "CARRY_FORWARD");
  assert.equal(carry.carriedForwardLossAmount.toFixed(2), "85.00");
  assert.equal(carry.holdDistribution, false);
  assert.equal(carry.absorbedByCompany, false);
  assert.match(carry.note, /bawa kerugian/i);

  const absorb = assessLossPeriod({
    netPnl: dec("-20.00"),
    agreement: agreement({ lossHandling: "ABSORB_BY_COMPANY" }),
  });
  assert.equal(absorb.status, "RECORDED");
  assert.equal(absorb.absorbedByCompany, true);
  assert.equal(absorb.carriedForwardLossAmount.toFixed(2), "0.00");
  assert.equal(absorb.memberLossCharged.toFixed(2), "0.00");

  const hold = assessLossPeriod({
    netPnl: dec("-20.00"),
    agreement: agreement({ lossHandling: "HOLD" }),
  });
  assert.equal(hold.status, "RECORDED");
  assert.equal(hold.holdDistribution, true);
  assert.equal(hold.carriedForwardLossAmount.toFixed(2), "0.00");
});

test("ketentuan kerugian yang tidak dikenal tidak menghasilkan penanganan apa pun", () => {
  const result = assessLossPeriod({
    netPnl: dec("-20.00"),
    agreement: agreement({ lossHandling: "KARANGAN_SISTEM" }),
  });

  assert.equal(result.status, "RULES_NOT_CONFIGURED");
  assert.equal(result.appliedHandling, null);
  assert.equal(result.carriedForwardLossAmount.toFixed(2), "0.00");
});

test("penjaga menolak pembebanan kerugian ke anggota dan nominal presisi berlebih", () => {
  const charged = {
    memberLossCharged: dec("5.00"),
    memberPrincipalReduction: dec("0.00"),
  } as LossAssessment;
  assert.throws(() => assertNoMemberLossCharge(charged), RangeError);

  const reducedPrincipal = {
    memberLossCharged: dec("0.00"),
    memberPrincipalReduction: dec("1.00"),
  } as LossAssessment;
  assert.throws(() => assertNoMemberLossCharge(reducedPrincipal), RangeError);

  assert.throws(() => assessLossPeriod({ netPnl: dec("-85.001"), agreement: null }), RangeError);
});
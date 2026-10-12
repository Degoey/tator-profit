import assert from "node:assert/strict";
import { test } from "node:test";

import { Prisma } from "@prisma/client";

import {
  TRADING_REPORT_TRANSITIONS,
  TradingReportTransitionError,
  assertTradingReportTransition,
  buildReportSummary,
  canTransitionTradingReport,
  evaluatePublicationReadiness,
  isTerminalTradingReportStatus,
  isTradingReportStatus,
  tradingReportStatusLabel,
  transitionRequiresReason,
} from "../src/lib/services/trading-report-status";
import { TRADING_REPORT_STATUSES } from "../src/lib/config/trading";

const dec = (value: string) => new Prisma.Decimal(value);

test("setiap status laporan punya transisi yang terdefinisi", () => {
  for (const status of TRADING_REPORT_STATUSES) {
    assert.ok(Array.isArray(TRADING_REPORT_TRANSITIONS[status]), status);
    assert.equal(isTradingReportStatus(status), true);
    assert.ok(tradingReportStatusLabel(status).length > 0);
  }
  assert.equal(isTradingReportStatus("TIDAK_ADA"), false);
});

test("transisi laporan yang sah diterima dan yang melompat ditolak", () => {
  assert.equal(canTransitionTradingReport("DRAFT", "RECONCILIATION"), true);
  assert.equal(canTransitionTradingReport("RECONCILIATION", "RULES_VALIDATION"), true);
  assert.equal(canTransitionTradingReport("RULES_VALIDATION", "PENDING_APPROVAL"), true);
  assert.equal(canTransitionTradingReport("PENDING_APPROVAL", "APPROVED"), true);
  assert.equal(canTransitionTradingReport("APPROVED", "PUBLISHED"), true);
  assert.equal(canTransitionTradingReport("PUBLISHED", "PAYMENT_PROCESSING"), true);
  assert.equal(canTransitionTradingReport("PAYMENT_PROCESSING", "PAID"), true);

  // Gerbang Validasi Aturan tidak boleh dilompati.
  assert.equal(canTransitionTradingReport("RECONCILIATION", "PENDING_APPROVAL"), false);
  assert.equal(canTransitionTradingReport("RULES_VALIDATION", "APPROVED"), false);
  assert.equal(canTransitionTradingReport("RULES_VALIDATION", "RECONCILIATION"), true);

  // Melompat dari DRAFT langsung ke PAID atau APPROVED tidak diizinkan.
  assert.equal(canTransitionTradingReport("DRAFT", "PAID"), false);
  assert.equal(canTransitionTradingReport("DRAFT", "APPROVED"), false);
  assert.equal(canTransitionTradingReport("PENDING_APPROVAL", "PAID"), false);
  assert.equal(canTransitionTradingReport("PAID", "APPROVED"), false);

  assert.doesNotThrow(() => assertTradingReportTransition("DRAFT", "RECONCILIATION"));
  assert.throws(() => assertTradingReportTransition("DRAFT", "PAID"), TradingReportTransitionError);
  assert.throws(() => assertTradingReportTransition("PAID", "PAID"), TradingReportTransitionError);
});

test("laporan yang sudah diterbitkan hanya bisa dikoreksi, bukan dibatalkan diam-diam", () => {
  assert.equal(canTransitionTradingReport("PUBLISHED", "CORRECTED"), true);
  assert.equal(canTransitionTradingReport("PAID", "CORRECTED"), true);
  assert.equal(canTransitionTradingReport("CORRECTED", "RECONCILIATION"), true);
  assert.equal(isTerminalTradingReportStatus("REJECTED"), true);
  assert.equal(isTerminalTradingReportStatus("PAID"), false);
  assert.equal(TRADING_REPORT_TRANSITIONS.REJECTED.length, 0);
});

test("penolakan dan koreksi wajib menyertakan alasan", () => {
  assert.equal(transitionRequiresReason("REJECTED"), true);
  assert.equal(transitionRequiresReason("CORRECTED"), true);
  assert.equal(transitionRequiresReason("APPROVED"), false);
  assert.equal(transitionRequiresReason("PUBLISHED"), false);
});

test("penerbitan diblokir selama data belum siap, dengan alasan yang jelas", () => {
  const blocked = evaluatePublicationReadiness({
    status: "RULES_VALIDATION",
    hasUnresolvedReconciliation: true,
    unverifiedRecordCount: 3,
    policyApproved: false,
    compiled: true,
    rulesStatus: "BLOCKED",
  });

  assert.equal(blocked.ready, false);
  assert.equal(blocked.blockers.length, 4);
  assert.match(blocked.blockers.join(" "), /selisih rekonsiliasi/i);
  assert.match(blocked.blockers.join(" "), /belum diverifikasi/i);
  assert.match(blocked.blockers.join(" "), /belum disetujui pemilik/i);
  assert.match(blocked.blockers.join(" "), /validasi aturan belum lolos/i);

  const notCompiled = evaluatePublicationReadiness({
    status: "DRAFT",
    hasUnresolvedReconciliation: false,
    unverifiedRecordCount: 0,
    policyApproved: true,
    compiled: false,
    rulesStatus: "RULES_NOT_CONFIGURED",
  });
  assert.equal(notCompiled.ready, false);
  assert.match(notCompiled.blockers.join(" "), /belum dikompilasi/i);
  assert.match(notCompiled.blockers.join(" "), /harus berstatus Validasi Aturan/i);
  assert.match(notCompiled.blockers.join(" "), /RULES_NOT_CONFIGURED/);

  const ready = evaluatePublicationReadiness({
    status: "RULES_VALIDATION",
    hasUnresolvedReconciliation: false,
    unverifiedRecordCount: 0,
    policyApproved: true,
    compiled: true,
    rulesStatus: "PASSED",
  });
  assert.equal(ready.ready, true);
  assert.equal(ready.blockers.length, 0);
});

test("ringkasan laporan menandai kerugian dan menjelaskan unrealized", () => {
  const profit = buildReportSummary({
    realizedPnl: dec("120.00"),
    unrealizedPnl: dec("30.00"),
    tradingFees: dec("10.00"),
    otherCosts: dec("5.00"),
    netPnl: dec("105.00"),
    memberPoolAmount: dec("52.50"),
  });
  assert.equal(profit.netPnl, "105.00");
  assert.equal(profit.memberPoolAmount, "52.50");
  assert.equal(profit.isLoss, false);
  assert.match(profit.unrealizedNote, /tidak ikut dibagi/i);

  const loss = buildReportSummary({
    realizedPnl: dec("-80.00"),
    unrealizedPnl: dec("0.00"),
    tradingFees: dec("5.00"),
    otherCosts: dec("0.00"),
    netPnl: dec("-85.00"),
    memberPoolAmount: dec("0.00"),
  });
  assert.equal(loss.isLoss, true);
  assert.equal(loss.netPnl, "-85.00");
  assert.equal(loss.memberPoolAmount, "0.00");
});
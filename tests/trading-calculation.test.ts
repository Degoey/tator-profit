import assert from "node:assert/strict";
import { test } from "node:test";

import { Prisma } from "@prisma/client";

import {
  computeNetTradingPnl,
  isLossPeriod,
  netPnlForRecord,
  reconcileTradingTotals,
  toMoney,
  tradingWeekPeriod,
  type TradingRecordPnlInput,
} from "../src/lib/services/trading-calculation";

const dec = (value: string) => new Prisma.Decimal(value);

const record = (overrides: Partial<TradingRecordPnlInput> = {}): TradingRecordPnlInput => ({
  externalReference: "TR-1",
  sourceType: "ACTUAL",
  realizedPnl: dec("0"),
  ...overrides,
});

test("Net Trading P&L = realized − biaya trading − biaya lain", () => {
  const result = computeNetTradingPnl([
    record({
      externalReference: "TR-1",
      realizedPnl: dec("120.50"),
      tradingFees: dec("10.25"),
      otherCosts: dec("0.25"),
      verified: true,
    }),
    record({
      externalReference: "TR-2",
      realizedPnl: dec("-20.00"),
      tradingFees: dec("5.00"),
      verified: true,
    }),
  ]);

  assert.equal(result.realizedPnl.toFixed(2), "100.50");
  assert.equal(result.tradingFees.toFixed(2), "15.25");
  assert.equal(result.otherCosts.toFixed(2), "0.25");
  assert.equal(result.netPnl.toFixed(2), "85.00");
  assert.equal(result.includedRecords, 2);
  assert.equal(result.unverifiedRecords, 0);
  assert.equal(result.breakdown.length, 2);
});

test("periode rugi menghasilkan Net P&L negatif dan dikenali sebagai kerugian", () => {
  const result = computeNetTradingPnl([
    record({ realizedPnl: dec("-50.00"), tradingFees: dec("5.00"), verified: true }),
  ]);

  assert.equal(result.netPnl.toFixed(2), "-55.00");
  assert.equal(isLossPeriod(result.netPnl), true);
  assert.equal(isLossPeriod(dec("0.00")), false);
});

test("periode impas tidak dihitung sebagai kerugian", () => {
  const result = computeNetTradingPnl([
    record({ realizedPnl: dec("10.00"), tradingFees: dec("10.00"), verified: true }),
  ]);

  assert.equal(result.netPnl.toFixed(2), "0.00");
  assert.equal(isLossPeriod(result.netPnl), false);
});

test("biaya yang sudah termasuk di P&L tidak dikurangkan dua kali", () => {
  const result = computeNetTradingPnl([
    record({
      realizedPnl: dec("100.00"),
      tradingFees: dec("10.00"),
      otherCosts: dec("5.00"),
      costsIncludedInPnl: true,
      verified: true,
    }),
  ]);

  assert.equal(result.netPnl.toFixed(2), "100.00");
  assert.equal(result.tradingFees.toFixed(2), "0.00");
  assert.equal(result.otherCosts.toFixed(2), "0.00");
});

test("unrealized P&L dijumlahkan terpisah dan tidak masuk Net Trading P&L", () => {
  const result = computeNetTradingPnl([
    record({ realizedPnl: dec("50.00"), unrealizedPnl: dec("999.99"), verified: true }),
  ]);

  assert.equal(result.netPnl.toFixed(2), "50.00");
  assert.equal(result.unrealizedPnl.toFixed(2), "999.99");
});

test("catatan demo dikecualikan dari laporan aktual", () => {
  const result = computeNetTradingPnl([
    record({ externalReference: "DEMO-1", sourceType: "DEMO", realizedPnl: dec("1000.00"), verified: true }),
    record({ externalReference: "TR-1", sourceType: "ACTUAL", realizedPnl: dec("25.00"), verified: true }),
  ]);

  assert.equal(result.includedRecords, 1);
  assert.equal(result.skippedDemoRecords, 1);
  assert.equal(result.realizedPnl.toFixed(2), "25.00");
  assert.equal(result.netPnl.toFixed(2), "25.00");
});

test("catatan yang belum diverifikasi dihitung dan dilaporkan jumlahnya", () => {
  const result = computeNetTradingPnl([
    record({ externalReference: "TR-1", realizedPnl: dec("10.00"), verified: false }),
    record({ externalReference: "TR-2", realizedPnl: dec("10.00"), verified: true }),
  ]);

  assert.equal(result.includedRecords, 2);
  assert.equal(result.unverifiedRecords, 1);
});

test("masukan tidak valid ditolak, bukan dibulatkan secara diam-diam", () => {
  assert.throws(() => netPnlForRecord(record({ realizedPnl: dec("10.005") })), RangeError);
  assert.throws(() => netPnlForRecord(record({ tradingFees: dec("1.234") })), RangeError);
  assert.throws(
    () => netPnlForRecord(record({ realizedPnl: new Prisma.Decimal(Number.POSITIVE_INFINITY) })),
    RangeError,
  );
  assert.equal(toMoney(dec("1.005")).toFixed(2), "1.01");
  assert.equal(toMoney(dec("1.004")).toFixed(2), "1.00");
});

test("rekonsiliasi menandai selisih yang belum selesai", () => {
  const matched = reconcileTradingTotals({
    internalNetPnl: dec("100.00"),
    sourceNetPnl: dec("100.00"),
  });
  assert.equal(matched.status, "MATCHED");
  assert.equal(matched.matches, true);
  assert.equal(matched.difference.toFixed(2), "0.00");

  const unresolved = reconcileTradingTotals({
    internalNetPnl: dec("100.00"),
    sourceNetPnl: dec("99.00"),
  });
  assert.equal(unresolved.status, "UNRESOLVED");
  assert.equal(unresolved.matches, false);
  assert.equal(unresolved.difference.toFixed(2), "1.00");
  assert.match(unresolved.reason, /belum boleh disetujui/i);

  const tolerated = reconcileTradingTotals({
    internalNetPnl: dec("100.00"),
    sourceNetPnl: dec("99.50"),
    tolerance: dec("0.50"),
  });
  assert.equal(tolerated.status, "MATCHED");

  assert.throws(
    () =>
      reconcileTradingTotals({
        internalNetPnl: dec("100.00"),
        sourceNetPnl: dec("100.00"),
        tolerance: dec("-1.00"),
      }),
    RangeError,
  );
});

test("periode mingguan dimulai Senin 00:00 UTC dan dapat digeser", () => {
  const thursday = tradingWeekPeriod(new Date("2026-01-01T12:00:00.000Z"));
  assert.equal(thursday.periodStart.toISOString(), "2025-12-29T00:00:00.000Z");
  assert.equal(thursday.periodEnd.toISOString(), "2026-01-05T00:00:00.000Z");

  const sunday = tradingWeekPeriod(new Date("2026-01-04T23:59:59.000Z"));
  assert.equal(sunday.periodStart.toISOString(), "2025-12-29T00:00:00.000Z");

  const previous = tradingWeekPeriod(new Date("2026-01-01T00:00:00.000Z"), -1);
  assert.equal(previous.periodStart.toISOString(), "2025-12-22T00:00:00.000Z");

  assert.throws(() => tradingWeekPeriod(new Date("bukan-tanggal")), RangeError);
  assert.throws(() => tradingWeekPeriod(new Date(), 1.5), RangeError);
});

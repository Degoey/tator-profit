import { Prisma, type TradingSourceType } from "@prisma/client";

/**
 * Matematika murni modul profit trading — tanpa akses database, tanpa efek samping.
 *
 * Semua angka uang adalah `Prisma.Decimal` dengan maksimal dua desimal. Fungsi di
 * berkas ini hanya *menghitung*; tidak ada satu pun yang memindahkan saldo. Kredit
 * saldo tetap tugas `postLedgerEntry` di ledger-service.
 */

const MONEY_DP = 2;

/** Pembulatan uang standar modul ini (dua desimal, setengah ke atas). */
export function toMoney(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(MONEY_DP, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * Menolak nilai yang bukan angka terbatas atau yang lebih presisi dari dua
 * desimal, alih-alih membulatkannya diam-diam (perilaku sama dengan mesin reward).
 */
export function assertMoney(value: Prisma.Decimal, label: string): Prisma.Decimal {
  if (!value.isFinite()) {
    throw new RangeError(`${label} harus berupa angka yang valid.`);
  }
  if (value.decimalPlaces() > MONEY_DP) {
    throw new RangeError(`${label} maksimal dua desimal.`);
  }
  return value;
}

/** Satu catatan trading sebagaimana dibutuhkan perhitungan (bukan baris database). */
export interface TradingRecordPnlInput {
  /** Referensi sumber; dipakai pada rincian agar selisih bisa ditelusuri. */
  externalReference: string;
  /** Hanya ACTUAL yang dihitung; DEMO selalu dilewati. */
  sourceType: TradingSourceType;
  realizedPnl: Prisma.Decimal;
  unrealizedPnl?: Prisma.Decimal | null;
  tradingFees?: Prisma.Decimal | null;
  otherCosts?: Prisma.Decimal | null;
  /**
   * true bila P&L dari sumber sudah bersih setelah biaya. Saat true, biaya tidak
   * dikurangkan lagi supaya tidak terhitung dua kali.
   */
  costsIncludedInPnl?: boolean;
  /** Selain true dihitung belum terverifikasi (dilaporkan, bukan diabaikan). */
  verified?: boolean;
}

export interface TradingRecordPnlBreakdown {
  externalReference: string;
  realizedPnl: Prisma.Decimal;
  /** Biaya transaksi yang benar-benar dikurangkan (0 bila sudah termasuk di P&L). */
  feesApplied: Prisma.Decimal;
  /** Biaya lain yang benar-benar dikurangkan (0 bila sudah termasuk di P&L). */
  otherCostsApplied: Prisma.Decimal;
  netPnl: Prisma.Decimal;
}

/** P&L bersih satu record; biaya hanya dikurangkan sekali. */
export function netPnlForRecord(record: TradingRecordPnlInput): TradingRecordPnlBreakdown {
  const realizedPnl = assertMoney(record.realizedPnl, `Realized P&L ${record.externalReference}`);
  const fees = record.tradingFees
    ? assertMoney(record.tradingFees, `Biaya trading ${record.externalReference}`)
    : new Prisma.Decimal(0);
  const costs = record.otherCosts
    ? assertMoney(record.otherCosts, `Biaya lain ${record.externalReference}`)
    : new Prisma.Decimal(0);

  const feesApplied = record.costsIncludedInPnl ? new Prisma.Decimal(0) : fees;
  const otherCostsApplied = record.costsIncludedInPnl ? new Prisma.Decimal(0) : costs;
  const netPnl = toMoney(realizedPnl.minus(feesApplied).minus(otherCostsApplied));

  return {
    externalReference: record.externalReference,
    realizedPnl,
    feesApplied,
    otherCostsApplied,
    netPnl,
  };
}

export interface NetTradingPnlResult {
  /** Total realized P&L dari record ACTUAL. */
  realizedPnl: Prisma.Decimal;
  /** Total unrealized P&L; hanya untuk tampilan, TIDAK masuk `netPnl`. */
  unrealizedPnl: Prisma.Decimal;
  tradingFees: Prisma.Decimal;
  otherCosts: Prisma.Decimal;
  /** Realized − biaya yang relevan. */
  netPnl: Prisma.Decimal;
  includedRecords: number;
  skippedDemoRecords: number;
  /** Jumlah record ACTUAL yang belum terverifikasi (memblokir penerbitan laporan). */
  unverifiedRecords: number;
  breakdown: TradingRecordPnlBreakdown[];
}

/**
 * Net Trading P&L periode:
 *
 *   Net Trading P&L = Realized Trading P&L − Trading Fees − Biaya Lain yang Relevan
 *
 * Record DEMO dilewati sepenuhnya. Unrealized P&L dijumlahkan terpisah dan tidak
 * pernah mengurangi/menambah `netPnl`.
 */
export function computeNetTradingPnl(
  records: readonly TradingRecordPnlInput[],
): NetTradingPnlResult {
  let realizedPnl = new Prisma.Decimal(0);
  let unrealizedPnl = new Prisma.Decimal(0);
  let tradingFees = new Prisma.Decimal(0);
  let otherCosts = new Prisma.Decimal(0);
  let netPnl = new Prisma.Decimal(0);
  let includedRecords = 0;
  let skippedDemoRecords = 0;
  let unverifiedRecords = 0;
  const breakdown: TradingRecordPnlBreakdown[] = [];

  for (const record of records) {
    if (record.sourceType !== "ACTUAL") {
      skippedDemoRecords += 1;
      continue;
    }

    const item = netPnlForRecord(record);
    realizedPnl = realizedPnl.plus(item.realizedPnl);
    tradingFees = tradingFees.plus(item.feesApplied);
    otherCosts = otherCosts.plus(item.otherCostsApplied);
    netPnl = netPnl.plus(item.netPnl);
    if (record.unrealizedPnl) {
      unrealizedPnl = unrealizedPnl.plus(record.unrealizedPnl);
    }
    if (record.verified !== true) {
      unverifiedRecords += 1;
    }
    includedRecords += 1;
    breakdown.push(item);
  }

  return {
    realizedPnl: toMoney(realizedPnl),
    unrealizedPnl: toMoney(unrealizedPnl),
    tradingFees: toMoney(tradingFees),
    otherCosts: toMoney(otherCosts),
    netPnl: toMoney(netPnl),
    includedRecords,
    skippedDemoRecords,
    unverifiedRecords,
    breakdown,
  };
}

/** true bila periode berakhir dengan kerugian neto. */
export function isLossPeriod(netPnl: Prisma.Decimal): boolean {
  return assertMoney(netPnl, "Net Trading P&L").isNegative();
}

export interface ReconciliationInput {
  internalNetPnl: Prisma.Decimal;
  sourceNetPnl: Prisma.Decimal;
  /** Toleransi selisih; bawaan 0,00 (harus sama persis). */
  tolerance?: Prisma.Decimal | null;
}

export interface ReconciliationResult {
  internalNetPnl: Prisma.Decimal;
  sourceNetPnl: Prisma.Decimal;
  /** internal − source. */
  difference: Prisma.Decimal;
  tolerance: Prisma.Decimal;
  matches: boolean;
  status: "MATCHED" | "UNRESOLVED";
  reason: string;
}

/**
 * Mencocokkan angka internal dengan angka sumber. Selama hasilnya `UNRESOLVED`,
 * laporan tidak boleh naik ke PENDING_APPROVAL.
 */
export function reconcileTradingTotals(input: ReconciliationInput): ReconciliationResult {
  const internalNetPnl = assertMoney(input.internalNetPnl, "Net P&L internal");
  const sourceNetPnl = assertMoney(input.sourceNetPnl, "Net P&L sumber");
  const tolerance = input.tolerance
    ? assertMoney(input.tolerance, "Toleransi rekonsiliasi")
    : new Prisma.Decimal(0);

  if (tolerance.isNegative()) {
    throw new RangeError("Toleransi rekonsiliasi tidak boleh negatif.");
  }

  const difference = toMoney(internalNetPnl.minus(sourceNetPnl));
  const matches = difference.abs().lte(tolerance);

  return {
    internalNetPnl,
    sourceNetPnl,
    difference,
    tolerance,
    matches,
    status: matches ? "MATCHED" : "UNRESOLVED",
    reason: matches
      ? "Angka internal cocok dengan angka sumber."
      : `Selisih ${difference.toFixed(2)} melebihi toleransi ${tolerance.toFixed(2)}; laporan belum boleh disetujui.`,
  };
}

export interface TradingPeriod {
  /** Senin 00:00 UTC sebagai awal periode (inklusif). */
  periodStart: Date;
  /** Senin 00:00 UTC berikutnya sebagai akhir periode (eksklusif). */
  periodEnd: Date;
  /** Tanggal referensi yang dipakai, dalam UTC. */
  reference: Date;
}

/**
 * Periode mingguan (Senin–Minggu, UTC) yang memuat tanggal referensi.
 * `weekOffset` menggeser periode maju/mundur dalam satuan minggu.
 */
export function tradingWeekPeriod(reference: Date, weekOffset = 0): TradingPeriod {
  if (Number.isNaN(reference.getTime())) {
    throw new RangeError("Tanggal referensi tidak valid.");
  }
  if (!Number.isInteger(weekOffset)) {
    throw new RangeError("Geseran minggu harus berupa bilangan bulat.");
  }

  const dayOfWeek = reference.getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const mondayUtc = Date.UTC(
    reference.getUTCFullYear(),
    reference.getUTCMonth(),
    reference.getUTCDate() - daysSinceMonday,
  );
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const periodStart = new Date(mondayUtc + weekOffset * weekMs);
  const periodEnd = new Date(periodStart.getTime() + weekMs);

  return { periodStart, periodEnd, reference };
}



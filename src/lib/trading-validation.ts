import { Prisma, type TradingSourceType } from "@prisma/client";
import { z } from "zod";

import { TRADING_CURRENCY } from "./config/trading";
import { MONEY_SCALE } from "./money";

/**
 * Impor dan validasi catatan trading — murni, tanpa database.
 *
 * Berkas ini satu-satunya pintu masuk data trading, baik dari unggahan CSV maupun
 * isian manual. Tiga aturan yang dijaga di sini:
 *
 * 1. Uang selalu string desimal dengan MAKSIMAL dua angka di belakang koma. Tidak
 *    ada `number` JavaScript dan tidak ada pembulatan diam-diam: nilai lebih halus
 *    ditolak agar tidak ada sen yang hilang tanpa persetujuan.
 * 2. Sumber data wajib disebut eksplisit (`sumber` = ACTUAL atau DEMO), sehingga
 *    data demo tidak pernah bisa lolos menjadi laporan profit aktual.
 * 3. Baris duplikat ditolak — baik di dalam berkas yang sama maupun terhadap
 *    catatan yang sudah ada. Kuncinya sama dengan unique index database
 *    (`TradingRecord @@unique([exchange, externalReference, sourceType])`).
 */

/** Nama kolom CSV (bahasa Indonesia agar bisa diisi staf non-teknis). */
export const TRADING_CSV_HEADERS = [
  "sumber",
  "referensi",
  "nama_trader",
  "bursa",
  "pasangan",
  "jenis",
  "waktu",
  "modal",
  "pnl_realisasi",
  "pnl_belum_realisasi",
  "biaya_trading",
  "biaya_lain",
  "biaya_masuk_pnl",
  "mata_uang",
  "catatan",
] as const;

export type TradingCsvHeader = (typeof TRADING_CSV_HEADERS)[number];

/** Kolom yang wajib ada di baris judul; kolom lain boleh dikosongkan. */
export const TRADING_CSV_REQUIRED_HEADERS = [
  "sumber",
  "referensi",
  "nama_trader",
  "bursa",
  "pasangan",
  "jenis",
  "waktu",
  "pnl_realisasi",
] as const satisfies readonly TradingCsvHeader[];

/** Batas jumlah baris data per unggahan (di luar baris judul). */
export const TRADING_IMPORT_MAX_ROWS = 5000;

/** Token yang diterima untuk kolom benar/salah. */
const TRUE_TOKENS = ["true", "1", "ya", "y", "yes", "benar"];
const FALSE_TOKENS = ["false", "0", "tidak", "t", "no", "salah"];

/** `-12.50` boleh (rugi), maksimal dua desimal, tanpa pemisah ribuan. */
const MONEY_PATTERN = /^-?\d{1,16}(\.\d{1,2})?$/;
const OPTIONAL_MONEY_PATTERN = /^$|^-?\d{1,16}(\.\d{1,2})?$/;
const OPTIONAL_NON_NEGATIVE_PATTERN = /^$|^\d{1,16}(\.\d{1,2})?$/;
const ISO_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?)?$/;

const moneyMessage = "Format angka tidak valid (contoh: -12.50; maksimal dua desimal).";

/** Satu baris CSV mentah (semua kolom berupa string apa adanya dari berkas). */
export interface TradingCsvRawRow {
  sumber: string;
  referensi: string;
  nama_trader: string;
  bursa: string;
  pasangan: string;
  jenis: string;
  waktu: string;
  modal: string;
  pnl_realisasi: string;
  pnl_belum_realisasi: string;
  biaya_trading: string;
  biaya_lain: string;
  biaya_masuk_pnl: string;
  mata_uang: string;
  catatan: string;
}

/**
 * Skema satu baris CSV. Kolom opsional yang kosong tetap sah; nilainya diisi
 * bawaan saat dipetakan, bukan saat divalidasi, agar pesan galat tetap jelas.
 */
export const tradingCsvRowSchema = z.object({
  sumber: z.enum(["ACTUAL", "DEMO"], {
    message: 'Sumber data harus "ACTUAL" atau "DEMO".',
  }),
  referensi: z.string().trim().min(1, "Referensi wajib diisi.").max(120, "Referensi terlalu panjang."),
  nama_trader: z.string().trim().min(1, "Nama trader wajib diisi.").max(120, "Nama trader terlalu panjang."),
  bursa: z.string().trim().min(1, "Nama bursa wajib diisi.").max(60, "Nama bursa terlalu panjang."),
  pasangan: z.string().trim().min(1, "Pasangan aset wajib diisi.").max(40, "Pasangan aset terlalu panjang."),
  jenis: z.string().trim().min(1, "Jenis transaksi wajib diisi.").max(40, "Jenis transaksi terlalu panjang."),
  waktu: z
    .string()
    .trim()
    .refine((value) => ISO_DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(value)), {
      message: "Waktu harus format ISO 8601 (contoh: 2026-10-16T08:30:00Z).",
    }),
  modal: z.string().trim().regex(OPTIONAL_NON_NEGATIVE_PATTERN, moneyMessage),
  pnl_realisasi: z.string().trim().regex(MONEY_PATTERN, moneyMessage),
  pnl_belum_realisasi: z.string().trim().regex(OPTIONAL_MONEY_PATTERN, moneyMessage),
  biaya_trading: z.string().trim().regex(OPTIONAL_NON_NEGATIVE_PATTERN, moneyMessage),
  biaya_lain: z.string().trim().regex(OPTIONAL_NON_NEGATIVE_PATTERN, moneyMessage),
  biaya_masuk_pnl: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || TRUE_TOKENS.includes(value.toLowerCase()) || FALSE_TOKENS.includes(value.toLowerCase()),
      { message: 'Isi dengan "ya" atau "tidak".' },
    ),
  mata_uang: z
    .string()
    .trim()
    .refine((value) => value === "" || /^[A-Za-z0-9]{2,12}$/.test(value), {
      message: "Mata uang harus 2-12 huruf/angka.",
    }),
  catatan: z.string().trim().max(500, "Catatan terlalu panjang."),
});

/* -------------------------------------------------------------------------- */
/* Normalisasi nilai                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Menyeragamkan nilai uang menjadi skala 2 desimal.
 *
 * Ini BUKAN pembulatan: nilai dengan lebih dari dua desimal sudah ditolak skema.
 * `10` menjadi `10.00`, `-0` menjadi `0.00`, sehingga angka yang tersimpan di
 * database tidak pernah berbeda hanya karena cara penulisannya.
 */
export function normalizeMoneyString(value: string): string {
  const raw = value.trim() === "" ? "0" : value.trim();
  const decimal = new Prisma.Decimal(raw);
  if (decimal.decimalPlaces() > MONEY_SCALE) {
    throw new RangeError(`Nilai uang maksimal ${MONEY_SCALE} desimal: "${value}".`);
  }
  return decimal.isZero() ? new Prisma.Decimal(0).toFixed(MONEY_SCALE) : decimal.toFixed(MONEY_SCALE);
}

/** Kolom benar/salah; nilai kosong berarti `false`. */
export function normalizeBooleanCell(value: string): boolean {
  const token = value.trim().toLowerCase();
  return TRUE_TOKENS.includes(token);
}

/** Mata uang kosong memakai mata uang modul; kode selalu huruf besar. */
export function normalizeCurrencyCell(value: string): string {
  const token = value.trim().toUpperCase();
  return token.length === 0 ? TRADING_CURRENCY : token;
}

/**
 * Waktu ISO 8601 menjadi string UTC.
 * Tanggal tanpa jam diartikan 00:00 UTC; waktu dengan zona diubah ke UTC supaya
 * batas periode mingguan tidak pernah bergeser mengikuti zona server.
 */
export function normalizeExecutedAt(value: string): string {
  return new Date(value.trim()).toISOString();
}

/** Satu catatan trading yang sudah tervalidasi dan ternormalisasi. */
export interface TradingRecordInput {
  sourceType: TradingSourceType;
  externalReference: string;
  traderName: string;
  exchange: string;
  assetPair: string;
  tradeType: string;
  /** ISO 8601 UTC. */
  executedAt: string;
  /** Modal yang dialokasikan; `"0.00"` bila kosong. */
  allocatedCapital: string;
  realizedPnl: string;
  /** `null` bila kolomnya kosong (unrealized tidak masuk Net Trading P&L). */
  unrealizedPnl: string | null;
  tradingFees: string;
  otherCosts: string;
  /** true bila P&L dari sumber sudah bersih setelah biaya. */
  costsIncludedInPnl: boolean;
  currency: string;
  notes: string | null;
}

/**
 * Kunci anti-duplikat, sengaja identik dengan unique index database
 * `TradingRecord @@unique([exchange, externalReference, sourceType])`.
 *
 * Bursa dinormalkan ke huruf besar dan referensi dipangkas spasi, sehingga
 * `Binance` dan `BINANCE` dianggap bursa yang sama — nilai itu juga yang disimpan,
 * jadi database dan pemeriksaan di sini tidak pernah berbeda pendapat.
 */
export function tradingRecordDuplicateKey(input: {
  sourceType: string;
  exchange: string;
  externalReference: string;
}): string {
  return [
    input.sourceType.trim().toUpperCase(),
    input.exchange.trim().toUpperCase(),
    input.externalReference.trim(),
  ].join(":");
}

/** Memetakan baris CSV mentah menjadi catatan trading yang ternormalisasi. */
export function mapTradingCsvRow(row: TradingCsvRawRow): TradingRecordInput {
  const unrealized = row.pnl_belum_realisasi.trim();
  const notes = row.catatan.trim();
  return {
    sourceType: row.sumber.trim().toUpperCase() as TradingSourceType,
    externalReference: row.referensi.trim(),
    traderName: row.nama_trader.trim(),
    exchange: row.bursa.trim().toUpperCase(),
    assetPair: row.pasangan.trim().toUpperCase(),
    tradeType: row.jenis.trim().toUpperCase(),
    executedAt: normalizeExecutedAt(row.waktu),
    allocatedCapital: normalizeMoneyString(row.modal),
    realizedPnl: normalizeMoneyString(row.pnl_realisasi),
    unrealizedPnl: unrealized.length === 0 ? null : normalizeMoneyString(unrealized),
    tradingFees: normalizeMoneyString(row.biaya_trading),
    otherCosts: normalizeMoneyString(row.biaya_lain),
    costsIncludedInPnl: normalizeBooleanCell(row.biaya_masuk_pnl),
    currency: normalizeCurrencyCell(row.mata_uang),
    notes: notes.length === 0 ? null : notes,
  };
}

/* -------------------------------------------------------------------------- */
/* Pembaca CSV                                                                */
/* -------------------------------------------------------------------------- */

/** Satu galat pada satu baris CSV. */
export interface TradingCsvIssue {
  /** Nomor baris pada berkas (baris 1 = judul). */
  line: number;
  /** Nama kolom yang bermasalah; null bila masalahnya menyangkut seluruh baris. */
  column: string | null;
  message: string;
}

/** Laporan baris duplikat: di dalam berkas maupun terhadap database. */
export interface TradingCsvDuplicate {
  line: number;
  /** Baris pertama berkunci sama; null bila bentrok dengan catatan database. */
  firstLine: number | null;
  key: string;
  message: string;
}

export interface TradingCsvRow {
  line: number;
  input: TradingRecordInput;
}

export interface TradingCsvParseResult {
  /** Masalah pada baris judul; bila tidak kosong, seluruh impor dibatalkan. */
  headerErrors: string[];
  /** Galat per baris. Baris yang punya galat TIDAK muncul di `rows`. */
  issues: TradingCsvIssue[];
  duplicates: TradingCsvDuplicate[];
  /** Baris valid, unik, sudah ternormalisasi (ACTUAL dan DEMO). */
  rows: TradingCsvRow[];
  counts: {
    /** Jumlah baris data pada berkas (di luar judul, tanpa baris kosong). */
    dataLines: number;
    accepted: number;
    actual: number;
    demo: number;
    rejected: number;
    duplicate: number;
  };
  /** true bila berkas diterima sepenuhnya. */
  ok: boolean;
}

export interface TradingCsvParseOptions {
  /** Kunci baris yang sudah ada di database, dari `tradingRecordDuplicateKey`. */
  existingKeys?: readonly string[];
  /** Batas baris data; melebihi batas membatalkan seluruh impor. */
  maxRows?: number;
}

function emptyParseResult(headerErrors: string[]): TradingCsvParseResult {
  return {
    headerErrors,
    issues: [],
    duplicates: [],
    rows: [],
    counts: { dataLines: 0, accepted: 0, actual: 0, demo: 0, rejected: 0, duplicate: 0 },
    ok: false,
  };
}

/**
 * Memecah teks CSV menjadi baris dan kolom.
 *
 * Mengikuti RFC 4180: mendukung tanda kutip ganda (koma, baris baru, dan kutip
 * ganda di dalam sel), pengakhir baris CRLF maupun LF, serta BOM di awal berkas.
 * Tidak ada pemetaan kolom di sini — itu tugas `parseTradingCsv`.
 */
export function parseCsvText(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === undefined) break;
    if (inQuotes) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      inQuotes = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\r") {
      if (input[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Memvalidasi satu berkas CSV catatan trading.
 *
 * Bersifat gagal-tertutup: bila baris judul bermasalah, berkas kosong, atau jumlah
 * baris melebihi batas, hasilnya `rows: []` sehingga tidak ada satu pun catatan
 * yang masuk. Baris yang punya galat, baris duplikat di dalam berkas, dan baris
 * yang sudah ada di database dikeluarkan dari `rows` dan dilaporkan terpisah.
 */
export function parseTradingCsv(
  text: string,
  options: TradingCsvParseOptions = {},
): TradingCsvParseResult {
  const maxRows = options.maxRows ?? TRADING_IMPORT_MAX_ROWS;
  const rawRows = parseCsvText(text).filter((cells) => cells.some((cell) => cell.trim().length > 0));

  if (rawRows.length === 0) {
    return emptyParseResult(["Berkas kosong: baris judul tidak ditemukan."]);
  }

  const headerRow = rawRows[0];
  if (!headerRow) {
    return emptyParseResult(["Berkas kosong: baris judul tidak ditemukan."]);
  }

  const header = headerRow.map((cell) => cell.trim().toLowerCase());
  const columnIndex = new Map<string, number>();
  header.forEach((name, index) => {
    if (name.length > 0 && !columnIndex.has(name)) columnIndex.set(name, index);
  });

  const headerErrors: string[] = [];
  for (const required of TRADING_CSV_REQUIRED_HEADERS) {
    if (!columnIndex.has(required)) {
      headerErrors.push(`Kolom wajib "${required}" tidak ada pada baris judul.`);
    }
  }
  if (headerErrors.length > 0) return emptyParseResult(headerErrors);

  const dataLines = rawRows.slice(1);
  if (dataLines.length > maxRows) {
    headerErrors.push(
      `Jumlah baris (${dataLines.length}) melebihi batas ${maxRows} baris per unggahan.`,
    );
    return emptyParseResult(headerErrors);
  }

  const issues: TradingCsvIssue[] = [];
  const duplicates: TradingCsvDuplicate[] = [];
  const rows: TradingCsvRow[] = [];
  const firstLineByKey = new Map<string, number>();
  const existingKeys = new Set(options.existingKeys ?? []);
  let rejected = 0;

  dataLines.forEach((cells, position) => {
    const line = position + 2;
    const cell = (name: TradingCsvHeader): string => {
      const index = columnIndex.get(name);
      return index === undefined ? "" : (cells[index] ?? "");
    };
    const raw: TradingCsvRawRow = {
      sumber: cell("sumber"),
      referensi: cell("referensi"),
      nama_trader: cell("nama_trader"),
      bursa: cell("bursa"),
      pasangan: cell("pasangan"),
      jenis: cell("jenis"),
      waktu: cell("waktu"),
      modal: cell("modal"),
      pnl_realisasi: cell("pnl_realisasi"),
      pnl_belum_realisasi: cell("pnl_belum_realisasi"),
      biaya_trading: cell("biaya_trading"),
      biaya_lain: cell("biaya_lain"),
      biaya_masuk_pnl: cell("biaya_masuk_pnl"),
      mata_uang: cell("mata_uang"),
      catatan: cell("catatan"),
    };

    const parsed = tradingCsvRowSchema.safeParse(raw);
    if (!parsed.success) {
      rejected += 1;
      for (const issue of parsed.error.issues) {
        issues.push({
          line,
          column: issue.path.length > 0 ? String(issue.path[0]) : null,
          message: issue.message,
        });
      }
      return;
    }

    const input = mapTradingCsvRow(raw);
    const key = tradingRecordDuplicateKey(input);
    const firstLine = firstLineByKey.get(key);
    if (firstLine !== undefined) {
      duplicates.push({
        line,
        firstLine,
        key,
        message: `Baris duplikat: bursa/referensi/sumber sama dengan baris ${firstLine}.`,
      });
      return;
    }
    if (existingKeys.has(key)) {
      duplicates.push({
        line,
        firstLine: null,
        key,
        message: "Catatan dengan bursa/referensi/sumber ini sudah ada di database.",
      });
      return;
    }

    firstLineByKey.set(key, line);
    rows.push({ line, input });
  });

  const actual = rows.filter((row) => row.input.sourceType === "ACTUAL").length;

  return {
    headerErrors,
    issues,
    duplicates,
    rows,
    counts: {
      dataLines: dataLines.length,
      accepted: rows.length,
      actual,
      demo: rows.length - actual,
      rejected,
      duplicate: duplicates.length,
    },
    ok: issues.length === 0 && duplicates.length === 0,
  };
}

/** Baris ACTUAL saja: satu-satunya baris yang boleh masuk laporan profit aktual. */
export function actualCsvRows(result: TradingCsvParseResult): TradingCsvRow[] {
  return result.rows.filter((row) => row.input.sourceType === "ACTUAL");
}

/** Baris DEMO: disimpan terpisah, tidak pernah masuk laporan profit aktual. */
export function demoCsvRows(result: TradingCsvParseResult): TradingCsvRow[] {
  return result.rows.filter((row) => row.input.sourceType === "DEMO");
}

/**
 * Baris judul siap unduh. Sengaja tanpa baris contoh supaya tidak ada satu pun
 * angka yang bisa terbaca sebagai data nyata.
 */
export function buildTradingCsvTemplate(): string {
  return `${TRADING_CSV_HEADERS.join(",")}\r\n`;
}
import assert from "node:assert/strict";
import { test } from "node:test";

import { TRADING_SOURCE_TYPES } from "../src/lib/config/trading";
import {
  TRADING_CSV_HEADERS,
  TRADING_CSV_REQUIRED_HEADERS,
  TRADING_IMPORT_MAX_ROWS,
  actualCsvRows,
  buildTradingCsvTemplate,
  demoCsvRows,
  mapTradingCsvRow,
  normalizeBooleanCell,
  normalizeCurrencyCell,
  normalizeExecutedAt,
  normalizeMoneyString,
  parseCsvText,
  parseTradingCsv,
  tradingRecordDuplicateKey,
  type TradingCsvRawRow,
} from "../src/lib/trading-validation";

const HEADER = TRADING_CSV_HEADERS.join(",");

/** Berkas CSV kecil dengan pengakhir baris CRLF, seperti hasil Excel. */
function csv(...lines: string[]): string {
  return `${[HEADER, ...lines].join("\r\n")}\r\n`;
}

const ACTUAL_ROW =
  "ACTUAL,TR-1,Budi,Binance,BTC/USDT,BUY,2026-10-16T08:30:00Z,1000.00,12.50,,3.25,1.10,tidak,USDT,catatan pertama";
const DEMO_ROW =
  "DEMO,DMO-1,Budi,Binance,ETH/USDT,SELL,2026-10-16T09:00:00Z,500,7.25,-1.50,1.00,0.50,ya,,demo";

test("baris judul dan templat CSV sejalan dengan konfigurasi sumber", () => {
  assert.deepEqual([...TRADING_SOURCE_TYPES], ["ACTUAL", "DEMO"]);
  for (const required of TRADING_CSV_REQUIRED_HEADERS) {
    assert.ok((TRADING_CSV_HEADERS as readonly string[]).includes(required), required);
  }
  const template = buildTradingCsvTemplate();
  assert.equal(template, `${HEADER}\r\n`);
  // Templat tidak boleh memuat baris contoh: tidak ada angka karangan.
  assert.equal(template.trim().split(/\r?\n/).length, 1);
});

test("berkas valid diterima, dinormalkan, dan dipisah ACTUAL/DEMO", () => {
  const result = parseTradingCsv(csv(ACTUAL_ROW, DEMO_ROW));

  assert.deepEqual(result.headerErrors, []);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.duplicates, []);
  assert.equal(result.ok, true);
  assert.equal(result.counts.dataLines, 2);
  assert.equal(result.counts.accepted, 2);
  assert.equal(result.counts.actual, 1);
  assert.equal(result.counts.demo, 1);
  assert.equal(result.rows[0]?.line, 2);
  assert.equal(result.rows[1]?.line, 3);

  const actualRow = actualCsvRows(result)[0];
  assert.ok(actualRow);
  const actual = actualRow.input;
  assert.equal(actual.sourceType, "ACTUAL");
  assert.equal(actual.externalReference, "TR-1");
  assert.equal(actual.traderName, "Budi");
  assert.equal(actual.exchange, "BINANCE");
  assert.equal(actual.assetPair, "BTC/USDT");
  assert.equal(actual.tradeType, "BUY");
  assert.equal(actual.executedAt, "2026-10-16T08:30:00.000Z");
  assert.equal(actual.allocatedCapital, "1000.00");
  assert.equal(actual.realizedPnl, "12.50");
  assert.equal(actual.unrealizedPnl, null);
  assert.equal(actual.tradingFees, "3.25");
  assert.equal(actual.otherCosts, "1.10");
  assert.equal(actual.costsIncludedInPnl, false);
  assert.equal(actual.currency, "USDT");
  assert.equal(actual.notes, "catatan pertama");

  const demoRow = demoCsvRows(result)[0];
  assert.ok(demoRow);
  assert.equal(demoRow.input.sourceType, "DEMO");
  assert.equal(demoRow.input.allocatedCapital, "500.00");
  assert.equal(demoRow.input.unrealizedPnl, "-1.50");
  assert.equal(demoRow.input.costsIncludedInPnl, true);
  // Kolom mata uang kosong memakai mata uang modul.
  assert.equal(demoRow.input.currency, "USDT");
});

test("berkas kosong atau baris judul kurang ditolak seluruhnya", () => {
  const empty = parseTradingCsv("");
  assert.equal(empty.ok, false);
  assert.equal(empty.rows.length, 0);
  assert.ok(empty.headerErrors[0]?.includes("Berkas kosong"));

  const missing = parseTradingCsv(
    "sumber,referensi,waktu,pnl_realisasi\r\nACTUAL,TR-1,2026-10-16T08:30:00Z,1.00\r\n",
  );
  assert.equal(missing.ok, false);
  assert.equal(missing.rows.length, 0);
  assert.ok(missing.headerErrors.some((message) => message.includes('"bursa"')));
  assert.ok(missing.headerErrors.some((message) => message.includes('"nama_trader"')));

  const onlyHeader = parseTradingCsv(`${HEADER}\r\n`);
  assert.equal(onlyHeader.ok, true);
  assert.equal(onlyHeader.counts.dataLines, 0);
  assert.equal(onlyHeader.counts.accepted, 0);
});

/* -------------------------------------------------------------------------- */
/* Baris uji dengan nilai yang bisa diganti                                    */
/* -------------------------------------------------------------------------- */

const BASE_VALUES: Record<string, string> = {
  sumber: "ACTUAL",
  referensi: "TR-1",
  nama_trader: "Budi",
  bursa: "Binance",
  pasangan: "BTC/USDT",
  jenis: "BUY",
  waktu: "2026-10-16T08:30:00Z",
  modal: "1000.00",
  pnl_realisasi: "12.50",
  pnl_belum_realisasi: "",
  biaya_trading: "3.25",
  biaya_lain: "1.10",
  biaya_masuk_pnl: "tidak",
  mata_uang: "USDT",
  catatan: "catatan",
};

/** Satu baris CSV dengan sebagian nilai diganti. */
function row(overrides: Record<string, string> = {}): string {
  const values = { ...BASE_VALUES, ...overrides };
  return TRADING_CSV_HEADERS.map((name) => values[name] ?? "").join(",");
}

test("kutip ganda, koma, dan baris baru di dalam sel tidak memecah baris", () => {
  const text =
    `${HEADER}\r\n` +
    `ACTUAL,TR-9,Ani,"Bursa, Inc",BTC/USDT,BUY,2026-10-16T10:00:00Z,10.00,1.00,,0.10,0.05,tidak,USDT,"baris satu\nbaris dua"\r\n`;

  const result = parseTradingCsv(text);
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.input.exchange, "BURSA, INC");
  assert.equal(result.rows[0]?.input.notes, "baris satu\nbaris dua");

  assert.deepEqual(parseCsvText('"a,b",c\r\n'), [["a,b", "c"]]);
  assert.deepEqual(parseCsvText('"kutip""dalam"\r\n'), [['kutip"dalam']]);
});

test("BOM, pengakhir baris LF, dan judul huruf besar tetap terbaca", () => {
  const text = `\uFEFF${HEADER.toUpperCase()}\n${ACTUAL_ROW}\n`;
  const result = parseTradingCsv(text);
  assert.deepEqual(result.headerErrors, []);
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.line, 2);
});

test("kolom opsional yang kosong memakai nilai bawaan", () => {
  const result = parseTradingCsv(
    csv(
      row({
        modal: "",
        pnl_belum_realisasi: "",
        biaya_trading: "",
        biaya_lain: "",
        biaya_masuk_pnl: "",
        mata_uang: "",
        catatan: "",
      }),
    ),
  );

  assert.equal(result.ok, true);
  const input = result.rows[0]?.input;
  assert.ok(input);
  assert.equal(input.allocatedCapital, "0.00");
  assert.equal(input.tradingFees, "0.00");
  assert.equal(input.otherCosts, "0.00");
  assert.equal(input.unrealizedPnl, null);
  assert.equal(input.costsIncludedInPnl, false);
  assert.equal(input.currency, "USDT");
  assert.equal(input.notes, null);
});

test("nilai uang dinormalkan tanpa pembulatan dan nilai halus ditolak", () => {
  assert.equal(normalizeMoneyString("10"), "10.00");
  assert.equal(normalizeMoneyString("-12.5"), "-12.50");
  assert.equal(normalizeMoneyString("-0"), "0.00");
  assert.equal(normalizeMoneyString(""), "0.00");
  assert.throws(() => normalizeMoneyString("10.001"), RangeError);

  const tooFine = parseTradingCsv(csv(row({ pnl_realisasi: "10.001" })));
  assert.equal(tooFine.ok, false);
  assert.equal(tooFine.rows.length, 0);
  assert.equal(tooFine.counts.rejected, 1);
  assert.equal(tooFine.issues[0]?.line, 2);
  assert.equal(tooFine.issues[0]?.column, "pnl_realisasi");
  assert.ok(tooFine.issues[0]?.message.includes("dua desimal"));

  const notANumber = parseTradingCsv(csv(row({ pnl_realisasi: "seribu" })));
  assert.equal(notANumber.rows.length, 0);
  assert.equal(notANumber.issues[0]?.column, "pnl_realisasi");

  // Rugi boleh: nilai negatif sah pada kolom P&L.
  const loss = parseTradingCsv(csv(row({ pnl_realisasi: "-12.50" })));
  assert.equal(loss.ok, true);
  assert.equal(loss.rows[0]?.input.realizedPnl, "-12.50");
});

test("nilai negatif ditolak pada kolom yang tidak boleh negatif", () => {
  for (const column of ["modal", "biaya_trading", "biaya_lain"] as const) {
    const result = parseTradingCsv(csv(row({ [column]: "-1.00" })));
    assert.equal(result.rows.length, 0, column);
    assert.equal(result.issues[0]?.column, column);
  }
});

test("waktu wajib ISO 8601 dan zona waktu diubah ke UTC", () => {
  const invalid = parseTradingCsv(csv(row({ waktu: "16-10-2026" })));
  assert.equal(invalid.rows.length, 0);
  assert.equal(invalid.issues[0]?.column, "waktu");

  const dateOnly = parseTradingCsv(csv(row({ waktu: "2026-10-16" })));
  assert.equal(dateOnly.rows[0]?.input.executedAt, "2026-10-16T00:00:00.000Z");

  const withOffset = parseTradingCsv(csv(row({ waktu: "2026-10-16T15:30:00+07:00" })));
  assert.equal(withOffset.rows[0]?.input.executedAt, "2026-10-16T08:30:00.000Z");

  assert.equal(normalizeExecutedAt("2026-10-16T08:30:00.123Z"), "2026-10-16T08:30:00.123Z");
});

test("token benar/salah dan kode mata uang diterima dalam beberapa penulisan", () => {
  for (const token of ["ya", "1", "benar", "YES", "true"]) {
    assert.equal(normalizeBooleanCell(token), true, token);
  }
  for (const token of ["tidak", "0", "salah", "t", "", "  "]) {
    assert.equal(normalizeBooleanCell(token), false, token);
  }
  const included = parseTradingCsv(csv(row({ biaya_masuk_pnl: "ya" })));
  assert.equal(included.rows[0]?.input.costsIncludedInPnl, true);

  const unknownToken = parseTradingCsv(csv(row({ biaya_masuk_pnl: "mungkin" })));
  assert.equal(unknownToken.rows.length, 0);
  assert.equal(unknownToken.issues[0]?.column, "biaya_masuk_pnl");

  assert.equal(normalizeCurrencyCell("idr"), "IDR");
  assert.equal(normalizeCurrencyCell("  "), "USDT");
  const badCurrency = parseTradingCsv(csv(row({ mata_uang: "U$" })));
  assert.equal(badCurrency.rows.length, 0);
  assert.equal(badCurrency.issues[0]?.column, "mata_uang");
});

test("sumber data wajib eksplisit supaya data demo tidak menjadi aktual", () => {
  const missing = parseTradingCsv(csv(row({ sumber: "" })));
  assert.equal(missing.ok, false);
  assert.equal(missing.rows.length, 0);
  assert.equal(missing.issues[0]?.column, "sumber");

  const lowercase = parseTradingCsv(csv(row({ sumber: "aktual" })));
  assert.equal(lowercase.rows.length, 0);
  assert.ok(lowercase.issues[0]?.message.includes("ACTUAL"));

  const demo = parseTradingCsv(csv(row({ sumber: "DEMO" })));
  assert.equal(demo.counts.demo, 1);
  assert.equal(demo.counts.actual, 0);
  assert.equal(actualCsvRows(demo).length, 0);
  assert.equal(demoCsvRows(demo).length, 1);
});

test("baris duplikat di dalam berkas ditolak dan dilaporkan", () => {
  const duplicated = parseTradingCsv(csv(row({ referensi: "TR-1" }), row({ referensi: "TR-1" })));
  assert.equal(duplicated.ok, false);
  assert.equal(duplicated.counts.accepted, 1);
  assert.equal(duplicated.counts.duplicate, 1);
  assert.equal(duplicated.duplicates[0]?.line, 3);
  assert.equal(duplicated.duplicates[0]?.firstLine, 2);
  assert.ok(duplicated.duplicates[0]?.message.includes("baris 2"));

  // Beda penulisan huruf pada bursa tetap dianggap bursa yang sama.
  const sameExchange = parseTradingCsv(csv(row({ bursa: "Binance" }), row({ bursa: "BINANCE" })));
  assert.equal(sameExchange.counts.duplicate, 1);

  // Sumber yang berbeda berarti catatan yang berbeda.
  const differentSource = parseTradingCsv(
    csv(row({ sumber: "ACTUAL", referensi: "TR-2" }), row({ sumber: "DEMO", referensi: "TR-2" })),
  );
  assert.equal(differentSource.counts.accepted, 2);
  assert.equal(differentSource.counts.actual, 1);
  assert.equal(differentSource.counts.demo, 1);
});

test("baris yang sudah ada di database ditolak", () => {
  const existing = parseTradingCsv(csv(row({ referensi: "TR-1" })), {
    existingKeys: [
      tradingRecordDuplicateKey({
        sourceType: "ACTUAL",
        exchange: "BINANCE",
        externalReference: "TR-1",
      }),
    ],
  });
  assert.equal(existing.rows.length, 0);
  assert.equal(existing.duplicates[0]?.firstLine, null);
  assert.ok(existing.duplicates[0]?.message.includes("database"));
});

test("kunci duplikat stabil dan mengikuti unique index database", () => {
  const canonical = "ACTUAL:BINANCE:TR-1";
  assert.equal(
    tradingRecordDuplicateKey({
      sourceType: " actual ",
      exchange: " Binance ",
      externalReference: " TR-1 ",
    }),
    canonical,
  );
  assert.notEqual(
    tradingRecordDuplicateKey({ sourceType: "DEMO", exchange: "BINANCE", externalReference: "TR-1" }),
    canonical,
  );

  const parsed = parseTradingCsv(csv(row()));
  const input = parsed.rows[0]?.input;
  assert.ok(input);
  assert.equal(tradingRecordDuplicateKey(input), canonical);
});

test("mapTradingCsvRow memetakan nilai mentah menjadi catatan ternormalisasi", () => {
  const raw: TradingCsvRawRow = {
    sumber: "actual",
    referensi: " TR-77 ",
    nama_trader: " Sari ",
    bursa: "kraken",
    pasangan: "sol/usdt",
    jenis: "limit_buy",
    waktu: "2026-10-16T08:30:00Z",
    modal: "250",
    pnl_realisasi: "5.5",
    pnl_belum_realisasi: "",
    biaya_trading: "0.25",
    biaya_lain: "0",
    biaya_masuk_pnl: "YA",
    mata_uang: "",
    catatan: "   ",
  };

  const input = mapTradingCsvRow(raw);
  assert.equal(input.sourceType, "ACTUAL");
  assert.equal(input.externalReference, "TR-77");
  assert.equal(input.traderName, "Sari");
  assert.equal(input.exchange, "KRAKEN");
  assert.equal(input.assetPair, "SOL/USDT");
  assert.equal(input.tradeType, "LIMIT_BUY");
  assert.equal(input.allocatedCapital, "250.00");
  assert.equal(input.realizedPnl, "5.50");
  assert.equal(input.unrealizedPnl, null);
  assert.equal(input.costsIncludedInPnl, true);
  assert.equal(input.currency, "USDT");
  assert.equal(input.notes, null);
});

test("kolom tambahan yang tidak dikenal diabaikan", () => {
  const result = parseTradingCsv(`${HEADER},catatan_lain\r\n${row()},abaikan\r\n`);
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 1);
});

test("jumlah baris melebihi batas membatalkan seluruh impor", () => {
  assert.ok(TRADING_IMPORT_MAX_ROWS > 0);

  const tooMany = parseTradingCsv(csv(row({ referensi: "TR-1" }), row({ referensi: "TR-2" })), {
    maxRows: 1,
  });
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.rows.length, 0);
  assert.ok(tooMany.headerErrors.some((message) => message.includes("melebihi batas")));
});
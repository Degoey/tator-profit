import assert from "node:assert/strict";
import { test } from "node:test";

import {
  WITHDRAWAL_CSV_HEADERS,
  buildWithdrawalCsv,
  csvResponseHeaders,
} from "../src/lib/payment-csv";

test("rekap CSV penarikan memuat header, nilai bruto, biaya, dan netto", () => {
  const csv = buildWithdrawalCsv([
    {
      id: "11111111-1111-1111-1111-111111111111",
      createdAt: "2026-10-10T02:00:00.000Z",
      amount: "1000.00",
      fee: "100.00",
      netAmount: "900.00",
      currency: "USDT",
      method: "BANK_TRANSFER",
      destination: "BCA 1234567890 a/n Budi",
      status: "COMPLETED",
      username: "budi",
      email: "budi@example.com",
    },
  ]);

  const lines = csv.trimEnd().split("\r\n");
  assert.equal(lines.length, 2);
  assert.equal(lines[0], WITHDRAWAL_CSV_HEADERS.join(","));
  // 10% fee and the net payout are printed from the stored amounts.
  assert.ok(lines[1]?.includes('"1000.00"'));
  assert.ok(lines[1]?.includes('"100.00"'));
  assert.ok(lines[1]?.includes('"900.00"'));
  assert.ok(lines[1]?.includes('"COMPLETED"'));
  assert.ok(lines[1]?.includes('"budi@example.com"'));
});

test("rekap CSV menetralkan sel yang bisa dieksekusi spreadsheet", () => {
  const csv = buildWithdrawalCsv([
    {
      id: "22222222-2222-2222-2222-222222222222",
      createdAt: "2026-10-10T03:00:00.000Z",
      amount: "50.00",
      fee: "5.00",
      netAmount: "45.00",
      currency: "USDT",
      method: "EWALLET",
      // A hostile destination, entered by a member, must not become a formula.
      destination: "=HYPERLINK(\"http://evil.example\",\"klik\")",
      status: "PENDING",
    },
  ]);

  const body = csv.split("\r\n")[1] ?? "";
  assert.ok(body.includes(`"'=HYPERLINK(`));
  assert.ok(!body.includes(`"=HYPERLINK(`));
  // Inner quotes are doubled, so the cell stays a single valid CSV field.
  assert.ok(body.includes(`""http://evil.example""`));
});

test("header unduhan CSV bersifat privat dan tidak di-cache", () => {
  const headers = csvResponseHeaders("rekap-penarikan-2026-10-10.csv");
  assert.equal(headers["content-type"], "text/csv; charset=utf-8");
  assert.equal(
    headers["content-disposition"],
    'attachment; filename="rekap-penarikan-2026-10-10.csv"',
  );
  assert.equal(headers["cache-control"], "private, no-store");
});

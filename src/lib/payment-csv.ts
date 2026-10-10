/**
 * CSV rendering for the withdrawal recap ("rekap penarikan").
 *
 * The recap is generated from the same server side rows the panels use, so the
 * numbers (gross, 10% fee, net) come from the ledger-authoritative model and not
 * from anything the browser sent. Every cell is escaped defensively: a field
 * that starts with `= + - @ TAB CR` is prefixed with an apostrophe so a hostile
 * destination or note can never be interpreted as a formula by a spreadsheet.
 */

export interface WithdrawalCsvRow {
  id: string;
  createdAt: string;
  amount: string;
  fee: string;
  netAmount: string;
  currency: string;
  method: string;
  destination: string;
  status: string;
  /** Present on the administrator scope only. */
  username?: string | null;
  email?: string | null;
}

export const WITHDRAWAL_CSV_HEADERS = [
  "ID",
  "Tanggal",
  "Pengguna",
  "Surel",
  "Nominal",
  "Biaya",
  "Bersih",
  "Mata uang",
  "Metode",
  "Tujuan",
  "Status",
] as const;

/** Quotes and neutralises one cell so the CSV stays parseable and inert. */
function safeCell(value: string | null | undefined): string {
  const raw = value ?? "";
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/** Renders the recap as a CRLF-delimited CSV string (Excel friendly). */
export function buildWithdrawalCsv(rows: WithdrawalCsvRow[]): string {
  const lines = [WITHDRAWAL_CSV_HEADERS.join(",")];
  for (const row of rows) {
    lines.push(
      [
        safeCell(row.id),
        safeCell(row.createdAt),
        safeCell(row.username),
        safeCell(row.email),
        safeCell(row.amount),
        safeCell(row.fee),
        safeCell(row.netAmount),
        safeCell(row.currency),
        safeCell(row.method),
        safeCell(row.destination),
        safeCell(row.status),
      ].join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

/** Download headers for a generated CSV attachment. */
export function csvResponseHeaders(fileName: string): Record<string, string> {
  return {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="${fileName}"`,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  };
}

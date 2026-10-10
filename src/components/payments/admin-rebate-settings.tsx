"use client";

import { Loader2, Percent, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { formatPaymentDate } from "@/components/payments/status-badge";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export interface RebateGenerationRow {
  generation: number;
  /** Stored fraction, 4 decimals (e.g. `0.1000`). */
  rate: string;
  /** Display percentage, e.g. `10%`. */
  displayRate: string;
  /** Percentage as an editable string, e.g. `10`. */
  percent: string;
  updatedAt: Date | null;
  updatedBy: string | null;
}

const PERCENT_PATTERN = /^\d{1,3}([.,]\d{1,4})?$/;

/** Shifts a percent string two decimal places left into a fraction string. */
function percentToFraction(input: string): string | null {
  const normalized = input.trim().replace(",", ".");
  if (!PERCENT_PATTERN.test(normalized)) return null;

  const [intPart, fracPart = ""] = normalized.split(".");
  const digits = (intPart + fracPart).replace(/^0+/, "") || "0";
  const scale = fracPart.length + 2;
  const padded = digits.padStart(scale + 1, "0");
  const cut = padded.length - scale;
  return `${padded.slice(0, cut)}.${padded.slice(cut)}`;
}

export interface AdminRebateSettingsProps {
  rows: RebateGenerationRow[];
  /** Only administrators with `manageFinance` may edit; others see a read-only table. */
  canEdit: boolean;
  /** `false` when the database had to fall back to the central configuration. */
  fromDatabase: boolean;
}

/**
 * "Persentase Komisi Rabat" admin settings. Shows generations 1..5 (never 6+)
 * and lets an authorised administrator change them; the server re-checks the
 * permission and writes an audit row for every change.
 */
export function AdminRebateSettings({ rows, canEdit, fromDatabase }: AdminRebateSettingsProps) {
  const router = useRouter();
  const [values, setValues] = React.useState<Record<number, string>>(() =>
    Object.fromEntries(rows.map((row) => [row.generation, row.percent])),
  );
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  const baseline = React.useMemo(
    () => Object.fromEntries(rows.map((row) => [row.generation, row.percent])),
    [rows],
  );

  const changes = rows
    .map((row) => ({ row, value: values[row.generation] ?? row.percent }))
    .filter(({ row, value }) => value.trim() !== (baseline[row.generation] ?? row.percent));

  const invalid = changes.some(({ value }) => percentToFraction(value) === null);

  async function save() {
    setPending(true);
    setError(null);
    setMessage(null);

    const updates = changes.map(({ row, value }) => ({
      generation: row.generation,
      rate: percentToFraction(value) as string,
    }));

    try {
      const response = await fetch("/api/admin/rebate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
      const payload = (await response.json()) as { ok: boolean; message?: string };
      if (!response.ok || !payload.ok) {
        setError(payload.message ?? "Persentase rabat tidak dapat disimpan.");
        return;
      }
      setMessage("Persentase rabat tersimpan dan tercatat pada jejak audit.");
      router.refresh();
    } catch {
      setError("Gangguan jaringan. Silakan coba lagi.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card id="pengaturan-rabat">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Percent className="size-4 text-[var(--color-neon)]" aria-hidden />
          Persentase Komisi Rabat
        </CardTitle>
        <CardDescription>
          Satu konfigurasi dipakai bersama oleh beranda member, mesin perhitungan rabat, dan tabel
          ini. Hanya lima generasi jaringan yang tersedia. Perubahan tidak mengubah transaksi rabat
          yang sudah tercatat.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="danger" title="Gagal menyimpan">
            {error}
          </Alert>
        ) : null}
        {message ? (
          <Alert variant="success" title="Berhasil">
            {message}
          </Alert>
        ) : null}
        {!fromDatabase ? (
          <Alert variant="warning" title="Nilai bawaan">
            Tabel database rabat belum lengkap; sistem memakai konfigurasi bawaan. Simpan perubahan
            untuk menuliskan konfigurasi ke database.
          </Alert>
        ) : null}

        <div className="overflow-hidden rounded-xl border border-white/10">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-white/[0.04] text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-white/50">
                <th scope="col" className="px-4 py-3">
                  Generasi jaringan
                </th>
                <th scope="col" className="px-4 py-3">
                  Persentase rabat
                </th>
                <th scope="col" className="px-4 py-3">
                  Terakhir diubah
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.generation} className="border-t border-white/10 bg-white/[0.02]">
                  <th scope="row" className="px-4 py-3 text-left font-medium text-white/80">
                    Generasi {row.generation}
                  </th>
                  <td className="px-4 py-3">
                    {canEdit ? (
                      <div className="flex items-center gap-2">
                        <input
                          aria-label={`Persentase rabat generasi ${row.generation}`}
                          value={values[row.generation] ?? row.percent}
                          onChange={(event) =>
                            setValues((state) => ({
                              ...state,
                              [row.generation]: event.target.value,
                            }))
                          }
                          inputMode="decimal"
                          className="h-9 w-24 rounded-lg border border-white/12 bg-white/[0.04] px-3 text-sm text-white focus-visible:border-[var(--color-neon)]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-neon)]/25"
                        />
                        <span className="text-sm text-white/60">%</span>
                      </div>
                    ) : (
                      <Badge variant="default">{row.displayRate}</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[11px] text-white/50">
                    {row.updatedAt ? formatPaymentDate(row.updatedAt) : "Bawaan sistem"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {canEdit ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="gold"
              size="sm"
              disabled={pending || changes.length === 0 || invalid}
              onClick={save}
            >
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
              Simpan persentase
            </Button>
            <p className="text-xs text-white/45">
              {invalid
                ? "Masukkan angka 0-100 dengan maksimal 2 desimal (contoh 7.5)."
                : "Hanya administrator berwenang (Super Admin atau Keuangan) yang dapat menyimpan."}
            </p>
          </div>
        ) : (
          <p className="text-xs text-white/45">
            Anda tidak memiliki izin mengubah persentase rabat. Hubungi Super Admin atau Keuangan.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

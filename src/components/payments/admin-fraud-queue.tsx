"use client";

import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import {
  FRAUD_DECISION_LABELS,
  type FraudDecision,
} from "@/components/payments/fraud-review-actions";
import { formatPaymentDate } from "@/components/payments/status-badge";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** One review case as rendered in the queue (safe display fields only). */
export interface FraudCaseRow {
  id: string;
  status: "OPEN" | "CLEARED" | "CONFIRMED";
  statusLabel: string;
  signalLabels: string[];
  note: string | null;
  reviewedAt: Date | null;
  reviewerUsername: string | null;
  createdAt: Date;
  user: { name: string; username: string; email: string };
  relatedUsers: { username: string }[];
}

const NOTE_MIN_LENGTH = 10;

/**
 * Anti-fraud review queue. It only closes a case with a written reason and never
 * touches a balance: `CONFIRMED` marks the account for the normal suspension or
 * withdrawal controls, so a human keeps the final decision on the money.
 */
export function AdminFraudQueue({ rows, canDecide }: { rows: FraudCaseRow[]; canDecide: boolean }) {
  const router = useRouter();
  const [notes, setNotes] = React.useState<Record<string, string>>({});
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  async function decide(row: FraudCaseRow, decision: FraudDecision) {
    const note = (notes[row.id] ?? "").trim();
    if (note.length < NOTE_MIN_LENGTH) {
      setMessage(null);
      setError("Tuliskan alasan minimal 10 karakter sebelum menutup kasus.");
      return;
    }

    setPendingId(row.id);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/admin/fraud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: row.id, decision, note }),
      });
      const payload = (await response.json()) as { ok: boolean; message?: string };
      if (!response.ok || !payload.ok) {
        setError(payload.message ?? "Keputusan tinjauan tidak dapat disimpan.");
        return;
      }
      setMessage(`Kasus @${row.user.username} ditutup: ${FRAUD_DECISION_LABELS[decision]}.`);
      setNotes((state) => ({ ...state, [row.id]: "" }));
      router.refresh();
    } catch {
      setError("Tidak dapat menghubungi server. Coba lagi.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Antrean tinjauan anti-fraud</CardTitle>
        <CardDescription>
          Sinyal berikut hanya penanda untuk diperiksa manusia. Kesamaan IP atau nomor rekening
          belum membuktikan apa pun: periksa bukti sebelum menutup kasus.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="danger" title="Gagal menyimpan">
            {error}
          </Alert>
        ) : null}
        {message ? (
          <Alert variant="success" title="Tersimpan">
            {message}
          </Alert>
        ) : null}

        {rows.length === 0 ? (
          <p className="text-sm text-white/50">Tidak ada kasus anti-fraud yang menunggu tinjauan.</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((row) => (
              <li
                key={row.id}
                className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={row.status === "OPEN" ? "danger" : "muted"}>
                    {row.statusLabel}
                  </Badge>
                  <span className="font-medium text-white/85">
                    {row.user.name} · @{row.user.username}
                  </span>
                  <span className="text-xs text-white/45">{row.user.email}</span>
                  <span className="text-xs text-white/40">
                    Terdaftar {formatPaymentDate(row.createdAt)}
                  </span>
                </div>

                <ul className="mt-3 flex flex-wrap gap-2">
                  {row.signalLabels.map((label) => (
                    <li key={label}>
                      <Badge variant="gold">
                        <ShieldAlert className="size-3.5" aria-hidden />
                        {label}
                      </Badge>
                    </li>
                  ))}
                </ul>

                {row.relatedUsers.length > 0 ? (
                  <p className="mt-2 text-xs text-white/45">
                    Akun terkait: {row.relatedUsers.map((user) => `@${user.username}`).join(", ")}
                  </p>
                ) : null}

                {row.status === "OPEN" ? (
                  canDecide ? (
                    <div className="mt-3 space-y-2">
                      <textarea
                        aria-label={`Alasan tinjauan untuk @${row.user.username}`}
                        value={notes[row.id] ?? ""}
                        onChange={(event) =>
                          setNotes((state) => ({ ...state, [row.id]: event.target.value }))
                        }
                        rows={2}
                        maxLength={500}
                        placeholder="Alasan keputusan (wajib, minimal 10 karakter)"
                        className="w-full rounded-lg border border-white/12 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/35 focus-visible:border-[var(--color-neon)]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-neon)]/25"
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          disabled={pendingId === row.id}
                          onClick={() => decide(row, "CLEARED")}
                        >
                          {pendingId === row.id ? (
                            <Loader2 className="animate-spin" aria-hidden />
                          ) : (
                            <ShieldCheck aria-hidden />
                          )}
                          {FRAUD_DECISION_LABELS.CLEARED}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={pendingId === row.id}
                          onClick={() => decide(row, "CONFIRMED")}
                        >
                          <ShieldAlert aria-hidden />
                          {FRAUD_DECISION_LABELS.CONFIRMED}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-white/45">
                      Anda hanya dapat membaca antrean ini. Keputusan hanya untuk Super Admin atau
                      Kepatuhan.
                    </p>
                  )
                ) : (
                  <p className="mt-3 text-xs text-white/45">
                    {row.reviewerUsername ? `Ditutup oleh @${row.reviewerUsername}` : "Ditutup"}
                    {row.reviewedAt ? ` · ${formatPaymentDate(row.reviewedAt)}` : ""}
                    {row.note ? ` · ${row.note}` : ""}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

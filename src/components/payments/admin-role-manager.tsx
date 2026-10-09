"use client";

import { Loader2, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { formatPaymentDate } from "@/components/payments/status-badge";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export interface AdministratorRow {
  id: string;
  username: string;
  name: string;
  email: string;
  status: string;
  adminRole: string | null;
  createdAt: Date;
}

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Tanpa peran (hanya baca antrean)" },
  { value: "SUPER_ADMIN", label: "Super Admin — seluruh izin" },
  { value: "FINANCE", label: "Keuangan — setoran, penarikan, kredit" },
  { value: "COMPLIANCE", label: "Kepatuhan — tinjau & tandai setoran" },
  { value: "SUPPORT", label: "Dukungan — hanya baca" },
  { value: "VIEWER", label: "Pengamat — hanya baca" },
];

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  FINANCE: "Keuangan",
  COMPLIANCE: "Kepatuhan",
  SUPPORT: "Dukungan",
  VIEWER: "Pengamat",
};

/**
 * Administrator role administration (SUPER_ADMIN only).
 *
 * The permission itself is re-checked inside the server service, so a FINANCE or
 * SUPPORT account that somehow reached this component still cannot change a role.
 */
export function AdminRoleManager({ administrators }: { administrators: AdministratorRow[] }) {
  const router = useRouter();
  const [selection, setSelection] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  async function assign(userId: string) {
    const raw = selection[userId];
    if (raw === undefined) return;

    setPending(userId);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/admin/users/role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role: raw === "" ? null : raw }),
      });
      const payload = (await response.json()) as { ok: boolean; message?: string };
      if (!response.ok || !payload.ok) {
        setError(payload.message ?? "Peran administrator tidak dapat disimpan.");
        return;
      }
      setMessage("Peran administrator tersimpan dan tercatat pada jejak audit.");
      router.refresh();
    } catch {
      setError("Gangguan jaringan. Silakan coba lagi.");
    } finally {
      setPending(null);
    }
  }

  return (
    <Card id="peran-admin">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-[var(--color-neon)]" aria-hidden />
          Peran administrator
        </CardTitle>
        <CardDescription>
          Administrator baru tidak memiliki kemampuan finansial sampai peran diberikan secara
          eksplisit. Setiap perubahan dicatat pada jejak audit.
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

        {administrators.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-6 text-center text-sm text-white/60">
            Belum ada akun dengan peran ADMIN.
          </p>
        ) : (
          <ul className="space-y-3">
            {administrators.map((row) => {
              const current = row.adminRole ?? "";
              const selected = selection[row.id] ?? current;
              return (
                <li key={row.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">
                        {row.name}{" "}
                        <span className="font-mono text-xs text-white/60">@{row.username}</span>
                      </p>
                      <p className="break-all text-[11px] text-white/55">{row.email}</p>
                      <p className="mt-1 text-[11px] text-white/50">
                        Terdaftar {formatPaymentDate(row.createdAt)}
                      </p>
                    </div>
                    <Badge variant={row.adminRole ? "default" : "muted"}>
                      {row.adminRole ? (ROLE_LABELS[row.adminRole] ?? row.adminRole) : "Tanpa peran"}
                    </Badge>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <label
                      className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60"
                      htmlFor={`role-${row.id}`}
                    >
                      Peran admin
                    </label>
                    <select
                      id={`role-${row.id}`}
                      value={selected}
                      onChange={(event) =>
                        setSelection((state) => ({ ...state, [row.id]: event.target.value }))
                      }
                      className="h-10 rounded-xl border border-white/12 bg-white/[0.04] px-3 text-sm text-white focus-visible:border-[var(--color-neon)]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-neon)]/25"
                    >
                      {ROLE_OPTIONS.map((option) => (
                        <option
                          key={option.value || "none"}
                          value={option.value}
                          className="bg-[#04070a]"
                        >
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending !== null || selected === current}
                      onClick={() => assign(row.id)}
                    >
                      {pending === row.id ? <Loader2 className="animate-spin" aria-hidden /> : null}
                      Simpan peran
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

import Link from "next/link";
import type { Metadata } from "next";

import { OwnerShell } from "@/components/owner/owner-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requireOwnerPage } from "@/lib/auth/owner-guard";
import { listOwnerAudit } from "@/lib/services/owner-console-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Jejak audit" };

const PAGE_SIZE = 50;

function formatJson(value: unknown): string {
  if (value === null || value === undefined) return "—";
  try {
    const text = JSON.stringify(value);
    return text.length > 400 ? `${text.slice(0, 400)}…` : text;
  } catch {
    return "—";
  }
}

/**
 * Jejak audit lengkap. Saringan dikerjakan database (`action`, `entityType`,
 * `actor`), dan sebelum/sesudah ditampilkan apa adanya sebagai JSON ringkas —
 * pemilik dapat melihat nilai lama dan baru tanpa membuka database.
 */
export default async function OwnerAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; entityType?: string; actor?: string; page?: string }>;
}) {
  const owner = await requireOwnerPage("/owner/audit");
  const params = await searchParams;

  const action = (params.action ?? "").trim();
  const entityType = (params.entityType ?? "").trim();
  const actor = (params.actor ?? "").trim();
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const result = await listOwnerAudit({
    action: action || undefined,
    entityType: entityType || undefined,
    actor: actor || undefined,
    take: PAGE_SIZE,
    skip: (page - 1) * PAGE_SIZE,
  });

  const pageCount = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const query = (next: number) => {
    const search = new URLSearchParams();
    if (action) search.set("action", action);
    if (entityType) search.set("entityType", entityType);
    if (actor) search.set("actor", actor);
    if (next > 1) search.set("page", String(next));
    const suffix = search.toString();
    return suffix ? `/owner/audit?${suffix}` : "/owner/audit";
  };

  return (
    <OwnerShell
      active="/owner/audit"
      title="Jejak audit"
      description="Setiap tindakan administrator, perubahan konfigurasi, keputusan setoran/penarikan, dan peristiwa passkey pemilik tercatat di sini beserta pelaku, alamat IP, dan waktu."
      ownerLabel={`@${owner.username}`}
    >
      <Card>
        <CardHeader>
          <CardTitle>Saringan</CardTitle>
          <CardDescription>
            {result.total} catatan cocok. Saringan berlaku pada database, bukan pada halaman.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form method="get" className="grid gap-3 sm:grid-cols-4 sm:items-end">
            <div className="space-y-1.5">
              <label
                htmlFor="audit-action"
                className="block text-xs font-semibold uppercase tracking-[0.14em] text-white/45"
              >
                Aksi
              </label>
              <Input id="audit-action" name="action" defaultValue={action} placeholder="deposit.approved" />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="audit-entity"
                className="block text-xs font-semibold uppercase tracking-[0.14em] text-white/45"
              >
                Jenis entitas
              </label>
              <Input
                id="audit-entity"
                name="entityType"
                defaultValue={entityType}
                placeholder="WithdrawalRequest"
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="audit-actor"
                className="block text-xs font-semibold uppercase tracking-[0.14em] text-white/45"
              >
                Pelaku
              </label>
              <Input id="audit-actor" name="actor" defaultValue={actor} placeholder="nama pengguna / surel" />
            </div>
            <div className="flex gap-2">
              <Button type="submit">Terapkan</Button>
              <Link
                href="/owner/audit"
                className="self-center text-xs text-white/60 underline-offset-4 hover:underline"
              >
                Bersihkan
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Catatan</CardTitle>
          <CardDescription>
            Halaman {Math.min(page, pageCount)} dari {pageCount}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {result.rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-6 text-center text-sm text-white/50">
              Tidak ada catatan audit yang cocok.
            </p>
          ) : (
            <ul className="space-y-2">
              {result.rows.map((row) => (
                <li key={row.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-mono text-white/90">{row.action}</span>
                    <span className="text-white/50">
                      {row.actorUsername ? `@${row.actorUsername}` : "sistem"} · {row.entityType}
                      {row.entityId ? ` · ${row.entityId.slice(0, 8)}` : ""}
                    </span>
                    <span className="text-white/40">
                      {new Date(row.createdAt).toLocaleString("id-ID")} ·{" "}
                      {row.ipAddress ?? "IP tidak tercatat"}
                    </span>
                  </div>
                  {row.before !== null || row.after !== null ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-[var(--color-neon)]">
                        Sebelum / sesudah
                      </summary>
                      <pre className="mt-2 overflow-x-auto rounded-lg border border-white/10 bg-black/30 p-3 text-[11px] text-white/70">
                        {`sebelum: ${formatJson(row.before)}\nsesudah: ${formatJson(row.after)}`}
                      </pre>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between gap-3">
            {page > 1 ? (
              <Link
                href={query(page - 1)}
                className="text-xs font-semibold text-[var(--color-neon)] underline-offset-4 hover:underline"
              >
                ← Halaman sebelumnya
              </Link>
            ) : (
              <span />
            )}
            {page < pageCount ? (
              <Link
                href={query(page + 1)}
                className="text-xs font-semibold text-[var(--color-neon)] underline-offset-4 hover:underline"
              >
                Halaman berikutnya →
              </Link>
            ) : (
              <span />
            )}
          </div>
        </CardContent>
      </Card>
    </OwnerShell>
  );
}

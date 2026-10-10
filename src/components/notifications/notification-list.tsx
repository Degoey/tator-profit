"use client";

import { CheckCheck, ExternalLink, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { formatPaymentDate } from "@/components/payments/status-badge";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  /** Unread rows are highlighted; a row without `readAt` is unread. */
  readAt: Date | null;
  createdAt: Date;
  /**
   * In-site target written by the service that created the notification, e.g.
   * `/deposit`. Only site-relative paths reach this field — the page validates
   * them through `notificationHref` before rendering.
   */
  href?: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  SYSTEM: "Sistem",
  PROGRAM: "Program",
  REWARD: "Imbalan",
  REFERRAL: "Rujukan",
  SECURITY: "Keamanan",
};

/**
 * Notification inbox. Marking as read goes through `PATCH /api/notifications`,
 * which scopes the update to the session user, so the button cannot affect any
 * other account's rows.
 */
export function NotificationList({ rows }: { rows: NotificationRow[] }) {
  const router = useRouter();
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function markRead(id?: string) {
    setPending(id ?? "all");
    setError(null);
    try {
      const response = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(id ? { id } : {}),
      });
      const payload = (await response.json()) as { ok: boolean; message?: string };
      if (!response.ok || !payload.ok) {
        setError(payload.message ?? "Notifikasi tidak dapat diperbarui saat ini.");
        return;
      }
      router.refresh();
    } catch {
      setError("Gangguan jaringan. Silakan coba lagi.");
    } finally {
      setPending(null);
    }
  }

  /**
   * Following the link of a notification counts as having read it: the same PATCH
   * endpoint is called, but with `keepalive` so the request survives the
   * navigation the click starts. If it is dropped the row simply stays unread —
   * nothing is lost, the member can still mark it by hand.
   */
  function markReadOnFollow(id: string) {
    void fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
      keepalive: true,
    }).catch(() => undefined);
  }

  const unread = rows.filter((row) => !row.readAt);

  return (
    <div className="space-y-4">
      {error ? (
        <Alert variant="danger" title="Gagal memperbarui">
          {error}
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-white/60">
          {unread.length} dari {rows.length} notifikasi belum dibaca.
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending !== null || unread.length === 0}
          onClick={() => markRead()}
        >
          {pending === "all" ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <CheckCheck aria-hidden />
          )}
          Tandai semua dibaca
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-6 text-center text-sm text-white/60">
          Belum ada notifikasi. Pemberitahuan setoran, penarikan, imbalan, dan keamanan akan muncul
          di sini.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li
              key={row.id}
              className={
                row.readAt
                  ? "rounded-xl border border-white/10 bg-white/[0.02] p-4"
                  : "rounded-xl border border-[var(--color-neon)]/30 bg-[var(--color-neon)]/[0.06] p-4"
              }
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={row.readAt ? "muted" : "default"}>
                      {TYPE_LABELS[row.type] ?? row.type}
                    </Badge>
                    {!row.readAt ? <Badge variant="gold">Baru</Badge> : null}
                  </div>
                  <p className="text-sm font-semibold text-white">{row.title}</p>
                  <p className="text-sm leading-relaxed text-white/70">{row.body}</p>
                  <p className="text-[11px] text-white/50">{formatPaymentDate(row.createdAt)}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {row.href ? (
                    <Button asChild size="sm" variant="outline">
                      <Link
                        href={row.href}
                        onClick={row.readAt ? undefined : () => markReadOnFollow(row.id)}
                      >
                        <ExternalLink aria-hidden />
                        Lihat detail
                      </Link>
                    </Button>
                  ) : null}

                  {!row.readAt ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={pending !== null}
                      onClick={() => markRead(row.id)}
                    >
                      {pending === row.id ? <Loader2 className="animate-spin" aria-hidden /> : null}
                      Tandai dibaca
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

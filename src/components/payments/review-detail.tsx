import type { ReactNode } from "react";

import { formatPaymentDate } from "@/components/payments/status-badge";

export interface RequestAuditEntry {
  id: string;
  action: string;
  actorUsername: string | null;
  createdAt: Date | string;
}

/**
 * Per-request audit history shown inside the review dialogs: every state change
 * of one deposit/withdrawal, newest first.
 */
export function RequestAuditList({ entries }: { entries: RequestAuditEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-xs text-white/45">Belum ada catatan audit untuk permintaan ini.</p>;
  }

  return (
    <ol className="space-y-2">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2"
        >
          <span className="font-mono text-[11px] text-[var(--color-neon)]">{entry.action}</span>
          <span className="text-[11px] text-white/45">
            {entry.actorUsername ? `@${entry.actorUsername}` : "Sistem"} ·{" "}
            {formatPaymentDate(entry.createdAt)}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Read-only label/value block used by the admin review detail dialogs. */
export function DetailItem({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
        {label}
      </dt>
      <dd
        className={
          accent
            ? "mt-1 text-sm font-semibold text-[var(--color-gold)]"
            : "mt-1 text-sm font-semibold text-white"
        }
      >
        {value}
      </dd>
    </div>
  );
}

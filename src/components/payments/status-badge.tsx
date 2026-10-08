import { Badge } from "@/components/ui/badge";

type BadgeVariant = "default" | "gold" | "muted" | "danger";

interface StatusMeta {
  label: string;
  variant: BadgeVariant;
}

/**
 * Indonesian display labels for the manual payment workflow statuses.
 * Stored enum values stay in English so the database, API and audit trail keep
 * stable, language independent codes.
 */
export const PAYMENT_STATUS_LABELS: Record<string, StatusMeta> = {
  UNDER_REVIEW: { label: "Sedang ditinjau", variant: "gold" },
  APPROVED: { label: "Disetujui", variant: "default" },
  PROCESSING: { label: "Sedang diproses", variant: "gold" },
  COMPLETED: { label: "Selesai", variant: "default" },
  REJECTED: { label: "Ditolak", variant: "danger" },
  FLAGGED: { label: "Ditandai", variant: "danger" },
  PENDING: { label: "Menunggu", variant: "gold" },
  ACTIVE: { label: "Aktif", variant: "default" },
  CANCELLED: { label: "Dibatalkan", variant: "muted" },
  SUSPENDED: { label: "Ditangguhkan", variant: "danger" },
};

export function paymentStatusLabel(status: string): string {
  return PAYMENT_STATUS_LABELS[status]?.label ?? status;
}

export function PaymentStatusBadge({ status }: { status: string }) {
  const meta = PAYMENT_STATUS_LABELS[status] ?? { label: status, variant: "muted" as BadgeVariant };
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

/** Short human readable timestamp used in tables and detail dialogs. */
export function formatPaymentDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

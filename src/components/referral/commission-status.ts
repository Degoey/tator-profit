import { statusLabel } from "@/lib/status-labels";

/**
 * Indonesian labels for the referral commission statuses.
 *
 * The five lifecycle values (PENDING -> APPROVED -> PAID, plus REJECTED / VOID)
 * are the same codes the reward engine uses, so the wording comes from the shared
 * `@/lib/status-labels` module instead of a second table that could drift apart
 * from it. The referral feature keeps only the badge tone mapping of its own.
 */
export const REFERRAL_COMMISSION_STATUS_LABELS: Record<string, string> = {
  PENDING: statusLabel("PENDING"),
  APPROVED: statusLabel("APPROVED"),
  PAID: statusLabel("PAID"),
  REJECTED: statusLabel("REJECTED"),
  VOID: statusLabel("VOID"),
};

/** Falls back to the raw code when a new status is added to the database first. */
export function referralCommissionStatusLabel(status: string): string {
  return REFERRAL_COMMISSION_STATUS_LABELS[status] ?? status;
}

export type ReferralCommissionTone = "default" | "gold" | "muted" | "danger";

/** Badge tone per commission status, so the table stays readable at a glance. */
export function referralCommissionStatusTone(status: string): ReferralCommissionTone {
  switch (status) {
    case "PAID":
      return "default";
    case "APPROVED":
      return "gold";
    case "REJECTED":
    case "VOID":
      return "danger";
    default:
      return "muted";
  }
}

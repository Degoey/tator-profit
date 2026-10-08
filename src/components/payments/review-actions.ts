/**
 * Review action tokens accepted by the admin review endpoints.
 * Kept in a plain module (no "use client") so the server page can compute the
 * capability-filtered action list and hand it to the client dialogs.
 */
export const DEPOSIT_REVIEW_ACTION_VALUES = [
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
  "FLAGGED",
] as const;

export const WITHDRAWAL_REVIEW_ACTION_VALUES = [
  "UNDER_REVIEW",
  "APPROVED",
  "PROCESSING",
  "COMPLETED",
  "REJECTED",
] as const;

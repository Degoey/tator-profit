/**
 * Referral commission lifecycle vocabulary shared by the admin API route, the
 * admin panel and the service layer.
 *
 * Kept free of any dependency (no zod, no Prisma) so a client component can
 * import it without pulling a server-only schema into the browser bundle. The
 * allowed transitions below mirror `COMMISSION_ALLOWED_FROM` in
 * `@/lib/services/referral-service`, which is the component that actually
 * enforces them inside the database transaction.
 */
export const COMMISSION_ACTIONS = ["APPROVE", "PAY", "REJECT", "VOID"] as const;

export type CommissionAction = (typeof COMMISSION_ACTIONS)[number];

/** Statuses from which each action is permitted. */
export const COMMISSION_ALLOWED_FROM: Record<CommissionAction, readonly string[]> = {
  APPROVE: ["PENDING"],
  PAY: ["APPROVED"],
  REJECT: ["PENDING", "APPROVED"],
  VOID: ["PENDING", "APPROVED"],
};

/** Indonesian action labels used by the confirmation dialog. */
export const COMMISSION_ACTION_LABELS: Record<CommissionAction, string> = {
  APPROVE: "Setujui komisi",
  PAY: "Bayar komisi",
  REJECT: "Tolak komisi",
  VOID: "Batalkan komisi",
};

/** Rejection and cancellation must explain themselves, exactly like the service requires. */
export function commissionActionRequiresReason(action: CommissionAction): boolean {
  return action === "REJECT" || action === "VOID";
}

/** Actions a commission in `status` may still receive; a terminal row returns none. */
export function commissionActionsForStatus(status: string): CommissionAction[] {
  return COMMISSION_ACTIONS.filter((action) => COMMISSION_ALLOWED_FROM[action].includes(status));
}

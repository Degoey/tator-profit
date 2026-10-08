import type { AdminRole } from "@prisma/client";

export type AdminPermission = "read" | "readProof" | "reviewDeposit" | "reviewWithdrawal" | "manageFinance";

/** Missing role is deliberately denied; no implicit super-admin fallback. */
export function canAdmin(role: AdminRole | null | undefined, permission: AdminPermission): boolean {
  if (!role) return false;
  if (permission === "read" || permission === "readProof") return true;
  return role === "SUPER_ADMIN" || role === "FINANCE";
}

export function canReviewDepositAction(role: AdminRole | null | undefined, action: string): boolean {
  if (canAdmin(role, "reviewDeposit")) return true;
  return role === "COMPLIANCE" && (action === "FLAGGED" || action === "UNDER_REVIEW");
}

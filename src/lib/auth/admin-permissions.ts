import type { AdminRole } from "@prisma/client";

/**
 * Explicit administrator capability matrix (Tahap 2).
 *
 * Every capability is written down per role instead of being derived from an
 * `if (role === ...)` chain, so the policy can be read, tested and shown in the
 * UI without guessing. The rules that the whole platform relies on:
 *
 *  - money only moves for SUPER_ADMIN and FINANCE (`reviewDeposit`,
 *    `reviewWithdrawal`, `manageFinance`, `creditBalance`);
 *  - COMPLIANCE may investigate (start a review, flag) but may never approve,
 *    reject or credit;
 *  - SUPPORT may read the queues so it can answer members, nothing more;
 *  - VIEWER is read-only and does not even open private payment proofs;
 *  - the audit trail and the anti-fraud queue are limited to SUPER_ADMIN,
 *    FINANCE and COMPLIANCE, and only SUPER_ADMIN/COMPLIANCE may close a
 *    fraud case (`reviewFraud`); FINANCE may read it but never decide it.
 */
export type AdminPermission =
  | "read"
  | "readProof"
  | "readAudit"
  | "reviewDeposit"
  | "reviewWithdrawal"
  | "manageFinance"
  | "creditBalance"
  | "manageUsers"
  | "readFraud"
  | "reviewFraud";

export const ADMIN_PERMISSIONS: readonly AdminPermission[] = [
  "read",
  "readProof",
  "readAudit",
  "reviewDeposit",
  "reviewWithdrawal",
  "manageFinance",
  "creditBalance",
  "manageUsers",
  "readFraud",
  "reviewFraud",
];

export const ADMIN_ROLE_PERMISSIONS: Record<AdminRole, readonly AdminPermission[]> = {
  SUPER_ADMIN: [...ADMIN_PERMISSIONS],
  FINANCE: [
    "read",
    "readProof",
    "readAudit",
    "reviewDeposit",
    "reviewWithdrawal",
    "manageFinance",
    "creditBalance",
    "readFraud",
  ],
  COMPLIANCE: ["read", "readProof", "readAudit", "readFraud", "reviewFraud"],
  SUPPORT: ["read", "readProof"],
  VIEWER: ["read"],
};

/** Missing role is deliberately denied; no implicit super-admin fallback. */
export function canAdmin(role: AdminRole | null | undefined, permission: AdminPermission): boolean {
  if (!role) return false;
  return ADMIN_ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/** Capabilities of one role, for the admin screen and for tests. */
export function adminPermissionsOf(role: AdminRole | null | undefined): readonly AdminPermission[] {
  if (!role) return [];
  return ADMIN_ROLE_PERMISSIONS[role] ?? [];
}

/**
 * Deposit review is the one action that COMPLIANCE may partly perform: it can
 * move a request to UNDER_REVIEW or FLAGGED, but approving or rejecting money
 * stays with SUPER_ADMIN/FINANCE.
 */
export function canReviewDepositAction(role: AdminRole | null | undefined, action: string): boolean {
  if (canAdmin(role, "reviewDeposit")) return true;
  return role === "COMPLIANCE" && (action === "FLAGGED" || action === "UNDER_REVIEW");
}

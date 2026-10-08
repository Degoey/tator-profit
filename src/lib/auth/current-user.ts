import type { AdminRole } from "@prisma/client";
import { redirect } from "next/navigation";

import { canAdmin, type AdminPermission } from "@/lib/auth/admin-permissions";
import { getActiveSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export interface CurrentUser {
  id: string;
  name: string;
  username: string;
  email: string;
  phone: string;
  role: "USER" | "ADMIN";
  /** Null for administrators that have no explicit admin role yet. */
  adminRole: AdminRole | null;
  status: "ACTIVE" | "SUSPENDED" | "CLOSED";
  createdAt: Date;
  lastLoginAt: Date | null;
  referralCode: string | null;
  referredBy: { username: string; level: number } | null;
  balance: {
    currency: string;
    availableAmount: string;
    pendingAmount: string;
    totalEarned: string;
  };
}

/** Loads the signed-in user (with profile, referral parent and balance) or `null`. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getActiveSession();
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      phone: true,
      role: true,
      status: true,
      adminRole: true,
      createdAt: true,
      lastLoginAt: true,
      profile: { select: { referralCode: true } },
      balance: {
        select: {
          currency: true,
          availableAmount: true,
          pendingAmount: true,
          totalEarned: true,
        },
      },
      referredByEntry: {
        select: { level: true, referrer: { select: { username: true } } },
      },
    },
  });

  if (!user || user.status !== "ACTIVE") return null;

  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    phone: user.phone,
    role: user.role,
    adminRole: user.adminRole,
    status: user.status,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    referralCode: user.profile?.referralCode ?? null,
    referredBy: user.referredByEntry
      ? { username: user.referredByEntry.referrer.username, level: user.referredByEntry.level }
      : null,
    balance: {
      currency: user.balance?.currency ?? "USDT",
      availableAmount: (user.balance?.availableAmount ?? 0).toFixed(2),
      pendingAmount: (user.balance?.pendingAmount ?? 0).toFixed(2),
      totalEarned: (user.balance?.totalEarned ?? 0).toFixed(2),
    },
  };
}

/** Server-side guard for protected pages: redirects guests to `/login`. */
export async function requireUser(returnTo = "/dashboard"): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  }
  return user;
}

/** Server-side guard for admin-only areas. */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser("/admin");
  if (user.role !== "ADMIN") {
    redirect("/dashboard?error=forbidden");
  }
  return user;
}

/**
 * Server-side guard for admin areas that need one specific capability.
 * Administrators without an explicit admin role are denied (fail closed).
 */
export async function requireAdminCapability(permission: AdminPermission): Promise<CurrentUser> {
  const user = await requireAdmin();
  if (!canAdmin(user.adminRole, permission)) {
    redirect("/dashboard?error=forbidden");
  }
  return user;
}

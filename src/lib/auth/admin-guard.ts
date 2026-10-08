import type { AdminRole } from "@prisma/client";
import { canAdmin, type AdminPermission } from "@/lib/auth/admin-permissions";
import { getActiveSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export interface AdminActor {
  id: string;
  username: string;
  /** Null until an administrator grants an explicit admin role; fails closed. */
  adminRole: AdminRole | null;
}

/**
 * Resolves the signed-in administrator for API routes.
 * Returns `null` for guests, non-admin accounts and inactive accounts.
 */
export async function getAdminActor(): Promise<AdminActor | null> {
  const session = await getActiveSession();
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, username: true, role: true, status: true, adminRole: true },
  });

  if (!user || user.role !== "ADMIN" || user.status !== "ACTIVE") return null;
  return { id: user.id, username: user.username, adminRole: user.adminRole };
}

/**
 * Resolves an administrator that additionally holds the given capability.
 * Permission checks live here so every admin API route shares one policy.
 */
export async function requireAdminPermission(
  permission: AdminPermission,
): Promise<AdminActor | null> {
  const actor = await getAdminActor();
  if (!actor) return null;
  return canAdmin(actor.adminRole, permission) ? actor : null;
}


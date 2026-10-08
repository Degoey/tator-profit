import type { AdminRole, Prisma } from "@prisma/client";

import { canAdmin } from "@/lib/auth/admin-permissions";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/security";

/**
 * Admin role administration.
 *
 * `User.role = ADMIN` only says "this account may reach the admin area".
 * What it may actually do is decided by `User.adminRole`, which is null by
 * default so a new administrator has no financial capability until a
 * SUPER_ADMIN grants one explicitly.
 */

export class AdminRoleError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "AdminRoleError";
    this.code = code;
    this.status = status;
  }
}

export interface AssignAdminRoleInput {
  targetUserId: string;
  role: AdminRole | null;
  actorUserId: string;
  actorAdminRole: AdminRole | null;
  meta?: RequestMeta;
}

/** Grants, changes or clears the admin role of one administrator account. */
export async function assignAdminRole(input: AssignAdminRoleInput) {
  if (input.actorAdminRole !== "SUPER_ADMIN") {
    throw new AdminRoleError(
      "FORBIDDEN",
      "Hanya SUPER_ADMIN yang dapat mengubah peran administrator.",
      403,
    );
  }

  return prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({
      where: { id: input.targetUserId },
      select: { id: true, username: true, role: true, adminRole: true },
    });
    if (!target) {
      throw new AdminRoleError("USER_NOT_FOUND", "Akun tidak ditemukan.", 404);
    }
    if (target.role !== "ADMIN") {
      throw new AdminRoleError(
        "NOT_AN_ADMIN",
        "Peran administrator hanya dapat diberikan kepada akun dengan peran ADMIN.",
        409,
      );
    }
    if (target.adminRole === input.role) {
      return { userId: target.id, adminRole: target.adminRole, changed: false };
    }
    if (target.id === input.actorUserId && input.role !== "SUPER_ADMIN") {
      throw new AdminRoleError(
        "CANNOT_DEMOTE_SELF",
        "Anda tidak dapat mencabut peran SUPER_ADMIN milik sendiri.",
        409,
      );
    }

    const updated = await tx.user.update({
      where: { id: target.id },
      data: { adminRole: input.role },
      select: { id: true, adminRole: true },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        action: "admin.role_assigned",
        entityType: "User",
        entityId: target.id,
        before: { adminRole: target.adminRole },
        after: { adminRole: updated.adminRole, username: target.username },
        ipAddress: input.meta?.ipAddress ?? null,
        userAgent: input.meta?.userAgent ?? null,
      },
    });

    return { userId: updated.id, adminRole: updated.adminRole, changed: true };
  });
}

/** Administrators with their current role, for the admin role screen. */
export async function listAdministrators(take = 100) {
  const rows = await prisma.user.findMany({
    where: { role: "ADMIN" },
    orderBy: [{ adminRole: "asc" }, { username: "asc" }],
    take,
    select: {
      id: true,
      username: true,
      name: true,
      email: true,
      status: true,
      adminRole: true,
      createdAt: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    name: row.name,
    email: row.email,
    status: row.status,
    adminRole: row.adminRole,
    canReviewFinance: canAdmin(row.adminRole, "reviewDeposit"),
    createdAt: row.createdAt,
  }));
}

export type AdminAuditLogWhere = Prisma.AuditLogWhereInput;

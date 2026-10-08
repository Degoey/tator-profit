import type { Prisma, SecurityEventType, SecuritySeverity } from "@prisma/client";
import { headers } from "next/headers";

import { prisma } from "@/lib/prisma";

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

/** Best-effort client metadata from the incoming request headers. */
export async function getRequestMeta(): Promise<RequestMeta> {
  try {
    const headerList = await headers();
    const forwardedFor = headerList.get("x-forwarded-for");
    const ipAddress =
      forwardedFor?.split(",")[0]?.trim() ?? headerList.get("x-real-ip") ?? null;
    return { ipAddress, userAgent: headerList.get("user-agent") };
  } catch {
    return { ipAddress: null, userAgent: null };
  }
}

export interface SecurityEventInput {
  userId?: string | null;
  type: SecurityEventType;
  severity?: SecuritySeverity;
  description?: string;
  metadata?: Prisma.InputJsonValue;
  meta?: RequestMeta;
}

/** Persists a security relevant event (login, logout, failed attempt, ...). */
export async function recordSecurityEvent(input: SecurityEventInput): Promise<void> {
  const meta = input.meta ?? (await getRequestMeta());
  try {
    await prisma.securityEvent.create({
      data: {
        userId: input.userId ?? null,
        type: input.type,
        severity: input.severity ?? "INFO",
        description: input.description,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: input.metadata,
      },
    });
  } catch (error) {
    console.error("Gagal mencatat peristiwa keamanan", error);
  }
}

export interface AuditLogInput {
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  meta?: RequestMeta;
}

/**
 * Persists an audit trail entry (referral changes, config changes, admin actions).
 * IP address and user agent are stored together with the before/after snapshots so
 * a financial decision can always be traced back to the request that produced it.
 */
export async function recordAuditLog(input: AuditLogInput): Promise<void> {
  const meta = input.meta ?? (await getRequestMeta());
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        before: input.before,
        after: input.after,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
    });
  } catch (error) {
    console.error("Gagal mencatat log audit", error);
  }
}

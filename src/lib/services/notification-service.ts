import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * Notification helpers shared by the inbox and the member pages that a
 * notification points at.
 *
 * A notification is written inside the same transaction that produced it, so
 * every row is guaranteed to describe something that really happened. What the
 * row *cannot* do by itself is take the member anywhere: the target page is
 * therefore carried in `metadata.href`, written by the service that creates the
 * notification. Nothing here ever builds a link from user input, and only
 * site-relative paths are accepted, so a corrupted row can never turn into an
 * off-site or `javascript:` navigation.
 */

/** Reads the `metadata` JSON object of a notification as a plain record. */
export function notificationMetadata(
  metadata: Prisma.JsonValue | null | undefined,
): Record<string, Prisma.JsonValue> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  return metadata as Record<string, Prisma.JsonValue>;
}

/** A metadata value as a non-empty string, or `null` when it is anything else. */
export function notificationMetadataString(
  metadata: Prisma.JsonValue | null | undefined,
  key: string,
): string | null {
  const value = notificationMetadata(metadata)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * The in-site target of a notification, or `null` when it has none.
 *
 * Only `"/"`-prefixed paths are returned: an absolute URL, a protocol-relative
 * `//host` URL, a `javascript:`/`data:` scheme or a malformed value is treated
 * as "no link" rather than being rendered into an `href`.
 */
export function notificationHref(
  metadata: Prisma.JsonValue | null | undefined,
): string | null {
  const href = notificationMetadataString(metadata, "href");
  if (!href || !href.startsWith("/") || href.startsWith("//")) return null;
  return href;
}

export interface DepositApprovalNotice {
  /** Notification marking as read clears the notice on /deposit. */
  notificationId: string;
  depositId: string | null;
  /** Amount already formatted with 2 decimals, when the row carries it. */
  amount: string | null;
  currency: string | null;
  href: string | null;
}

/**
 * Newest unread notification that announces an *approved* deposit.
 *
 * Older rows were written before `metadata.href` existed, so the amount and the
 * link may be missing; the notice is then rendered without them instead of
 * showing a wrong number. Rows without a `depositId` (program join/activation
 * announcements, which share the `PROGRAM` type) never qualify.
 */
export async function getUnreadDepositApprovalNotice(
  userId: string,
): Promise<DepositApprovalNotice | null> {
  // Filtered in the database on `metadata -> 'status'`, so a newer unrelated
  // notification (a program join, for example) cannot hide an unread approval.
  const row = await prisma.notification.findFirst({
    where: {
      userId,
      readAt: null,
      type: "PROGRAM",
      metadata: { path: ["status"], equals: "APPROVED" },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, metadata: true },
  });
  if (!row) return null;

  const depositId = notificationMetadataString(row.metadata, "depositId");
  if (!depositId) return null;

  return {
    notificationId: row.id,
    depositId,
    amount: notificationMetadataString(row.metadata, "amount"),
    currency: notificationMetadataString(row.metadata, "currency"),
    href: notificationHref(row.metadata),
  };
}

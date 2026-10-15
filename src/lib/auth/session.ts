import { cookies } from "next/headers";

import { generateOpaqueToken, hashToken } from "@/lib/auth/tokens";
import { isProductionLikeEnvironment } from "@/lib/config/production-environment";
import { prisma } from "@/lib/prisma";

export const SESSION_COOKIE_NAME = "tatorprofit_session";
export const SESSION_TTL_DAYS = 30;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

export interface SessionRequestContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface CreatedSession {
  token: string;
  expiresAt: Date;
  sessionId: string;
}

/** Creates a database backed session and writes the httpOnly cookie. */
export async function createSession(
  userId: string,
  context: SessionRequestContext = {},
): Promise<CreatedSession> {
  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
      lastUsedAt: new Date(),
    },
    select: { id: true },
  });

  const cookieStore = await cookies();
  cookieStore.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    /**
     * Staging juga disajikan lewat HTTPS, jadi ia harus menandai cookie sebagai
     * `Secure` persis seperti produksi — sebelumnya hanya `NODE_ENV=production`
     * yang melakukannya.
     */
    secure: isProductionLikeEnvironment(process.env),
    path: "/",
    expires: expiresAt,
  });

  return { token, expiresAt, sessionId: session.id };
}

export interface ActiveSession {
  id: string;
  userId: string;
  expiresAt: Date;
  /**
   * Waktu sesi ini terakhir lolos verifikasi kode 2FA pemilik (step-up).
   * `null` berarti belum pernah; hanya Konsol Pemilik yang membacanya.
   */
  totpVerifiedAt: Date | null;
}

/** Resolves the current session from the cookie, or `null` when absent/expired. */
export async function getActiveSession(): Promise<ActiveSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      revokedAt: true,
      lastUsedAt: true,
      totpVerifiedAt: true,
      user: { select: { status: true } },
    },
  });

  if (!session || session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  if (session.user.status !== "ACTIVE") return null;

  const lastUsedAt = session.lastUsedAt?.getTime() ?? 0;
  if (Date.now() - lastUsedAt > 5 * 60 * 1000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } });
  }

  return {
    id: session.id,
    userId: session.userId,
    expiresAt: session.expiresAt,
    totpVerifiedAt: session.totpVerifiedAt,
  };
}

/** Revokes the current session and clears the cookie. */
export async function destroyCurrentSession(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    await prisma.session.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  cookieStore.delete(SESSION_COOKIE_NAME);
  return token ? hashToken(token) : null;
}

/** Revokes every session of a user (used after password changes / admin actions). */
export async function revokeUserSessions(userId: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/**
 * Menandai sesi ini lolos verifikasi kode 2FA pemilik (step-up).
 * Hanya dipanggil oleh `owner-2fa-service` setelah kode diverifikasi.
 */
export async function markSessionOwnerVerified(sessionId: string, at: Date = new Date()): Promise<void> {
  await prisma.session.update({ where: { id: sessionId }, data: { totpVerifiedAt: at } });
}

/**
 * Mencabut status verifikasi 2FA dari seluruh sesi satu pengguna — dipakai saat
 * 2FA dimatikan/didaftarkan ulang supaya sesi lama tidak tetap "terverifikasi".
 */
export async function clearUserSessionVerifications(userId: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, totpVerifiedAt: { not: null } },
    data: { totpVerifiedAt: null },
  });
  return result.count;
}

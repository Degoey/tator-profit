import { Prisma } from "@prisma/client";

import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { generateOpaqueToken, hashToken } from "@/lib/auth/tokens";
import { PROGRAM_CURRENCY } from "@/lib/config/program";
import { prisma } from "@/lib/prisma";
import { recordAuditLog, recordSecurityEvent, type RequestMeta } from "@/lib/security";
import {
  createReferral,
  findReferrerByCode,
  generateUniqueReferralCode,
  ReferralError,
} from "@/lib/services/referral-service";
import type { LoginInput, RegisterInput } from "@/lib/validation";

export class AuthError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fieldErrors?: Record<string, string>;

  constructor(
    code: string,
    message: string,
    options?: { status?: number; fieldErrors?: Record<string, string> },
  ) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.status = options?.status ?? 400;
    this.fieldErrors = options?.fieldErrors;
  }
}

function uniqueViolationFields(error: unknown): string[] | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const target = error.meta?.target;
    if (Array.isArray(target)) return target.map((item) => String(item));
    if (typeof target === "string") return [target];
    return [];
  }
  return null;
}

export interface RegisterResult {
  userId: string;
  username: string;
  email: string;
  referralCode: string;
  referredByUserId: string | null;
}

/**
 * Creates a real, persistent account: user row, profile (with share code),
 * balance, optional referral relationship, welcome notification and audit trail.
 * All writes happen inside a single transaction.
 */
export async function registerUser(
  input: RegisterInput,
  meta: RequestMeta,
): Promise<RegisterResult> {
  const existing = await prisma.user.findFirst({
    where: {
      OR: [{ username: input.username }, { email: input.email }, { phone: input.phone }],
    },
    select: { username: true, email: true, phone: true },
  });

  if (existing) {
    const fieldErrors: Record<string, string> = {};
    if (existing.username === input.username) fieldErrors.username = "Nama pengguna sudah digunakan.";
    if (existing.email === input.email) fieldErrors.email = "Surel sudah terdaftar.";
    if (existing.phone === input.phone) fieldErrors.phone = "Nomor telepon sudah terdaftar.";
    throw new AuthError("DUPLICATE_ACCOUNT", "Akun dengan data ini sudah ada.", {
      status: 409,
      fieldErrors,
    });
  }

  let referrerId: string | null = null;
  let referralCodeUsed: string | null = null;

  if (input.referralCode) {
    const referrer = await findReferrerByCode(input.referralCode);
    if (!referrer) {
      throw new AuthError("INVALID_REFERRAL_CODE", "Kode referral tidak ditemukan.", {
        status: 422,
        fieldErrors: { referralCode: "Kode referral tidak ditemukan." },
      });
    }
    referrerId = referrer.userId;
    referralCodeUsed = referrer.referralCode;
  }

  const passwordHash = await hashPassword(input.password);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: input.name,
          username: input.username,
          email: input.email,
          phone: input.phone,
          passwordHash,
          role: "USER",
          status: "ACTIVE",
        },
        select: { id: true, username: true, email: true },
      });

      const profileReferralCode = await generateUniqueReferralCode(input.username, tx);

      await tx.profile.create({
        data: {
          userId: user.id,
          referralCode: profileReferralCode,
          displayName: input.name,
        },
      });

      await tx.balance.create({
        data: { userId: user.id, currency: PROGRAM_CURRENCY },
      });

      if (referrerId && referralCodeUsed) {
        await createReferral(tx, {
          referrerId,
          referredUserId: user.id,
          codeUsed: referralCodeUsed,
        });
      }

      await tx.notification.create({
        data: {
          userId: user.id,
          type: "SYSTEM",
          title: "Selamat datang di Tatorprofit",
          body:
            "Akun Anda sudah aktif. Pilih paket gabung untuk memulai program imbalan Anda. " +
            "Imbalan mengikuti ketentuan program dan bukan jaminan hasil.",
        },
      });

      await tx.securityEvent.create({
        data: {
          userId: user.id,
          type: "LOGIN_SUCCESS",
          severity: "INFO",
          description: "Akun dibuat",
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: "user.register",
          entityType: "User",
          entityId: user.id,
          after: {
            username: user.username,
            email: user.email,
            referredBy: referrerId,
            referralCode: profileReferralCode,
          },
          ipAddress: meta.ipAddress,
        },
      });

      return {
        userId: user.id,
        username: user.username,
        email: user.email,
        referralCode: profileReferralCode,
        referredByUserId: referrerId,
      } satisfies RegisterResult;
    });

    await recordAuditLog({
      actorUserId: result.userId,
      action: "user.register.completed",
      entityType: "User",
      entityId: result.userId,
      meta,
    });

    return result;
  } catch (error) {
    const fields = uniqueViolationFields(error);
    if (fields) {
      const fieldErrors: Record<string, string> = {};
      if (fields.includes("username")) fieldErrors.username = "Nama pengguna sudah digunakan.";
      if (fields.includes("email")) fieldErrors.email = "Surel sudah terdaftar.";
      if (fields.includes("phone")) fieldErrors.phone = "Nomor telepon sudah terdaftar.";
      if (fields.includes("referralCode")) fieldErrors.referralCode = "Konflik kode rujukan.";
      throw new AuthError("DUPLICATE_ACCOUNT", "Akun dengan data ini sudah ada.", {
        status: 409,
        fieldErrors,
      });
    }
    if (error instanceof ReferralError) {
      throw new AuthError(error.code, error.message, { status: 422 });
    }
    throw error;
  }
}

export interface AuthenticatedUser {
  id: string;
  name: string;
  username: string;
  email: string;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED" | "CLOSED";
}

/** Verifies credentials against the database. */
export async function authenticateUser(
  input: LoginInput,
  meta: RequestMeta,
): Promise<AuthenticatedUser> {
  const identifier = input.identifier.trim().toLowerCase();
  const user = await prisma.user.findFirst({
    where: { OR: [{ username: identifier }, { email: identifier }] },
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      role: true,
      status: true,
      passwordHash: true,
    },
  });

  if (!user) {
    await recordSecurityEvent({
      type: "LOGIN_FAILED",
      severity: "WARNING",
      description: `Identifier tidak dikenal: ${identifier}`,
      meta,
    });
    throw new AuthError("INVALID_CREDENTIALS", "Nama pengguna/email atau kata sandi salah.", {
      status: 401,
    });
  }

  const passwordValid = await verifyPassword(input.password, user.passwordHash);
  if (!passwordValid) {
    await recordSecurityEvent({
      userId: user.id,
      type: "LOGIN_FAILED",
      severity: "WARNING",
      description: "Kata sandi salah",
      meta,
    });
    throw new AuthError("INVALID_CREDENTIALS", "Nama pengguna/email atau kata sandi salah.", {
      status: 401,
    });
  }

  if (user.status !== "ACTIVE") {
    await recordSecurityEvent({
      userId: user.id,
      type: "LOGIN_FAILED",
      severity: "CRITICAL",
      description: `Masuk diblokir, status akun: ${user.status}`,
      meta,
    });
    throw new AuthError("ACCOUNT_INACTIVE", "Akun ini tidak aktif. Hubungi dukungan.", {
      status: 403,
    });
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    role: user.role,
    status: user.status,
  };
}

export interface PasswordResetRequestResult {
  requested: boolean;
  /**
   * Only populated when the operator explicitly enables the local development
   * switch (`ALLOW_DEV_RESET_TOKEN=1`, never allowed in production). Reset tokens
   * are otherwise delivered out of band and are never returned by the API.
   */
  devToken?: string;
  expiresAt?: Date;
}

/**
 * Forgot-password structure: always reports success (no account enumeration) and
 * stores a hashed, single-use token when the email matches a real account.
 */
export async function requestPasswordReset(
  email: string,
  meta: RequestMeta,
): Promise<PasswordResetRequestResult> {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, status: true },
  });

  if (!user || user.status !== "ACTIVE") {
    return { requested: true };
  }

  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    await tx.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt },
    });
    await tx.notification.create({
      data: {
        userId: user.id,
        type: "SECURITY",
        title: "Permintaan reset kata sandi",
        body: "Ada permintaan reset kata sandi untuk akun Anda. Jika ini bukan Anda, hubungi dukungan.",
      },
    });
  });

  await recordSecurityEvent({
    userId: user.id,
    type: "PASSWORD_RESET_REQUESTED",
    severity: "WARNING",
    description: "Token reset kata sandi diterbitkan",
    meta,
  });

  /**
   * A reset token is a credential: it is never returned by default. The only
   * exception is an explicit, local-development opt-in that is impossible in
   * production, so the reset flow can still be verified without a mail provider.
   */
  const exposeToken =
    process.env.ALLOW_DEV_RESET_TOKEN === "1" && process.env.NODE_ENV !== "production";

  return {
    requested: true,
    devToken: exposeToken ? token : undefined,
    expiresAt: exposeToken ? expiresAt : undefined,
  };
}

export interface ResetPasswordResult {
  userId: string;
}

/** Completes a password reset and revokes every existing session. */
export async function resetPasswordWithToken(
  token: string,
  newPassword: string,
  meta: RequestMeta,
): Promise<ResetPasswordResult> {
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });

  if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()) {
    throw new AuthError("INVALID_RESET_TOKEN", "Tautan reset ini tidak valid atau sudah kedaluwarsa.", {
      status: 422,
    });
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
    await tx.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    await tx.session.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: record.userId,
        action: "user.password.reset",
        entityType: "User",
        entityId: record.userId,
        ipAddress: meta.ipAddress,
      },
    });
  });

  await recordSecurityEvent({
    userId: record.userId,
    type: "PASSWORD_CHANGED",
    severity: "WARNING",
    description: "Atur ulang kata sandi selesai",
    meta,
  });

  return { userId: record.userId };
}

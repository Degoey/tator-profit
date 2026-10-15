import { isOwnerAccount } from "@/lib/config/owner";
import { markSessionOwnerVerified, clearUserSessionVerifications } from "@/lib/auth/session";
import {
  consumeRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCodes,
  recoveryHashesFromJson,
} from "@/lib/owner/recovery-codes";
import { decryptOwnerSecret, encryptOwnerSecret, OwnerSecretError } from "@/lib/owner/secret-box";
import {
  generateTotpSecret,
  otpauthUri,
  verifyTotpCode,
} from "@/lib/owner/totp";
import { prisma } from "@/lib/prisma";
import { recordAuditLog, recordSecurityEvent, type RequestMeta } from "@/lib/security";

/**
 * Layanan 2FA Konsol Pemilik.
 *
 * Semua aturan 2FA hidup di sini, bukan di UI: UI hanya mencerminkan keputusan
 * server. Tiga hal yang dijaga modul ini:
 *
 *  - **Rahasia tidak pernah disimpan apa adanya.** Rahasia TOTP dienkripsi
 *    AES-256-GCM (`src/lib/owner/secret-box.ts`); kalau `OWNER_2FA_KEY` belum
 *    diisi, pendaftaran gagal alih-alih menyimpan rahasia tanpa pelindung.
 *  - **Satu kode hanya sekali.** Langkah TOTP terakhir yang terpakai dicatat di
 *    `User.ownerTotpLastStep`, jadi kode yang sama tidak dapat dipakai ulang
 *    walau masih di dalam jendela toleransi.
 *  - **Setiap peristiwa meninggalkan jejak.** Pendaftaran, verifikasi, kegagalan,
 *    pemakaian kode pemulihan, dan penonaktifan menulis jejak audit, dan
 *    keberhasilan/kegagalan verifikasi juga menulis peristiwa keamanan.
 */

export const OWNER_TOTP_ISSUER = "Tatorprofit Pemilik";

export class OwnerTotpError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "OwnerTotpError";
    this.code = code;
    this.status = status;
  }
}

interface OwnerSecurityRow {
  id: string;
  username: string;
  email: string;
  role: string;
  adminRole: string | null;
  status: string;
  ownerTotpSecret: string | null;
  ownerTotpEnabledAt: Date | null;
  ownerTotpRecoveryCodes: unknown;
  ownerTotpLastStep: number | null;
}

/**
 * Memuat akun pemilik dan menolak akun lain. Konsol pemilik hanya untuk satu
 * akun, jadi layanan ini pun memeriksa hal yang sama seperti penjaga halaman —
 * rute API tidak dapat dipakai oleh akun lain walau permintaannya disusun manual.
 */
async function loadOwnerRow(userId: string): Promise<OwnerSecurityRow> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      adminRole: true,
      status: true,
      ownerTotpSecret: true,
      ownerTotpEnabledAt: true,
      ownerTotpRecoveryCodes: true,
      ownerTotpLastStep: true,
    },
  });

  if (!user || user.status !== "ACTIVE" || !isOwnerAccount(user)) {
    throw new OwnerTotpError("FORBIDDEN", "Akses konsol pemilik diperlukan.", 403);
  }
  return user;
}

function mapSecretError(error: unknown): never {
  if (error instanceof OwnerSecretError) {
    throw new OwnerTotpError(error.code, error.message, error.code === "OWNER_2FA_KEY_MISSING" ? 503 : 409);
  }
  throw error;
}

export interface OwnerTotpStatus {
  enabled: boolean;
  enabledAt: string | null;
  pendingEnrollment: boolean;
  remainingRecoveryCodes: number;
}

/**
 * Sepuluh sesi terakhir milik pemilik beserta penanda kedaluwarsa.
 *
 * Penghitungan waktu dilakukan di lapisan layanan (bukan di dalam komponen)
 * supaya render tetap murni — komponen hanya membaca `expired` yang sudah jadi.
 */
export type OwnerSessionSummary = {
  id: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date;
  revokedAt: Date | null;
  ipAddress: string | null;
  userAgent: string | null;
  totpVerifiedAt: Date | null;
  expired: boolean;
};

export async function listOwnerSessions(
  userId: string,
  take = 10,
): Promise<OwnerSessionSummary[]> {
  const rows = await prisma.session.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    select: {
      id: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
      ipAddress: true,
      userAgent: true,
      totpVerifiedAt: true,
    },
  });

  const now = Date.now();
  return rows.map((row) => ({
    ...row,
    expired: !row.revokedAt && row.expiresAt.getTime() <= now,
  }));
}

export async function ownerTotpStatus(userId: string): Promise<OwnerTotpStatus> {
  const user = await loadOwnerRow(userId);
  return {
    enabled: Boolean(user.ownerTotpSecret) && Boolean(user.ownerTotpEnabledAt),
    enabledAt: user.ownerTotpEnabledAt ? user.ownerTotpEnabledAt.toISOString() : null,
    pendingEnrollment: Boolean(user.ownerTotpSecret) && !user.ownerTotpEnabledAt,
    remainingRecoveryCodes: recoveryHashesFromJson(user.ownerTotpRecoveryCodes).length,
  };
}

export interface BeginEnrollmentInput {
  userId: string;
  meta: RequestMeta;
}

export interface BeginEnrollmentResult {
  secret: string;
  otpauthUri: string;
  account: string;
  issuer: string;
}

/**
 * Mulai pendaftaran: membuat rahasia baru dan menyimpannya (terenkripsi) sebagai
 * *belum aktif*. 2FA baru berlaku setelah pemilik memasukkan satu kode yang sah.
 */
export async function beginOwnerTotpEnrollment(
  input: BeginEnrollmentInput,
): Promise<BeginEnrollmentResult> {
  const user = await loadOwnerRow(input.userId);

  if (user.ownerTotpSecret && user.ownerTotpEnabledAt) {
    throw new OwnerTotpError(
      "OWNER_2FA_ALREADY_ENABLED",
      "2FA sudah aktif. Nonaktifkan dulu sebelum mendaftarkan perangkat baru.",
      409,
    );
  }

  const secret = generateTotpSecret();
  let encrypted: string;
  try {
    encrypted = encryptOwnerSecret(secret);
  } catch (error) {
    mapSecretError(error);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      ownerTotpSecret: encrypted,
      ownerTotpEnabledAt: null,
      ownerTotpRecoveryCodes: [],
      ownerTotpLastStep: null,
    },
  });

  await recordAuditLog({
    actorUserId: user.id,
    action: "owner.2fa.enrollment_started",
    entityType: "User",
    entityId: user.id,
    after: { issuer: OWNER_TOTP_ISSUER, account: user.email },
    meta: input.meta,
  });

  return {
    secret,
    otpauthUri: otpauthUri({ secret, account: user.email, issuer: OWNER_TOTP_ISSUER }),
    account: user.email,
    issuer: OWNER_TOTP_ISSUER,
  };
}

export interface ActivateEnrollmentInput {
  userId: string;
  code: string;
  meta: RequestMeta;
}

export interface ActivateEnrollmentResult {
  enabledAt: string;
  recoveryCodes: string[];
}

/** Menyelesaikan pendaftaran setelah satu kode TOTP yang sah diverifikasi. */
export async function activateOwnerTotp(
  input: ActivateEnrollmentInput,
): Promise<ActivateEnrollmentResult> {
  const user = await loadOwnerRow(input.userId);
  if (!user.ownerTotpSecret) {
    throw new OwnerTotpError(
      "OWNER_2FA_NOT_STARTED",
      "Pendaftaran 2FA belum dimulai. Mulai pendaftaran terlebih dahulu.",
      409,
    );
  }
  if (user.ownerTotpEnabledAt) {
    throw new OwnerTotpError("OWNER_2FA_ALREADY_ENABLED", "2FA sudah aktif.", 409);
  }

  let secret: string;
  try {
    secret = decryptOwnerSecret(user.ownerTotpSecret);
  } catch (error) {
    mapSecretError(error);
  }

  const match = verifyTotpCode(secret, input.code);
  if (!match) {
    await recordOwnerFailure({
      userId: user.id,
      action: "owner.2fa.enrollment_failed",
      description: "Kode pendaftaran 2FA pemilik salah",
      meta: input.meta,
    });
    throw new OwnerTotpError("OWNER_2FA_INVALID", "Kode 2FA tidak sah atau sudah kedaluwarsa.", 401);
  }

  const recoveryCodes = generateRecoveryCodes();
  const enabledAt = new Date();

  await prisma.user.update({
    where: { id: user.id },
    data: {
      ownerTotpEnabledAt: enabledAt,
      ownerTotpRecoveryCodes: hashRecoveryCodes(recoveryCodes),
      ownerTotpLastStep: match.counter,
    },
  });

  await recordAuditLog({
    actorUserId: user.id,
    action: "owner.2fa.enrolled",
    entityType: "User",
    entityId: user.id,
    after: { enabledAt: enabledAt.toISOString(), recoveryCodeCount: recoveryCodes.length },
    meta: input.meta,
  });
  await recordSecurityEvent({
    userId: user.id,
    type: "PASSWORD_CHANGED",
    severity: "INFO",
    description: "2FA Konsol Pemilik didaftarkan",
    meta: input.meta,
  });

  return { enabledAt: enabledAt.toISOString(), recoveryCodes };
}

async function recordOwnerFailure(input: {
  userId: string;
  action: string;
  description: string;
  meta: RequestMeta;
}): Promise<void> {
  await recordAuditLog({
    actorUserId: input.userId,
    action: input.action,
    entityType: "User",
    entityId: input.userId,
    meta: input.meta,
  });
  await recordSecurityEvent({
    userId: input.userId,
    type: "LOGIN_FAILED",
    severity: "WARNING",
    description: input.description,
    meta: input.meta,
  });
}

export interface VerifyStepUpInput {
  userId: string;
  sessionId: string;
  code?: string;
  recoveryCode?: string;
  meta: RequestMeta;
}

export interface VerifyStepUpResult {
  usedRecoveryCode: boolean;
  remainingRecoveryCodes: number;
  verifiedAt: string;
}

/**
 * Memverifikasi sesi ini dengan kode TOTP (atau kode pemulihan sekali-pakai).
 * Setelah berhasil, sesi ditandai `totpVerifiedAt` sehingga Konsol Pemilik dapat
 * dibuka tanpa mengulang kode pada setiap halaman.
 */
export async function verifyOwnerStepUp(input: VerifyStepUpInput): Promise<VerifyStepUpResult> {
  const user = await loadOwnerRow(input.userId);

  if (!user.ownerTotpSecret || !user.ownerTotpEnabledAt) {
    throw new OwnerTotpError(
      "OWNER_2FA_NOT_ENROLLED",
      "2FA belum aktif. Daftarkan perangkat autentikator terlebih dahulu.",
      409,
    );
  }

  const recoveryInput = (input.recoveryCode ?? "").trim();
  const codeInput = (input.code ?? "").trim();

  if (recoveryInput.length > 0) {
    const hashes = recoveryHashesFromJson(user.ownerTotpRecoveryCodes);
    const result = consumeRecoveryCode(hashes, recoveryInput);
    if (!result.matched) {
      await recordOwnerFailure({
        userId: user.id,
        action: "owner.2fa.step_up_failed",
        description: "Kode pemulihan 2FA pemilik tidak sah",
        meta: input.meta,
      });
      throw new OwnerTotpError("OWNER_2FA_INVALID", "Kode pemulihan tidak sah.", 401);
    }

    const verifiedAt = new Date();
    await prisma.user.update({
      where: { id: user.id },
      data: { ownerTotpRecoveryCodes: result.remaining },
    });
    await markSessionOwnerVerified(input.sessionId, verifiedAt);

    await recordAuditLog({
      actorUserId: user.id,
      action: "owner.2fa.recovery_used",
      entityType: "User",
      entityId: user.id,
      after: { remainingRecoveryCodes: result.remaining.length },
      meta: input.meta,
    });
    await recordSecurityEvent({
      userId: user.id,
      type: "LOGIN_SUCCESS",
      severity: "WARNING",
      description: "Konsol Pemilik dibuka dengan kode pemulihan",
      meta: input.meta,
    });

    return {
      usedRecoveryCode: true,
      remainingRecoveryCodes: result.remaining.length,
      verifiedAt: verifiedAt.toISOString(),
    };
  }

  if (codeInput.length === 0) {
    throw new OwnerTotpError("OWNER_2FA_CODE_REQUIRED", "Masukkan kode 2FA.", 422);
  }

  let secret: string;
  try {
    secret = decryptOwnerSecret(user.ownerTotpSecret);
  } catch (error) {
    mapSecretError(error);
  }

  const match = verifyTotpCode(secret, codeInput, { lastUsedCounter: user.ownerTotpLastStep });
  if (!match) {
    await recordOwnerFailure({
      userId: user.id,
      action: "owner.2fa.step_up_failed",
      description: "Kode 2FA pemilik tidak sah",
      meta: input.meta,
    });
    throw new OwnerTotpError("OWNER_2FA_INVALID", "Kode 2FA tidak sah atau sudah kedaluwarsa.", 401);
  }

  const verifiedAt = new Date();
  await prisma.user.update({
    where: { id: user.id },
    data: { ownerTotpLastStep: match.counter },
  });
  await markSessionOwnerVerified(input.sessionId, verifiedAt);

  await recordAuditLog({
    actorUserId: user.id,
    action: "owner.2fa.step_up",
    entityType: "User",
    entityId: user.id,
    after: { verifiedAt: verifiedAt.toISOString() },
    meta: input.meta,
  });
  await recordSecurityEvent({
    userId: user.id,
    type: "LOGIN_SUCCESS",
    severity: "INFO",
    description: "Konsol Pemilik dibuka dengan kode 2FA",
    meta: input.meta,
  });

  return {
    usedRecoveryCode: false,
    remainingRecoveryCodes: recoveryHashesFromJson(user.ownerTotpRecoveryCodes).length,
    verifiedAt: verifiedAt.toISOString(),
  };
}

export interface DisableTotpInput {
  userId: string;
  code?: string;
  recoveryCode?: string;
  meta: RequestMeta;
}

/**
 * Mematikan 2FA pemilik. Wajib disertai kode yang sah, dan seluruh sesi pemilik
 * kehilangan status verifikasi setelahnya — jadi mematikan 2FA tidak membuka
 * pintu bagi sesi lama yang mungkin sudah dicuri.
 */
export async function disableOwnerTotp(input: DisableTotpInput): Promise<{ disabledAt: string }> {
  const user = await loadOwnerRow(input.userId);
  if (!user.ownerTotpSecret || !user.ownerTotpEnabledAt) {
    throw new OwnerTotpError("OWNER_2FA_NOT_ENROLLED", "2FA belum aktif.", 409);
  }

  await assertOwnerCode({
    user,
    code: input.code,
    recoveryCode: input.recoveryCode,
    action: "owner.2fa.disable_failed",
    failureDescription: "Percobaan mematikan 2FA pemilik dengan kode salah",
    meta: input.meta,
  });

  const disabledAt = new Date();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      ownerTotpSecret: null,
      ownerTotpEnabledAt: null,
      ownerTotpRecoveryCodes: [],
      ownerTotpLastStep: null,
    },
  });
  await clearUserSessionVerifications(user.id);

  await recordAuditLog({
    actorUserId: user.id,
    action: "owner.2fa.disabled",
    entityType: "User",
    entityId: user.id,
    before: { enabledAt: user.ownerTotpEnabledAt.toISOString() },
    after: { disabledAt: disabledAt.toISOString() },
    meta: input.meta,
  });
  await recordSecurityEvent({
    userId: user.id,
    type: "PASSWORD_CHANGED",
    severity: "WARNING",
    description: "2FA Konsol Pemilik dimatikan",
    meta: input.meta,
  });

  return { disabledAt: disabledAt.toISOString() };
}

export interface RegenerateRecoveryInput {
  userId: string;
  code?: string;
  recoveryCode?: string;
  meta: RequestMeta;
}

export async function regenerateOwnerRecoveryCodes(
  input: RegenerateRecoveryInput,
): Promise<{ recoveryCodes: string[] }> {
  const user = await loadOwnerRow(input.userId);
  if (!user.ownerTotpSecret || !user.ownerTotpEnabledAt) {
    throw new OwnerTotpError("OWNER_2FA_NOT_ENROLLED", "2FA belum aktif.", 409);
  }

  await assertOwnerCode({
    user,
    code: input.code,
    recoveryCode: input.recoveryCode,
    action: "owner.2fa.recovery_regenerate_failed",
    failureDescription: "Percobaan membuat ulang kode pemulihan dengan kode salah",
    meta: input.meta,
  });

  const recoveryCodes = generateRecoveryCodes();
  await prisma.user.update({
    where: { id: user.id },
    data: { ownerTotpRecoveryCodes: hashRecoveryCodes(recoveryCodes) },
  });

  await recordAuditLog({
    actorUserId: user.id,
    action: "owner.2fa.recovery_regenerated",
    entityType: "User",
    entityId: user.id,
    after: { recoveryCodeCount: recoveryCodes.length },
    meta: input.meta,
  });

  return { recoveryCodes };
}

/**
 * Menerima kode TOTP **atau** kode pemulihan dan melempar `OwnerTotpError` bila
 * keduanya tidak sah. Dipakai aksi sensitif yang tidak mengubah 2FA itu sendiri.
 */
async function assertOwnerCode(input: {
  user: OwnerSecurityRow;
  code?: string;
  recoveryCode?: string;
  action: string;
  failureDescription: string;
  meta: RequestMeta;
}): Promise<void> {
  const recoveryInput = (input.recoveryCode ?? "").trim();
  const codeInput = (input.code ?? "").trim();

  if (recoveryInput.length > 0) {
    const result = consumeRecoveryCode(
      recoveryHashesFromJson(input.user.ownerTotpRecoveryCodes),
      recoveryInput,
    );
    if (result.matched) {
      await prisma.user.update({
        where: { id: input.user.id },
        data: { ownerTotpRecoveryCodes: result.remaining },
      });
      return;
    }
    await recordOwnerFailure({
      userId: input.user.id,
      action: input.action,
      description: input.failureDescription,
      meta: input.meta,
    });
    throw new OwnerTotpError("OWNER_2FA_INVALID", "Kode pemulihan tidak sah.", 401);
  }

  if (!input.user.ownerTotpSecret) {
    throw new OwnerTotpError("OWNER_2FA_NOT_ENROLLED", "2FA belum aktif.", 409);
  }

  let secret: string;
  try {
    secret = decryptOwnerSecret(input.user.ownerTotpSecret);
  } catch (error) {
    mapSecretError(error);
  }

  const match = verifyTotpCode(secret, codeInput, { lastUsedCounter: input.user.ownerTotpLastStep });
  if (!match) {
    await recordOwnerFailure({
      userId: input.user.id,
      action: input.action,
      description: input.failureDescription,
      meta: input.meta,
    });
    throw new OwnerTotpError("OWNER_2FA_INVALID", "Kode 2FA tidak sah atau sudah kedaluwarsa.", 401);
  }

  await prisma.user.update({
    where: { id: input.user.id },
    data: { ownerTotpLastStep: match.counter },
  });
}

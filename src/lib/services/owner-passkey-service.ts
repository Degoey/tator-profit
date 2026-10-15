import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";

import { clearUserSessionVerifications, markSessionOwnerVerified } from "@/lib/auth/session";
import {
  isOwnerAccount,
  ownerWebAuthnOrigin,
  ownerWebAuthnRpId,
  ownerWebAuthnRpName,
} from "@/lib/config/owner";
import { prisma } from "@/lib/prisma";
import { recordAuditLog, recordSecurityEvent, type RequestMeta } from "@/lib/security";

/**
 * Layanan passkey (WebAuthn) Konsol Pemilik.
 *
 * Menggantikan 2FA berbasis kode sepenuhnya. Semua aturan hidup di sini, bukan di
 * UI: UI hanya mencerminkan keputusan server. Tiga hal yang dijaga modul ini:
 *
 *  - **Tidak ada rahasia bersama yang disimpan.** Yang tersimpan hanya kunci
 *    publik dan penghitung tanda tangan; kunci privat tidak pernah meninggalkan
 *    perangkat pemilik. Karena itu salinan database tidak cukup untuk meniru
 *    verifikasi.
 *  - **Tantangan sekali pakai.** Tantangan WebAuthn yang sedang berjalan disimpan
 *    di `User.ownerPasskeyChallenge`, ditimpa pada setiap langkah, dan dibersihkan
 *    setelah dipakai — sehingga balasan lama tidak dapat diputar ulang.
 *  - **Setiap peristiwa meninggalkan jejak.** Pendaftaran, verifikasi, kegagalan,
 *    dan penghapusan kredensial menulis jejak audit; keberhasilan/kegagalan
 *    verifikasi juga menulis peristiwa keamanan.
 */

export class OwnerPasskeyError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "OwnerPasskeyError";
    this.code = code;
    this.status = status;
  }
}

/** Transport yang dikenali WebAuthn; nilai lain dari database diabaikan. */
const KNOWN_TRANSPORTS = new Set<AuthenticatorTransportFuture>([
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb",
]);

function toTransports(values: string[]): AuthenticatorTransportFuture[] {
  return values.filter((value): value is AuthenticatorTransportFuture =>
    KNOWN_TRANSPORTS.has(value as AuthenticatorTransportFuture),
  );
}

interface OwnerRow {
  id: string;
  name: string;
  username: string;
  email: string;
  role: string;
  adminRole: string | null;
  status: string;
  ownerPasskeyChallenge: string | null;
}

/**
 * Memuat akun pemilik dan menolak akun lain. Konsol pemilik hanya untuk satu akun,
 * jadi layanan ini pun memeriksa hal yang sama seperti penjaga halaman — rute API
 * tidak dapat dipakai oleh akun lain walau permintaannya disusun manual.
 */
async function loadOwnerRow(userId: string): Promise<OwnerRow> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      role: true,
      adminRole: true,
      status: true,
      ownerPasskeyChallenge: true,
    },
  });

  if (!user || user.status !== "ACTIVE" || !isOwnerAccount(user)) {
    throw new OwnerPasskeyError("FORBIDDEN", "Akses konsol pemilik diperlukan.", 403);
  }
  return user;
}

async function recordPasskeyFailure(input: {
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

export interface OwnerPasskeyStatus {
  enabled: boolean;
  credentialCount: number;
}

/** Apakah pemilik sudah mendaftarkan minimal satu passkey. */
export async function ownerPasskeyStatus(userId: string): Promise<OwnerPasskeyStatus> {
  const user = await loadOwnerRow(userId);
  const credentialCount = await prisma.ownerPasskey.count({ where: { userId: user.id } });
  return { enabled: credentialCount > 0, credentialCount };
}

export interface OwnerPasskeySummary {
  id: string;
  credentialId: string;
  friendlyName: string | null;
  deviceType: string;
  backedUp: boolean;
  transports: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
}

/** Daftar kredensial passkey pemilik, terbaru lebih dulu. */
export async function listOwnerPasskeys(userId: string): Promise<OwnerPasskeySummary[]> {
  const user = await loadOwnerRow(userId);
  const rows = await prisma.ownerPasskey.findMany({
    where: { userId: user.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      credentialId: true,
      friendlyName: true,
      deviceType: true,
      backedUp: true,
      transports: true,
      createdAt: true,
      lastUsedAt: true,
    },
  });
  return rows;
}

/**
 * Sepuluh sesi terakhir milik pemilik beserta penanda kedaluwarsa.
 *
 * Penghitungan waktu dilakukan di lapisan layanan (bukan di dalam komponen)
 * supaya render tetap murni — komponen hanya membaca `expired` yang sudah jadi.
 * Kolom `totpVerifiedAt` tetap dipakai sebagai penanda "sesi ini sudah lolos
 * verifikasi kedua" (kini passkey), jadi namanya sengaja tidak diubah.
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

export interface BeginPasskeyRegistrationInput {
  userId: string;
  meta: RequestMeta;
}

/**
 * Mulai pendaftaran passkey: membuat opsi pendaftaran WebAuthn dan menyimpan
 * tantangannya. Pendaftaran baru sah setelah peramban mengembalikan balasan yang
 * ditandatangani dan `completePasskeyRegistration` memverifikasinya.
 */
export async function beginPasskeyRegistration(
  input: BeginPasskeyRegistrationInput,
): Promise<Awaited<ReturnType<typeof generateRegistrationOptions>>> {
  const user = await loadOwnerRow(input.userId);

  const existing = await prisma.ownerPasskey.findMany({
    where: { userId: user.id },
    select: { credentialId: true, transports: true },
  });

  const options = await generateRegistrationOptions({
    rpName: ownerWebAuthnRpName(),
    rpID: ownerWebAuthnRpId(),
    userID: new TextEncoder().encode(user.id),
    userName: user.email,
    userDisplayName: user.name,
    attestationType: "none",
    /**
     * Pendaftaran ulang pada authenticator yang sama dicegah lewat
     * `excludeCredentials`, tetapi pendaftaran perangkat **tambahan** tetap
     * diizinkan. Verifikasi pengguna (sidik jari/PIN) diwajibkan.
     */
    excludeCredentials: existing.map((row) => ({
      id: row.credentialId,
      transports: toTransports(row.transports),
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
    },
    timeout: 60_000,
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { ownerPasskeyChallenge: options.challenge },
  });

  await recordAuditLog({
    actorUserId: user.id,
    action: "owner.passkey.registration_started",
    entityType: "User",
    entityId: user.id,
    after: { rpId: ownerWebAuthnRpId(), credentialCount: existing.length },
    meta: input.meta,
  });

  return options;
}

export interface CompletePasskeyRegistrationInput {
  userId: string;
  response: RegistrationResponseJSON;
  friendlyName?: string;
  meta: RequestMeta;
}

export interface CompletePasskeyRegistrationResult {
  credentialId: string;
  friendlyName: string | null;
  deviceType: string;
  backedUp: boolean;
  registeredAt: string;
}

/** Menyelesaikan pendaftaran setelah balasan attestation diverifikasi. */
export async function completePasskeyRegistration(
  input: CompletePasskeyRegistrationInput,
): Promise<CompletePasskeyRegistrationResult> {
  const user = await loadOwnerRow(input.userId);
  const expectedChallenge = user.ownerPasskeyChallenge;
  if (!expectedChallenge) {
    throw new OwnerPasskeyError(
      "OWNER_PASSKEY_CHALLENGE_MISSING",
      "Pendaftaran sidik jari harus dimulai ulang.",
      409,
    );
  }

  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge,
      expectedOrigin: ownerWebAuthnOrigin(),
      expectedRPID: ownerWebAuthnRpId(),
      requireUserVerification: true,
    });
  } catch {
    await prisma.user.update({ where: { id: user.id }, data: { ownerPasskeyChallenge: null } });
    await recordPasskeyFailure({
      userId: user.id,
      action: "owner.passkey.registration_failed",
      description: "Pendaftaran passkey pemilik gagal diverifikasi",
      meta: input.meta,
    });
    throw new OwnerPasskeyError(
      "OWNER_PASSKEY_REGISTRATION_FAILED",
      "Pendaftaran sidik jari gagal diverifikasi. Coba lagi.",
      400,
    );
  }

  if (!verification.verified) {
    await prisma.user.update({ where: { id: user.id }, data: { ownerPasskeyChallenge: null } });
    await recordPasskeyFailure({
      userId: user.id,
      action: "owner.passkey.registration_failed",
      description: "Pendaftaran passkey pemilik tidak terverifikasi",
      meta: input.meta,
    });
    throw new OwnerPasskeyError(
      "OWNER_PASSKEY_REGISTRATION_FAILED",
      "Pendaftaran sidik jari gagal diverifikasi. Coba lagi.",
      400,
    );
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const friendlyName = input.friendlyName?.trim() ? input.friendlyName.trim() : null;
  const registeredAt = new Date();

  await prisma.ownerPasskey.upsert({
    where: { credentialId: credential.id },
    update: {
      userId: user.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: BigInt(credential.counter),
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      transports: credential.transports ?? [],
      friendlyName,
      lastUsedAt: registeredAt,
    },
    create: {
      userId: user.id,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: BigInt(credential.counter),
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      transports: credential.transports ?? [],
      friendlyName,
      lastUsedAt: registeredAt,
    },
  });

  await prisma.user.update({ where: { id: user.id }, data: { ownerPasskeyChallenge: null } });

  await recordAuditLog({
    actorUserId: user.id,
    action: "owner.passkey.registered",
    entityType: "User",
    entityId: user.id,
    after: {
      credentialId: credential.id,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      friendlyName,
    },
    meta: input.meta,
  });
  await recordSecurityEvent({
    userId: user.id,
    type: "PASSWORD_CHANGED",
    severity: "INFO",
    description: "Passkey Konsol Pemilik didaftarkan",
    meta: input.meta,
  });

  return {
    credentialId: credential.id,
    friendlyName,
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    registeredAt: registeredAt.toISOString(),
  };
}

export interface BeginPasskeyAuthenticationInput {
  userId: string;
  meta: RequestMeta;
}

/** Mulai verifikasi passkey: membuat opsi verifikasi dan menyimpan tantangannya. */
export async function beginPasskeyAuthentication(
  input: BeginPasskeyAuthenticationInput,
): Promise<Awaited<ReturnType<typeof generateAuthenticationOptions>>> {
  const user = await loadOwnerRow(input.userId);

  const credentials = await prisma.ownerPasskey.findMany({
    where: { userId: user.id },
    select: { credentialId: true, transports: true },
  });
  if (credentials.length === 0) {
    throw new OwnerPasskeyError(
      "OWNER_PASSKEY_NOT_ENROLLED",
      "Belum ada sidik jari terdaftar. Daftarkan dulu di halaman Keamanan.",
      409,
    );
  }

  const options = await generateAuthenticationOptions({
    rpID: ownerWebAuthnRpId(),
    allowCredentials: credentials.map((row) => ({
      id: row.credentialId,
      transports: toTransports(row.transports),
    })),
    userVerification: "required",
    timeout: 60_000,
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { ownerPasskeyChallenge: options.challenge },
  });

  await recordAuditLog({
    actorUserId: user.id,
    action: "owner.passkey.verification_started",
    entityType: "User",
    entityId: user.id,
    meta: input.meta,
  });

  return options;
}

export interface CompletePasskeyAuthenticationInput {
  userId: string;
  sessionId: string;
  response: AuthenticationResponseJSON;
  meta: RequestMeta;
}

export interface CompletePasskeyAuthenticationResult {
  credentialId: string;
  verifiedAt: string;
}

/**
 * Memverifikasi sesi ini dengan passkey. Setelah berhasil, sesi ditandai
 * `totpVerifiedAt` sehingga Konsol Pemilik dapat dibuka tanpa mengulang verifikasi
 * pada setiap halaman (selama `OWNER_STEP_UP_MINUTES` belum lewat).
 */
export async function completePasskeyAuthentication(
  input: CompletePasskeyAuthenticationInput,
): Promise<CompletePasskeyAuthenticationResult> {
  const user = await loadOwnerRow(input.userId);
  const expectedChallenge = user.ownerPasskeyChallenge;
  if (!expectedChallenge) {
    throw new OwnerPasskeyError(
      "OWNER_PASSKEY_CHALLENGE_MISSING",
      "Verifikasi sidik jari harus dimulai ulang.",
      409,
    );
  }

  const stored = await prisma.ownerPasskey.findUnique({
    where: { credentialId: input.response.id },
  });
  if (!stored || stored.userId !== user.id) {
    await prisma.user.update({ where: { id: user.id }, data: { ownerPasskeyChallenge: null } });
    await recordPasskeyFailure({
      userId: user.id,
      action: "owner.passkey.step_up_failed",
      description: "Verifikasi passkey pemilik memakai kredensial tak dikenal",
      meta: input.meta,
    });
    throw new OwnerPasskeyError(
      "OWNER_PASSKEY_UNKNOWN_CREDENTIAL",
      "Kredensial sidik jari tidak dikenali. Daftarkan ulang perangkat ini.",
      401,
    );
  }

  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge,
      expectedOrigin: ownerWebAuthnOrigin(),
      expectedRPID: ownerWebAuthnRpId(),
      credential: {
        id: stored.credentialId,
        publicKey: new Uint8Array(stored.publicKey),
        counter: Number(stored.counter),
        transports: toTransports(stored.transports),
      },
      requireUserVerification: true,
    });
  } catch {
    await prisma.user.update({ where: { id: user.id }, data: { ownerPasskeyChallenge: null } });
    await recordPasskeyFailure({
      userId: user.id,
      action: "owner.passkey.step_up_failed",
      description: "Verifikasi passkey pemilik gagal diverifikasi",
      meta: input.meta,
    });
    throw new OwnerPasskeyError(
      "OWNER_PASSKEY_VERIFICATION_FAILED",
      "Verifikasi sidik jari gagal. Coba lagi.",
      401,
    );
  }

  if (!verification.verified) {
    await prisma.user.update({ where: { id: user.id }, data: { ownerPasskeyChallenge: null } });
    await recordPasskeyFailure({
      userId: user.id,
      action: "owner.passkey.step_up_failed",
      description: "Verifikasi passkey pemilik tidak terverifikasi",
      meta: input.meta,
    });
    throw new OwnerPasskeyError(
      "OWNER_PASSKEY_VERIFICATION_FAILED",
      "Verifikasi sidik jari gagal. Coba lagi.",
      401,
    );
  }

  const verifiedAt = new Date();
  await prisma.ownerPasskey.update({
    where: { id: stored.id },
    data: {
      counter: BigInt(verification.authenticationInfo.newCounter),
      lastUsedAt: verifiedAt,
    },
  });
  await prisma.user.update({ where: { id: user.id }, data: { ownerPasskeyChallenge: null } });
  await markSessionOwnerVerified(input.sessionId, verifiedAt);

  await recordAuditLog({
    actorUserId: user.id,
    action: "owner.passkey.step_up",
    entityType: "User",
    entityId: user.id,
    after: { credentialId: stored.credentialId, verifiedAt: verifiedAt.toISOString() },
    meta: input.meta,
  });
  await recordSecurityEvent({
    userId: user.id,
    type: "LOGIN_SUCCESS",
    severity: "INFO",
    description: "Konsol Pemilik dibuka dengan passkey",
    meta: input.meta,
  });

  return { credentialId: stored.credentialId, verifiedAt: verifiedAt.toISOString() };
}

export interface RemoveOwnerPasskeyInput {
  userId: string;
  credentialId: string;
  meta: RequestMeta;
}

export interface RemoveOwnerPasskeyResult {
  removedCredentialId: string;
  remainingCredentials: number;
}

/**
 * Menghapus satu kredensial passkey. Bila itu kredensial terakhir, seluruh sesi
 * pemilik kehilangan status verifikasi — konsol kembali ke keadaan "perlu
 * pendaftaran", jadi menghapus sidik jari tidak mewariskan akses ke sesi lama.
 */
export async function removeOwnerPasskey(
  input: RemoveOwnerPasskeyInput,
): Promise<RemoveOwnerPasskeyResult> {
  const user = await loadOwnerRow(input.userId);

  const stored = await prisma.ownerPasskey.findUnique({
    where: { credentialId: input.credentialId },
  });
  if (!stored || stored.userId !== user.id) {
    throw new OwnerPasskeyError(
      "OWNER_PASSKEY_UNKNOWN_CREDENTIAL",
      "Kredensial sidik jari tidak dikenali.",
      404,
    );
  }

  await prisma.ownerPasskey.delete({ where: { id: stored.id } });
  const remaining = await prisma.ownerPasskey.count({ where: { userId: user.id } });
  if (remaining === 0) {
    await clearUserSessionVerifications(user.id);
  }

  await recordAuditLog({
    actorUserId: user.id,
    action: "owner.passkey.removed",
    entityType: "User",
    entityId: user.id,
    before: { credentialId: stored.credentialId, friendlyName: stored.friendlyName },
    after: { remainingCredentials: remaining },
    meta: input.meta,
  });
  await recordSecurityEvent({
    userId: user.id,
    type: "PASSWORD_CHANGED",
    severity: remaining === 0 ? "WARNING" : "INFO",
    description:
      remaining === 0
        ? "Passkey Konsol Pemilik terakhir dihapus — konsol kembali memerlukan pendaftaran"
        : "Satu passkey Konsol Pemilik dihapus",
    meta: input.meta,
  });

  return { removedCredentialId: stored.credentialId, remainingCredentials: remaining };
}

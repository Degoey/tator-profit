import type { AdminRole } from "@prisma/client";
import { notFound, redirect } from "next/navigation";

import { getActiveSession } from "@/lib/auth/session";
import {
  isOwnerAccount,
  isOwnerConsoleConfigured,
  ownerStepUpMs,
  type OwnerEnv,
} from "@/lib/config/owner";
import { prisma } from "@/lib/prisma";

/**
 * Penjaga Konsol Pemilik.
 *
 * Konsol pemilik adalah satu-satunya permukaan yang boleh dipakai pemilik akun
 * tunggal, jadi penjagaannya berlapis dan semuanya diputuskan di server:
 *
 *  1. `OWNER_EMAIL` harus terisi — kalau tidak, konsolnya tidak ada sama sekali;
 *  2. pengunjung harus sudah masuk (sesi database yang sah);
 *  3. akunnya harus ADMIN **dan** SUPER_ADMIN **dan** surelnya sama dengan
 *     `OWNER_EMAIL` — peran saja tidak cukup, jadi administrator lain menerima 404;
 *  4. passkey (sidik jari) harus sudah didaftarkan;
 *  5. sesi ini harus sudah lolos verifikasi passkey dan belum kedaluwarsa.
 *
 * Syarat 3 sengaja menghasilkan `notFound()` (404) alih-alih "akses ditolak":
 * administrator lain tidak diberi tahu bahwa permukaan ini ada.
 */

export interface OwnerActor {
  id: string;
  name: string;
  username: string;
  email: string;
  adminRole: AdminRole | null;
  sessionId: string;
  /** True bila pemilik sudah mendaftarkan minimal satu passkey. */
  passkeyEnabled: boolean;
  /** Waktu sesi ini terakhir lolos verifikasi passkey, atau `null`. */
  stepUpVerifiedAt: Date | null;
}

export type OwnerContext =
  | { kind: "unconfigured" }
  | { kind: "guest" }
  | { kind: "forbidden" }
  | { kind: "enrollment"; actor: OwnerActor }
  | { kind: "step-up"; actor: OwnerActor }
  | { kind: "ready"; actor: OwnerActor };

export class OwnerAccessError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "OwnerAccessError";
    this.code = code;
    this.status = status;
  }
}

/** Apakah verifikasi passkey pada sesi ini masih berlaku (bawaan 12 jam). */
export function ownerStepUpIsFresh(
  verifiedAt: Date | null,
  env: OwnerEnv = process.env,
  now: number = Date.now(),
): boolean {
  if (!verifiedAt) return false;
  return now - verifiedAt.getTime() <= ownerStepUpMs(env);
}

/** Keadaan konsol pemilik untuk permintaan saat ini. Tidak pernah melempar. */
export async function loadOwnerContext(env: OwnerEnv = process.env): Promise<OwnerContext> {
  if (!isOwnerConsoleConfigured(env)) return { kind: "unconfigured" };

  const session = await getActiveSession();
  if (!session) return { kind: "guest" };

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      role: true,
      adminRole: true,
      status: true,
      _count: { select: { ownerPasskeys: true } },
    },
  });

  if (!user || user.status !== "ACTIVE" || !isOwnerAccount(user, env)) return { kind: "forbidden" };

  const actor: OwnerActor = {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    adminRole: user.adminRole,
    sessionId: session.id,
    passkeyEnabled: user._count.ownerPasskeys > 0,
    stepUpVerifiedAt: session.totpVerifiedAt,
  };

  if (!actor.passkeyEnabled) return { kind: "enrollment", actor };
  if (!ownerStepUpIsFresh(actor.stepUpVerifiedAt, env)) return { kind: "step-up", actor };
  return { kind: "ready", actor };
}

/**
 * Penjaga halaman konsol pemilik. Tamu diarahkan masuk, akun lain menerima 404,
 * pemilik yang belum mendaftarkan passkey diarahkan ke halaman keamanan, dan
 * pemilik yang sesinya belum diverifikasi diarahkan ke halaman verifikasi sidik
 * jari.
 */
export async function requireOwnerPage(returnTo = "/owner"): Promise<OwnerActor> {
  const context = await loadOwnerContext();

  if (context.kind === "guest") redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  if (context.kind === "unconfigured" || context.kind === "forbidden") notFound();
  if (context.kind === "enrollment") redirect("/owner/keamanan");
  if (context.kind === "step-up") redirect("/owner/masuk");
  return context.actor;
}

export interface RequireOwnerApiOptions {
  /**
   * Izinkan keadaan "pemilik sudah masuk tetapi passkey belum didaftarkan".
   * Hanya dipakai oleh langkah pendaftaran passkey itu sendiri.
   */
  allowEnrollment?: boolean;
  /**
   * Izinkan keadaan "passkey aktif tetapi sesi ini belum diverifikasi".
   * Hanya dipakai oleh langkah verifikasi sidik jari.
   */
  allowStepUp?: boolean;
}

/**
 * Penjaga untuk rute API konsol pemilik. Setiap rute yang mengubah keadaan
 * (termasuk yang memindahkan uang) memanggil ini lebih dulu, sehingga verifikasi
 * passkey tidak dapat dilewati dengan menembak rute API secara langsung.
 */
export async function requireOwnerApi(
  options: RequireOwnerApiOptions = {},
  env: OwnerEnv = process.env,
): Promise<OwnerActor> {
  const context = await loadOwnerContext(env);

  if (context.kind === "unconfigured" || context.kind === "forbidden") {
    throw new OwnerAccessError("FORBIDDEN", "Akses konsol pemilik diperlukan.", 403);
  }
  if (context.kind === "guest") {
    throw new OwnerAccessError("UNAUTHENTICATED", "Silakan masuk terlebih dahulu.", 401);
  }
  if (context.kind === "enrollment" && !options.allowEnrollment) {
    throw new OwnerAccessError(
      "OWNER_PASSKEY_NOT_ENROLLED",
      "Passkey pemilik belum didaftarkan. Buka Konsol Pemilik → Keamanan untuk mendaftarkannya.",
      409,
    );
  }
  if (context.kind === "step-up" && !options.allowStepUp) {
    throw new OwnerAccessError(
      "OWNER_PASSKEY_REQUIRED",
      "Sesi ini belum diverifikasi dengan sidik jari.",
      401,
    );
  }
  return context.actor;
}

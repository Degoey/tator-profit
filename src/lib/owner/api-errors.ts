import { jsonError, type ApiErrorBody } from "@/lib/api";
import { OwnerAccessError } from "@/lib/auth/owner-guard";
import { OwnerSecretError } from "@/lib/owner/secret-box";
import { OwnerTotpError } from "@/lib/services/owner-2fa-service";
import { pruneRateLimitBuckets, rateLimit } from "@/lib/rate-limit";

import type { NextResponse } from "next/server";

/**
 * Pemetaan galat bersama untuk seluruh rute Konsol Pemilik.
 *
 * Kesalahan yang memang punya arti bagi pemilik (2FA belum didaftarkan, kode
 * salah, kunci enkripsi belum diisi) dijawab apa adanya; kesalahan lain ditelan
 * menjadi pesan umum supaya detail internal tidak bocor lewat API.
 */
export function ownerApiError(error: unknown, fallbackMessage: string): NextResponse<ApiErrorBody> {
  if (error instanceof OwnerAccessError) return jsonError(error.code, error.message, error.status);
  if (error instanceof OwnerTotpError) return jsonError(error.code, error.message, error.status);
  if (error instanceof OwnerSecretError) {
    return jsonError(error.code, error.message, error.code === "OWNER_2FA_KEY_MISSING" ? 503 : 409);
  }
  console.error(fallbackMessage, error);
  return jsonError("INTERNAL_ERROR", fallbackMessage, 500);
}

/**
 * Pembatas laju per akun pemilik. Dijalankan sebelum pekerjaan apa pun supaya
 * tebakan kode 2FA dan tindakan uang tidak dapat dibanjiri permintaan.
 */
export function ownerRateLimit(
  scope: string,
  actorId: string,
  limit: number,
  windowMs: number,
): NextResponse<ApiErrorBody> | null {
  pruneRateLimitBuckets();
  const result = rateLimit(`owner-${scope}:${actorId}`, limit, windowMs);
  if (result.allowed) return null;
  return jsonError(
    "RATE_LIMITED",
    `Terlalu banyak permintaan. Coba lagi dalam ${result.retryAfterSeconds} detik.`,
    429,
  );
}

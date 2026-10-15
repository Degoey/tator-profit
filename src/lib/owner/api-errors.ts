import { jsonError, type ApiErrorBody } from "@/lib/api";
import { OwnerAccessError } from "@/lib/auth/owner-guard";
import { OwnerPasskeyError } from "@/lib/services/owner-passkey-service";
import { pruneRateLimitBuckets, rateLimit } from "@/lib/rate-limit";

import type { NextResponse } from "next/server";

/**
 * Pemetaan galat bersama untuk seluruh rute Konsol Pemilik.
 *
 * Kesalahan yang memang punya arti bagi pemilik (passkey belum didaftarkan,
 * verifikasi gagal, kredensial tak dikenal) dijawab apa adanya; kesalahan lain
 * ditelan menjadi pesan umum supaya detail internal tidak bocor lewat API.
 */
export function ownerApiError(error: unknown, fallbackMessage: string): NextResponse<ApiErrorBody> {
  if (error instanceof OwnerAccessError) return jsonError(error.code, error.message, error.status);
  if (error instanceof OwnerPasskeyError) return jsonError(error.code, error.message, error.status);
  console.error(fallbackMessage, error);
  return jsonError("INTERNAL_ERROR", fallbackMessage, 500);
}

/**
 * Pembatas laju per akun pemilik. Dijalankan sebelum pekerjaan apa pun supaya
 * percobaan verifikasi passkey dan tindakan uang tidak dapat dibanjiri permintaan.
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

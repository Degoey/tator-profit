import { createHmac, randomBytes } from "node:crypto";

import { resolveTokenSecret } from "@/lib/config/production-environment";

/**
 * Secret efektif untuk HMAC sesi dan token reset.
 *
 * `resolveTokenSecret` melempar `TokenSecretError` bila proses berjalan di
 * lingkungan seperti produksi (produksi **dan** staging) tanpa secret sungguhan
 * minimal 32 karakter; sebelumnya hanya produksi yang diperiksa. Di luar
 * lingkungan itu, secret pengembangan bawaan dipakai supaya `npm run dev` dan
 * suite pengujian tetap sederhana. Lihat `src/lib/config/production-environment.ts`.
 */
const EFFECTIVE_SECRET = resolveTokenSecret();

/** Cryptographically random, URL safe token (never stored in plaintext). */
export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Deterministic HMAC-SHA256 hash used for session / reset token lookups. */
export function hashToken(token: string): string {
  return createHmac("sha256", EFFECTIVE_SECRET).update(token).digest("hex");
}

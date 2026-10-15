import { randomBytes, timingSafeEqual } from "node:crypto";

import { hashToken } from "@/lib/auth/tokens";

/**
 * Kode pemulihan sekali-pakai untuk konsol pemilik.
 *
 * Dipakai hanya bila perangkat autentikator hilang. Yang disimpan di database
 * adalah hash HMAC-SHA256 (kunci: `AUTH_TOKEN_SECRET`), bukan kodenya, dan satu
 * kode langsung dibuang dari daftar begitu terpakai.
 *
 * Alfabet sengaja membuang huruf yang mudah tertukar (I, L, O, U) dan angka 0/1.
 */

export const RECOVERY_CODE_COUNT = 10;
export const RECOVERY_CODE_GROUP_LENGTH = 4;
export const RECOVERY_CODE_GROUPS = 3;

const RECOVERY_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = RECOVERY_CODE_GROUP_LENGTH * RECOVERY_CODE_GROUPS;

/** Kode acak dalam format `XXXX-XXXX-XXXX`. */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    const bytes = randomBytes(CODE_LENGTH);
    let raw = "";
    for (let index = 0; index < CODE_LENGTH; index += 1) {
      const byte = bytes.readUInt8(index);
      raw += RECOVERY_ALPHABET.charAt(byte % RECOVERY_ALPHABET.length);
    }
    codes.add(formatRecoveryCode(raw));
  }
  return [...codes];
}

/** Membuang spasi/tanda hubung dan menaikkan huruf; bentuk baku untuk hashing. */
export function normalizeRecoveryCode(input: string): string {
  return input.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function formatRecoveryCode(code: string): string {
  const normalized = normalizeRecoveryCode(code);
  return normalized.replace(new RegExp(`(.{${RECOVERY_CODE_GROUP_LENGTH}})`, "g"), "$1-").replace(/-$/, "");
}

/** Hash yang disimpan; memakai HMAC-SHA256 dengan secret token aplikasi. */
export function hashRecoveryCode(code: string): string {
  return hashToken(`owner-recovery:${normalizeRecoveryCode(code)}`);
}

export function hashRecoveryCodes(codes: readonly string[]): string[] {
  return codes.map((code) => hashRecoveryCode(code));
}

export interface RecoveryCodeMatch {
  matched: boolean;
  remaining: string[];
}

/**
 * Mencari satu kode di daftar hash. Hash yang cocok dibuang dari daftar
 * (sekali-pakai), dan perbandingan memakai `timingSafeEqual`.
 */
export function consumeRecoveryCode(hashes: readonly string[], input: string): RecoveryCodeMatch {
  const normalized = normalizeRecoveryCode(input);
  if (normalized.length !== CODE_LENGTH) return { matched: false, remaining: [...hashes] };

  const candidate = Buffer.from(hashRecoveryCode(normalized), "utf8");
  let matchedIndex = -1;

  hashes.forEach((hash, index) => {
    if (matchedIndex !== -1) return;
    const stored = Buffer.from(hash, "utf8");
    if (stored.length === candidate.length && timingSafeEqual(stored, candidate)) {
      matchedIndex = index;
    }
  });

  if (matchedIndex === -1) return { matched: false, remaining: [...hashes] };
  return { matched: true, remaining: hashes.filter((_, index) => index !== matchedIndex) };
}

/** Membaca daftar hash dari kolom JSON tanpa mempercayai bentuknya. */
export function recoveryHashesFromJson(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length === 64);
}

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { OWNER_2FA_KEY_ENV, type OwnerEnv } from "@/lib/config/owner";

/**
 * Kotak rahasia pemilik.
 *
 * Rahasia TOTP tidak pernah disimpan sebagai teks biasa. Nilainya dienkripsi
 * dengan AES-256-GCM memakai kunci `OWNER_2FA_KEY` (64 karakter heksadesimal =
 * 32 byte), jadi salinan database — mis. hasil `pg_dump` atau cadangan — tidak
 * cukup untuk meniru kode autentikator.
 *
 * Format tersimpan: `v1.<iv>.<tag>.<ciphertext>` (masing-masing base64url).
 * Bila kunci tidak ada atau tidak sah, enkripsi **gagal** (fail closed) alih-alih
 * menyimpan rahasia tanpa pelindung.
 */

export const OWNER_SECRET_FORMAT_VERSION = "v1";
const KEY_BYTES = 32;
const KEY_HEX_PATTERN = new RegExp(`^[0-9a-fA-F]{${KEY_BYTES * 2}}$`);
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class OwnerSecretError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "OwnerSecretError";
    this.code = code;
  }
}

/** Kunci enkripsi dari lingkungan, atau `null` bila belum/tidak sah. */
export function ownerSecretKeyFromEnv(env: OwnerEnv = process.env): Buffer | null {
  const raw = (env[OWNER_2FA_KEY_ENV] ?? "").trim();
  if (!KEY_HEX_PATTERN.test(raw)) return null;
  return Buffer.from(raw, "hex");
}

export function isOwnerSecretBoxConfigured(env: OwnerEnv = process.env): boolean {
  return ownerSecretKeyFromEnv(env) !== null;
}

function requireKey(env: OwnerEnv): Buffer {
  const key = ownerSecretKeyFromEnv(env);
  if (!key) {
    throw new OwnerSecretError(
      "OWNER_2FA_KEY_MISSING",
      `Kunci ${OWNER_2FA_KEY_ENV} belum diisi (butuh 64 karakter heksadesimal), jadi rahasia 2FA tidak dapat disimpan dengan aman.`,
    );
  }
  return key;
}

export function encryptOwnerSecret(plain: string, env: OwnerEnv = process.env): string {
  const key = requireKey(env);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    OWNER_SECRET_FORMAT_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptOwnerSecret(payload: string, env: OwnerEnv = process.env): string {
  const key = requireKey(env);
  const [version, ivPart, tagPart, cipherPart] = payload.split(".");
  if (
    version !== OWNER_SECRET_FORMAT_VERSION ||
    !ivPart ||
    !tagPart ||
    !cipherPart
  ) {
    throw new OwnerSecretError("OWNER_SECRET_UNREADABLE", "Rahasia 2FA tersimpan dalam format yang tidak dikenal.");
  }

  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  const ciphertext = Buffer.from(cipherPart, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new OwnerSecretError("OWNER_SECRET_UNREADABLE", "Rahasia 2FA tersimpan dalam format yang tidak dikenal.");
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    /**
     * Kunci salah atau isi diubah. Tidak pernah menebak: pemilik harus mendaftar
     * ulang 2FA lewat konsol, bukan diberi kode yang mungkin salah.
     */
    throw new OwnerSecretError(
      "OWNER_SECRET_UNREADABLE",
      "Rahasia 2FA tidak dapat dibuka dengan kunci saat ini.",
    );
  }
}

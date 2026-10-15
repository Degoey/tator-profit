import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * TOTP (RFC 6238) tanpa dependensi tambahan.
 *
 * Aplikasi autentikator standar (Google Authenticator, Authy, 1Password, dsb.)
 * memakai parameter bawaan: HMAC-SHA1, 6 angka, langkah 30 detik. Modul ini
 * sengaja ditulis dengan `node:crypto` saja supaya konsol pemilik tidak menambah
 * paket pihak ketiga pada permukaan autentikasi.
 */

export const TOTP_ALGORITHM = "SHA1";
export const TOTP_DIGITS = 6;
export const TOTP_STEP_SECONDS = 30;
/** Satu langkah ke belakang dan ke depan ditoleransi (geseran jam perangkat). */
export const TOTP_DEFAULT_WINDOW = 1;
export const TOTP_SECRET_BYTES = 20;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export class TotpError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "TotpError";
    this.code = code;
  }
}

/** RFC 4648 base32 (tanpa padding) — format yang dipakai aplikasi autentikator. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET.charAt((value << (5 - bits)) & 31);
  }

  return output;
}

/** Menerima base32 dengan atau tanpa padding/spasi; huruf kecil dinormalkan. */
export function base32Decode(input: string): Buffer {
  const cleaned = input.replace(/[\s-]/g, "").replace(/=+$/g, "").toUpperCase();
  if (cleaned.length === 0) throw new TotpError("TOTP_SECRET_EMPTY", "Rahasia TOTP kosong.");

  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const character of cleaned) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) {
      throw new TotpError("TOTP_SECRET_INVALID", "Rahasia TOTP bukan base32 yang sah.");
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/** Rahasia acak 160 bit, ditampilkan sebagai base32 (32 karakter). */
export function generateTotpSecret(bytes = TOTP_SECRET_BYTES): string {
  return base32Encode(randomBytes(bytes));
}

/** Penghitung langkah TOTP untuk satu titik waktu (detik Unix / 30). */
export function totpCounter(atMs: number, stepSeconds = TOTP_STEP_SECONDS): number {
  return Math.floor(atMs / 1000 / stepSeconds);
}

function codeForCounter(key: Buffer, counter: number, digits: number): string {
  const message = Buffer.alloc(8);
  message.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  message.writeUInt32BE(counter % 2 ** 32, 4);

  const digest = createHmac("sha1", key).update(message).digest();
  /** Dynamic truncation (RFC 4226 §5.3): 4 bit terakhir memilih titik mulai. */
  const offset = digest.readUInt8(digest.length - 1) & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;

  return (binary % 10 ** digits).toString().padStart(digits, "0");
}

/** Kode TOTP untuk satu penghitung langkah. */
export function totpCode(
  secret: string,
  counter: number,
  digits = TOTP_DIGITS,
): string {
  return codeForCounter(base32Decode(secret), counter, digits);
}

/** Kode TOTP yang berlaku saat ini (untuk pengujian dan verifikasi manual). */
export function totpCodeAt(secret: string, atMs: number, stepSeconds = TOTP_STEP_SECONDS): string {
  return totpCode(secret, totpCounter(atMs, stepSeconds));
}

export function normalizeTotpCode(input: string): string {
  return input.replace(/[^0-9]/g, "");
}

export interface VerifyTotpOptions {
  atMs?: number;
  stepSeconds?: number;
  digits?: number;
  window?: number;
  /**
   * Penghitung langkah yang sudah pernah dipakai akun ini. Kode dengan langkah
   * yang sama atau lebih lama ditolak, sehingga satu kode tidak dapat dipakai
   * dua kali (anti replay) meskipun masih di dalam jendela toleransi.
   */
  lastUsedCounter?: number | null;
}

export interface TotpMatch {
  counter: number;
}

/**
 * Memverifikasi kode TOTP. Mengembalikan langkah yang cocok, atau `null`.
 * Perbandingan memakai `timingSafeEqual` supaya waktu jawaban tidak membocorkan
 * angka yang benar.
 */
export function verifyTotpCode(
  secret: string,
  input: string,
  options: VerifyTotpOptions = {},
): TotpMatch | null {
  const digits = options.digits ?? TOTP_DIGITS;
  const code = normalizeTotpCode(input);
  if (code.length !== digits) return null;

  let key: Buffer;
  try {
    key = base32Decode(secret);
  } catch {
    return null;
  }

  const stepSeconds = options.stepSeconds ?? TOTP_STEP_SECONDS;
  const window = options.window ?? TOTP_DEFAULT_WINDOW;
  const current = totpCounter(options.atMs ?? Date.now(), stepSeconds);
  const expected = Buffer.from(code, "utf8");

  let matched: number | null = null;
  for (let offset = -window; offset <= window; offset += 1) {
    const counter = current + offset;
    if (counter < 0) continue;
    const candidate = Buffer.from(codeForCounter(key, counter, digits), "utf8");
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
      if (matched === null || counter > matched) matched = counter;
    }
  }

  if (matched === null) return null;
  if (options.lastUsedCounter != null && matched <= options.lastUsedCounter) return null;
  return { counter: matched };
}

/** URI `otpauth://` yang bisa dipindai atau diketik manual ke autentikator. */
export function otpauthUri(input: { secret: string; account: string; issuer: string }): string {
  const label = encodeURIComponent(`${input.issuer}:${input.account}`);
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: TOTP_ALGORITHM,
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Rahasia ditampilkan berkelompok empat huruf supaya mudah diketik manual. */
export function formatTotpSecret(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

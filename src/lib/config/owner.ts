/**
 * Konfigurasi Konsol Pemilik (super admin tunggal).
 *
 * Konsol ini hanya boleh dipakai oleh satu akun: akun yang alamat surelnya sama
 * dengan `OWNER_EMAIL`. Bila variabel itu kosong, konsol pemilik **mati total**
 * (fail closed) — tidak ada akun yang dianggap pemilik, sehingga tidak ada jalan
 * masuk cadangan yang diam-diam terbuka.
 *
 * Nilai yang dibaca:
 *  - `OWNER_EMAIL`            — surel akun pemilik (wajib, tanpa ini konsol mati).
 *  - `OWNER_STEP_UP_MINUTES`  — berapa lama satu verifikasi passkey berlaku untuk
 *                               sesi (bawaan 720 menit = 12 jam).
 *  - `OWNER_WEBAUTHN_RP_ID`   — RP ID WebAuthn; harus domain tempat passkey
 *                               didaftarkan (bawaan `app.tatorprofitbos.my.id`).
 *  - `OWNER_WEBAUTHN_RP_NAME` — nama yang ditampilkan pada dialog passkey
 *                               (bawaan `Tatorprofit`).
 *  - `OWNER_WEBAUTHN_ORIGIN`  — origin yang diharapkan saat memverifikasi passkey
 *                               (bawaan `https://app.tatorprofitbos.my.id`).
 *
 * Passkey tidak menyimpan rahasia apa pun di server, jadi tidak ada kunci
 * enkripsi yang perlu dikonfigurasi lagi.
 */
/**
 * Bentuk lingkungan yang dibaca modul ini. Sengaja tidak memakai `NodeJS.ProcessEnv`
 * supaya pengujian dapat menyuplai objek biasa tanpa harus melengkapi seluruh
 * bidang tipe Node.
 */
export type OwnerEnv = Record<string, string | undefined>;

export const OWNER_EMAIL_ENV = "OWNER_EMAIL";
export const OWNER_STEP_UP_MINUTES_ENV = "OWNER_STEP_UP_MINUTES";
export const OWNER_WEBAUTHN_RP_ID_ENV = "OWNER_WEBAUTHN_RP_ID";
export const OWNER_WEBAUTHN_RP_NAME_ENV = "OWNER_WEBAUTHN_RP_NAME";
export const OWNER_WEBAUTHN_ORIGIN_ENV = "OWNER_WEBAUTHN_ORIGIN";

export const DEFAULT_OWNER_STEP_UP_MINUTES = 12 * 60;
export const MIN_OWNER_STEP_UP_MINUTES = 5;
export const MAX_OWNER_STEP_UP_MINUTES = 24 * 60;

/** Domain WebAuthn bawaan; harus sama dengan domain yang menyajikan konsol. */
export const DEFAULT_OWNER_WEBAUTHN_RP_ID = "app.tatorprofitbos.my.id";
export const DEFAULT_OWNER_WEBAUTHN_RP_NAME = "Tatorprofit";
export const DEFAULT_OWNER_WEBAUTHN_ORIGIN = "https://app.tatorprofitbos.my.id";

/** Surel pemilik dalam huruf kecil, atau `null` bila konsol belum dikonfigurasi. */
export function ownerEmailFromEnv(env: OwnerEnv = process.env): string | null {
  const raw = (env[OWNER_EMAIL_ENV] ?? "").trim().toLowerCase();
  return raw.length > 0 ? raw : null;
}

/** Masa berlaku satu verifikasi passkey, dibatasi ke rentang yang masuk akal. */
export function ownerStepUpMinutes(env: OwnerEnv = process.env): number {
  const raw = Number.parseInt((env[OWNER_STEP_UP_MINUTES_ENV] ?? "").trim(), 10);
  if (!Number.isFinite(raw)) return DEFAULT_OWNER_STEP_UP_MINUTES;
  return Math.min(MAX_OWNER_STEP_UP_MINUTES, Math.max(MIN_OWNER_STEP_UP_MINUTES, raw));
}

export function ownerStepUpMs(env: OwnerEnv = process.env): number {
  return ownerStepUpMinutes(env) * 60 * 1000;
}

/** RP ID WebAuthn (domain tanpa skema), mis. `app.tatorprofitbos.my.id`. */
export function ownerWebAuthnRpId(env: OwnerEnv = process.env): string {
  const raw = (env[OWNER_WEBAUTHN_RP_ID_ENV] ?? "").trim();
  return raw.length > 0 ? raw : DEFAULT_OWNER_WEBAUTHN_RP_ID;
}

/** Nama RP yang muncul pada dialog passkey peramban. */
export function ownerWebAuthnRpName(env: OwnerEnv = process.env): string {
  const raw = (env[OWNER_WEBAUTHN_RP_NAME_ENV] ?? "").trim();
  return raw.length > 0 ? raw : DEFAULT_OWNER_WEBAUTHN_RP_NAME;
}

/** Origin lengkap (dengan skema) yang diharapkan saat verifikasi passkey. */
export function ownerWebAuthnOrigin(env: OwnerEnv = process.env): string {
  const raw = (env[OWNER_WEBAUTHN_ORIGIN_ENV] ?? "").trim().replace(/\/+$/, "");
  return raw.length > 0 ? raw : DEFAULT_OWNER_WEBAUTHN_ORIGIN;
}

export interface OwnerCandidate {
  email: string;
  role: string;
  adminRole: string | null;
}

/**
 * Apakah akun ini pemilik?
 *
 * Tiga syarat harus benar sekaligus: surelnya sama dengan `OWNER_EMAIL`, perannya
 * ADMIN, dan peran adminnya SUPER_ADMIN. Peran saja tidak cukup dan surel saja
 * tidak cukup, jadi akun SUPER_ADMIN lain (kalau suatu saat dibuat) tetap tidak
 * dapat membuka konsol pemilik.
 */
export function isOwnerAccount(
  user: OwnerCandidate | null | undefined,
  env: OwnerEnv = process.env,
): boolean {
  if (!user) return false;
  const ownerEmail = ownerEmailFromEnv(env);
  if (!ownerEmail) return false;
  if (user.role !== "ADMIN" || user.adminRole !== "SUPER_ADMIN") return false;
  return user.email.trim().toLowerCase() === ownerEmail;
}

/** True bila `OWNER_EMAIL` sudah diisi; kalau false, konsol pemilik tidak ada. */
export function isOwnerConsoleConfigured(env: OwnerEnv = process.env): boolean {
  return ownerEmailFromEnv(env) !== null;
}

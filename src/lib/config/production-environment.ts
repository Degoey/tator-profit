/**
 * Aturan lingkungan "seperti produksi" (Bagian 7/7).
 *
 * Aplikasi membedakan tiga jenis lingkungan: pengembangan/pengujian, staging, dan
 * produksi. Staging menyajikan aplikasi lewat HTTPS ke pengguna nyata, jadi ia
 * harus diperlakukan sama ketatnya dengan produksi — risiko terbuka nomor 4 di
 * `docs/security-audit-and-production-readiness.md` menyebutnya secara eksplisit.
 *
 * Modul ini hanya berisi aturan konfigurasi: tidak ada saldo, tarif, atau
 * keputusan keuangan yang bergantung padanya. Variabel lingkungan selalu
 * diteruskan sebagai parameter supaya aturannya dapat diuji tanpa mengubah
 * variabel proses nyata.
 */

/**
 * Variabel lingkungan yang dibaca aturan ini. Sengaja bukan `NodeJS.ProcessEnv`:
 * deklarasi Next menandai `NODE_ENV` sebagai properti wajib, sehingga objek
 * lingkungan tiruan di pengujian tidak akan bisa dibuat.
 */
export type EnvironmentVariables = Readonly<Record<string, string | undefined>>;

/**
 * Lingkungan yang diperlakukan seperti produksi: menjalani HTTPS ke pengguna
 * nyata, sehingga tidak boleh memakai nilai bawaan pengembangan.
 */
export const PRODUCTION_LIKE_ENVIRONMENTS = ["production", "staging"] as const;

/** Panjang minimum `AUTH_TOKEN_SECRET` di lingkungan seperti produksi. */
export const MIN_TOKEN_SECRET_LENGTH = 32;

/**
 * Secret pengembangan. Hanya dipakai di luar lingkungan seperti produksi, supaya
 * `npm run dev` dan suite pengujian tetap dapat berjalan tanpa `.env` lengkap.
 */
export const DEVELOPMENT_TOKEN_SECRET = "tatorprofit-development-only-secret";

/** Dilempar bila `AUTH_TOKEN_SECRET` tidak layak untuk lingkungan saat ini. */
export class TokenSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenSecretError";
  }
}

/** Benar bila `NODE_ENV` saat ini harus diperlakukan seperti produksi. */
export function isProductionLikeEnvironment(env: EnvironmentVariables = process.env): boolean {
  const nodeEnv = (env.NODE_ENV ?? "").trim().toLowerCase();
  return (PRODUCTION_LIKE_ENVIRONMENTS as readonly string[]).includes(nodeEnv);
}

/**
 * Mengembalikan secret efektif untuk HMAC sesi dan token reset.
 *
 * Di produksi **dan** staging secret wajib ada dan minimal 32 karakter; sebelumnya
 * hanya produksi yang diperiksa, sehingga staging dapat berjalan dengan secret
 * pengembangan bawaan yang tertulis di repositori ini.
 */
export function resolveTokenSecret(env: EnvironmentVariables = process.env): string {
  const secret = (env.AUTH_TOKEN_SECRET ?? "").trim();

  if (!isProductionLikeEnvironment(env)) {
    return secret || DEVELOPMENT_TOKEN_SECRET;
  }

  const nodeEnv = (env.NODE_ENV ?? "").trim().toLowerCase();

  if (secret.length === 0) {
    throw new TokenSecretError(
      `AUTH_TOKEN_SECRET wajib diisi saat NODE_ENV=${nodeEnv}; staging diperlakukan sama ketatnya dengan produksi.`,
    );
  }

  if (secret.length < MIN_TOKEN_SECRET_LENGTH) {
    throw new TokenSecretError(
      `AUTH_TOKEN_SECRET minimal ${MIN_TOKEN_SECRET_LENGTH} karakter saat NODE_ENV=${nodeEnv} (sekarang ${secret.length}).`,
    );
  }

  return secret;
}
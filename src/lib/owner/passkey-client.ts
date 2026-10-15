import { WebAuthnError } from "@simplewebauthn/browser";

/**
 * Pesan galat passkey untuk pemilik, dalam bahasa Indonesia.
 *
 * `@simplewebauthn/browser` membungkus kegagalan WebAuthn menjadi `WebAuthnError`
 * dengan kode yang lebih jelas dari `DOMException` biasa; kode-kode itu diterjemahkan
 * di sini supaya pemilik tahu apa yang harus dilakukan (batalkan, hapus kredensial
 * lama, pakai HTTPS, atau ganti perangkat).
 */
export function describePasskeyError(
  error: unknown,
  action: "pendaftaran" | "verifikasi",
): string {
  const label = action === "pendaftaran" ? "Pendaftaran sidik jari" : "Verifikasi sidik jari";

  if (error instanceof WebAuthnError) {
    switch (error.code) {
      case "ERROR_CEREMONY_ABORTED":
        return `${label} dibatalkan.`;
      case "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED":
        return "Perangkat ini sudah terdaftar. Hapus kredensial lama lebih dulu.";
      case "ERROR_INVALID_DOMAIN":
      case "ERROR_INVALID_RP_ID":
        return "Domain aplikasi tidak cocok dengan konfigurasi passkey.";
      case "ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT":
      case "ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT":
      case "ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG":
        return "Perangkat ini tidak mendukung verifikasi sidik jari.";
      default:
        return `${label} gagal di perangkat ini.`;
    }
  }

  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "AbortError") {
      return `${label} dibatalkan atau tidak diizinkan perangkat.`;
    }
    if (error.name === "SecurityError") {
      return "Domain aplikasi tidak aman untuk passkey (butuh HTTPS).";
    }
  }

  return `${label} gagal. Coba lagi.`;
}

/** True bila peramban tampaknya mendukung WebAuthn. */
export function passkeySupported(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential !== "undefined";
}

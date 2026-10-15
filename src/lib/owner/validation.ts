import { z } from "zod";

/**
 * Skema masukan rute Konsol Pemilik (passkey WebAuthn).
 *
 * Peramban mengirim balik struktur yang dibuat `@simplewebauthn/browser`, jadi
 * yang divalidasi di sini hanya bentuk dan batas ukurannya — bukan isi
 * kriptografinya. Keaslian balasan tetap diverifikasi
 * `@simplewebauthn/server` terhadap tantangan dan origin yang disimpan server.
 * Bidang yang tidak dipakai (mis. `clientExtensionResults`) dibiarkan opsional.
 */
const base64url = z.string().trim().min(1).max(4096);

const transports = z.array(z.string().trim().min(1).max(32)).max(8).optional();

const clientExtensionResults = z.record(z.string(), z.unknown()).optional();

/** Balasan pendaftaran: `RegistrationResponseJSON` dari `startRegistration()`. */
export const ownerPasskeyRegistrationResponseSchema = z.object({
  id: base64url,
  rawId: base64url,
  type: z.string().trim().min(1).max(32),
  response: z.object({
    clientDataJSON: z.string().min(1).max(16384),
    attestationObject: z.string().min(1).max(131072),
    transports,
  }),
  clientExtensionResults,
  authenticatorAttachment: z.string().trim().max(32).optional(),
});

export type OwnerPasskeyRegistrationResponse = z.infer<typeof ownerPasskeyRegistrationResponseSchema>;

/** Badan rute `/api/owner/passkey/register-verify`. */
export const ownerPasskeyRegisterVerifySchema = z.object({
  response: ownerPasskeyRegistrationResponseSchema,
  friendlyName: z.string().trim().max(60, "Nama perangkat terlalu panjang.").optional(),
});

export type OwnerPasskeyRegisterVerifyInput = z.infer<typeof ownerPasskeyRegisterVerifySchema>;

/** Balasan verifikasi: `AuthenticationResponseJSON` dari `startAuthentication()`. */
export const ownerPasskeyAuthenticationResponseSchema = z.object({
  id: base64url,
  rawId: base64url,
  type: z.string().trim().min(1).max(32),
  response: z.object({
    clientDataJSON: z.string().min(1).max(16384),
    authenticatorData: z.string().min(1).max(16384),
    signature: z.string().min(1).max(16384),
    userHandle: z.string().max(4096).optional(),
  }),
  clientExtensionResults,
  authenticatorAttachment: z.string().trim().max(32).optional(),
});

export type OwnerPasskeyAuthenticationResponse = z.infer<
  typeof ownerPasskeyAuthenticationResponseSchema
>;

/** Badan rute `/api/owner/passkey/authenticate-verify`. */
export const ownerPasskeyAuthenticateVerifySchema = z.object({
  response: ownerPasskeyAuthenticationResponseSchema,
});

export type OwnerPasskeyAuthenticateVerifyInput = z.infer<
  typeof ownerPasskeyAuthenticateVerifySchema
>;

/** Badan rute `/api/owner/passkey/remove`. */
export const ownerPasskeyRemoveSchema = z.object({
  credentialId: z.string().trim().min(1).max(4096),
});

export type OwnerPasskeyRemoveInput = z.infer<typeof ownerPasskeyRemoveSchema>;

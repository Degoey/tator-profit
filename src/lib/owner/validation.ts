import { z } from "zod";

/**
 * Skema masukan rute Konsol Pemilik.
 *
 * Kode TOTP diterima dengan spasi/tanda hubung (orang sering menempel
 * "123 456"), jadi panjangnya dibatasi longgar di sini dan dinormalkan lagi oleh
 * `verifyTotpCode`. Kode pemulihan punya bentuk `XXXX-XXXX-XXXX`.
 */
export const ownerTotpCodeSchema = z
  .object({
    code: z.string().trim().max(16, "Kode 2FA terlalu panjang.").optional(),
    recoveryCode: z.string().trim().max(24, "Kode pemulihan terlalu panjang.").optional(),
  })
  .refine(
    (value) => Boolean(value.code?.replace(/[^0-9]/g, "")) || Boolean(value.recoveryCode),
    { message: "Masukkan kode 2FA atau kode pemulihan." },
  );

export type OwnerTotpCodeInput = z.infer<typeof ownerTotpCodeSchema>;

export const ownerActivateSchema = z.object({
  code: z
    .string()
    .trim()
    .min(6, "Kode 2FA terdiri dari 6 angka.")
    .max(16, "Kode 2FA terlalu panjang."),
});

export type OwnerActivateInput = z.infer<typeof ownerActivateSchema>;

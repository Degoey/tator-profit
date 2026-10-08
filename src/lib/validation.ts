import { z } from "zod";

import { REFERRAL_CODE_PATTERN, normalizeReferralCode } from "@/lib/config/referral";

export const nameSchema = z
  .string()
  .trim()
  .min(2, "Nama minimal 2 karakter.")
  .max(80, "Nama maksimal 80 karakter.");

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Nama pengguna minimal 3 karakter.")
  .max(24, "Nama pengguna maksimal 24 karakter.")
  .regex(/^[a-z0-9_]+$/, "Nama pengguna hanya boleh berisi huruf kecil, angka, dan garis bawah.");

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/, "Masukkan alamat surel yang valid.");

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{7,15}$/, "Masukkan nomor telepon yang valid (7-15 digit, awalan + opsional).");

export const passwordSchema = z
  .string()
  .min(8, "Kata sandi minimal 8 karakter.")
  .max(72, "Kata sandi maksimal 72 karakter.")
  .regex(/[A-Za-z]/, "Kata sandi harus memuat minimal satu huruf.")
  .regex(/[0-9]/, "Kata sandi harus memuat minimal satu angka.");

export const referralCodeSchema = z
  .string()
  .trim()
  .transform(normalizeReferralCode)
  .refine((value) => REFERRAL_CODE_PATTERN.test(value), "Format kode rujukan tidak valid.");

/**
 * Optional referral code for the register and join forms: `undefined`, `""` and
 * whitespace-only values are normalised to `undefined`, anything else must match
 * the referral code pattern (Zod 4 unions do not treat `z.undefined()` as optional).
 */
export const optionalReferralCodeSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? normalizeReferralCode(value) : undefined))
  .refine(
    (value) => value === undefined || referralCodeSchema.safeParse(value).success,
    "Format kode rujukan tidak valid.",
  );

export const registerSchema = z
  .object({
    name: nameSchema,
    username: usernameSchema,
    email: emailSchema,
    phone: phoneSchema,
    password: passwordSchema,
    confirmPassword: z.string().optional(),
    referralCode: optionalReferralCodeSchema,
    acceptTerms: z.boolean().refine((value) => value === true, {
      message: "Anda harus menyetujui ketentuan program untuk membuat akun.",
    }),
  })
  .refine(
    (data) => !data.confirmPassword || data.confirmPassword === data.password,
    { path: ["confirmPassword"], message: "Kata sandi tidak sama." },
  );

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(1, "Masukkan nama pengguna atau surel Anda.")
    .max(254, "Nama pengguna atau surel terlalu panjang."),
  password: z.string().min(1, "Masukkan kata sandi Anda."),
  remember: z.boolean().optional().default(false),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    token: z.string().min(16, "Token reset tidak valid."),
    password: passwordSchema,
    confirmPassword: z.string().optional(),
  })
  .refine((data) => !data.confirmPassword || data.confirmPassword === data.password, {
    path: ["confirmPassword"],
    message: "Kata sandi tidak sama.",
  });

export const updateProfileSchema = z.object({
  name: nameSchema.optional(),
  phone: phoneSchema.optional(),
  country: z.string().trim().max(56).optional(),
  city: z.string().trim().max(80).optional(),
  timezone: z.string().trim().max(64).optional(),
  bio: z.string().trim().max(400).optional(),
});

export const joinProgramSchema = z.object({
  tierId: z.string().uuid("Pilih paket program yang valid."),
  cycleId: z.string().uuid("Pilih durasi program yang valid.").optional(),
  referralCode: optionalReferralCodeSchema,
});

/** USDT amount as a string so money never passes through a JS float. */
export const decimalAmountSchema = z
  .string()
  .trim()
  .regex(/^(0|[1-9]\d{0,15})(\.\d{1,2})?$/, "Masukkan nilai USDT yang valid (maksimal 2 desimal).");

export const adminProgramActionSchema = z.object({
  action: z.enum(["activate", "suspend", "resume", "complete", "cancel"]),
  userProgramId: z.string().uuid("Pilih keanggotaan yang valid."),
  confirmedAmount: decimalAmountSchema.optional(),
  reason: z.string().trim().max(200).optional(),
  refundFunds: z.boolean().optional(),
});

export type AdminProgramActionInput = z.infer<typeof adminProgramActionSchema>;

export const adminRewardActionSchema = z
  .object({
    action: z.enum(["generate", "approve", "pay", "reject", "void"]),
    rewardId: z.string().uuid("Pilih imbalan yang valid.").optional(),
    userProgramId: z.string().uuid().optional(),
    userId: z.string().uuid().optional(),
    period: z.number().int().min(1).max(12).optional(),
    reason: z.string().trim().max(200).optional(),
  })
  .refine((data) => data.action === "generate" || Boolean(data.rewardId), {
    path: ["rewardId"],
    message: "Imbalan harus dipilih untuk aksi ini.",
  })
  .refine((data) => data.action !== "reject" && data.action !== "void" ? true : Boolean(data.reason), {
    path: ["reason"],
    message: "Alasan wajib diisi untuk aksi penolakan dan pembatalan.",
  });

export type AdminRewardActionInput = z.infer<typeof adminRewardActionSchema>;

/**
 * Assigns an explicit admin role to an existing administrator account.
 * Only SUPER_ADMIN may change roles (enforced server-side in the service).
 */
export const adminRoleAssignmentSchema = z.object({
  userId: z.string().uuid("Pilih akun administrator yang valid."),
  role: z.enum(["SUPER_ADMIN", "FINANCE", "SUPPORT", "COMPLIANCE", "VIEWER"]).nullable(),
});

export type AdminRoleAssignmentInput = z.infer<typeof adminRoleAssignmentSchema>;


/** Flattens a Zod error into a `{ field: message }` map for form rendering. */
export function flattenZodError(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "form";
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

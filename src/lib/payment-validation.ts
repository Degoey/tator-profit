import { z } from "zod";

/**
 * Payment request validation shared by the deposit/withdrawal routes.
 *
 * Amounts are always validated as strings (never floats) so money never passes
 * through a JS `number`. Field names mirror the UI contract exactly:
 * deposits use `userProgramId, amount, paymentMethod, paymentReference`, and
 * withdrawals use `amount, method, destination, notes`.
 */

/** Accepted payment method tokens for both deposits and withdrawals. */
export const PAYMENT_METHODS = ["BANK_TRANSFER", "EWALLET", "CRYPTO", "OTHER"] as const;

/** USDT amount as a decimal string; at least one digit must be non-zero. */
const positiveDecimalAmount = z
  .string()
  .trim()
  .regex(/^(0|[1-9]\d{0,15})(\.\d{1,2})?$/, "Masukkan nilai USDT yang valid.")
  .refine((value) => /[1-9]/.test(value), "Jumlah harus lebih besar dari nol.");

export const paymentAmountSchema = positiveDecimalAmount;

/** Multipart text fields of `POST /api/deposits` (the file is validated separately). */
export const depositFieldsSchema = z.object({
  userProgramId: z.string().uuid("Pilih keanggotaan program yang valid."),
  amount: paymentAmountSchema,
  paymentMethod: z.enum(PAYMENT_METHODS, { message: "Pilih metode pembayaran yang valid." }),
  paymentReference: z.string().trim().max(200, "Referensi pembayaran terlalu panjang.").optional(),
});

export type DepositFieldsInput = z.infer<typeof depositFieldsSchema>;

/** JSON body of `POST /api/withdrawals`. */
export const withdrawalSchema = z.object({
  amount: paymentAmountSchema,
  method: z.enum(PAYMENT_METHODS, { message: "Pilih metode penarikan yang valid." }),
  destination: z.string().trim().min(1, "Masukkan tujuan penarikan.").max(300, "Tujuan penarikan terlalu panjang."),
  notes: z.string().trim().max(500, "Catatan terlalu panjang.").optional(),
});

export type WithdrawalInput = z.infer<typeof withdrawalSchema>;

/** Deposit review actions accepted by `POST /api/admin/deposits`. */
export const DEPOSIT_ACTIONS = ["UNDER_REVIEW", "APPROVED", "REJECTED", "FLAGGED"] as const;
/** Withdrawal review actions accepted by `POST /api/admin/withdrawals`. */
export const WITHDRAWAL_ACTIONS = ["UNDER_REVIEW", "APPROVED", "PROCESSING", "COMPLETED", "REJECTED"] as const;

/** JSON body of `POST /api/admin/deposits`; the action enum is deposit-specific. */
export const adminDepositActionSchema = z.object({
  id: z.string().uuid("Identitas setoran tidak valid."),
  action: z.enum(DEPOSIT_ACTIONS, { message: "Aksi setoran tidak valid." }),
  reason: z.string().trim().max(500, "Alasan terlalu panjang.").optional(),
});

export type AdminDepositActionInput = z.infer<typeof adminDepositActionSchema>;

/** JSON body of `POST /api/admin/withdrawals`; the action enum is withdrawal-specific. */
export const adminWithdrawalActionSchema = z.object({
  id: z.string().uuid("Identitas penarikan tidak valid."),
  action: z.enum(WITHDRAWAL_ACTIONS, { message: "Aksi penarikan tidak valid." }),
  reason: z.string().trim().max(500, "Alasan terlalu panjang.").optional(),
});

export type AdminWithdrawalActionInput = z.infer<typeof adminWithdrawalActionSchema>;

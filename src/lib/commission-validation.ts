import { z } from "zod";

import { COMMISSION_ACTIONS } from "@/lib/commission-actions";

export const COMMISSION_STATUSES = ["PENDING", "APPROVED", "PAID", "REJECTED", "VOID"] as const;

export const adminCommissionActionSchema = z.object({
  commissionId: z.string().trim().min(1).max(100),
  action: z.enum(COMMISSION_ACTIONS),
  reason: z.string().trim().max(500).optional(),
}).strict().superRefine((data, ctx) => {
  if ((data.action === "REJECT" || data.action === "VOID") && (data.reason?.length ?? 0) < 3) {
    ctx.addIssue({ code: "custom", path: ["reason"], message: "Alasan wajib diisi (minimal 3 karakter)." });
  }
});

export const commissionListQuerySchema = z.object({
  status: z.enum(COMMISSION_STATUSES).optional(),
  search: z.string().trim().max(100).optional(),
  take: z.coerce.number().int().min(1).max(200).default(100),
  skip: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

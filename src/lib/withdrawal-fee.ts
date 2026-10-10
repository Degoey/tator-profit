import { Prisma } from "@prisma/client";

import { MAX_MONEY, roundMoney, toDecimal, type DecimalInput } from "./money";

/** Shared by server and browser. Money is rounded half-up to the existing USDT scale. */
export const WITHDRAWAL_FEE_RATE = "0.10";
export const WITHDRAWAL_FEE_LABEL = "10%";
export const WITHDRAWAL_FEE_NOTICE =
  "Setiap penarikan dikenakan biaya sebesar 10% dari nominal penarikan. Jumlah yang diterima adalah nominal penarikan setelah dikurangi biaya.";

export function calculateWithdrawalFee(value: DecimalInput) {
  const amount = toDecimal(value);
  if (!amount.isFinite() || amount.lte(0) || amount.gt(MAX_MONEY) || amount.decimalPlaces() > 2) {
    throw new RangeError("Nominal penarikan harus positif dengan maksimal 2 desimal.");
  }
  const fee = roundMoney(amount.times(WITHDRAWAL_FEE_RATE));
  return { amount, fee, netAmount: amount.minus(fee) };
}

/** Old requests retain their original payout: no retroactive fee or ledger rewrite. */
export function withdrawalAmounts(row: {
  amount: Prisma.Decimal;
  fee: Prisma.Decimal | null;
  netAmount: Prisma.Decimal | null;
}) {
  return {
    fee: (row.fee ?? new Prisma.Decimal("0")).toFixed(2),
    netAmount: (row.netAmount ?? row.amount).toFixed(2),
  };
}

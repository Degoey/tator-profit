/**
 * Anti-fraud thresholds and signal vocabulary (Bagian 13).
 *
 * Every threshold lives in one place so the policy can be read, tested and
 * adjusted without hunting through the service. The signals only open a review
 * case for a human: no balance is touched and no commission is denied here.
 */

/** How many accounts may share one bank/e-wallet number before it is a signal. */
export const SHARED_BANK_ACCOUNT_MIN_COUNT = 2;

/** Registrations from one IP address inside the window below that raise a signal. */
export const SHARED_IP_MIN_COUNT = 3;
export const SHARED_IP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Referrals created through one referrer inside the window below that raise a signal. */
export const REFERRER_BURST_MIN_COUNT = 5;
export const REFERRER_BURST_WINDOW_MS = 60 * 60 * 1000;

/** Human readable label of every signal, shared by the admin queue and tests. */
export const FRAUD_SIGNAL_LABELS = {
  SHARED_BANK_ACCOUNT: "Nomor rekening dipakai akun lain",
  SHARED_IP: "Beberapa akun dari IP yang sama",
  SAME_IP_AS_REFERRER: "IP pendaftar sama dengan perujuk",
  SAME_BANK_AS_REFERRER: "Nomor rekening sama dengan perujuk",
  REFERRER_BURST: "Banyak pendaftaran lewat satu perujuk",
} as const;

export type FraudSignal = keyof typeof FRAUD_SIGNAL_LABELS;

export const FRAUD_SIGNALS = Object.keys(FRAUD_SIGNAL_LABELS) as FraudSignal[];

/** Guard for untrusted values (e.g. JSON stored in an audit row). */
export function isFraudSignal(value: unknown): value is FraudSignal {
  return typeof value === "string" && Object.hasOwn(FRAUD_SIGNAL_LABELS, value);
}

export function fraudSignalLabel(signal: unknown): string {
  return isFraudSignal(signal) ? FRAUD_SIGNAL_LABELS[signal] : String(signal);
}

export type FraudReviewStatus = "OPEN" | "CLEARED" | "CONFIRMED";

export const FRAUD_STATUS_LABELS: Record<FraudReviewStatus, string> = {
  OPEN: "Menunggu tinjauan",
  CLEARED: "Bersih",
  CONFIRMED: "Terbukti",
};

/**
 * `X-Forwarded-For` is client controlled, so a shared-IP signal is only derived
 * from forwarded headers when the operator declares a trusted reverse proxy.
 * Without it the header is ignored and the IP is simply unknown.
 */
export function trustedIpAddress(meta: { ipAddress: string | null }): string | null {
  if (process.env.TRUST_PROXY_HEADERS !== "1") return null;
  const ip = meta.ipAddress?.trim();
  return ip ? ip : null;
}
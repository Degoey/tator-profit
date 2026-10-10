/**
 * Anti-fraud decision tokens accepted by the review endpoint.
 * Kept in a plain module (no "use client") so the server page can decide which
 * decisions to render while the client dialog only sends a typed value.
 */
export const FRAUD_DECISION_VALUES = ["CLEARED", "CONFIRMED"] as const;

export type FraudDecision = (typeof FRAUD_DECISION_VALUES)[number];

export const FRAUD_DECISION_LABELS: Record<FraudDecision, string> = {
  CLEARED: "Tandai bersih",
  CONFIRMED: "Tandai terbukti",
};

import { createHmac, randomBytes } from "node:crypto";

const TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET ?? "";

if (!TOKEN_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("AUTH_TOKEN_SECRET must be configured in production");
}

if (!TOKEN_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("AUTH_TOKEN_SECRET must be configured in production");
}

if (TOKEN_SECRET && process.env.NODE_ENV === "production" && TOKEN_SECRET.length < 32) {
  throw new Error("AUTH_TOKEN_SECRET must be at least 32 characters in production");
}

const EFFECTIVE_SECRET = TOKEN_SECRET || "tatorprofit-development-only-secret";

/** Cryptographically random, URL safe token (never stored in plaintext). */
export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Deterministic HMAC-SHA256 hash used for session / reset token lookups. */
export function hashToken(token: string): string {
  return createHmac("sha256", EFFECTIVE_SECRET).update(token).digest("hex");
}

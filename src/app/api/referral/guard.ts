/**
 * Query-parameter guard for the referral API.
 *
 * The referral endpoint is always scoped to the signed-in session, so it never
 * accepts a query parameter that could point it at somebody else's account
 * (`?root=`, `?userId=`, `?referrerId=`, ...). Every parameter — root-like or
 * merely unknown — is rejected instead of silently ignored, so a caller can
 * never believe they read another user's network.
 */

/** Names that would let a caller pick a foreign root; kept for message wording. */
export const REFERRAL_ROOT_PARAM_NAMES: readonly string[] = [
  "root",
  "rootid",
  "rootuser",
  "rootuserid",
  "user",
  "userid",
  "id",
  "username",
  "referrer",
  "referrerid",
  "referreduserid",
  "parent",
  "parentid",
  "sponsor",
  "sponsorid",
  "code",
  "referralcode",
  "referredby",
  "ownerid",
];

/** No query parameter is allowed: the resource is derived from the session only. */
export const REFERRAL_ALLOWED_PARAM_NAMES: readonly string[] = [];

export interface ReferralQueryRejection {
  param: string;
  kind: "root" | "unknown";
}

/** Returns the first rejected query parameter, or `null` when the query is clean. */
export function inspectReferralQuery(params: URLSearchParams): ReferralQueryRejection | null {
  for (const param of params.keys()) {
    const normalized = param.trim().toLowerCase();
    if (REFERRAL_ALLOWED_PARAM_NAMES.includes(normalized)) continue;
    return {
      param,
      kind: REFERRAL_ROOT_PARAM_NAMES.includes(normalized) ? "root" : "unknown",
    };
  }
  return null;
}

/** Indonesian, user-facing explanation for a rejected query string. */
export function referralQueryRejectionMessage(rejection: ReferralQueryRejection): string {
  return rejection.kind === "root"
    ? `Parameter "${rejection.param}" tidak diizinkan. Data rujukan selalu dibatasi pada akun yang sedang masuk.`
    : `Parameter "${rejection.param}" tidak dikenal. Data rujukan selalu dibatasi pada akun yang sedang masuk.`;
}

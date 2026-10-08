import { jsonError, jsonSuccess } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth/current-user";

import { loadReferralOverview } from "@/app/referral/overview";

import { inspectReferralQuery, referralQueryRejectionMessage } from "./guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Authenticated referral overview: five-level network plus recorded commissions.
 *
 * The root is always the signed-in account. Any query parameter (notably
 * `?root=`, `?userId=` or `?referrerId=`) is rejected with 400 so the endpoint
 * can never be turned into an enumeration tool for other users' networks.
 */
export async function GET(request: Request) {
  const rejection = inspectReferralQuery(new URL(request.url).searchParams);
  if (rejection) {
    return jsonError("FORBIDDEN_QUERY_PARAM", referralQueryRejectionMessage(rejection), 400);
  }

  const user = await getCurrentUser();
  if (!user) {
    return jsonError("UNAUTHENTICATED", "Silakan masuk untuk melihat data rujukan Anda.", 401);
  }

  const overview = await loadReferralOverview({
    id: user.id,
    username: user.username,
    referralCode: user.referralCode,
  });

  return jsonSuccess(overview);
}

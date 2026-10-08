import { jsonSuccess } from "@/lib/api";
import { getActiveProgram } from "@/lib/program-config";
import { previewReferralCommissions } from "@/lib/services/program-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public program configuration: rates, durations (4 / 8 / 12 weeks) and the nine
 * join tiers. Nine tiers x three durations = the 27 program combinations.
 */
export async function GET() {
  const { program, tiers, cycles, fromDatabase } = await getActiveProgram();
  const baseTier = tiers[0];

  return jsonSuccess({
    program,
    tiers,
    cycles: cycles,
    source: fromDatabase ? "database" : "central-config-fallback",
    referralPreview: baseTier ? previewReferralCommissions(baseTier.joinAmount) : [],
  });
}

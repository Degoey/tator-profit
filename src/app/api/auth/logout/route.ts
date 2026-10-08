import { jsonSuccess } from "@/lib/api";
import { getActiveSession, destroyCurrentSession } from "@/lib/auth/session";
import { getRequestMeta, recordSecurityEvent } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const meta = await getRequestMeta();
  const session = await getActiveSession();

  await destroyCurrentSession();

  if (session) {
    await recordSecurityEvent({
      userId: session.userId,
      type: "LOGOUT",
      severity: "INFO",
      description: "Sesi diakhiri oleh pengguna",
      meta,
    });
  }

  return jsonSuccess({ loggedOut: true });
}

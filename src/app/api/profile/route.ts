import { jsonError, jsonSuccess, readJsonBody } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/prisma";
import { getRequestMeta, recordAuditLog } from "@/lib/security";
import { getUserPrograms } from "@/lib/services/program-service";
import { flattenZodError, updateProfileSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Returns the signed-in account (profile, balance, referral and memberships). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return jsonError("UNAUTHENTICATED", "Silakan masuk untuk melihat profil Anda.", 401);
  }

  const programs = await getUserPrograms(user.id);
  return jsonSuccess({ user, programs });
}

/** Updates the mutable parts of the profile (name, phone, country, city, timezone, bio). */
export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return jsonError("UNAUTHENTICATED", "Silakan masuk untuk memperbarui profil Anda.", 401);
  }

  const body = await readJsonBody(request);
  const parsed = updateProfileSchema.safeParse(body);

  if (!parsed.success) {
    return jsonError(
      "VALIDATION_ERROR",
      "Periksa kembali kolom yang ditandai.",
      422,
      flattenZodError(parsed.error),
    );
  }

  const { name, phone, country, city, timezone, bio } = parsed.data;
  const meta = await getRequestMeta();

  try {
    await prisma.$transaction(async (tx) => {
      if (name || phone) {
        await tx.user.update({
          where: { id: user.id },
          data: {
            ...(name ? { name } : {}),
            ...(phone ? { phone } : {}),
          },
        });
      }

      const profileData = {
        ...(country !== undefined ? { country } : {}),
        ...(city !== undefined ? { city } : {}),
        ...(timezone !== undefined ? { timezone } : {}),
        ...(bio !== undefined ? { bio } : {}),
      };

      if (Object.keys(profileData).length > 0) {
        await tx.profile.update({ where: { userId: user.id }, data: profileData });
      }
    });

    await recordAuditLog({
      actorUserId: user.id,
      action: "user.profile.updated",
      entityType: "User",
      entityId: user.id,
      after: { name, phone, country, city, timezone, bio },
      meta,
    });

    const updated = await getCurrentUser();
    return jsonSuccess({ user: updated });
  } catch (error) {
    console.error("Profile update failed", error);
    return jsonError("INTERNAL_ERROR", "Tidak dapat memperbarui profil saat ini.", 500);
  }
}

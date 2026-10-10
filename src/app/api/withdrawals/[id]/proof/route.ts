import { jsonError } from "@/lib/api";
import { requireAdminPermission } from "@/lib/auth/admin-guard";
import { getActiveSession } from "@/lib/auth/session";
import { ProofError, proofResponseHeaders, readProofFile } from "@/lib/payment-proof";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams the transfer proof attached to a completed withdrawal back to its
 * owner or to an administrator with the `readProof` capability.
 *
 * Nothing is ever public: the file lives in the private proof directory and is
 * returned as an `attachment` with `nosniff`, `private, no-store` caching and a
 * restrictive CSP, exactly like a deposit proof.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getActiveSession();
  if (!session) {
    return jsonError("UNAUTHENTICATED", "Silakan masuk untuk mengunduh bukti.", 401);
  }

  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return jsonError("NOT_FOUND", "Bukti tidak ditemukan.", 404);
  }

  const withdrawal = await prisma.withdrawalRequest.findUnique({
    where: { id },
    select: {
      userId: true,
      proofStorageKey: true,
      proofFileName: true,
      proofMimeType: true,
    },
  });

  if (!withdrawal?.proofStorageKey) {
    return jsonError("NOT_FOUND", "Bukti tidak ditemukan.", 404);
  }

  if (withdrawal.userId !== session.userId) {
    const actor = await requireAdminPermission("readProof");
    if (!actor) {
      return jsonError("FORBIDDEN", "Anda tidak berhak mengunduh bukti ini.", 403);
    }
  }

  try {
    const bytes = await readProofFile(withdrawal.proofStorageKey);
    if (!bytes) {
      return jsonError("NOT_FOUND", "Berkas bukti tidak ditemukan.", 404);
    }

    const headers = proofResponseHeaders({
      fileName: withdrawal.proofFileName ?? "bukti-transfer",
      mimeType: withdrawal.proofMimeType ?? "application/octet-stream",
      sizeBytes: bytes.byteLength,
    });

    return new Response(new Uint8Array(bytes), { status: 200, headers });
  } catch (error) {
    if (error instanceof ProofError) {
      return jsonError(error.code, error.message, error.status);
    }
    console.error("Pengunduhan bukti penarikan gagal", error);
    return jsonError("INTERNAL_ERROR", "Tidak dapat mengunduh bukti saat ini.", 500);
  }
}

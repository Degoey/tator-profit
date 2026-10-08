import { jsonError } from "@/lib/api";
import { requireAdminPermission } from "@/lib/auth/admin-guard";
import { getActiveSession } from "@/lib/auth/session";
import { ProofError, proofResponseHeaders, readProofFile } from "@/lib/payment-proof";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams a deposit proof file back to its owner or to an administrator with
 * the `readProof` capability.
 *
 * The file is never publicly reachable: it is read from the private directory
 * and returned as an `attachment` with `nosniff`, `private, no-store` caching
 * and a restrictive CSP, so a hostile PDF/image can never execute on this
 * origin.
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

  const deposit = await prisma.depositRequest.findUnique({
    where: { id },
    select: {
      userId: true,
      proofStorageKey: true,
      proofFileName: true,
      proofMimeType: true,
      proofSize: true,
    },
  });

  if (!deposit) {
    return jsonError("NOT_FOUND", "Bukti tidak ditemukan.", 404);
  }

  if (deposit.userId !== session.userId) {
    const actor = await requireAdminPermission("readProof");
    if (!actor) {
      return jsonError("FORBIDDEN", "Anda tidak berhak mengunduh bukti ini.", 403);
    }
  }

  try {
    const bytes = await readProofFile(deposit.proofStorageKey);
    if (!bytes) {
      return jsonError("NOT_FOUND", "Berkas bukti tidak ditemukan.", 404);
    }

    const headers = proofResponseHeaders({
      fileName: deposit.proofFileName,
      mimeType: deposit.proofMimeType,
      sizeBytes: bytes.byteLength,
    });

    return new Response(new Uint8Array(bytes), { status: 200, headers });
  } catch (error) {
    if (error instanceof ProofError) {
      return jsonError(error.code, error.message, error.status);
    }
    console.error("Pengunduhan bukti gagal", error);
    return jsonError("INTERNAL_ERROR", "Tidak dapat mengunduh bukti saat ini.", 500);
  }
}

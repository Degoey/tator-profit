import { Prisma } from "@prisma/client";

import { jsonError, jsonSuccess } from "@/lib/api";
import { getActiveSession } from "@/lib/auth/session";
import {
  MAX_MULTIPART_BYTES,
  ProofError,
  deleteProofFile,
  parseBoundedMultipart,
  readProofFromFormData,
  storeProofFile,
} from "@/lib/payment-proof";
import { depositFieldsSchema } from "@/lib/payment-validation";
import { pruneRateLimitBuckets, rateLimit } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/request-origin";
import { getRequestMeta } from "@/lib/security";
import { PaymentError, createDepositRequest } from "@/lib/services/manual-payment-service";
import { flattenZodError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Records a manual deposit for the signed-in member: the money is reported as
 * already sent outside the platform and a proof file is attached. Nothing is
 * credited here; an administrator approves the request later.
 *
 * The multipart body is bounded by counting real streamed bytes before it is
 * parsed, the proof is validated (MIME + extension + magic signature) and stored
 * under a random private name, and the file is deleted again when the record
 * cannot be created.
 */
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return jsonError("FORBIDDEN", "Permintaan lintas situs ditolak.", 403);
  }

  const session = await getActiveSession();
  if (!session) {
    return jsonError("UNAUTHENTICATED", "Silakan masuk untuk mengirim setoran.", 401);
  }

  pruneRateLimitBuckets();
  const limit = rateLimit(`deposit:${session.userId}`, 10, 60_000);
  if (!limit.allowed) {
    return jsonError(
      "RATE_LIMITED",
      `Terlalu banyak permintaan setoran. Coba lagi dalam ${limit.retryAfterSeconds} detik.`,
      429,
    );
  }

  let stored: Awaited<ReturnType<typeof storeProofFile>> | null = null;

  try {
    const formData = await parseBoundedMultipart(request, MAX_MULTIPART_BYTES);

    const parsed = depositFieldsSchema.safeParse({
      userProgramId: formData.get("userProgramId"),
      amount: formData.get("amount"),
      paymentMethod: formData.get("paymentMethod"),
      paymentReference: formData.get("paymentReference") ?? undefined,
    });
    if (!parsed.success) {
      return jsonError(
        "VALIDATION_ERROR",
        "Periksa kembali kolom yang ditandai.",
        422,
        flattenZodError(parsed.error),
      );
    }

    const proof = await readProofFromFormData(formData);
    stored = await storeProofFile({
      bytes: proof.bytes,
      kind: proof.kind,
      originalName: proof.originalName,
    });

    const meta = await getRequestMeta();
    const result = await createDepositRequest({
      userId: session.userId,
      userProgramId: parsed.data.userProgramId,
      amount: new Prisma.Decimal(parsed.data.amount),
      paymentMethod: parsed.data.paymentMethod,
      paymentReference: parsed.data.paymentReference ?? "",
      proof: {
        storageKey: stored.storagePath,
        fileName: stored.fileName,
        mimeType: stored.mimeType,
        size: stored.sizeBytes,
      },
      meta,
    });

    return jsonSuccess(result, 201);
  } catch (error) {
    if (stored) await deleteProofFile(stored.storagePath);

    if (error instanceof ProofError) {
      return jsonError(error.code, error.message, error.status);
    }
    if (error instanceof PaymentError) {
      return jsonError(error.code, error.message, error.status);
    }

    console.error("Pencatatan setoran gagal", error);
    return jsonError("INTERNAL_ERROR", "Tidak dapat mencatat setoran saat ini.", 500);
  }
}

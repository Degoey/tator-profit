import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Secure storage for payment proof attachments (deposit receipts).
 *
 * Guarantees enforced here (routes stay thin and reuse them):
 * - the raw request body is bounded by counting actual streamed bytes, so a
 *   lying/absent `Content-Length` cannot push an unbounded multipart body into
 *   memory before parsing;
 * - only PNG / JPEG / PDF are accepted, and the declared MIME type, the file
 *   extension and the magic signature must all agree;
 * - the stored name is a random identifier with a server-chosen extension, so a
 *   hostile filename can never influence the path and files never collide;
 * - files live outside `public/` in a private directory and are only ever
 *   streamed back through an authenticated route as an `attachment`.
 */

export const MAX_PROOF_BYTES = 5 * 1024 * 1024;
/** Hard cap for the whole multipart envelope: file + the surrounding form fields. */
export const MAX_MULTIPART_BYTES = MAX_PROOF_BYTES + 64 * 1024;
export const PROOF_FIELD_NAME = "proof";

export type ProofKind = "png" | "jpeg" | "pdf";

export class ProofError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ProofError";
    this.code = code;
    this.status = status;
  }
}

const KIND_BY_EXTENSION: Record<string, ProofKind> = {
  ".png": "png",
  ".jpg": "jpeg",
  ".jpeg": "jpeg",
  ".pdf": "pdf",
};

const MIME_BY_KIND: Record<ProofKind, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  pdf: "application/pdf",
};

const EXTENSION_BY_KIND: Record<ProofKind, string> = {
  png: ".png",
  jpeg: ".jpg",
  pdf: ".pdf",
};

/** Maps an accepted MIME type to its kind; unknown types return `null`. */
export function kindFromMime(mime: string | null | undefined): ProofKind | null {
  const normalized = (mime ?? "").trim().toLowerCase();
  if (normalized === "image/png") return "png";
  if (normalized === "image/jpeg" || normalized === "image/jpg") return "jpeg";
  if (normalized === "application/pdf") return "pdf";
  return null;
}

/** Maps a lower-cased file extension to its kind; unknown extensions return `null`. */
export function kindFromExtension(fileName: string): ProofKind | null {
  const extension = path.extname(fileName ?? "").toLowerCase();
  return KIND_BY_EXTENSION[extension] ?? null;
}

/** Detects the container format from the leading magic bytes; `null` when unknown. */
export function detectProofKind(bytes: Uint8Array): ProofKind | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) {
    return "pdf";
  }
  return null;
}


/**
 * Validates one uploaded proof. The declared MIME type, the file extension and
 * the magic signature must describe the same format, otherwise the upload is
 * rejected (`UNSUPPORTED_PROOF_TYPE` / `PROOF_SIGNATURE_MISMATCH`).
 */
export function validateProofUpload(input: {
  fileName: string | null | undefined;
  declaredMime: string | null | undefined;
  bytes: Uint8Array;
}): { kind: ProofKind; mimeType: string; extension: string } {
  const { bytes } = input;
  if (bytes.byteLength === 0) {
    throw new ProofError("EMPTY_PROOF", "Berkas bukti kosong.", 422);
  }
  if (bytes.byteLength > MAX_PROOF_BYTES) {
    throw new ProofError("PROOF_TOO_LARGE", "Berkas bukti melebihi batas 5 MiB.", 413);
  }

  const kindByMime = kindFromMime(input.declaredMime);
  const kindByExtension = kindFromExtension(input.fileName ?? "");
  const kindBySignature = detectProofKind(bytes);

  if (!kindByMime && !kindByExtension) {
    throw new ProofError("UNSUPPORTED_PROOF_TYPE", "Bukti harus berupa PNG, JPEG, atau PDF.", 415);
  }
  if (!kindBySignature) {
    throw new ProofError("PROOF_SIGNATURE_MISMATCH", "Isi berkas tidak cocok dengan tipe yang diizinkan.", 415);
  }
  if (kindByMime && kindByMime !== kindBySignature) {
    throw new ProofError("PROOF_SIGNATURE_MISMATCH", "Tipe MIME tidak cocok dengan isi berkas.", 415);
  }
  if (kindByExtension && kindByExtension !== kindBySignature) {
    throw new ProofError("PROOF_SIGNATURE_MISMATCH", "Ekstensi berkas tidak cocok dengan isi berkas.", 415);
  }

  return {
    kind: kindBySignature,
    mimeType: MIME_BY_KIND[kindBySignature],
    extension: EXTENSION_BY_KIND[kindBySignature],
  };
}

/** Root of the private proof directory; never inside `public/`. */
export function proofStorageRoot(): string {
  const configured = process.env.PAYMENT_PROOF_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.join(process.cwd(), "storage", "payment-proofs");
}

/**
 * Resolves a stored relative path to an absolute path inside the private root.
 * Rejects absolute paths and any `..` escape (`INVALID_PROOF_PATH`).
 */
export function resolveProofPath(storagePath: string): string {
  const root = proofStorageRoot();
  const normalized = storagePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("\0")) {
    throw new ProofError("INVALID_PROOF_PATH", "Lokasi berkas bukti tidak valid.", 500);
  }
  const absolute = path.resolve(root, normalized);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new ProofError("INVALID_PROOF_PATH", "Lokasi berkas bukti keluar dari direktori privat.", 500);
  }
  return absolute;
}

export interface StoredProof {
  /** Relative path persisted on the payment record. */
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

/** Writes bytes to a random, server-named file inside the private root. */
export async function storeProofFile(input: {
  bytes: Uint8Array;
  kind: ProofKind;
  originalName?: string | null;
  now?: Date;
}): Promise<StoredProof> {
  const { bytes, kind } = input;
  const when = input.now ?? new Date();
  const folder = `${when.getUTCFullYear()}/${String(when.getUTCMonth() + 1).padStart(2, "0")}`;
  const storagePath = `${folder}/${randomUUID()}${EXTENSION_BY_KIND[kind]}`;
  const absolute = resolveProofPath(storagePath);

  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, bytes, { flag: "wx", mode: 0o600 });

  return {
    storagePath,
    fileName: sanitizeProofFileName(input.originalName ?? `bukti${EXTENSION_BY_KIND[kind]}`),
    mimeType: MIME_BY_KIND[kind],
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

/** Reads a stored proof; returns `null` when the file disappeared. */
export async function readProofFile(storagePath: string): Promise<Buffer | null> {
  try {
    // The private proof directory is written at runtime, so bundler tracing must
    // not try to follow this dynamic path (it would trace the whole project).
    return await readFile(/* turbopackIgnore: true */ resolveProofPath(storagePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Best-effort deletion used to roll back a stored file when the record failed. */
export async function deleteProofFile(storagePath: string | null | undefined): Promise<void> {
  if (!storagePath) return;
  try {
    await rm(resolveProofPath(storagePath), { force: true });
  } catch (error) {
    console.error("Gagal menghapus berkas bukti", error);
  }
}

/** Keeps a human readable name but strips any directory or control characters. */
export function sanitizeProofFileName(fileName: string): string {
  const base = fileName.replace(/\\/g, "/").split("/").pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"]/g, "").trim();
  return cleaned.slice(0, 120) || "bukti";
}

/** Response headers that force a private, non-sniffable download. */
export function proofResponseHeaders(input: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}): Record<string, string> {
  const safeName = sanitizeProofFileName(input.fileName).replace(/[^\x20-\x7e]/g, "_");
  return {
    "Content-Type": input.mimeType,
    "Content-Length": String(input.sizeBytes),
    "Content-Disposition": `attachment; filename="${safeName}"`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
  };
}

/**
 * Reads the raw request body while counting the actual bytes. Throws
 * `PAYLOAD_TOO_LARGE` as soon as the stream exceeds `maxBytes`, so an attacker
 * cannot bypass `Content-Length` (missing or forged) to buffer a huge body.
 */
export async function readBoundedRequestBody(
  request: Request,
  maxBytes = MAX_MULTIPART_BYTES,
): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ProofError("PAYLOAD_TOO_LARGE", "Ukuran permintaan terlalu besar.", 413);
  }

  const body = request.body;
  if (!body) return new Uint8Array();

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ProofError("PAYLOAD_TOO_LARGE", "Ukuran permintaan terlalu besar.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/**
 * Parses a multipart request only after the body was bounded by real byte
 * count. Throws `INVALID_MULTIPART` when the payload is not valid form data.
 */
export async function parseBoundedMultipart(
  request: Request,
  maxBytes = MAX_MULTIPART_BYTES,
): Promise<FormData> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    throw new ProofError("INVALID_CONTENT_TYPE", "Permintaan harus berupa multipart/form-data.", 415);
  }

  const bytes = await readBoundedRequestBody(request, maxBytes);
  try {
    // `Response` needs an exact `ArrayBuffer` view: copy the slice so the type is
    // unambiguous while the parsed form data keeps the original bytes.
    const payload = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    return await new Response(payload, { headers: { "content-type": contentType } }).formData();
  } catch {
    throw new ProofError("INVALID_MULTIPART", "Formulir unggahan tidak dapat dibaca.", 400);
  }
}

/** Max accepted size of a JSON payment body (well above any legitimate payload). */
export const MAX_JSON_BYTES = 16 * 1024;

/**
 * Parses a JSON body only after the raw bytes were bounded, so a client cannot
 * force a huge parse by omitting or forging `Content-Length`. Throws
 * `PAYLOAD_TOO_LARGE` / `INVALID_JSON`.
 */
export async function readBoundedJsonBody(
  request: Request,
  maxBytes = MAX_JSON_BYTES,
): Promise<unknown> {
  const bytes = await readBoundedRequestBody(request, maxBytes);
  if (bytes.byteLength === 0) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ProofError("INVALID_JSON", "Muatan permintaan bukan JSON yang valid.", 400);
  }
}

/** A `File`-like entry from parsed form data (string values excluded). */
export function isFileEntry(value: FormDataEntryValue | null | undefined): value is File {
  return typeof value === "object" && value !== null && typeof (value as File).arrayBuffer === "function";
}

/** Reads the `proof` entry as bytes and validates its type before storing it. */
export async function readProofFromFormData(
  formData: FormData,
  fieldName = PROOF_FIELD_NAME,
): Promise<{ bytes: Uint8Array; kind: ProofKind; originalName: string; declaredMime: string }> {
  const entry = formData.get(fieldName);
  if (!isFileEntry(entry)) {
    throw new ProofError("PROOF_REQUIRED", "Bukti pembayaran wajib diunggah.", 422);
  }
  if (entry.size > MAX_PROOF_BYTES) {
    throw new ProofError("PROOF_TOO_LARGE", "Berkas bukti melebihi batas 5 MiB.", 413);
  }

  const bytes = new Uint8Array(await entry.arrayBuffer());
  const validated = validateProofUpload({
    fileName: entry.name,
    declaredMime: entry.type,
    bytes,
  });

  return { bytes, kind: validated.kind, originalName: entry.name, declaredMime: validated.mimeType };
}

